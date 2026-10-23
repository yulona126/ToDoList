"""Lightweight Accept-Language aware API messages.

The web UI sends ``Accept-Language: zh-CN`` or ``en-US``. Without a header
(tests, CLI, MCP) we default to ``zh-CN`` so existing Chinese assertions keep
working.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

DEFAULT_LANGUAGE = "zh-CN"
SUPPORTED_LANGUAGES = frozenset({"zh-CN", "en-US"})

_language: ContextVar[str] = ContextVar("todolist_api_language", default=DEFAULT_LANGUAGE)

# key → {"zh-CN": "...", "en-US": "..."}; use {name} style placeholders.
MESSAGES: dict[str, dict[str, str]] = {
    # --- common -------------------------------------------------------------
    "common.bad_request": {
        "zh-CN": "请求参数有误",
        "en-US": "Invalid request",
    },
    "common.field_required": {
        "zh-CN": "该字段为必填项。",
        "en-US": "This field is required.",
    },
    "common.cannot_be_empty": {
        "zh-CN": "不能为空。",
        "en-US": "This field cannot be empty.",
    },
    # --- auth / accounts ----------------------------------------------------
    "auth.email_taken": {
        "zh-CN": "该邮箱已被注册。",
        "en-US": "This email is already registered.",
    },
    "auth.username_charset": {
        "zh-CN": "用户名只能包含字母、数字、下划线和连字符。",
        "en-US": "Username may only contain letters, numbers, underscores and hyphens.",
    },
    "auth.username_taken": {
        "zh-CN": "该用户名已被占用。",
        "en-US": "This username is already taken.",
    },
    "auth.password_mismatch": {
        "zh-CN": "两次输入的密码不一致。",
        "en-US": "The two passwords do not match.",
    },
    "auth.invalid_credentials": {
        "zh-CN": "邮箱或密码不正确。",
        "en-US": "Incorrect email or password.",
    },
    "auth.wrong_password": {
        "zh-CN": "当前密码不正确。",
        "en-US": "Current password is incorrect.",
    },
    "auth.refresh_missing": {
        "zh-CN": "缺少 refresh 字段。",
        "en-US": "Missing refresh field.",
    },
    "auth.api_token_invalid": {
        "zh-CN": "API Token 无效、已撤销或已过期。",
        "en-US": "API token is invalid, revoked, or expired.",
    },
    "auth.account_disabled": {
        "zh-CN": "该账号已被停用。",
        "en-US": "This account has been disabled.",
    },
    "auth.api_token_not_found": {
        "zh-CN": "API Token 不存在。",
        "en-US": "API token not found.",
    },
    # --- todos --------------------------------------------------------------
    "todos.workspace_name_empty": {
        "zh-CN": "工作区名称不能为空。",
        "en-US": "Workspace name cannot be empty.",
    },
    "todos.workspace_missing": {
        "zh-CN": "工作区不存在。",
        "en-US": "Workspace not found.",
    },
    "todos.workspace_missing_id": {
        "zh-CN": "工作区 {workspace_id} 不存在。",
        "en-US": "Workspace {workspace_id} not found.",
    },
    "todos.workspace_limit": {
        "zh-CN": "每个账号最多可创建 {limit} 个工作区。",
        "en-US": "Each account can create at most {limit} workspaces.",
    },
    "todos.list_name_empty": {
        "zh-CN": "清单名称不能为空。",
        "en-US": "List name cannot be empty.",
    },
    "todos.tag_name_empty": {
        "zh-CN": "标签名称不能为空。",
        "en-US": "Tag name cannot be empty.",
    },
    "todos.task_title_empty": {
        "zh-CN": "任务标题不能为空。",
        "en-US": "Task title cannot be empty.",
    },
    "todos.list_wrong_workspace": {
        "zh-CN": "清单必须属于同一工作区。",
        "en-US": "The list must belong to the same workspace.",
    },
    "todos.parent_wrong_workspace": {
        "zh-CN": "父任务必须属于同一工作区。",
        "en-US": "The parent task must belong to the same workspace.",
    },
    "todos.subtask_nesting": {
        "zh-CN": "子任务不能再嵌套子任务（最多一层）。",
        "en-US": "Sub-tasks cannot nest further (one level only).",
    },
    "todos.parent_self": {
        "zh-CN": "任务不能作为自己的父任务。",
        "en-US": "A task cannot be its own parent.",
    },
    "todos.parent_has_subtasks": {
        "zh-CN": "该任务已有子任务，不能再成为其他任务的子任务。",
        "en-US": "This task already has sub-tasks and cannot become a sub-task.",
    },
    "todos.move_subtasks_first": {
        "zh-CN": "请先将其子任务移动到同一清单。",
        "en-US": "Move its sub-tasks to the same list first.",
    },
    "todos.tag_wrong_workspace": {
        "zh-CN": "标签 {name} 不属于该工作区。",
        "en-US": "Tag {name} does not belong to this workspace.",
    },
    "todos.reorder_limit": {
        "zh-CN": "单次最多重排 500 条。",
        "en-US": "You can reorder at most 500 items at a time.",
    },
    "todos.bulk_limit": {
        "zh-CN": "单次最多操作 500 条。",
        "en-US": "You can act on at most 500 items at a time.",
    },
    "todos.bulk_create_empty": {
        "zh-CN": "tasks 必须是非空数组。",
        "en-US": "`tasks` must be a non-empty array.",
    },
    "todos.bulk_create_limit": {
        "zh-CN": "单次最多创建 100 条任务。",
        "en-US": "You can create at most 100 tasks at a time.",
    },
    "todos.bulk_item_invalid": {
        "zh-CN": "第 {n} 条格式不正确。",
        "en-US": "Item {n} has an invalid format.",
    },
    "todos.bulk_item_workspace": {
        "zh-CN": "第 {n} 条缺少 workspace（也可在顶层传一次）。",
        "en-US": "Item {n} is missing workspace (or pass it once at the top level).",
    },
    "todos.bulk_item_title": {
        "zh-CN": "第 {n} 条缺少标题。",
        "en-US": "Item {n} is missing a title.",
    },
    "todos.bulk_item_list": {
        "zh-CN": "第 {n} 条的清单 {list_id} 不属于工作区 {workspace_id}。",
        "en-US": "Item {n}: list {list_id} does not belong to workspace {workspace_id}.",
    },
    "todos.bulk_item_list_invalid": {
        "zh-CN": "第 {n} 条 task_list 无效。",
        "en-US": "Item {n} has an invalid task_list.",
    },
    # --- assistant ----------------------------------------------------------
    "ai.api_key_short": {
        "zh-CN": "API Key 看起来太短了。",
        "en-US": "That API key looks too short.",
    },
    "ai.list_missing": {
        "zh-CN": "清单不存在。",
        "en-US": "List not found.",
    },
    "ai.api_key_required_first": {
        "zh-CN": "首次配置必须提供 API Key。",
        "en-US": "An API key is required for the first setup.",
    },
    "ai.api_key_missing": {
        "zh-CN": "尚未配置 API Key。",
        "en-US": "No API key configured yet.",
    },
    "ai.task_missing": {
        "zh-CN": "任务不存在。",
        "en-US": "Task not found.",
    },
    "ai.task_has_subtasks": {
        "zh-CN": "该任务已有子任务，请先清空。",
        "en-US": "This task already has sub-tasks — clear them first.",
    },
    "ai.not_configured": {
        "zh-CN": "尚未配置 AI，请先在「设置 → AI 分析」中填入 API Key。",
        "en-US": "AI is not configured. Add an API key under Settings → AI assistant.",
    },
    "ai.empty_input": {
        "zh-CN": "请先输入要分析的内容。",
        "en-US": "Enter some text to analyse first.",
    },
    "ai.quota_exhausted": {
        "zh-CN": "今日 AI 配额已用尽（{used}/{budget} token），明天再试或调高 AI_DAILY_TOKEN_BUDGET。",
        "en-US": "Today's AI quota is used up ({used}/{budget} tokens). Try again tomorrow or raise AI_DAILY_TOKEN_BUDGET.",
    },
    "ai.bad_payload": {
        "zh-CN": "模型返回的结构无法识别。",
        "en-US": "The model returned an unrecognised structure.",
    },
    "ai.truncated": {
        "zh-CN": "结果超过 {limit} 条，已截断。",
        "en-US": "More than {limit} results — truncated.",
    },
    "ai.empty_title_skipped": {
        "zh-CN": "有一条任务缺少标题，已跳过。",
        "en-US": "Skipped a task with no title.",
    },
    "ai.list_not_found": {
        "zh-CN": "未找到清单「{name}」，该任务归入未分组。",
        "en-US": 'No list named "{name}" — moved to Ungrouped.',
    },
    "ai.bad_date": {
        "zh-CN": "「{title}」的日期无法识别，已忽略。",
        "en-US": 'Could not parse the date on "{title}" — ignored.',
    },
    "ai.empty_extract": {
        "zh-CN": "没有从这段文字里提取到任务。",
        "en-US": "No tasks could be extracted from this text.",
    },
    "ai.output_truncated": {
        "zh-CN": "AI 输出被截断（max_tokens 用尽），本次没有可用结果。请重试；若反复出现请在设置里换一个模型。",
        "en-US": "AI output was truncated (max_tokens exhausted); no usable result. Retry, or switch models in Settings if it keeps happening.",
    },
    "ai.empty_response": {
        "zh-CN": "AI 返回了空内容，本次没有可用结果。请重试。",
        "en-US": "AI returned empty content; no usable result. Please retry.",
    },
    "ai.invalid_json": {
        "zh-CN": "AI 返回的内容不是合法 JSON，无法解析。原始回复：{snippet}",
        "en-US": "AI response is not valid JSON. Raw reply: {snippet}",
    },
    "ai.no_tasks_raw": {
        "zh-CN": "AI 没有返回可用的任务。原始回复：{snippet}",
        "en-US": "AI returned no usable tasks. Raw reply: {snippet}",
    },
    "ai.no_tasks": {
        "zh-CN": "AI 没有返回可用的任务。",
        "en-US": "AI returned no usable tasks.",
    },
    "ai.base_url_https": {
        "zh-CN": "base_url 必须是 https:// 地址。",
        "en-US": "base_url must be an https:// URL.",
    },
    "ai.base_url_host": {
        "zh-CN": "base_url 缺少主机名。",
        "en-US": "base_url is missing a hostname.",
    },
    "ai.base_url_localhost": {
        "zh-CN": "base_url 不允许指向本机地址。",
        "en-US": "base_url cannot point at localhost.",
    },
    "ai.base_url_private": {
        "zh-CN": "base_url 不允许指向内网地址。",
        "en-US": "base_url cannot point at a private network address.",
    },
    "ai.timeout": {
        "zh-CN": "调用 {url} 超时，请重试。",
        "en-US": "Timed out calling {url}. Please retry.",
    },
    "ai.connect_error": {
        "zh-CN": "无法连接 {url}：{error}",
        "en-US": "Cannot reach {url}: {error}",
    },
    "ai.key_invalid": {
        "zh-CN": "API Key 无效或已被撤销（401）。",
        "en-US": "API key is invalid or revoked (401).",
    },
    "ai.balance": {
        "zh-CN": "DeepSeek 账户余额不足（402）。",
        "en-US": "DeepSeek account balance is insufficient (402).",
    },
    "ai.rate_limited": {
        "zh-CN": "DeepSeek 触发限流（429），请稍后重试。",
        "en-US": "DeepSeek rate-limited the request (429). Try again shortly.",
    },
    "ai.http_error": {
        "zh-CN": "DeepSeek 返回 {status}：{detail}",
        "en-US": "DeepSeek returned {status}: {detail}",
    },
    "ai.non_json": {
        "zh-CN": "DeepSeek 返回了非 JSON 响应。",
        "en-US": "DeepSeek returned a non-JSON response.",
    },
    "ai.no_result": {
        "zh-CN": "DeepSeek 未返回任何结果。",
        "en-US": "DeepSeek returned no result.",
    },
    "ai.prompt_lists": {
        "zh-CN": "清单",
        "en-US": "Lists",
    },
    "ai.prompt_tags": {
        "zh-CN": "标签",
        "en-US": "Tags",
    },
    "ai.prompt_today": {
        "zh-CN": "今天",
        "en-US": "Today",
    },
    "ai.prompt_max": {
        "zh-CN": "最多",
        "en-US": "Max",
    },
    "ai.prompt_none": {
        "zh-CN": "(无)",
        "en-US": "(none)",
    },
    "ai.prompt_unit": {
        "zh-CN": "条",
        "en-US": "",
    },
    "ai.prompt_task": {
        "zh-CN": "任务",
        "en-US": "Task",
    },
    "ai.prompt_description": {
        "zh-CN": "描述",
        "en-US": "Description",
    },
}


def normalize_language(value: str | None) -> str:
    """Map an Accept-Language token (or UI code) onto a supported language."""
    if not value:
        return DEFAULT_LANGUAGE
    token = value.strip().lower().replace("_", "-")
    if token.startswith("en"):
        return "en-US"
    if token.startswith("zh"):
        return "zh-CN"
    return DEFAULT_LANGUAGE


def parse_accept_language(header: str | None) -> str:
    """Pick the best supported language from an Accept-Language header."""
    if not header:
        return DEFAULT_LANGUAGE
    # "en-US,en;q=0.9,zh-CN;q=0.8" → try in order, ignore q for simplicity
    # but still prefer earlier (higher-q typically listed first).
    for part in header.split(","):
        tag = part.split(";", 1)[0].strip()
        if not tag:
            continue
        lang = normalize_language(tag)
        # Only accept if the tag actually looked like en/zh; bare junk → skip
        low = tag.lower().replace("_", "-")
        if low.startswith("en") or low.startswith("zh"):
            return lang
    return DEFAULT_LANGUAGE


def get_language() -> str:
    return _language.get()


def activate(language: str) -> None:
    _language.set(normalize_language(language))


def t(key: str, **kwargs: Any) -> str:
    """Translate ``key`` for the active request language."""
    entry = MESSAGES.get(key)
    if entry is None:
        return key
    lang = get_language()
    template = entry.get(lang) or entry[DEFAULT_LANGUAGE]
    if kwargs:
        try:
            return template.format(**kwargs)
        except (KeyError, ValueError):
            return template
    return template


class LanguageMiddleware:
    """Activate API language from ``Accept-Language`` for the request."""

    def __init__(self, get_response: Any) -> None:
        self.get_response = get_response

    def __call__(self, request: Any) -> Any:
        lang = parse_accept_language(request.headers.get("Accept-Language"))
        token = _language.set(lang)
        try:
            return self.get_response(request)
        finally:
            _language.reset(token)
