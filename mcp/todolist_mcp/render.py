"""Task/workspace data -> compact Markdown for the model.

Everything here is tuned for context economy: one line per task, no JSON, no
repeated column headers, no blank lines between tasks.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Iterable, Mapping, Sequence

# Enum labels from docs/api.md §0.4. Kept short on purpose.
PRIORITY_ZH = {"low": "低", "medium": "中", "high": "高", "urgent": "急"}
TYPE_ZH = {
    "dev": "开发",
    "meeting": "会议",
    "communication": "沟通",
    "design": "设计",
    "research": "调研",
    "other": "其他",
}
STATUS_ZH = {"todo": "待办", "doing": "进行中", "blocked": "阻塞", "done": "已完成"}

UNGROUPED = "未分组"


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def format_due(value: Any, current_year: int | None = None) -> str:
    """``2026-10-13`` -> ``10-13``; keeps the year when it is not the current one."""
    if not isinstance(value, str) or len(value) < 10:
        return ""
    year, month, day = value[:4], value[5:7], value[8:10]
    current_year = current_year or date.today().year
    if year.isdigit() and int(year) != current_year:
        return f"{year}-{month}-{day}"
    return f"{month}-{day}"


def _workspace_row(workspace: Mapping[str, Any]) -> str:
    stats = workspace.get("stats") or {}
    name = str(workspace.get("name") or "(未命名)")
    if workspace.get("is_archived"):
        name = f"{name} [已归档]"
    description = str(workspace.get("description") or "").replace("|", "/").replace("\n", " ")
    return (
        f"| {_as_int(workspace.get('id'))} | {name} "
        f"| {_as_int(stats.get('total'))} | {_as_int(stats.get('todo'))} "
        f"| {_as_int(stats.get('doing'))} | {_as_int(stats.get('blocked'))} "
        f"| {_as_int(stats.get('done'))} | {_as_int(stats.get('overdue'))} "
        f"| {description} |"
    )


def render_workspaces(workspaces: Sequence[Mapping[str, Any]]) -> str:
    if not workspaces:
        return "工作区列表为空。请先在 ToDoList 网页端创建一个工作区。"
    lines = [
        "| id | 名称 | 总数 | 待办 | 进行 | 阻塞 | 完成 | 逾期 | 描述 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    lines.extend(_workspace_row(w) for w in workspaces)
    return "\n".join(lines)


def _task_line(task: Mapping[str, Any], *, indent: str = "") -> str:
    status = str(task.get("status") or "todo")
    checkbox = "x" if status == "done" else " "
    parts = [f"- [{checkbox}] #{_as_int(task.get('id'))} {str(task.get('title') or '').strip()}"]

    meta: list[str] = []
    if status not in ("todo", "done"):
        meta.append(STATUS_ZH.get(status, status))
    meta.append(PRIORITY_ZH.get(str(task.get("priority") or "medium"), str(task.get("priority") or "")))
    meta.append(TYPE_ZH.get(str(task.get("task_type") or "other"), str(task.get("task_type") or "")))
    due = format_due(task.get("due_date"))
    if due:
        meta.append(f"{due}!" if task.get("is_overdue") else due)
    elif task.get("is_overdue"):
        meta.append("逾期")

    line = parts[0] + "".join(f" · {m}" for m in meta if m)
    for tag in _tag_names(task):
        line += f" · #{tag}"
    if task.get("is_archived"):
        line += " · [已归档]"
    return f"{indent}{line}"


def _tag_names(task: Mapping[str, Any]) -> list[str]:
    tags = task.get("tags")
    if not isinstance(tags, Iterable):
        return []
    names: list[str] = []
    for tag in tags:
        if isinstance(tag, Mapping):
            name = str(tag.get("name") or "").strip()
            if name:
                names.append(name)
        elif isinstance(tag, str) and tag.strip():
            names.append(tag.strip())
    return names


def render_tasks(
    workspace: Mapping[str, Any],
    tasks: Sequence[Mapping[str, Any]],
    subtasks_by_parent: Mapping[int, Sequence[Mapping[str, Any]]] | None = None,
) -> str:
    """Group top-level ``tasks`` by list; render children indented underneath."""
    subtasks_by_parent = subtasks_by_parent or {}
    workspace_name = str(workspace.get("name") or workspace.get("id") or "")
    header = f"# {workspace_name} (id={_as_int(workspace.get('id'))}) · {len(tasks)} 项"

    if not tasks:
        return (
            f"{header}\n\n没有符合筛选条件的任务。"
            "可尝试放宽 status/due/search，或用 include_done=true 查看已完成任务。"
        )

    groups: dict[str | int, dict[str, Any]] = {}
    for task in tasks:
        list_id = task.get("task_list")
        key: str | int = _as_int(list_id) if list_id is not None else UNGROUPED
        bucket = groups.setdefault(
            key,
            {"name": str(task.get("task_list_name") or UNGROUPED), "tasks": []},
        )
        bucket["tasks"].append(task)

    blocks: list[str] = []
    for key, bucket in groups.items():
        name = bucket["name"] or UNGROUPED
        if key == UNGROUPED or key == 0:
            title = f"## {UNGROUPED} · {len(bucket['tasks'])} 项"
        else:
            title = f"## {name} · list#{key} · {len(bucket['tasks'])} 项"
        lines = [title]
        for task in bucket["tasks"]:
            lines.append(_task_line(task))
            for child in subtasks_by_parent.get(_as_int(task.get("id")), ()):
                lines.append(_task_line(child, indent="  "))
        blocks.append("\n".join(lines))

    return header + "\n\n" + "\n\n".join(blocks)


def render_bulk_create_result(
    workspace_id: int, requested: int, payload: Mapping[str, Any]
) -> str:
    created = payload.get("tasks") or []
    lines = [f"已在工作区 {workspace_id} 创建 {len(created)}/{requested} 条任务："]
    for task in created:
        line = _task_line(task)
        stats = task.get("subtask_stats")
        if isinstance(stats, Mapping) and _as_int(stats.get("total")):
            line += f" · 子任务 {_as_int(stats.get('total'))} 条"
        lines.append(line)
    return "\n".join(lines)


def render_bulk_action_result(action: str, task_ids: Sequence[int], updated: int) -> str:
    label = {"done": "标记完成", "todo": "改回待办", "archive": "归档"}.get(action, action)
    return f"{label}：更新 {updated}/{len(task_ids)} 条任务（ids: {', '.join(str(i) for i in task_ids)}）。"
