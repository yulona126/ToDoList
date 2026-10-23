"""Flow metrics: the numbers that replace backlog grooming.

Nothing here requires user input. Everything is derived from timestamps that the
app already records, which is the whole point: the user should never have to
"go through" their list to learn something about it.

Two rules encoded here:

* Weeks are **local-time** half-open intervals ``[start, start + 7d)``.
  ``__week`` lookups are deliberately avoided: they match week N of *any* year.
* Throughput uses the **median** of the last four weeks, not the mean. Work is
  batched (the data shows 13 completions on one day and none on the others), so
  a mean is dominated by a single spike.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from statistics import median
from typing import Any

from django.db.models import Min
from django.utils import timezone

from .models import Task, Workspace

#: How many days in the backlog before we surface it.
BACKLOG_AGING_DAYS = 14
#: Throughput window used for the commitment ceiling.
THROUGHPUT_WEEKS = 4
#: Head-room above measured throughput.
WIP_HEADROOM = 1.2
#: Never set a ceiling below this — a bad week should not lock the tool.
MIN_WIP_LIMIT = 3


def week_start(moment: datetime | None = None) -> datetime:
    """Monday 00:00 in local time, as an aware datetime."""
    local = timezone.localtime(moment or timezone.now())
    monday = local.date() - timedelta(days=local.weekday())
    start = datetime.combine(monday, datetime.min.time())
    return timezone.make_aware(start, timezone.get_current_timezone())


def week_bounds(moment: datetime | None = None) -> tuple[datetime, datetime]:
    start = week_start(moment)
    return start, start + timedelta(days=7)


def _weeks_back(count: int) -> list[tuple[datetime, datetime]]:
    """The last ``count`` complete-ish weeks, newest first, including this one."""
    bounds: list[tuple[datetime, datetime]] = []
    cursor = week_start()
    for _ in range(count):
        bounds.append((cursor - timedelta(days=7), cursor))
        cursor -= timedelta(days=7)
    return bounds


def scope(workspace: Workspace) -> Any:
    """The task universe this metric set describes."""
    return Task.objects.filter(workspace=workspace, is_archived=False)


def weekly_throughput(workspace: Workspace, weeks: int = THROUGHPUT_WEEKS) -> list[int]:
    """Completed-per-week counts, oldest first."""
    queryset = scope(workspace).filter(completed_at__isnull=False)
    counts: list[int] = []
    for start, end in reversed(_weeks_back(weeks)):
        counts.append(
            queryset.filter(completed_at__gte=start, completed_at__lt=end).count()
        )
    return counts


def wip_limit(workspace: Workspace) -> int:
    """Commitment ceiling: median throughput of the last four weeks, +20%."""
    history = [n for n in weekly_throughput(workspace) if n > 0]
    if not history:
        return MIN_WIP_LIMIT
    return max(MIN_WIP_LIMIT, int(round(median(history) * WIP_HEADROOM)))


def flow_summary(workspace: Workspace) -> dict[str, Any]:
    """One screen of numbers. No charts, because nobody maintains the input."""
    tasks = scope(workspace).filter(status__in=[Task.Status.TODO, Task.Status.DOING, Task.Status.BLOCKED])

    now_qs = tasks.filter(committed_at__isnull=False)
    backlog_qs = tasks.filter(committed_at__isnull=True)

    now_count = now_qs.count()
    limit = wip_limit(workspace)

    today = timezone.localdate()

    # Backlog age is measured from creation: an item that has waited is a risk,
    # regardless of what its priority claims.
    oldest_backlog = backlog_qs.aggregate(oldest=Min("created_at"))["oldest"]
    oldest_backlog_days = (
        (timezone.now() - oldest_backlog).days if oldest_backlog else 0
    )
    stale_cutoff = timezone.now() - timedelta(days=BACKLOG_AGING_DAYS)
    stale_backlog = backlog_qs.filter(created_at__lt=stale_cutoff).count()

    oldest_now = now_qs.aggregate(oldest=Min("committed_at"))["oldest"]
    oldest_now_days = (timezone.now() - oldest_now).days if oldest_now else 0

    start, end = week_bounds()
    done_this_week = scope(workspace).filter(
        completed_at__gte=start, completed_at__lt=end
    ).count()

    overdue = tasks.filter(due_date__lt=today).count()
    everything = scope(workspace)
    total = everything.count()
    undated_pct = (
        round(everything.filter(due_date__isnull=True).count() * 100 / total) if total else 0
    )

    return {
        "now": now_count,
        "backlog": backlog_qs.count(),
        "done_this_week": done_this_week,
        "wip_limit": limit,
        "wip_exceeded": now_count > limit,
        "wip_headroom": max(0, limit - now_count),
        "throughput_per_week": weekly_throughput(workspace),
        "oldest_backlog_days": oldest_backlog_days,
        "oldest_now_days": oldest_now_days,
        "stale_backlog": stale_backlog,
        "backlog_aging_days": BACKLOG_AGING_DAYS,
        "overdue": overdue,
        "undated_percent": undated_pct,
        "message": _message(now_count, limit, oldest_now_days, stale_backlog),
    }


def _message(now_count: int, limit: int, oldest_now_days: int, stale: int) -> str:
    """A single actionable sentence, because a number without a verb is noise."""
    if now_count > limit:
        return f"「现在」有 {now_count} 条，超过你近四周的实测上限 {limit} 条。建议退回 {now_count - limit} 条。"
    if now_count == 0:
        return "「现在」是空的。从 backlog 拉几条进来，否则这周没有明确目标。"
    if oldest_now_days >= 7:
        return f"有任务在「现在」待了 {oldest_now_days} 天。要么做完，要么退回 backlog。"
    if stale >= 1:
        return f"backlog 里有 {stale} 条超过 14 天没动。要么做，要么明确删掉。"
    return f"「现在」{now_count}/{limit}，节奏正常。"


def story_timeline(task: Task) -> dict[str, Any]:
    """Everything needed to understand one story without reading a log."""
    events = list(task.events.all())

    def first_at(*kinds: str) -> datetime | None:
        for event in events:
            if event.kind in kinds:
                return event.created_at
        return None

    started = first_at("committed")
    finished = task.completed_at
    lead_hours = None
    if finished:
        lead_hours = round((finished - task.created_at).total_seconds() / 3600, 1)

    active_hours = None
    if started:
        end = finished or timezone.now()
        active_hours = round((end - started).total_seconds() / 3600, 1)

    return {
        "lead_time_hours": lead_hours,
        "active_hours": active_hours,
        "event_count": len(events),
        "blocked_ever": any(e.kind == "blocked" for e in events),
        "has_test_note": any(e.kind == "completed" and e.note for e in events),
    }
