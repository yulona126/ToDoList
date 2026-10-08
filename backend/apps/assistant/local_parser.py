"""Local rule-based parser — T1 in docs/ai-assistant.md §2.2.

This is the single biggest token saver: a marked-up one-liner like

    写登录页 @开发 #api !高 明天

never reaches the model at all. The frontend mirrors this grammar in
``src/lib/localParse.ts``; **the two must stay in sync**.

Pure functions only — no Django, no ORM, no I/O — so it is trivially testable
and can be reused by a management command later.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

# --- escalation thresholds (docs §2.2) -------------------------------------
CONNECTORS = ("和", "另外", "顺便", "还有", "以及", "并且", "同时")
MAX_LOCAL_LINES = 2
MAX_LOCAL_LENGTH = 40

PRIORITY_SYNONYMS: dict[str, str] = {
    "低": "low", "low": "low", "l": "low",
    "中": "medium", "medium": "medium", "m": "medium", "普通": "medium",
    "高": "high", "high": "high", "h": "high",
    "紧急": "urgent", "急": "urgent", "urgent": "urgent", "u": "urgent",
}

TYPE_SYNONYMS: dict[str, str] = {
    "开发": "dev", "dev": "dev",
    "会议": "meeting", "meeting": "meeting",
    "沟通": "communication", "communication": "communication",
    "设计": "design", "design": "design",
    "调研": "research", "research": "research",
    "其他": "other", "other": "other",
}

WEEKDAY_NAMES = {
    "一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6,
}

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SHORT_DATE_RE = re.compile(r"^(\d{1,2})-(\d{1,2})$")


@dataclass
class LocalDraft:
    t: str
    list_name: str | None = None
    tag_names: list[str] = field(default_factory=list)
    priority: str | None = None
    task_type: str | None = None
    due_date: str | None = None


@dataclass
class LocalParseResult:
    drafts: list[LocalDraft]
    warnings: list[str]
    should_escalate: bool


def _resolve_relative_date(word: str, today: date) -> date | None:
    """Chinese relative-date words → absolute date."""
    table = {
        "今天": 0, "today": 0, "今日": 0,
        "明天": 1, "tomorrow": 1, "明日": 1,
        "后天": 2, "大后天": 3,
    }
    if word in table:
        return today + timedelta(days=table[word])

    match = re.fullmatch(r"(下+)?(?:周|星期|礼拜)([一二三四五六日天])", word)
    if match:
        prefix, day_char = match.groups()
        target = WEEKDAY_NAMES[day_char]
        if prefix:
            # "下周三" = that weekday in the *next calendar week*, counted from
            # Monday. Taking "the next occurrence" and adding 7 overshoots by a
            # week whenever that weekday has already passed — with today=Thu,
            # 周三 would resolve to the Wednesday *after* next.
            monday = (
                today
                - timedelta(days=today.weekday())
                + timedelta(weeks=len(prefix))
            )
            return monday + timedelta(days=target)
        # Days until the next occurrence of that weekday; 0 means today.
        return today + timedelta(days=(target - today.weekday()) % 7)

    if word in ("下周", "下个星期"):
        # Monday of next week.
        return today + timedelta(days=7 - today.weekday())

    short = _SHORT_DATE_RE.fullmatch(word)
    if short:
        month, day = int(short.group(1)), int(short.group(2))
        try:
            return date(today.year, month, day)
        except ValueError:
            return None

    if _DATE_RE.fullmatch(word):
        try:
            return date.fromisoformat(word)
        except ValueError:
            return None

    return None


def _parse_line(
    line: str,
    *,
    today: date,
    list_lookup: dict[str, str],
    unknown_list_label: str,
) -> tuple[LocalDraft | None, list[str]]:
    """Parse one line. Returns (draft, warnings)."""
    warnings: list[str] = []
    forced_title = line.lstrip().startswith("^")
    if forced_title:
        line = line.lstrip()[1:]

    title_parts: list[str] = []
    list_name: str | None = None
    tag_names: list[str] = []
    priority: str | None = None
    task_type: str | None = None
    due: date | None = None

    for token in line.split():
        if not forced_title and token.startswith("@") and len(token) > 1:
            raw = token[1:]
            resolved = list_lookup.get(raw.lower())
            if resolved is None:
                warnings.append(f"未找到清单「{raw}」，已归入{unknown_list_label}")
            else:
                list_name = resolved
        elif not forced_title and token.startswith("#") and len(token) > 1:
            name = token[1:].strip()
            if name and name not in tag_names:
                tag_names.append(name)
        elif not forced_title and token.startswith("!") and len(token) > 1:
            value = PRIORITY_SYNONYMS.get(token[1:].lower())
            if value:
                priority = value
            else:
                title_parts.append(token)
        elif not forced_title and token.startswith("/") and len(token) > 1:
            value = TYPE_SYNONYMS.get(token[1:].lower())
            if value:
                task_type = value
            else:
                title_parts.append(token)
        elif not forced_title and due is None:
            candidate = _resolve_relative_date(token, today)
            if candidate is not None:
                due = candidate
            else:
                title_parts.append(token)
        else:
            title_parts.append(token)

    title = " ".join(title_parts).strip()
    if not title:
        if forced_title:
            return None, warnings
        # Marker-only input carries no action: nothing to create.
        return None, warnings

    return (
        LocalDraft(
            t=title,
            list_name=list_name,
            tag_names=tag_names,
            priority=priority,
            task_type=task_type,
            due_date=due.isoformat() if due else None,
        ),
        warnings,
    )


def should_escalate(text: str) -> bool:
    """Whether this text is too free-form for the rules (docs §2.2)."""
    stripped = text.strip()
    if not stripped:
        return False
    if stripped.lstrip().startswith("^"):
        return False

    lines = [line for line in stripped.splitlines() if line.strip()]
    if len(lines) > MAX_LOCAL_LINES:
        return True
    if len(stripped) > MAX_LOCAL_LENGTH:
        return True
    return any(connector in stripped for connector in CONNECTORS)


def parse(
    text: str,
    *,
    lists: list[dict[str, Any]],
    today: date,
    unknown_list_label: str = "未分组",
    max_tasks: int = 8,
) -> LocalParseResult:
    """Parse free text into drafts without any network call."""
    list_lookup = {item["name"].strip().lower(): item["name"] for item in lists}

    drafts: list[LocalDraft] = []
    warnings: list[str] = []

    for line in text.splitlines():
        if not line.strip():
            continue
        draft, line_warnings = _parse_line(
            line,
            today=today,
            list_lookup=list_lookup,
            unknown_list_label=unknown_list_label,
        )
        warnings.extend(line_warnings)
        if draft is not None:
            drafts.append(draft)
        if len(drafts) >= max_tasks:
            warnings.append(f"最多创建 {max_tasks} 条任务")
            break

    return LocalParseResult(
        drafts=drafts,
        warnings=warnings,
        should_escalate=should_escalate(text),
    )
