"""The single place that writes ``TaskEvent`` rows.

Every state change funnels through :func:`record_event` so the story timeline is
a by-product of doing the work, never a chore. If a caller mutates a task by
hand, nothing is recorded — that is deliberate: the API layer is the only
writer, and it always knows *who* changed *what*.

Never call ``Task.objects.filter(...).update(...)`` for a state change; it
bypasses this module and the timeline silently loses an entry. Use
:func:`apply_event` instead, which updates the task and appends the event
together.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction
from django.utils import timezone

from .models import Task, TaskEvent


def record_event(
    task: Task,
    kind: str,
    *,
    source: str = TaskEvent.Source.UI,
    note: str = "",
    from_value: str = "",
    to_value: str = "",
) -> TaskEvent:
    """Append one immutable entry to a task's story."""
    return TaskEvent.objects.create(
        task=task,
        kind=kind,
        source=source,
        note=note[:2000],
        from_value=str(from_value)[:120],
        to_value=str(to_value)[:120],
    )


@transaction.atomic
def apply_event(
    task: Task,
    kind: str,
    *,
    source: str = TaskEvent.Source.UI,
    note: str = "",
    **fields: Any,
) -> Task:
    """Update the task and record why, atomically.

    ``fields`` are model attributes to set (``status``, ``committed_at``, ...).
    """
    from_value = ""
    to_value = ""

    for name, value in fields.items():
        from_value = str(getattr(task, name, "") or "")
        setattr(task, name, value)
        to_value = str(value or "")

    task.save()
    record_event(
        task,
        kind,
        source=source,
        note=note,
        from_value=from_value,
        to_value=to_value,
    )
    return task


def commit_task(task: Task, *, source: str = TaskEvent.Source.UI, note: str = "") -> Task:
    """Pull a task into "Now". Idempotent."""
    if task.committed_at is not None:
        return task
    return apply_event(
        task,
        TaskEvent.Kind.COMMITTED,
        source=source,
        note=note,
        committed_at=timezone.now(),
    )


def uncommit_task(
    task: Task, *, source: str = TaskEvent.Source.UI, note: str = ""
) -> Task:
    """Send a task back to the backlog. Idempotent."""
    if task.committed_at is None:
        return task
    return apply_event(
        task,
        TaskEvent.Kind.UNCOMMITTED,
        source=source,
        note=note,
        committed_at=None,
    )


def complete_task(
    task: Task, *, source: str = TaskEvent.Source.UI, note: str = ""
) -> Task:
    """Mark done, optionally with the one-line evidence required by the flow."""
    if task.status == Task.Status.DONE:
        return task
    return apply_event(
        task,
        TaskEvent.Kind.COMPLETED,
        source=source,
        note=note,
        status=Task.Status.DONE,
    )


def reopen_task(
    task: Task, *, source: str = TaskEvent.Source.UI, note: str = ""
) -> Task:
    if task.status != Task.Status.DONE:
        return task
    return apply_event(
        task,
        TaskEvent.Kind.REOPENED,
        source=source,
        note=note,
        status=Task.Status.TODO,
    )


def note_task(task: Task, note: str, *, source: str = TaskEvent.Source.MCP) -> TaskEvent:
    """A one-line fact worth keeping ("tested with curl 401/400/404")."""
    return record_event(task, TaskEvent.Kind.NOTED, source=source, note=note)


def bulk_complete(
    tasks: Iterable[Task], *, source: str = TaskEvent.Source.UI, note: str = ""
) -> int:
    """Complete many tasks, recording an event for each.

    Slower than ``queryset.update()`` on purpose: without the per-task event the
    timeline would lie about when each item finished.
    """
    count = 0
    now = timezone.now()
    with transaction.atomic():
        for task in tasks:
            if task.status == Task.Status.DONE:
                continue
            task.status = Task.Status.DONE
            task.completed_at = now
            task.save(update_fields=["status", "completed_at", "updated_at"])
            record_event(task, TaskEvent.Kind.COMPLETED, source=source, note=note)
            count += 1
    return count
