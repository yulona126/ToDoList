"""Story flow: committed_at, the event timeline, and the derived metrics.

These cover the contract that makes "整理时间接近零" possible: the user performs
exactly one organising action (pull into Now), and everything else — the story
timeline, aging, throughput, the WIP ceiling — is derived or recorded for free.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.todos import events as ev
from apps.todos import flow
from apps.todos.models import Task, TaskEvent, TaskList, Workspace

User = get_user_model()

TASKS = "/api/v1/tasks/"
FLOW = "/api/v1/flow/"


class BaseFlowTest(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="flow@example.com", username="flow", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)
        self.workspace = Workspace.objects.create(name="W", owner=self.user)
        self.task_list = TaskList.objects.create(workspace=self.workspace, name="开发")

    def make_task(self, **kwargs):
        defaults = {"workspace": self.workspace, "task_list": self.task_list, "title": "任务"}
        defaults.update(kwargs)
        return Task.objects.create(**defaults)


class CommittedAtTests(BaseFlowTest):
    def test_new_tasks_land_in_the_backlog(self) -> None:
        """Zero-cost default: nothing has to be triaged for capture to work."""
        task = self.make_task()
        self.assertIsNone(task.committed_at)

    def test_commit_sets_the_timestamp_and_records_an_event(self) -> None:
        task = self.make_task()
        response = self.client.post(f"{TASKS}{task.id}/commit/")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data["is_committed"])
        self.assertEqual(response.data["now_days"], 0)

        task.refresh_from_db()
        self.assertIsNotNone(task.committed_at)
        self.assertTrue(
            task.events.filter(kind=TaskEvent.Kind.COMMITTED).exists()
        )

    def test_commit_is_idempotent(self) -> None:
        task = self.make_task()
        first = self.client.post(f"{TASKS}{task.id}/commit/").data["committed_at"]
        self.client.post(f"{TASKS}{task.id}/commit/")
        task.refresh_from_db()
        self.assertEqual(task.events.filter(kind="committed").count(), 1)
        # Compare instants, not strings: the API renders `Z`, isoformat renders
        # `+00:00`, and they are the same moment.
        self.assertEqual(task.committed_at, datetime.fromisoformat(first.replace("Z", "+00:00")))

    def test_uncommit_returns_it_to_the_backlog(self) -> None:
        task = self.make_task()
        self.client.post(f"{TASKS}{task.id}/commit/")
        response = self.client.post(f"{TASKS}{task.id}/uncommit/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["is_committed"])
        task.refresh_from_db()
        self.assertIsNone(task.committed_at)
        self.assertTrue(task.events.filter(kind="uncommitted").exists())

    def test_committed_at_is_not_writable_directly(self) -> None:
        """It must go through /commit/, otherwise the timeline loses its entry."""
        task = self.make_task()
        response = self.client.patch(
            f"{TASKS}{task.id}/",
            {"committed_at": timezone.now().isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertIsNone(task.committed_at)


class TimelineTests(BaseFlowTest):
    def test_create_records_a_created_event(self) -> None:
        response = self.client.post(
            TASKS,
            {"workspace": self.workspace.id, "task_list": self.task_list.id, "title": "新任务"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        task = Task.objects.get(pk=response.data["id"])
        self.assertTrue(task.events.filter(kind="created").exists())

    def test_toggle_records_completion_with_evidence(self) -> None:
        task = self.make_task()
        response = self.client.post(
            f"{TASKS}{task.id}/toggle/", {"note": "curl 了 401/400/404"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        event = task.events.get(kind="completed")
        self.assertIn("curl", event.note)

    def test_reopening_records_an_event(self) -> None:
        task = self.make_task(status=Task.Status.DONE)
        self.client.post(f"{TASKS}{task.id}/toggle/")
        self.assertTrue(task.events.filter(kind="reopened").exists())

    def test_bulk_done_writes_one_event_per_task(self) -> None:
        """queryset.update() would be faster and would make the timeline lie."""
        ids = [self.make_task(title=f"t{i}").id for i in range(3)]
        response = self.client.post(
            f"{TASKS}bulk/", {"ids": ids, "action": "done"}, format="json"
        )
        self.assertEqual(response.data["updated"], 3)
        self.assertEqual(TaskEvent.objects.filter(kind="completed").count(), 3)

    def test_events_endpoint_returns_the_story(self) -> None:
        task = self.make_task()
        self.client.post(f"{TASKS}{task.id}/commit/")
        self.client.post(f"{TASKS}{task.id}/toggle/", {"note": "自测通过"}, format="json")

        response = self.client.get(f"{TASKS}{task.id}/events/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kinds = [e["kind"] for e in response.data["results"]]
        self.assertIn("committed", kinds)
        self.assertIn("completed", kinds)
        self.assertIn("lead_time_hours", response.data["summary"])
        self.assertTrue(response.data["summary"]["has_test_note"])

    def test_events_are_isolated_between_users(self) -> None:
        task = self.make_task()
        other = User.objects.create_user(
            email="o@example.com", username="o", password="SuperSecret123"
        )
        self.client.force_authenticate(other)
        self.assertEqual(
            self.client.get(f"{TASKS}{task.id}/events/").status_code,
            status.HTTP_404_NOT_FOUND,
        )


class FlowMetricTests(BaseFlowTest):
    def get_flow(self):
        return self.client.get(f"{FLOW}?workspace={self.workspace.id}")

    def test_requires_a_workspace(self) -> None:
        self.assertEqual(self.client.get(FLOW).status_code, status.HTTP_400_BAD_REQUEST)

    def test_foreign_workspace_is_404(self) -> None:
        other = User.objects.create_user(
            email="o@example.com", username="o", password="SuperSecret123"
        )
        theirs = Workspace.objects.create(name="T", owner=other)
        self.assertEqual(
            self.client.get(f"{FLOW}?workspace={theirs.id}").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_counts_now_backlog_and_done(self) -> None:
        self.client.post(f"{TASKS}{self.make_task(title="a").id}/commit/")
        self.make_task(title="b")
        self.make_task(title="c", status=Task.Status.DONE)

        data = self.get_flow().data
        self.assertEqual(data["now"], 1)
        self.assertEqual(data["backlog"], 1)
        self.assertEqual(data["done_this_week"], 1)
        self.assertIsInstance(data["message"], str)

    def test_wip_limit_uses_median_of_recorded_weeks(self) -> None:
        """Per-week completions of 2, 2, 10, 2 -> median 2 -> limit 3 (floor)."""
        now = timezone.now()
        for week_index, count in enumerate([2, 2, 10, 2]):
            base = now - timedelta(days=7 * (week_index + 1))
            for _ in range(count):
                task = self.make_task(status=Task.Status.DONE)
                Task.objects.filter(pk=task.pk).update(completed_at=base)

        # A mean would be 4 -> limit 5; the median keeps the ceiling honest.
        self.assertEqual(flow.wip_limit(self.workspace), flow.MIN_WIP_LIMIT)

    def test_limit_has_a_floor_so_a_bad_month_cannot_lock_the_tool(self) -> None:
        self.assertEqual(flow.wip_limit(self.workspace), flow.MIN_WIP_LIMIT)

    def test_exceeding_the_limit_is_reported_with_a_suggestion(self) -> None:
        for i in range(flow.MIN_WIP_LIMIT + 2):
            self.client.post(f"{TASKS}{self.make_task(title=f"t{i}").id}/commit/")
        data = self.get_flow().data
        self.assertTrue(data["wip_exceeded"])
        self.assertIn("超过", data["message"])
        self.assertEqual(data["wip_headroom"], 0)

    def test_stale_backlog_is_counted(self) -> None:
        old = self.make_task(title="老任务")
        Task.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=flow.BACKLOG_AGING_DAYS + 5)
        )
        self.make_task(title="新任务")
        data = self.get_flow().data
        self.assertEqual(data["stale_backlog"], 1)
        self.assertGreaterEqual(data["oldest_backlog_days"], flow.BACKLOG_AGING_DAYS)

    def test_archived_tasks_are_excluded(self) -> None:
        self.make_task(title="归档", is_archived=True)
        data = self.get_flow().data
        self.assertEqual(data["backlog"], 0)

    def test_week_bounds_use_local_monday(self) -> None:
        start, end = flow.week_bounds()
        local = timezone.localtime(start)
        self.assertEqual(local.weekday(), 0)  # Monday
        self.assertEqual((local.hour, local.minute, local.second), (0, 0, 0))
        self.assertEqual((end - start), timedelta(days=7))

    def test_week_bounds_are_not_year_ambiguous(self) -> None:
        """A regression guard for using `__week` (matches week N of any year)."""
        start, _ = flow.week_bounds()
        same_week_last_year = start.replace(year=start.year - 1)
        self.assertNotEqual(start, same_week_last_year)


class EventHelperTests(BaseFlowTest):
    def test_complete_and_reopen_are_idempotent(self) -> None:
        task = self.make_task()
        ev.complete_task(task)
        ev.complete_task(task)
        self.assertEqual(task.events.filter(kind="completed").count(), 1)

        ev.reopen_task(task)
        ev.reopen_task(task)
        self.assertEqual(task.events.filter(kind="reopened").count(), 1)

    def test_note_event_is_stored(self) -> None:
        task = self.make_task()
        ev.note_task(task, "这个模块不能引 Celery")
        self.assertEqual(task.events.get(kind="noted").source, TaskEvent.Source.MCP)
