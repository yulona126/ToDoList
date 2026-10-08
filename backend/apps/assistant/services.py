"""Assistant services: vocabulary, quota, normalization, orchestration.

The normalization layer (``normalize_drafts``) is the trust boundary: everything
the model says is untrusted input that must be coerced into real domain objects
or dropped with a warning (docs/ai-assistant.md §7).
"""

from __future__ import annotations

import logging
from typing import Any

from django.conf import settings
from django.utils import timezone

from apps.todos.models import Task, Workspace
from apps.todos.services import clean_date, clean_title

from . import local_parser
from .deepseek import (
    AiError,
    AiInvalidInput,
    AiNotConfigured,
    AiQuotaExceeded,
    DeepSeekClient,
)
from .models import AiCredential, AiUsageRecord
from .prompts import (
    SPLIT_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_user_message,
    estimate_max_tokens,
)

logger = logging.getLogger(__name__)

MAX_DRAFTS = 8
MAX_SUBTASKS = 5
MAX_SUBTASK_LENGTH = 60

VALID_PRIORITIES = {choice for choice, _ in Task.Priority.choices}
VALID_TYPES = {choice for choice, _ in Task.Type.choices}


# --------------------------------------------------------------------- quota
def tokens_used_today(user: Any) -> int:
    start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    return AiUsageRecord.tokens_since(user, start)


def quota_remaining(user: Any) -> int:
    budget = int(getattr(settings, "AI_DAILY_TOKEN_BUDGET", 50_000) or 0)
    if budget <= 0:
        return -1  # unlimited
    return max(0, budget - tokens_used_today(user))


def enforce_quota(user: Any) -> None:
    budget = int(getattr(settings, "AI_DAILY_TOKEN_BUDGET", 50_000) or 0)
    if budget <= 0:
        return
    used = tokens_used_today(user)
    if used >= budget:
        raise AiQuotaExceeded(
            f"今日 AI 配额已用尽（{used}/{budget} token），明天再试或调高 AI_DAILY_TOKEN_BUDGET。"
        )


# ---------------------------------------------------------------- vocabulary
def build_vocabulary(workspace: Workspace) -> dict[str, list[str]]:
    """Smallest possible context: names only, never ids, never existing tasks."""
    list_names = list(
        workspace.lists.filter(is_archived=False)
        .order_by("sort_order", "created_at")
        .values_list("name", flat=True)
    )
    tag_names = list(workspace.tags.order_by("name").values_list("name", flat=True))
    return {"lists": list_names, "tags": tag_names}


# --------------------------------------------------------------- credential
def get_credential(user: Any) -> AiCredential | None:
    return AiCredential.objects.filter(user=user).first()


def client_for(credential: AiCredential) -> DeepSeekClient:
    return DeepSeekClient(
        api_key=credential.get_api_key(),
        base_url=credential.base_url,
        model=credential.model,
    )


def record_usage(
    user: Any,
    kind: str,
    *,
    source: str = AiUsageRecord.Source.AI,
    model: str = "",
    ok: bool = True,
    error: str = "",
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cached_tokens: int = 0,
    total_tokens: int = 0,
    latency_ms: int = 0,
    created_tasks: int = 0,
) -> AiUsageRecord:
    return AiUsageRecord.objects.create(
        user=user,
        kind=kind,
        source=source,
        model=model,
        ok=ok,
        error=error[:2000],
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        total_tokens=total_tokens,
        latency_ms=latency_ms,
        created_tasks=created_tasks,
    )


# -------------------------------------------------------------- normalization
def _clean_enum(value: Any, allowed: set[str]) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip().lower()
    return candidate if candidate in allowed else None


def normalize_drafts(
    workspace: Workspace,
    raw_tasks: Any,
    *,
    default_list_id: int | None = None,
    default_task_type: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Coerce model output into drafts. Never raises; always returns warnings."""
    warnings: list[dict[str, str]] = []

    if not isinstance(raw_tasks, list):
        if raw_tasks is not None:
            warnings.append({"code": "bad_payload", "message": "模型返回的结构无法识别。"})
        return [], warnings

    lists = {
        item.name.strip().lower(): item
        for item in workspace.lists.all()
    }
    tags = {tag.name.strip().lower(): tag for tag in workspace.tags.all()}

    drafts: list[dict[str, Any]] = []
    for raw in raw_tasks:
        if not isinstance(raw, dict):
            continue
        if len(drafts) >= MAX_DRAFTS:
            warnings.append(
                {"code": "truncated", "message": f"结果超过 {MAX_DRAFTS} 条，已截断。"}
            )
            break

        title = clean_title(raw.get("t") or raw.get("title"))
        if not title:
            warnings.append({"code": "empty_title", "message": "有一条任务缺少标题，已跳过。"})
            continue

        # -- list: name → real id; unknown falls back to the inbox
        list_id: int | None = default_list_id
        list_name: str | None = None
        raw_list = raw.get("l") or raw.get("list")
        if isinstance(raw_list, str) and raw_list.strip():
            matched = lists.get(raw_list.strip().lower())
            if matched is not None:
                list_id, list_name = matched.id, matched.name
            else:
                list_id, list_name = None, None
                warnings.append(
                    {
                        "code": "list_not_found",
                        "message": f"未找到清单「{raw_list.strip()}」，该任务归入未分组。",
                        "value": raw_list.strip(),
                    }
                )
        elif list_id is not None:
            match_by_id = workspace.lists.filter(pk=list_id).first()
            list_name = match_by_id.name if match_by_id else None

        # -- tags: names only here; bulk-create does the get_or_create
        tag_ids: list[int] = []
        tag_names: list[str] = []
        raw_tags = raw.get("g") or raw.get("tags") or []
        if isinstance(raw_tags, list):
            for item in raw_tags[:6]:
                if not isinstance(item, str):
                    continue
                name = item.strip()[:40]
                if not name or name in tag_names:
                    continue
                tag_names.append(name)
                existing = tags.get(name.lower())
                if existing is not None:
                    tag_ids.append(existing.id)

        # -- sub-tasks
        subtasks: list[str] = []
        raw_sub = raw.get("s") or raw.get("subtasks") or []
        if isinstance(raw_sub, list):
            for item in raw_sub[:MAX_SUBTASKS]:
                text = item.get("t") if isinstance(item, dict) else item
                cleaned = clean_title(text)
                if cleaned:
                    subtasks.append(cleaned[:MAX_SUBTASK_LENGTH])

        priority = _clean_enum(raw.get("p") or raw.get("priority"), VALID_PRIORITIES)
        task_type = _clean_enum(raw.get("y") or raw.get("task_type"), VALID_TYPES)
        if task_type is None and default_task_type in VALID_TYPES:
            task_type = default_task_type

        due_value = clean_date(raw.get("d") or raw.get("due_date"))
        if (raw.get("d") or raw.get("due_date")) and due_value is None:
            warnings.append(
                {"code": "bad_date", "message": f"「{title}」的日期无法识别，已忽略。"}
            )

        drafts.append(
            {
                "t": title,
                "l": list_id,
                "l_name": list_name,
                "p": priority,
                "y": task_type,
                "d": due_value.isoformat() if due_value else None,
                "g": tag_ids,
                "g_names": tag_names,
                "s": subtasks,
            }
        )

    return drafts, warnings


# ------------------------------------------------------------------ orch.
def parse_text(
    user: Any,
    workspace: Workspace,
    text: str,
    *,
    mode: str = "auto",
    default_list_id: int | None = None,
    default_task_type: str | None = None,
) -> dict[str, Any]:
    """Local rules first, model only when needed (docs §2.2 T1)."""
    text = (text or "").strip()
    if not text:
        raise AiInvalidInput("请先输入要分析的内容。")

    lists = [
        {"id": item.id, "name": item.name}
        for item in workspace.lists.filter(is_archived=False)
    ]

    if mode in ("auto", "local"):
        local = local_parser.parse(
            text,
            lists=lists,
            today=timezone.localdate(),
            max_tasks=MAX_DRAFTS,
        )
        use_local = bool(local.drafts) and (
            mode == "local" or not local.should_escalate
        )
        if use_local:
            drafts, extra = normalize_drafts(
                workspace,
                [
                    {
                        "t": d.t,
                        "l": d.list_name,
                        "p": d.priority,
                        "y": d.task_type,
                        "d": d.due_date,
                        "g": d.tag_names,
                    }
                    for d in local.drafts
                ],
                default_list_id=default_list_id,
                default_task_type=default_task_type,
            )
            record_usage(user, AiUsageRecord.Kind.PARSE, source=AiUsageRecord.Source.LOCAL)
            return {
                "source": "local",
                "tasks": drafts,
                "warnings": [
                    {"code": "local", "message": message} for message in local.warnings
                ]
                + extra,
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "cached_tokens": 0,
                    "total_tokens": 0,
                },
                "latency_ms": 0,
            }

        if mode == "local":
            return {
                "source": "local",
                "tasks": [],
                "warnings": [
                    {"code": "empty", "message": "本地解析没有提取到任务。"}
                ],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "cached_tokens": 0,
                    "total_tokens": 0,
                },
                "latency_ms": 0,
            }

    # ---- AI path -----------------------------------------------------------
    credential = get_credential(user)
    if credential is None or not credential.usable:
        raise AiNotConfigured("尚未配置 AI，请先在「设置 → AI 分析」中填入 API Key。")

    enforce_quota(user)

    vocabulary = build_vocabulary(workspace)
    user_message = build_user_message(
        text,
        list_names=vocabulary["lists"],
        tag_names=vocabulary["tags"],
        today=timezone.localdate().isoformat(),
        max_tasks=MAX_DRAFTS,
    )

    client = client_for(credential)
    try:
        result = client.chat_json(
            system_prompt=SYSTEM_PROMPT,
            user_message=user_message,
            max_tokens=estimate_max_tokens(len(text)),
        )
    except AiError as exc:
        credential.last_error = str(exc)[:500]
        credential.save(update_fields=["last_error", "updated_at"])
        record_usage(user, AiUsageRecord.Kind.PARSE, model=credential.model, ok=False, error=str(exc))
        raise

    drafts, warnings = normalize_drafts(
        workspace,
        result.payload.get("tasks"),
        default_list_id=default_list_id,
        default_task_type=default_task_type,
    )

    credential.last_error = ""
    credential.last_verified_at = timezone.now()
    credential.save(update_fields=["last_error", "last_verified_at", "updated_at"])

    record_usage(
        user,
        AiUsageRecord.Kind.PARSE,
        model=credential.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        cached_tokens=result.cached_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
    )

    if not drafts and not warnings:
        warnings.append(
            {"code": "no_tasks", "message": "AI 没有从这段文字里识别出任务。"}
        )

    return {
        "source": "ai",
        "tasks": drafts,
        "warnings": warnings,
        "usage": {
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
            "cached_tokens": result.cached_tokens,
            "total_tokens": result.total_tokens,
        },
        "latency_ms": result.latency_ms,
    }


def split_task(user: Any, task: Task) -> dict[str, Any]:
    """Propose sub-tasks for one existing task."""
    credential = get_credential(user)
    if credential is None or not credential.usable:
        raise AiNotConfigured("尚未配置 AI，请先在「设置 → AI 分析」中填入 API Key。")

    enforce_quota(user)

    user_message = (
        f"任务: {task.title}\n"
        f"描述: {(task.description or '(无)')[:400]}\n"
        f"最多: {MAX_SUBTASKS} 条"
    )

    client = client_for(credential)
    try:
        result = client.chat_json(
            system_prompt=SPLIT_SYSTEM_PROMPT,
            user_message=user_message,
            max_tokens=200,
        )
    except AiError as exc:
        record_usage(user, AiUsageRecord.Kind.SPLIT, model=credential.model, ok=False, error=str(exc))
        raise

    raw = result.payload.get("subtasks")
    subtasks: list[str] = []
    seen: set[str] = set()
    if isinstance(raw, list):
        for item in raw[:MAX_SUBTASKS]:
            text = item.get("t") if isinstance(item, dict) else item
            cleaned = clean_title(text)
            if not cleaned or cleaned == task.title or cleaned in seen:
                continue
            seen.add(cleaned)
            subtasks.append(cleaned[:MAX_SUBTASK_LENGTH])

    record_usage(
        user,
        AiUsageRecord.Kind.SPLIT,
        model=credential.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        cached_tokens=result.cached_tokens,
        total_tokens=result.total_tokens,
        latency_ms=result.latency_ms,
    )

    return {
        "subtasks": [{"t": text} for text in subtasks],
        "usage": {
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
            "cached_tokens": result.cached_tokens,
            "total_tokens": result.total_tokens,
        },
        "latency_ms": result.latency_ms,
    }


def verify_credential(user: Any, credential: AiCredential) -> dict[str, Any]:
    client = client_for(credential)
    try:
        latency_ms, model = client.verify()
    except AiError as exc:
        credential.last_error = str(exc)[:500]
        credential.save(update_fields=["last_error", "updated_at"])
        record_usage(user, AiUsageRecord.Kind.TEST, model=credential.model, ok=False, error=str(exc))
        raise

    credential.last_error = ""
    credential.last_verified_at = timezone.now()
    credential.save(update_fields=["last_error", "last_verified_at", "updated_at"])
    record_usage(
        user, AiUsageRecord.Kind.TEST, model=credential.model, latency_ms=latency_ms
    )
    return {"ok": True, "model": model, "latency_ms": latency_ms}


