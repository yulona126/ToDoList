"""MCP tool definitions.

Exactly four tools — the tool list is part of the agent's context, so the
surface stays deliberately small. Every tool returns a compact Markdown string
and every failure is turned into a ``ToolError`` with a short readable message
(the SDK reports that to the model as ``isError: true``; an uncaught exception
would instead be logged locally as a crash and reach the model as a generic
"Error executing tool ...").
"""

from __future__ import annotations

from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from .client import TodoListClient, TodoListError
from .config import ConfigError, load_config
from .render import (
    render_bulk_action_result,
    render_bulk_create_result,
    render_tasks,
    render_workspaces,
)

VALID_STATUS = ("todo", "doing", "blocked", "done")
VALID_PRIORITY = ("low", "medium", "high", "urgent")
VALID_TYPE = ("dev", "meeting", "communication", "design", "research", "other")
VALID_DUE = ("today", "week", "overdue", "none")
VALID_ACTION = ("done", "todo", "archive")

MAX_CREATE = 100  # backend hard limit for /tasks/bulk-create/
MAX_ACTION = 500  # backend hard limit for /tasks/bulk/
CREATE_KEYS = (
    "title",
    "task_list",
    "description",
    "priority",
    "task_type",
    "due_date",
    "tag_names",
    "subtasks",
)

mcp = MCPServer(
    name="todolist",
    version="1.0.0",
    instructions=(
        "ToDoList 工作区工具。开始前先调用 list_workspaces 拿到 workspace_id；"
        "任务 id 一律以工具返回的 #id 为准，不要凭空编造。"
    ),
)


def _client() -> TodoListClient:
    """Build a client per call so a missing/edited env var is reported cleanly."""
    return TodoListClient(load_config())


def _fail(exc: Exception) -> ToolError:
    return ToolError(str(exc))


def _require_workspace_id(workspace_id: Any) -> int:
    try:
        value = int(workspace_id)
    except (TypeError, ValueError):
        raise ToolError(f"workspace_id 必须是整数，收到：{workspace_id!r}。先调用 list_workspaces。")
    if value <= 0:
        raise ToolError(f"workspace_id 必须是正整数，收到 {value}。先调用 list_workspaces。")
    return value


def _status_filter(status: str, include_done: bool) -> str:
    requested = [part.strip() for part in (status or "").split(",") if part.strip()]
    unknown = [part for part in requested if part not in VALID_STATUS]
    if unknown:
        raise ToolError(
            f"status 含未知取值 {', '.join(unknown)}；允许逗号分隔的 "
            f"{'|'.join(VALID_STATUS)}。"
        )
    if include_done:
        return ",".join(requested)
    # Done tasks are hidden unless explicitly asked for by `status`.
    if requested and set(requested) == {"done"}:
        return "done"
    effective = [part for part in requested if part != "done"]
    return ",".join(effective) if requested else "todo,doing,blocked"


@mcp.tool(
    description=(
        "列出 ToDoList 工作区（含已归档），返回 id / 名称 / 任务数统计的 Markdown 表。"
        "第一步总是调用它来拿到 workspace_id；如果用户提到的工作区不唯一，先问清楚再继续。"
        " [List workspaces with ids and task counts. Call this first.]"
    )
)
def list_workspaces() -> str:
    try:
        return render_workspaces(_client().list_workspaces())
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"列出工作区时发生未预期错误：{exc}") from None


@mcp.tool(
    description=(
        "读取某工作区的任务，返回按清单分组的紧凑 Markdown（每任务一行，总是带数字 id，"
        "子任务缩进在父任务下）。默认隐藏已完成任务；用 include_done=true 显示（渲染为 - [x]）。"
        " 过滤：status='todo,doing'（逗号分隔，逗号多值）、due=today|week|overdue|none、"
        "search=关键词。子任务仅对确实含子任务的父任务额外拉取。"
        " [Main read tool: returns compact Markdown tasks grouped by list, one line per task.]"
    )
)
def get_tasks(
    workspace_id: int,
    status: str = "",
    due: str = "",
    include_done: bool = False,
    search: str = "",
) -> str:
    workspace_id = _require_workspace_id(workspace_id)
    due = (due or "").strip()
    if due and due not in VALID_DUE:
        raise ToolError(f"due 取值必须是 {'|'.join(VALID_DUE)}，收到 {due!r}。")

    status_param = _status_filter(status, include_done)
    try:
        client = _client()
        workspace = client.get_workspace(workspace_id)
        filters: dict[str, Any] = {"parent": "null"}
        if status_param:
            filters["status"] = status_param
        if due:
            filters["due"] = due
        if (search or "").strip():
            filters["search"] = search.strip()
        tasks = client.list_tasks(workspace_id, **filters)

        # Only parents that actually report children cost an extra request.
        subtasks: dict[int, list[dict[str, Any]]] = {}
        for task in tasks:
            stats = task.get("subtask_stats")
            if not isinstance(stats, dict) or not int(stats.get("total") or 0):
                continue
            parent_id = int(task.get("id") or 0)
            if not parent_id:
                continue
            sub_filters: dict[str, Any] = {"parent": parent_id}
            if status_param:
                sub_filters["status"] = status_param
            subtasks[parent_id] = client.list_tasks(workspace_id, **sub_filters)
        return render_tasks(workspace, tasks, subtasks)
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"读取任务时发生未预期错误：{exc}") from None


@mcp.tool(
    description=(
        "在一个工作区里批量创建任务（POST /tasks/bulk-create/，最多 100 条）。"
        "tasks 是对象数组，每个对象：title（必填，1-200 字）、task_list（清单 id）、"
        "priority（low|medium|high|urgent）、task_type（dev|meeting|communication|design|research|other）、"
        "due_date（YYYY-MM-DD）、tag_names（按名新建/复用标签）、subtasks（子任务标题数组）。"
        "返回创建结果与它们的数字 id。写之前先用 get_tasks 读取现状，不要凭记忆写。"
        " [Bulk-create tasks; returns the created tasks with their ids.]"
    )
)
def create_tasks(workspace_id: int, tasks: list[dict]) -> str:
    workspace_id = _require_workspace_id(workspace_id)
    if not isinstance(tasks, list) or not tasks:
        raise ToolError("tasks 必须是非空数组。")
    if len(tasks) > MAX_CREATE:
        raise ToolError(f"单次最多创建 {MAX_CREATE} 条任务，收到 {len(tasks)} 条。请分批调用。")

    normalized: list[dict[str, Any]] = []
    wanted_lists: set[int] = set()
    for index, item in enumerate(tasks, start=1):
        if not isinstance(item, dict):
            raise ToolError(f"第 {index} 条不是对象（期望 dict），收到 {type(item).__name__}。")
        unknown = [key for key in item if key not in CREATE_KEYS]
        if unknown:
            raise ToolError(
                f"第 {index} 条含不支持的字段 {', '.join(str(k) for k in unknown)}；"
                f"允许：{', '.join(CREATE_KEYS)}。"
            )
        title = str(item.get("title") or "").strip()
        if not title:
            raise ToolError(f"第 {index} 条缺少 title。")
        if len(title) > 200:
            raise ToolError(f"第 {index} 条的 title 超过 200 字（{len(title)}）。")

        row: dict[str, Any] = {"title": title}
        if item.get("task_list") is not None:
            try:
                list_id = int(item["task_list"])
            except (TypeError, ValueError):
                raise ToolError(f"第 {index} 条的 task_list 必须是清单 id（整数）。") from None
            wanted_lists.add(list_id)
            row["task_list"] = list_id
        if item.get("description"):
            row["description"] = str(item["description"])
        if item.get("priority"):
            priority = str(item["priority"]).strip()
            if priority not in VALID_PRIORITY:
                raise ToolError(
                    f"第 {index} 条的 priority={priority!r} 不合法；允许 {'|'.join(VALID_PRIORITY)}。"
                )
            row["priority"] = priority
        if item.get("task_type"):
            task_type = str(item["task_type"]).strip()
            if task_type not in VALID_TYPE:
                raise ToolError(
                    f"第 {index} 条的 task_type={task_type!r} 不合法；允许 {'|'.join(VALID_TYPE)}。"
                )
            row["task_type"] = task_type
        if item.get("due_date"):
            due_date = str(item["due_date"]).strip()
            if not _is_iso_date(due_date):
                raise ToolError(f"第 {index} 条的 due_date={due_date!r} 不是 YYYY-MM-DD 格式。")
            row["due_date"] = due_date
        if item.get("tag_names"):
            names = item["tag_names"]
            if not isinstance(names, list):
                raise ToolError(f"第 {index} 条的 tag_names 必须是字符串数组。")
            row["tag_names"] = [str(name).strip() for name in names if str(name).strip()]
        if item.get("subtasks"):
            subtasks = item["subtasks"]
            if not isinstance(subtasks, list):
                raise ToolError(f"第 {index} 条的 subtasks 必须是标题字符串数组。")
            titles = [str(sub).strip() for sub in subtasks if str(sub).strip()]
            if titles:
                row["subtasks"] = titles
        normalized.append(row)

    try:
        client = _client()
        if wanted_lists:
            available = client.list_lists(workspace_id)
            known = {int(lst.get("id") or 0): lst for lst in available}
            missing = sorted(wanted_lists - set(known))
            if missing:
                hint = "、".join(f"{i}={known[i].get('name')}" for i in sorted(known)) or "（无清单）"
                raise ToolError(
                    f"清单 id {missing} 不属于工作区 {workspace_id}（该工作区的清单：{hint}）。"
                    "先用 get_tasks 确认清单 id，或省略 task_list 落到「未分组」。"
                )
        payload = client.bulk_create(workspace_id, normalized)
        return render_bulk_create_result(workspace_id, len(normalized), payload)
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except ToolError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"创建任务时发生未预期错误：{exc}") from None


@mcp.tool(
    description=(
        "批量更新任务状态（POST /tasks/bulk/，最多 500 个 id）。"
        "action：done=标记完成 | todo=改回待办 | archive=归档。task_ids 必须是 get_tasks "
        "返回过的真实 id，返回实际更新条数。 [Batch update: done | todo | archive.]"
    )
)
def update_tasks(task_ids: list[int], action: str) -> str:
    if not isinstance(task_ids, list) or not task_ids:
        raise ToolError("task_ids 必须是非空整数数组。")
    if len(task_ids) > MAX_ACTION:
        raise ToolError(f"单次最多操作 {MAX_ACTION} 个任务，收到 {len(task_ids)} 个。请分批调用。")
    try:
        ids = [int(value) for value in task_ids]
    except (TypeError, ValueError):
        raise ToolError("task_ids 只能包含整数，请使用 get_tasks 返回的 #id。") from None
    if any(value <= 0 for value in ids):
        raise ToolError("task_ids 必须都是正整数，请使用 get_tasks 返回的 #id。")

    action = (action or "").strip()
    if action not in VALID_ACTION:
        raise ToolError(f"action={action!r} 不合法；允许 {'|'.join(VALID_ACTION)}。")

    try:
        payload = _client().bulk_action(ids, action)
        updated = payload.get("updated")
        updated = int(updated) if isinstance(updated, (int, float, str)) else 0
        return render_bulk_action_result(action, ids, updated)
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"更新任务时发生未预期错误：{exc}") from None


def _is_iso_date(value: str) -> bool:
    if len(value) != 10 or value[4] != "-" or value[7] != "-":
        return False
    return value.replace("-", "").isdigit()
