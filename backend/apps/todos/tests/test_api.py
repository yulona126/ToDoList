"""Todo API contract tests — mirrors docs/api.md §2–§5."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.todos.models import (
    ArchitectureDiagram,
    Document,
    Tag,
    Task,
    TaskList,
    Workspace,
    WorkspaceMember,
)

User = get_user_model()

WORKSPACES = "/api/v1/workspaces/"
LISTS = "/api/v1/lists/"
TASKS = "/api/v1/tasks/"
TAGS = "/api/v1/tags/"
DOCUMENTS = "/api/v1/documents/"


class BaseAPITestCase(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="a@example.com", username="alice", password="SuperSecret123"
        )
        self.other = User.objects.create_user(
            email="b@example.com", username="bob", password="SuperSecret123"
        )
        self.authenticate(self.user)

    def authenticate(self, user: Any) -> None:
        from apps.accounts.views import _token_pair

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {_token_pair(user)['access']}")

    # -- factories -----------------------------------------------------------
    def make_workspace(self, owner: Any = None, **kwargs: Any) -> Workspace:
        owner = owner or self.user
        defaults = {"name": "Project X", "owner": owner}
        defaults.update(kwargs)
        workspace = Workspace.objects.create(**defaults)
        WorkspaceMember.objects.get_or_create(
            workspace=workspace,
            user=owner,
            defaults={"role": WorkspaceMember.Role.OWNER},
        )
        return workspace

    def make_list(self, workspace: Workspace, **kwargs: Any) -> TaskList:
        defaults = {"workspace": workspace, "name": "需求梳理"}
        defaults.update(kwargs)
        return TaskList.objects.create(**defaults)

    def make_task(self, workspace: Workspace, **kwargs: Any) -> Task:
        defaults = {"workspace": workspace, "title": "Task"}
        defaults.update(kwargs)
        return Task.objects.create(**defaults)


class AuthenticationRequiredTests(BaseAPITestCase):
    def test_endpoints_require_auth(self) -> None:
        self.client.credentials()
        for url in (
            WORKSPACES,
            f"{TASKS}?workspace=1",
            LISTS + "?workspace=1",
            TAGS + "?workspace=1",
            DOCUMENTS + "?workspace=1",
        ):
            with self.subTest(url=url):
                self.assertEqual(
                    self.client.get(url).status_code, status.HTTP_401_UNAUTHORIZED
                )


class WorkspaceTests(BaseAPITestCase):
    def test_create_workspace_seeds_owner_membership(self) -> None:
        response = self.client.post(
            WORKSPACES, {"name": "ToDoList v1", "description": "个人待办"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["role"], "owner")
        self.assertEqual(response.data["visibility"], "private")
        self.assertEqual(response.data["stats"]["total"], 0)

        workspace = Workspace.objects.get(pk=response.data["id"])
        self.assertEqual(workspace.owner, self.user)
        self.assertTrue(
            WorkspaceMember.objects.filter(
                workspace=workspace, user=self.user, role=WorkspaceMember.Role.OWNER
            ).exists()
        )

    def test_stats_reflect_task_state(self) -> None:
        workspace = self.make_workspace()
        today = timezone.localdate()
        self.make_task(workspace, title="a", status=Task.Status.TODO)
        self.make_task(workspace, title="b", status=Task.Status.DOING)
        self.make_task(workspace, title="c", status=Task.Status.BLOCKED)
        self.make_task(workspace, title="d", status=Task.Status.DONE)
        self.make_task(workspace, title="e", due_date=today - timedelta(days=1))
        self.make_task(workspace, title="f", is_archived=True)

        response = self.client.get(WORKSPACES)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        stats = response.data["results"][0]["stats"]
        self.assertEqual(stats["total"], 5)
        self.assertEqual(stats["todo"], 2)  # "a" + overdue "e"
        self.assertEqual(stats["doing"], 1)
        self.assertEqual(stats["blocked"], 1)
        self.assertEqual(stats["done"], 1)
        self.assertEqual(stats["overdue"], 1)

    def test_workspace_isolation(self) -> None:
        mine = self.make_workspace(name="Mine")
        theirs = self.make_workspace(owner=self.other, name="Theirs")

        listing = self.client.get(WORKSPACES)
        self.assertEqual(listing.data["count"], 1)
        self.assertEqual(listing.data["results"][0]["id"], mine.id)

        self.assertEqual(
            self.client.get(f"{WORKSPACES}{theirs.id}/").status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(
            self.client.patch(
                f"{WORKSPACES}{theirs.id}/", {"name": "hacked"}, format="json"
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.delete(f"{WORKSPACES}{theirs.id}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )
        theirs.refresh_from_db()
        self.assertEqual(theirs.name, "Theirs")

    def test_members_endpoint_returns_owner_only(self) -> None:
        workspace = self.make_workspace()
        response = self.client.get(f"{WORKSPACES}{workspace.id}/members/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["role"], "owner")
        self.assertEqual(response.data["results"][0]["user"]["username"], "alice")
        self.assertIn("joined_at", response.data["results"][0])

    def test_archive_and_filter(self) -> None:
        workspace = self.make_workspace()
        self.client.patch(
            f"{WORKSPACES}{workspace.id}/", {"is_archived": True}, format="json"
        )
        self.assertEqual(self.client.get(WORKSPACES).data["count"], 0)
        self.assertEqual(
            self.client.get(f"{WORKSPACES}?include_archived=true").data["count"], 1
        )

    def test_workspace_limit_enforced(self) -> None:
        from django.test import override_settings

        with override_settings(MAX_WORKSPACES_PER_USER=2):
            self.make_workspace(name="one")
            self.make_workspace(name="two")
            response = self.client.post(WORKSPACES, {"name": "three"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_workspace_cascades(self) -> None:
        workspace = self.make_workspace()
        task_list = self.make_list(workspace)
        self.make_task(workspace, task_list=task_list)
        Tag.objects.create(workspace=workspace, name="pwa")

        self.client.delete(f"{WORKSPACES}{workspace.id}/")
        self.assertFalse(Workspace.objects.filter(pk=workspace.pk).exists())
        self.assertFalse(TaskList.objects.filter(pk=task_list.pk).exists())
        self.assertFalse(Task.objects.filter(workspace_id=workspace.id).exists())
        self.assertFalse(Tag.objects.filter(workspace_id=workspace.id).exists())


class TaskListTests(BaseAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.workspace = self.make_workspace()

    def test_workspace_param_is_required(self) -> None:
        response = self.client.get(LISTS)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_and_list(self) -> None:
        response = self.client.post(
            LISTS, {"workspace": self.workspace.id, "name": "开发"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["stats"], {"total": 0, "done": 0})

        listing = self.client.get(f"{LISTS}?workspace={self.workspace.id}")
        self.assertEqual(listing.data["count"], 1)
        self.assertEqual(listing.data["results"][0]["name"], "开发")

    def test_create_list_in_foreign_workspace_is_rejected(self) -> None:
        theirs = self.make_workspace(owner=self.other)
        response = self.client.post(
            LISTS, {"workspace": theirs.id, "name": "nope"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("workspace", response.data["errors"])

    def test_detail_route_ignores_required_workspace_filter(self) -> None:
        task_list = self.make_list(self.workspace)
        response = self.client.get(f"{LISTS}{task_list.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], task_list.id)

    def test_delete_list_keeps_tasks(self) -> None:
        task_list = self.make_list(self.workspace)
        task = self.make_task(self.workspace, task_list=task_list)

        response = self.client.delete(f"{LISTS}{task_list.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        task.refresh_from_db()
        self.assertIsNone(task.task_list)
        self.assertTrue(Task.objects.filter(pk=task.pk).exists())

    def test_stats_count_only_active_tasks(self) -> None:
        task_list = self.make_list(self.workspace)
        self.make_task(self.workspace, task_list=task_list, status=Task.Status.DONE)
        self.make_task(self.workspace, task_list=task_list)
        self.make_task(self.workspace, task_list=task_list, is_archived=True)

        response = self.client.get(f"{LISTS}?workspace={self.workspace.id}")
        self.assertEqual(response.data["results"][0]["stats"], {"total": 2, "done": 1})

    def test_reorder(self) -> None:
        first = self.make_list(self.workspace, name="A", sort_order=0)
        second = self.make_list(self.workspace, name="B", sort_order=1)

        response = self.client.post(
            f"{LISTS}reorder/",
            {"items": [{"id": first.id, "sort_order": 5}, {"id": second.id, "sort_order": 1}]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["updated"], 2)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.sort_order, second.sort_order), (5, 1))


class TaskTests(BaseAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.workspace = self.make_workspace()
        self.task_list = self.make_list(self.workspace)

    def test_workspace_param_is_required(self) -> None:
        self.assertEqual(self.client.get(TASKS).status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_task_with_defaults(self) -> None:
        response = self.client.post(
            TASKS,
            {"workspace": self.workspace.id, "task_list": self.task_list.id, "title": "写架构文档"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["status"], "todo")
        self.assertEqual(response.data["priority"], "medium")
        self.assertEqual(response.data["task_type"], "other")
        self.assertFalse(response.data["is_overdue"])
        self.assertEqual(response.data["subtask_stats"], {"total": 0, "done": 0})
        self.assertEqual(response.data["task_list_name"], "需求梳理")

    def test_sort_order_auto_increments_per_list(self) -> None:
        for _ in range(3):
            self.client.post(
                TASKS,
                {"workspace": self.workspace.id, "task_list": self.task_list.id, "title": "t"},
                format="json",
            )
        orders = list(
            Task.objects.filter(workspace=self.workspace)
            .order_by("sort_order")
            .values_list("sort_order", flat=True)
        )
        self.assertEqual(orders, [1, 2, 3])

    def test_tags_round_trip(self) -> None:
        tag = Tag.objects.create(workspace=self.workspace, name="pwa")
        response = self.client.post(
            TASKS,
            {
                "workspace": self.workspace.id,
                "title": "缓存策略",
                "tag_ids": [tag.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual([t["name"] for t in response.data["tags"]], ["pwa"])

        patched = self.client.patch(
            f"{TASKS}{response.data['id']}/", {"tag_ids": []}, format="json"
        )
        self.assertEqual(patched.status_code, status.HTTP_200_OK, patched.data)
        self.assertEqual(patched.data["tags"], [])

    def test_tag_from_another_workspace_is_rejected(self) -> None:
        other_workspace = self.make_workspace(name="Other")
        foreign_tag = Tag.objects.create(workspace=other_workspace, name="nope")
        response = self.client.post(
            TASKS,
            {"workspace": self.workspace.id, "title": "x", "tag_ids": [foreign_tag.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("tag_ids", response.data["errors"])

    def test_task_list_from_another_workspace_is_rejected(self) -> None:
        other_workspace = self.make_workspace(name="Other")
        foreign_list = self.make_list(other_workspace)
        response = self.client.post(
            TASKS,
            {"workspace": self.workspace.id, "task_list": foreign_list.id, "title": "x"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("task_list", response.data["errors"])

    def test_completed_at_tracks_status(self) -> None:
        task = self.make_task(self.workspace, title="x")
        response = self.client.patch(
            f"{TASKS}{task.id}/", {"status": "done"}, format="json"
        )
        self.assertIsNotNone(response.data["completed_at"])

        response = self.client.patch(
            f"{TASKS}{task.id}/", {"status": "doing"}, format="json"
        )
        self.assertIsNone(response.data["completed_at"])

    def test_toggle_endpoint(self) -> None:
        task = self.make_task(self.workspace, title="x")
        done = self.client.post(f"{TASKS}{task.id}/toggle/")
        self.assertEqual(done.status_code, status.HTTP_200_OK)
        self.assertEqual(done.data["status"], "done")

        todo = self.client.post(f"{TASKS}{task.id}/toggle/")
        self.assertEqual(todo.data["status"], "todo")

    def test_detail_route_ignores_required_workspace_filter(self) -> None:
        task = self.make_task(self.workspace, title="x")
        response = self.client.get(f"{TASKS}{task.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_task_isolation(self) -> None:
        task = self.make_task(self.workspace, title="secret")
        self.authenticate(self.other)
        self.assertEqual(
            self.client.get(f"{TASKS}{task.id}/").status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(
            self.client.patch(
                f"{TASKS}{task.id}/", {"title": "hacked"}, format="json"
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.authenticate(self.user)
        self.assertEqual(self.client.get(f"{TASKS}?workspace={self.workspace.id}").data["count"], 1)

    def test_subtasks_allowed_one_level_only(self) -> None:
        parent = self.make_task(self.workspace, title="parent")
        child = self.make_task(self.workspace, title="child", parent=parent)

        nested = self.client.post(
            TASKS,
            {"workspace": self.workspace.id, "title": "grandchild", "parent": child.id},
            format="json",
        )
        self.assertEqual(nested.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("parent", nested.data["errors"])

    def test_parent_cannot_become_child_of_its_own_subtask(self) -> None:
        parent = self.make_task(self.workspace, title="parent")
        child = self.make_task(self.workspace, title="child", parent=parent)
        response = self.client.patch(
            f"{TASKS}{parent.id}/", {"parent": child.id}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cross_workspace_parent_is_rejected(self) -> None:
        other_workspace = self.make_workspace(name="Other")
        foreign = self.make_task(other_workspace, title="foreign")
        response = self.client.post(
            TASKS,
            {"workspace": self.workspace.id, "title": "x", "parent": foreign.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_subtask_stats_and_parent_filter(self) -> None:
        parent = self.make_task(self.workspace, title="parent")
        self.make_task(self.workspace, title="c1", parent=parent, status=Task.Status.DONE)
        self.make_task(self.workspace, title="c2", parent=parent)

        listing = self.client.get(f"{TASKS}?workspace={self.workspace.id}")
        self.assertEqual(listing.data["count"], 3)
        top = [row for row in listing.data["results"] if row["parent"] is None]
        self.assertEqual(top[0]["subtask_stats"], {"total": 2, "done": 1})

        children = self.client.get(
            f"{TASKS}?workspace={self.workspace.id}&parent={parent.id}"
        )
        self.assertEqual(children.data["count"], 2)

    def test_delete_parent_cascades_to_subtasks(self) -> None:
        parent = self.make_task(self.workspace, title="parent")
        child = self.make_task(self.workspace, title="child", parent=parent)
        self.client.delete(f"{TASKS}{parent.id}/")
        self.assertFalse(Task.objects.filter(pk=child.pk).exists())

    def test_empty_title_is_rejected(self) -> None:
        response = self.client.post(
            TASKS, {"workspace": self.workspace.id, "title": "   "}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TaskFilterTests(BaseAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.workspace = self.make_workspace()
        self.list_a = self.make_list(self.workspace, name="A")
        self.list_b = self.make_list(self.workspace, name="B")
        today = timezone.localdate()

        self.todo = self.make_task(
            self.workspace, title="梳理需求", task_list=self.list_a, status=Task.Status.TODO
        )
        self.doing = self.make_task(
            self.workspace,
            title="开发接口",
            task_list=self.list_a,
            status=Task.Status.DOING,
            priority=Task.Priority.URGENT,
            task_type=Task.Type.DEV,
        )
        self.done = self.make_task(
            self.workspace,
            title="开会同步",
            task_list=self.list_b,
            status=Task.Status.DONE,
            priority=Task.Priority.LOW,
            task_type=Task.Type.MEETING,
        )
        self.overdue = self.make_task(
            self.workspace,
            title="逾期事项",
            due_date=today - timedelta(days=2),
            status=Task.Status.TODO,
        )
        self.future = self.make_task(
            self.workspace, title="下周事项", due_date=today + timedelta(days=3)
        )
        self.no_due = self.make_task(self.workspace, title="无期限")

    def _get(self, query: str) -> dict:
        response = self.client.get(f"{TASKS}?workspace={self.workspace.id}&{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return response.data

    def test_status_csv_filter(self) -> None:
        data = self._get("status=todo,doing")
        # todo, overdue, future, no_due are all `todo`; doing adds one more.
        self.assertEqual(data["count"], 5)

    def test_priority_filter(self) -> None:
        self.assertEqual(self._get("priority=urgent")["count"], 1)

    def test_task_type_filter(self) -> None:
        self.assertEqual(self._get("task_type=meeting")["count"], 1)

    def test_search_filter(self) -> None:
        self.assertEqual(self._get("search=接口")["count"], 1)

    def test_due_filters(self) -> None:
        self.assertEqual(self._get("due=overdue")["count"], 1)
        self.assertEqual(self._get("due=none")["count"], 4)
        self.assertEqual(self._get("due=week")["count"], 1)

    def test_task_list_filter(self) -> None:
        self.assertEqual(self._get(f"task_list={self.list_a.id}")["count"], 2)
        # overdue, future and no_due have no list; `done` belongs to list_b.
        self.assertEqual(self._get("task_list=null")["count"], 3)

    def test_tag_filter_uses_and_semantics(self) -> None:
        pwa = Tag.objects.create(workspace=self.workspace, name="pwa")
        api = Tag.objects.create(workspace=self.workspace, name="api")
        self.todo.tags.set([pwa, api])
        self.doing.tags.set([pwa])

        self.assertEqual(self._get(f"tag={pwa.id}")["count"], 2)
        self.assertEqual(self._get(f"tag={pwa.id},{api.id}")["count"], 1)

    def test_is_archived_defaults_to_false(self) -> None:
        self.make_task(self.workspace, title="archived", is_archived=True)
        self.assertEqual(self._get("")["count"], 6)
        self.assertEqual(self._get("is_archived=true")["count"], 1)

    def test_priority_ordering_is_semantic(self) -> None:
        data = self._get("ordering=priority")
        priorities = [row["priority"] for row in data["results"]]
        self.assertEqual(priorities[0], "urgent")
        self.assertEqual(priorities[-1], "low")

    def test_due_date_ordering(self) -> None:
        data = self._get("ordering=due_date")
        due_dates = [row["due_date"] for row in data["results"]]
        self.assertEqual(due_dates[0], str(timezone.localdate() - timedelta(days=2)))


class TaskBulkOperationTests(BaseAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.workspace = self.make_workspace()
        self.tasks = [self.make_task(self.workspace, title=f"t{i}") for i in range(3)]

    def test_bulk_done(self) -> None:
        ids = [t.id for t in self.tasks[:2]]
        response = self.client.post(f"{TASKS}bulk/", {"ids": ids, "action": "done"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["updated"], 2)
        self.assertEqual(Task.objects.filter(id__in=ids, status=Task.Status.DONE).count(), 2)

    def test_bulk_todo_resets_completed_at(self) -> None:
        task = self.tasks[0]
        task.status = Task.Status.DONE
        task.save()
        self.client.post(f"{TASKS}bulk/", {"ids": [task.id], "action": "todo"}, format="json")
        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.TODO)
        self.assertIsNone(task.completed_at)

    def test_bulk_archive_and_delete(self) -> None:
        self.client.post(
            f"{TASKS}bulk/", {"ids": [self.tasks[0].id], "action": "archive"}, format="json"
        )
        self.tasks[0].refresh_from_db()
        self.assertTrue(self.tasks[0].is_archived)

        self.client.post(
            f"{TASKS}bulk/", {"ids": [self.tasks[1].id], "action": "delete"}, format="json"
        )
        self.assertFalse(Task.objects.filter(pk=self.tasks[1].pk).exists())

    def test_bulk_cannot_touch_foreign_tasks(self) -> None:
        theirs_workspace = self.make_workspace(owner=self.other, name="Theirs")
        foreign = self.make_task(theirs_workspace, title="foreign")
        response = self.client.post(
            f"{TASKS}bulk/", {"ids": [foreign.id], "action": "delete"}, format="json"
        )
        self.assertEqual(response.data["updated"], 0)
        self.assertTrue(Task.objects.filter(pk=foreign.pk).exists())

    def test_bulk_rejects_unknown_action(self) -> None:
        response = self.client.post(
            f"{TASKS}bulk/", {"ids": [self.tasks[0].id], "action": "explode"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class TaskReorderTests(BaseAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.workspace = self.make_workspace()
        self.list_a = self.make_list(self.workspace, name="A")
        self.list_b = self.make_list(self.workspace, name="B")
        self.t1 = self.make_task(self.workspace, title="t1", task_list=self.list_a)
        self.t2 = self.make_task(self.workspace, title="t2", task_list=self.list_a)

    def test_reorder_updates_sort_order(self) -> None:
        response = self.client.post(
            f"{TASKS}reorder/",
            {"items": [{"id": self.t1.id, "sort_order": 9}, {"id": self.t2.id, "sort_order": 1}]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.t1.refresh_from_db()
        self.assertEqual(self.t1.sort_order, 9)

    def test_reorder_can_move_between_lists(self) -> None:
        response = self.client.post(
            f"{TASKS}reorder/",
            {"items": [{"id": self.t1.id, "sort_order": 0, "task_list": self.list_b.id}]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.t1.refresh_from_db()
        self.assertEqual(self.t1.task_list_id, self.list_b.id)

    def test_reorder_ignores_foreign_tasks(self) -> None:
        theirs_workspace = self.make_workspace(owner=self.other, name="Theirs")
        foreign = self.make_task(theirs_workspace, title="foreign")
        response = self.client.post(
            f"{TASKS}reorder/", {"items": [{"id": foreign.id, "sort_order": 42}]}, format="json"
        )
        self.assertEqual(response.data["updated"], 0)
        foreign.refresh_from_db()
        self.assertNotEqual(foreign.sort_order, 42)

    def test_reorder_rejects_invalid_list_id(self) -> None:
        response = self.client.post(
            f"{TASKS}reorder/",
            {"items": [{"id": self.t1.id, "sort_order": 1, "task_list": 999999}]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.t1.refresh_from_db()
        self.assertEqual(self.t1.task_list_id, self.list_a.id)


class TagTests(BaseAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.workspace = self.make_workspace()

    def test_create_and_count(self) -> None:
        response = self.client.post(
            TAGS, {"workspace": self.workspace.id, "name": "pwa"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        tag_id = response.data["id"]
        self.make_task(self.workspace, title="x").tags.set([Tag.objects.get(pk=tag_id)])

        listing = self.client.get(f"{TAGS}?workspace={self.workspace.id}")
        self.assertEqual(listing.data["results"][0]["task_count"], 1)

    def test_duplicate_name_in_same_workspace_is_rejected(self) -> None:
        Tag.objects.create(workspace=self.workspace, name="pwa")
        response = self.client.post(
            TAGS, {"workspace": self.workspace.id, "name": "pwa"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_same_name_in_other_workspace_is_allowed(self) -> None:
        other = self.make_workspace(name="Other")
        Tag.objects.create(workspace=self.workspace, name="pwa")
        response = self.client.post(
            TAGS, {"workspace": other.id, "name": "pwa"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_delete_detaches_from_tasks(self) -> None:
        tag = Tag.objects.create(workspace=self.workspace, name="pwa")
        task = self.make_task(self.workspace, title="x")
        task.tags.set([tag])
        response = self.client.delete(f"{TAGS}{tag.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        task.refresh_from_db()
        self.assertEqual(task.tags.count(), 0)

    def test_tag_isolation(self) -> None:
        theirs = self.make_workspace(owner=self.other, name="Theirs")
        foreign_tag = Tag.objects.create(workspace=theirs, name="secret")
        self.assertEqual(
            self.client.delete(f"{TAGS}{foreign_tag.id}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )


class DocumentTests(BaseAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.workspace = self.make_workspace()

    def test_create_list_update_delete(self) -> None:
        create = self.client.post(
            DOCUMENTS,
            {
                "workspace": self.workspace.id,
                "title": "v1 里程碑计划",
                "body": "- [ ] #1 登录页\n- [ ] #2 PWA",
                "kind": "plan",
                "status": "draft",
            },
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.data)
        self.assertEqual(create.data["workspace_name"], self.workspace.name)
        self.assertEqual(create.data["kind"], "plan")
        self.assertEqual(create.data["status"], "draft")
        doc_id = create.data["id"]

        listing = self.client.get(f"{DOCUMENTS}?workspace={self.workspace.id}")
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual(listing.data["count"], 1)
        self.assertEqual(listing.data["results"][0]["id"], doc_id)

        patch = self.client.patch(
            f"{DOCUMENTS}{doc_id}/",
            {"status": "active", "body": "- [x] #1 登录页"},
            format="json",
        )
        self.assertEqual(patch.status_code, status.HTTP_200_OK, patch.data)
        self.assertEqual(patch.data["status"], "active")
        self.assertIn("#1", patch.data["body"])

        detail = self.client.get(f"{DOCUMENTS}{doc_id}/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data["title"], "v1 里程碑计划")

        delete = self.client.delete(f"{DOCUMENTS}{doc_id}/")
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(
            self.client.get(f"{DOCUMENTS}?workspace={self.workspace.id}").data["count"],
            0,
        )

    def test_archived_hidden_by_default(self) -> None:
        Document.objects.create(
            workspace=self.workspace,
            title="旧计划",
            kind=Document.Kind.PLAN,
            status=Document.Status.ARCHIVED,
        )
        Document.objects.create(
            workspace=self.workspace,
            title="进行中",
            kind=Document.Kind.NOTE,
            status=Document.Status.ACTIVE,
        )
        listing = self.client.get(f"{DOCUMENTS}?workspace={self.workspace.id}")
        self.assertEqual(listing.data["count"], 1)
        self.assertEqual(listing.data["results"][0]["title"], "进行中")

        with_archived = self.client.get(
            f"{DOCUMENTS}?workspace={self.workspace.id}&include_archived=true"
        )
        self.assertEqual(with_archived.data["count"], 2)

    def test_filter_by_kind_and_search(self) -> None:
        Document.objects.create(
            workspace=self.workspace,
            title="发布计划",
            body="含 PWA 缓存",
            kind=Document.Kind.PLAN,
        )
        Document.objects.create(
            workspace=self.workspace,
            title="登录决策",
            body="JWT 轮换",
            kind=Document.Kind.DECISION,
        )
        by_kind = self.client.get(
            f"{DOCUMENTS}?workspace={self.workspace.id}&kind=decision"
        )
        self.assertEqual(by_kind.data["count"], 1)
        self.assertEqual(by_kind.data["results"][0]["kind"], "decision")

        by_search = self.client.get(
            f"{DOCUMENTS}?workspace={self.workspace.id}&search=PWA"
        )
        self.assertEqual(by_search.data["count"], 1)
        self.assertEqual(by_search.data["results"][0]["title"], "发布计划")

    def test_title_required_and_isolation(self) -> None:
        empty = self.client.post(
            DOCUMENTS,
            {"workspace": self.workspace.id, "title": "  "},
            format="json",
        )
        self.assertEqual(empty.status_code, status.HTTP_400_BAD_REQUEST)

        theirs = self.make_workspace(owner=self.other, name="Theirs")
        foreign = Document.objects.create(
            workspace=theirs, title="secret plan", kind=Document.Kind.PLAN
        )
        self.assertEqual(
            self.client.get(f"{DOCUMENTS}{foreign.id}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.get(f"{DOCUMENTS}?workspace={theirs.id}").status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.get(f"{DOCUMENTS}?workspace={theirs.id}").data["count"],
            0,
        )

    def test_tag_ids_must_belong_to_workspace(self) -> None:
        tag = Tag.objects.create(workspace=self.workspace, name="milestone")
        other_ws = self.make_workspace(name="Other")
        foreign_tag = Tag.objects.create(workspace=other_ws, name="foreign")

        ok = self.client.post(
            DOCUMENTS,
            {
                "workspace": self.workspace.id,
                "title": "带标签计划",
                "tag_ids": [tag.id],
            },
            format="json",
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)
        self.assertEqual(ok.data["tags"][0]["name"], "milestone")

        bad = self.client.post(
            DOCUMENTS,
            {
                "workspace": self.workspace.id,
                "title": "错标签",
                "tag_ids": [foreign_tag.id],
            },
            format="json",
        )
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)


class ArchitectureDiagramTests(BaseAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.workspace = self.make_workspace()
        self.url = f"{WORKSPACES}{self.workspace.id}/architecture/"
        self.image_url = f"{WORKSPACES}{self.workspace.id}/architecture/image/"

    def test_get_empty_shell_then_put_mermaid(self) -> None:
        empty = self.client.get(self.url)
        self.assertEqual(empty.status_code, status.HTTP_200_OK, empty.data)
        self.assertFalse(empty.data["has_content"])
        self.assertEqual(empty.data["mermaid"], "")

        put = self.client.put(
            self.url,
            {
                "title": "系统架构",
                "mermaid": "flowchart LR\n  A --> B",
                "preferred": "mermaid",
            },
            format="json",
        )
        self.assertEqual(put.status_code, status.HTTP_200_OK, put.data)
        self.assertTrue(put.data["has_content"])
        self.assertIn("A --> B", put.data["mermaid"])
        self.assertEqual(ArchitectureDiagram.objects.filter(workspace=self.workspace).count(), 1)

        again = self.client.put(
            self.url,
            {"mermaid": "flowchart TB\n  X --> Y"},
            format="json",
        )
        self.assertEqual(again.status_code, status.HTTP_200_OK, again.data)
        self.assertEqual(
            ArchitectureDiagram.objects.filter(workspace=self.workspace).count(), 1
        )
        self.assertIn("X --> Y", again.data["mermaid"])

    def test_upload_and_delete_image(self) -> None:
        upload = SimpleUploadedFile(
            "diagram.png",
            b"\x89PNG\r\n\x1a\n" + b"\x00" * 32,
            content_type="image/png",
        )
        response = self.client.post(self.image_url, {"image": upload}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data["has_content"])
        self.assertEqual(response.data["preferred"], "image")
        self.assertIsNotNone(response.data["image_url"])

        cleared = self.client.delete(self.image_url)
        self.assertEqual(cleared.status_code, status.HTTP_200_OK, cleared.data)
        self.assertIsNone(cleared.data["image_url"])

    def test_delete_architecture_and_isolation(self) -> None:
        ArchitectureDiagram.objects.create(
            workspace=self.workspace,
            title="arch",
            mermaid="flowchart LR\n  A --> B",
        )
        deleted = self.client.delete(self.url)
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            ArchitectureDiagram.objects.filter(workspace=self.workspace).exists()
        )

        theirs = self.make_workspace(owner=self.other, name="Theirs")
        ArchitectureDiagram.objects.create(
            workspace=theirs, mermaid="flowchart LR\n  secret"
        )
        self.assertEqual(
            self.client.get(f"{WORKSPACES}{theirs.id}/architecture/").status_code,
            status.HTTP_404_NOT_FOUND,
        )
