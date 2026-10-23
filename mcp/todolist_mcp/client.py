"""HTTP client over the ToDoList REST API.

Uses only the standard library (``urllib``) on purpose: the ``mcp`` 2.3.0
distribution depends on ``httpx2`` (a differently-named fork), so importing
``httpx`` from this package would not be portable across the venvs that
different clients create.

Design rules:

* Every failure becomes a ``TodoListError`` carrying a short, human-readable
  message — never a raw traceback, never the token.
* Pagination is followed via the ``next`` cursor until exhausted.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .config import Config, load_config

PAGE_SIZE = 200
MAX_PAGES = 200


class TodoListError(Exception):
    """An API/transport failure with a message that is safe to hand to a model."""


def _build_opener() -> urllib.request.OpenerDirector:
    """An opener that only honors *environment* proxies.

    On macOS ``urllib.request.getproxies()`` merges the SystemConfiguration
    proxy settings. If the machine runs a local proxy (Clash/Surge/...), every
    request to ``localhost`` or to a docker network name gets routed through it
    and comes back as ``502 Bad Gateway``. Honoring only ``http_proxy`` /
    ``https_proxy`` / ``no_proxy`` keeps local setups working while still
    supporting a genuine proxy when one is configured explicitly.
    """
    return urllib.request.build_opener(
        urllib.request.ProxyHandler(urllib.request.getproxies_environment())
    )


def _stringify_error(payload: Any, fallback: str) -> str:
    """Turn the ``{detail, errors}`` envelope into one readable line."""
    if not isinstance(payload, dict):
        return fallback
    parts: list[str] = []
    detail = payload.get("detail")
    if isinstance(detail, str) and detail.strip():
        parts.append(detail.strip())
    errors = payload.get("errors")
    if isinstance(errors, dict):
        for field, messages in errors.items():
            if isinstance(messages, (list, tuple)):
                text = "; ".join(str(m) for m in messages)
            else:
                text = str(messages)
            parts.append(f"{field}: {text}" if field != "non_field_errors" else text)
    elif isinstance(errors, (list, tuple)):
        parts.append("; ".join(str(m) for m in errors))
    return " | ".join(parts) if parts else fallback


def _clean_params(params: dict[str, Any] | None) -> list[tuple[str, str]]:
    """Drop empty values and stringify the rest, keeping a stable order."""
    out: list[tuple[str, str]] = []
    for key, value in (params or {}).items():
        if value is None:
            continue
        if isinstance(value, bool):
            out.append((key, "true" if value else "false"))
        elif isinstance(value, (list, tuple)):
            joined = ",".join(str(v) for v in value if str(v) != "")
            if joined:
                out.append((key, joined))
        elif str(value) != "":
            out.append((key, str(value)))
    return out


class TodoListClient:
    """Thin, typed-enough wrapper around the REST endpoints we need."""

    def __init__(self, config: Config | None = None) -> None:
        self._config = config or load_config()
        self._opener = _build_opener()

    # ------------------------------------------------------------------ core

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        body: Any | None = None,
    ) -> Any:
        url = f"{self._config.api_url}/{path.lstrip('/')}"
        query = urllib.parse.urlencode(_clean_params(params))
        if query:
            url = f"{url}?{query}"

        data = None
        headers = {
            "Accept": "application/json",
            "User-Agent": "todolist-mcp/1.0",
            **self._config.auth_header,
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self._opener.open(request, timeout=self._config.timeout) as response:
                raw = response.read()
                status = response.status
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            status = exc.code
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            raise TodoListError(
                f"无法连接 ToDoList API（{self._config.api_url}）：{reason}。"
                "请确认服务已启动，且 TODOLIST_API_URL 指向正确的地址。"
                f"[Cannot reach the ToDoList API: {reason}]"
            ) from None
        except TimeoutError:
            raise TodoListError(
                f"请求 ToDoList API 超时（{self._config.timeout:g}s）：{url.split('?')[0]}。"
            ) from None

        if not raw:
            if 200 <= status < 300:
                return None
            raise TodoListError(f"ToDoList API 返回 HTTP {status} 且响应体为空。")

        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            if 200 <= status < 300:
                raise TodoListError("ToDoList API 返回了非 JSON 内容，无法解析。") from None
            raise TodoListError(f"ToDoList API 返回 HTTP {status}（非 JSON 响应体）。") from None

        if 200 <= status < 300:
            return payload

        if status == 401:
            message = (
                "认证失败（401）：TODOLIST_TOKEN 无效或已失效。"
                "请在 ToDoList 网页端「设置 → API Tokens」重新生成，并更新 .cursor/mcp.json。"
            )
        elif status == 403:
            message = "无权限（403）：该 token 对目标工作区没有访问权限。"
        elif status == 404:
            message = "资源不存在（404），或不属于当前 token 对应的用户。请先用 list_workspaces 确认 id。"
        else:
            message = f"ToDoList API 返回 HTTP {status}。"
        detail = _stringify_error(payload, "")
        raise TodoListError(f"{message} {detail}".strip())

    def _paginate(self, path: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Follow ``next`` until exhausted. ``next`` may point at another host
        (reverse proxy / docker network), so we only trust its ``page`` value
        and re-issue the request against our own base URL."""
        current = dict(params or {})
        if "page_size" not in current:
            current["page_size"] = PAGE_SIZE

        results: list[dict[str, Any]] = []
        for _ in range(MAX_PAGES):
            payload = self._request("GET", path, params=current)
            if isinstance(payload, list):
                return [item for item in payload if isinstance(item, dict)]
            if not isinstance(payload, dict) or "results" not in payload:
                raise TodoListError("ToDoList API 的分页响应格式不符合预期（缺少 results 字段）。")
            results.extend(item for item in payload["results"] if isinstance(item, dict))
            next_url = payload.get("next")
            if not next_url:
                return results
            page = urllib.parse.parse_qs(urllib.parse.urlparse(str(next_url)).query).get("page")
            if not page:
                return results
            current["page"] = page[0]
        raise TodoListError(f"分页超过 {MAX_PAGES} 页仍未结束，已中止以避免无限循环。")

    # ------------------------------------------------------------ endpoints

    def list_workspaces(self, include_archived: bool = True) -> list[dict[str, Any]]:
        return self._paginate(
            "workspaces/",
            {"include_archived": include_archived, "ordering": "sort_order,-created_at"},
        )

    def get_workspace(self, workspace_id: int) -> dict[str, Any]:
        payload = self._request("GET", f"workspaces/{workspace_id}/")
        if not isinstance(payload, dict):
            raise TodoListError(f"读取工作区 {workspace_id} 的响应格式不符合预期。")
        return payload

    def list_tasks(self, workspace_id: int, **filters: Any) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"workspace": workspace_id}
        params.update(filters)
        return self._paginate("tasks/", params)

    def list_lists(self, workspace_id: int, include_archived: bool = False) -> list[dict[str, Any]]:
        return self._paginate(
            "lists/", {"workspace": workspace_id, "include_archived": include_archived}
        )

    def list_subtasks(self, workspace_id: int, parent_id: int) -> list[dict[str, Any]]:
        return self._paginate("tasks/", {"workspace": workspace_id, "parent": parent_id})

    def bulk_create(self, workspace_id: int, tasks: list[dict[str, Any]]) -> dict[str, Any]:
        # The endpoint requires `workspace` on *every* item (it groups them
        # itself); a top-level workspace key is ignored by the backend.
        rows = [{**task, "workspace": workspace_id} for task in tasks]
        payload = self._request("POST", "tasks/bulk-create/", body={"tasks": rows})
        if not isinstance(payload, dict):
            raise TodoListError("批量创建任务的响应格式不符合预期。")
        return payload

    def bulk_action(self, task_ids: list[int], action: str) -> dict[str, Any]:
        payload = self._request("POST", "tasks/bulk/", body={"ids": task_ids, "action": action})
        if not isinstance(payload, dict):
            raise TodoListError("批量更新任务的响应格式不符合预期。")
        return payload

    def get_task(self, task_id: int) -> dict[str, Any]:
        payload = self._request("GET", f"tasks/{task_id}/")
        if not isinstance(payload, dict):
            raise TodoListError(f"读取任务 {task_id} 的响应格式不符合预期。")
        return payload

    def update_task(self, task_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("PATCH", f"tasks/{task_id}/", body=payload)
        if not isinstance(result, dict):
            raise TodoListError(f"更新任务 {task_id} 的响应格式不符合预期。")
        return result

    def list_documents(self, workspace_id: int, **filters: Any) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"workspace": workspace_id}
        params.update(filters)
        return self._paginate("documents/", params)

    def get_document(self, document_id: int) -> dict[str, Any]:
        payload = self._request("GET", f"documents/{document_id}/")
        if not isinstance(payload, dict):
            raise TodoListError(f"读取文档 {document_id} 的响应格式不符合预期。")
        return payload

    def create_document(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("POST", "documents/", body=payload)
        if not isinstance(result, dict):
            raise TodoListError("创建文档的响应格式不符合预期。")
        return result

    def update_document(self, document_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("PATCH", f"documents/{document_id}/", body=payload)
        if not isinstance(result, dict):
            raise TodoListError(f"更新文档 {document_id} 的响应格式不符合预期。")
        return result

    def get_architecture(self, workspace_id: int) -> dict[str, Any]:
        payload = self._request("GET", f"workspaces/{workspace_id}/architecture/")
        if not isinstance(payload, dict):
            raise TodoListError(f"读取工作区 {workspace_id} 架构图的响应格式不符合预期。")
        return payload

    def upsert_architecture(self, workspace_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._request("PUT", f"workspaces/{workspace_id}/architecture/", body=payload)
        if not isinstance(result, dict):
            raise TodoListError(f"更新工作区 {workspace_id} 架构图的响应格式不符合预期。")
        return result
