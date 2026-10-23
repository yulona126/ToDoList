"""MCP tool definitions.

Task tools (4) + document tools (3). The tool list is part of the agent's
context, so the surface stays deliberately small. Every tool returns a compact
Markdown string and every failure is turned into a ``ToolError`` with a short
readable message (the SDK reports that to the model as ``isError: true``; an
uncaught exception would instead be logged locally as a crash and reach the
model as a generic "Error executing tool ...").
"""

from __future__ import annotations

from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from .client import TodoListClient, TodoListError
from .config import ConfigError, load_config
from .render import (
    render_architecture,
    render_bulk_action_result,
    render_bulk_create_result,
    render_document,
    render_documents,
    render_tasks,
    render_update_task_result,
    render_upsert_document_result,
    render_workspaces,
)

VALID_STATUS = ("todo", "doing", "blocked", "done")
VALID_PRIORITY = ("low", "medium", "high", "urgent")
VALID_TYPE = ("dev", "meeting", "communication", "design", "research", "other")
VALID_DUE = ("today", "week", "overdue", "none")
VALID_ACTION = ("done", "todo", "archive")
VALID_DOC_KIND = ("plan", "note", "decision", "spec")
VALID_DOC_STATUS = ("draft", "active", "archived")
VALID_ARCH_PREFERRED = ("mermaid", "image")

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
# PATCH /tasks/{id}/ — field updates for a single task.
UPDATE_KEYS = (
    "title",
    "description",
    "status",
    "priority",
    "task_type",
    "due_date",
    "task_list",
    "is_archived",
)

mcp = MCPServer(
    name="todolist",
    version="1.1.0",
    instructions=(
        "ToDoList 工作区工具。开始前先调用 list_workspaces 拿到 workspace_id；"
        "任务 id 一律以工具返回的 #id 为准，文档 id 以 doc#id / list_documents 为准，不要凭空编造。"
        "改任务标题/描述/优先级等用 update_task；批量改完成/待办/归档用 update_tasks。"
        "开发计划写进 documents（kind=plan），不要只落到本地 markdown。"
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
        "tasks 是对象数组，每个对象：title（必填，1-200 字）、description、task_list（清单 id）、"
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
        "返回过的真实 id，返回实际更新条数。"
        "若要改标题/描述/优先级等字段，请用 update_task。"
        " [Batch status: done | todo | archive. For fields use update_task.]"
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


@mcp.tool(
    description=(
        "更新单条任务的字段（PATCH /tasks/{id}/）。"
        "fields 对象可含：title、description、status（todo|doing|blocked|done）、"
        "priority（low|medium|high|urgent）、task_type（dev|meeting|communication|design|research|other）、"
        "due_date（YYYY-MM-DD；传空字符串或 null 清除）、task_list（清单 id；传 null 移到未分组）、"
        "is_archived（bool）。只传要改的字段。"
        "改描述示例：update_task(158, {\"description\": \"…\"})。"
        "批量改状态请用 update_tasks。"
        " [Patch one task's fields (title/description/status/…).]"
    )
)
def update_task(task_id: int, fields: dict) -> str:
    try:
        task_id = int(task_id)
    except (TypeError, ValueError):
        raise ToolError(f"task_id 必须是整数，收到：{task_id!r}。") from None
    if task_id <= 0:
        raise ToolError(f"task_id 必须是正整数，收到 {task_id}。")

    if not isinstance(fields, dict) or not fields:
        raise ToolError(
            "fields 必须是非空对象，例如 {\"description\": \"…\", \"priority\": \"high\"}。"
        )

    unknown = [key for key in fields if key not in UPDATE_KEYS]
    if unknown:
        raise ToolError(
            f"fields 含不支持的键 {', '.join(str(k) for k in unknown)}；"
            f"允许：{', '.join(UPDATE_KEYS)}。"
        )

    patch: dict[str, Any] = {}
    changed: list[str] = []

    if "title" in fields:
        title = str(fields.get("title") or "").strip()
        if not title:
            raise ToolError("title 不能为空。")
        if len(title) > 200:
            raise ToolError(f"title 超过 200 字（{len(title)}）。")
        patch["title"] = title
        changed.append("title")

    if "description" in fields:
        # Allow clearing with "" / null.
        value = fields.get("description")
        patch["description"] = "" if value is None else str(value)
        changed.append("description")

    if "status" in fields:
        status = str(fields.get("status") or "").strip()
        if status not in VALID_STATUS:
            raise ToolError(f"status={status!r} 不合法；允许 {'|'.join(VALID_STATUS)}。")
        patch["status"] = status
        changed.append("status")

    if "priority" in fields:
        priority = str(fields.get("priority") or "").strip()
        if priority not in VALID_PRIORITY:
            raise ToolError(f"priority={priority!r} 不合法；允许 {'|'.join(VALID_PRIORITY)}。")
        patch["priority"] = priority
        changed.append("priority")

    if "task_type" in fields:
        task_type = str(fields.get("task_type") or "").strip()
        if task_type not in VALID_TYPE:
            raise ToolError(f"task_type={task_type!r} 不合法；允许 {'|'.join(VALID_TYPE)}。")
        patch["task_type"] = task_type
        changed.append("task_type")

    if "due_date" in fields:
        due = fields.get("due_date")
        if due is None or (isinstance(due, str) and not due.strip()):
            patch["due_date"] = None
        else:
            due_date = str(due).strip()
            if not _is_iso_date(due_date):
                raise ToolError(f"due_date={due_date!r} 不是 YYYY-MM-DD 格式。")
            patch["due_date"] = due_date
        changed.append("due_date")

    if "task_list" in fields:
        list_value = fields.get("task_list")
        if list_value is None or list_value == "":
            patch["task_list"] = None
        else:
            try:
                patch["task_list"] = int(list_value)
            except (TypeError, ValueError):
                raise ToolError("task_list 必须是清单 id（整数）或 null。") from None
            if patch["task_list"] <= 0:
                raise ToolError("task_list 必须是正整数或 null。")
        changed.append("task_list")

    if "is_archived" in fields:
        archived = fields.get("is_archived")
        if not isinstance(archived, bool):
            raise ToolError("is_archived 必须是布尔值 true/false。")
        patch["is_archived"] = archived
        changed.append("is_archived")

    if not patch:
        raise ToolError("fields 里没有可提交的更新。")

    try:
        client = _client()
        # Validate list belongs to the same workspace when moving lists.
        if "task_list" in patch and patch["task_list"] is not None:
            current = client.get_task(task_id)
            workspace_id = int(current.get("workspace") or 0)
            available = client.list_lists(workspace_id)
            known = {int(lst.get("id") or 0) for lst in available}
            if patch["task_list"] not in known:
                raise ToolError(
                    f"清单 id {patch['task_list']} 不属于任务 #{task_id} 所在工作区 {workspace_id}。"
                    "先用 get_tasks 确认 list#id。"
                )
        updated = client.update_task(task_id, patch)
        return render_update_task_result(updated, changed)
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except ToolError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"更新任务字段时发生未预期错误：{exc}") from None


def _is_iso_date(value: str) -> bool:
    if len(value) != 10 or value[4] != "-" or value[7] != "-":
        return False
    return value.replace("-", "").isdigit()


def _require_document_id(document_id: Any) -> int:
    try:
        value = int(document_id)
    except (TypeError, ValueError):
        raise ToolError(
            f"document_id 必须是整数，收到：{document_id!r}。先调用 list_documents。"
        ) from None
    if value <= 0:
        raise ToolError(f"document_id 必须是正整数，收到 {value}。先调用 list_documents。")
    return value


@mcp.tool(
    description=(
        "列出某工作区的文档（计划/笔记/决策/规格），返回紧凑 Markdown 摘要（带 doc id）。"
        "过滤：kind=plan|note|decision|spec（可逗号多值）、status=draft|active|archived、"
        "search=关键词、include_archived=true。默认隐藏已归档。"
        "整理开发计划前可先调它看是否已有 plan。"
        " [List workspace documents (plans/notes).]"
    )
)
def list_documents(
    workspace_id: int,
    kind: str = "",
    status: str = "",
    include_archived: bool = False,
    search: str = "",
) -> str:
    workspace_id = _require_workspace_id(workspace_id)
    kind = (kind or "").strip()
    status = (status or "").strip()
    if kind:
        parts = [part.strip() for part in kind.split(",") if part.strip()]
        unknown = [part for part in parts if part not in VALID_DOC_KIND]
        if unknown:
            raise ToolError(
                f"kind 含未知取值 {', '.join(unknown)}；允许 {'|'.join(VALID_DOC_KIND)}。"
            )
        kind = ",".join(parts)
    if status:
        parts = [part.strip() for part in status.split(",") if part.strip()]
        unknown = [part for part in parts if part not in VALID_DOC_STATUS]
        if unknown:
            raise ToolError(
                f"status 含未知取值 {', '.join(unknown)}；允许 {'|'.join(VALID_DOC_STATUS)}。"
            )
        status = ",".join(parts)

    try:
        client = _client()
        workspace = client.get_workspace(workspace_id)
        filters: dict[str, Any] = {"include_archived": include_archived}
        if kind:
            filters["kind"] = kind
        if status:
            filters["status"] = status
        if (search or "").strip():
            filters["search"] = search.strip()
        docs = client.list_documents(workspace_id, **filters)
        return render_documents(workspace, docs)
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"列出文档时发生未预期错误：{exc}") from None


@mcp.tool(
    description=(
        "读取一篇文档的完整 Markdown 正文。document_id 必须来自 list_documents。"
        " [Fetch one document body by id.]"
    )
)
def get_document(document_id: int) -> str:
    document_id = _require_document_id(document_id)
    try:
        return render_document(_client().get_document(document_id))
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"读取文档时发生未预期错误：{exc}") from None


@mcp.tool(
    description=(
        "创建或更新工作区文档（POST/PATCH /documents/）。"
        "传 document_id 则更新，否则新建。字段：title（新建必填，1-200 字）、body（Markdown）、"
        "kind（plan|note|decision|spec，默认 plan）、status（draft|active|archived，默认 active）、"
        "path（可选，仓库相对路径指针）。"
        "整理开发计划时应把产物写回这里（保留任务 #id），不要只写本地文件。"
        "写之前先 list_documents / get_document 确认现状。"
        " [Create or update a workspace document.]"
    )
)
def upsert_document(
    workspace_id: int,
    title: str = "",
    body: str = "",
    kind: str = "plan",
    status: str = "active",
    path: str = "",
    document_id: int = 0,
) -> str:
    workspace_id = _require_workspace_id(workspace_id)
    kind = (kind or "plan").strip() or "plan"
    status = (status or "active").strip() or "active"
    if kind not in VALID_DOC_KIND:
        raise ToolError(f"kind={kind!r} 不合法；允许 {'|'.join(VALID_DOC_KIND)}。")
    if status not in VALID_DOC_STATUS:
        raise ToolError(f"status={status!r} 不合法；允许 {'|'.join(VALID_DOC_STATUS)}。")

    updating = bool(document_id)
    if updating:
        document_id = _require_document_id(document_id)

    title = (title or "").strip()
    if not updating and not title:
        raise ToolError("新建文档必须提供 title。")
    if title and len(title) > 200:
        raise ToolError(f"title 超过 200 字（{len(title)}）。")

    payload: dict[str, Any] = {}
    if title:
        payload["title"] = title
    # Allow clearing body with an explicit empty string on update; on create default "".
    if updating or body or body == "":
        payload["body"] = body if body is not None else ""
    payload["kind"] = kind
    payload["status"] = status
    payload["path"] = (path or "").strip()

    try:
        client = _client()
        # Ensure the workspace exists for this token before write.
        client.get_workspace(workspace_id)
        if updating:
            # Confirm the document belongs to the requested workspace.
            existing = client.get_document(document_id)
            existing_ws = int(existing.get("workspace") or 0)
            if existing_ws != workspace_id:
                raise ToolError(
                    f"文档 #{document_id} 属于工作区 {existing_ws}，与请求的 workspace_id={workspace_id} 不一致。"
                )
            doc = client.update_document(document_id, payload)
            return render_upsert_document_result(False, doc)

        payload["workspace"] = workspace_id
        if "title" not in payload:
            raise ToolError("新建文档必须提供 title。")
        doc = client.create_document(payload)
        return render_upsert_document_result(True, doc)
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except ToolError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"写入文档时发生未预期错误：{exc}") from None


@mcp.tool(
    description=(
        "读取某工作区的唯一架构图（Mermaid 源码 + 是否有上传图片）。"
        "每个工作区只有一份；若尚未创建则返回空壳。"
        " [Get the single architecture diagram for a workspace.]"
    )
)
def get_architecture(workspace_id: int) -> str:
    workspace_id = _require_workspace_id(workspace_id)
    try:
        return render_architecture(_client().get_architecture(workspace_id))
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"读取架构图时发生未预期错误：{exc}") from None


@mcp.tool(
    description=(
        "创建或更新工作区的唯一架构图（PUT /workspaces/{id}/architecture/）。"
        "传 mermaid（Mermaid 源码）、可选 title、preferred（mermaid|image）。"
        "图片请在网页端上传；MCP 只写 Mermaid 文本。"
        "写之前可先 get_architecture 看现状。"
        " [Upsert the workspace architecture Mermaid source.]"
    )
)
def upsert_architecture(
    workspace_id: int,
    mermaid: str = "",
    title: str = "",
    preferred: str = "mermaid",
) -> str:
    workspace_id = _require_workspace_id(workspace_id)
    preferred = (preferred or "mermaid").strip() or "mermaid"
    if preferred not in VALID_ARCH_PREFERRED:
        raise ToolError(
            f"preferred={preferred!r} 不合法；允许 {'|'.join(VALID_ARCH_PREFERRED)}。"
        )
    title = (title or "").strip()
    if len(title) > 200:
        raise ToolError(f"title 超过 200 字（{len(title)}）。")

    payload: dict[str, Any] = {
        "mermaid": mermaid if mermaid is not None else "",
        "preferred": preferred,
    }
    if title:
        payload["title"] = title

    try:
        client = _client()
        client.get_workspace(workspace_id)
        diagram = client.upsert_architecture(workspace_id, payload)
        return f"已更新架构图：\n{render_architecture(diagram)}"
    except (TodoListError, ConfigError) as exc:
        raise _fail(exc) from None
    except Exception as exc:  # pragma: no cover - defensive
        raise ToolError(f"写入架构图时发生未预期错误：{exc}") from None
