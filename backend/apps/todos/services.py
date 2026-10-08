"""Task creation services shared by the API and the AI assistant.

Kept in the todos app so that task creation (including tag auto-creation and
sub-task nesting rules) has exactly one implementation. The assistant imports
from here rather than duplicating it.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from django.db import transaction

from .models import Tag, Task, Workspace

MAX_TITLE_LENGTH = 200


def clean_title(value: Any) -> str | None:
    """Collapse whitespace, drop empties, cap length."""
    if not isinstance(value, str):
        return None
    title = " ".join(value.split())
    return title[:MAX_TITLE_LENGTH] if title else None


def clean_date(value: Any) -> date | None:
    """Normalise to a real ``datetime.date``.

    Returning a ``date`` (not a string) matters: assigning a string to
    ``Task.due_date`` leaves that string on the in-memory instance, and
    ``Task.is_overdue`` then compares a ``str`` with a ``date`` and blows up
    when the freshly created objects are serialised back to the client.
    """
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        except ValueError:
            return None


def next_sort_order(workspace: Workspace, task_list: Any, parent: Any = None) -> int:
    queryset = Task.objects.filter(workspace=workspace)
    if parent is not None:
        queryset = queryset.filter(parent=parent)
    else:
        queryset = queryset.filter(parent__isnull=True, task_list=task_list)
    last = queryset.order_by("-sort_order").values_list("sort_order", flat=True).first()
    return (last or 0) + 1


@transaction.atomic
def bulk_create_tasks(
    user: Any, workspace: Workspace, items: list[dict[str, Any]]
) -> list[Task]:
    """Create tasks (with optional sub-tasks) in a single transaction.

    ``items`` entries: ``title``, optional ``task_list`` (id), ``description``,
    ``status``, ``priority``, ``task_type``, ``due_date``, ``tag_ids`` (existing),
    ``tag_names`` (get_or_create), ``subtasks`` (list of titles).
    """
    created: list[Task] = []

    for item in items:
        task_list = None
        list_id = item.get("task_list")
        if list_id is not None:
            task_list = workspace.lists.filter(pk=list_id).first()

        tags = list(workspace.tags.filter(id__in=item.get("tag_ids") or []))
        for name in item.get("tag_names") or []:
            cleaned = str(name).strip()[:40]
            if not cleaned:
                continue
            tag, _ = Tag.objects.get_or_create(workspace=workspace, name=cleaned)
            if tag not in tags:
                tags.append(tag)

        task = Task.objects.create(
            workspace=workspace,
            task_list=task_list,
            title=str(item["title"])[:MAX_TITLE_LENGTH],
            description=str(item.get("description") or ""),
            status=item.get("status") or Task.Status.TODO,
            priority=item.get("priority") or Task.Priority.MEDIUM,
            task_type=item.get("task_type") or Task.Type.OTHER,
            due_date=clean_date(item.get("due_date")),
            sort_order=next_sort_order(workspace, task_list),
            created_by=user,
        )
        if tags:
            task.tags.set(tags)

        for offset, sub in enumerate(item.get("subtasks") or [], start=1):
            title = clean_title(sub)
            if not title:
                continue
            Task.objects.create(
                workspace=workspace,
                task_list=task_list,
                parent=task,
                title=title,
                task_type=task.task_type,
                sort_order=offset,
                created_by=user,
            )

        created.append(task)

    return created
