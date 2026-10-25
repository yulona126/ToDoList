"""Workspace sharing: invites, roles, and task assignment.

The policy that matters and is easy to get wrong: an admin must not be able to
demote or remove an owner, and a viewer must not be able to write. Both are
covered here rather than trusted to the UI.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.todos.models import Task, TaskList, Workspace, WorkspaceInvite, WorkspaceMember

User = get_user_model()

WS = "/api/v1/workspaces/"
TASKS = "/api/v1/tasks/"
INVITES = "/api/v1/invites/"


class BaseTeamTest(APITestCase):
    def setUp(self) -> None:
        self.owner = User.objects.create_user(
            email="owner@example.com", username="owner", password="SuperSecret123"
        )
        self.member = User.objects.create_user(
            email="member@example.com", username="member", password="SuperSecret123"
        )
        self.outsider = User.objects.create_user(
            email="out@example.com", username="out", password="SuperSecret123"
        )
        self.workspace = Workspace.objects.create(name="Team", owner=self.owner)
        WorkspaceMember.objects.create(
            workspace=self.workspace, user=self.owner, role=WorkspaceMember.Role.OWNER
        )
        self.task_list = TaskList.objects.create(
            workspace=self.workspace, name="开发"
        )
        self.as_user(self.owner)

    def as_user(self, user) -> None:
        self.client.force_authenticate(user)

    def make_invite(self, role=WorkspaceMember.Role.MEMBER, **overrides):
        fields = {
            "workspace": self.workspace,
            "role": role,
            "invited_by": self.owner,
            "expires_at": timezone.now() + timedelta(days=7),
        }
        fields.update(overrides)
        return WorkspaceInvite.objects.create(**fields)


class InviteTokenTests(BaseTeamTest):
    def test_creating_an_invite_returns_a_copyable_path(self) -> None:
        response = self.client.post(
            f"{WS}{self.workspace.id}/invites/", {"role": "member"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(response.data["token"])
        self.assertEqual(response.data["accept_path"], f"/join/{response.data['token']}")
        self.assertEqual(response.data["status"], "pending")

    def test_owner_role_cannot_be_invited(self) -> None:
        """Ownership transfer is not an invite; it needs its own deliberate flow."""
        response = self.client.post(
            f"{WS}{self.workspace.id}/invites/", {"role": "owner"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_plain_members_cannot_mint_invites(self) -> None:
        WorkspaceMember.objects.create(
            workspace=self.workspace, user=self.member, role=WorkspaceMember.Role.MEMBER
        )
        self.as_user(self.member)
        response = self.client.post(
            f"{WS}{self.workspace.id}/invites/", {"role": "member"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_preview_is_public(self) -> None:
        """The join page must explain the invitation before asking to sign in."""
        invite = self.make_invite()
        self.client.force_authenticate(None)
        response = self.client.get(f"{INVITES}{invite.token}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["workspace_name"], "Team")
        self.assertTrue(response.data["is_usable"])

    def test_accepting_joins_the_workspace(self) -> None:
        invite = self.make_invite(role=WorkspaceMember.Role.MEMBER)
        self.as_user(self.member)
        response = self.client.post(f"{INVITES}{invite.token}/accept/")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(
            WorkspaceMember.objects.filter(
                workspace=self.workspace, user=self.member
            ).exists()
        )
        invite.refresh_from_db()
        self.assertIsNotNone(invite.accepted_at)
        self.assertEqual(invite.accepted_by_id, self.member.id)

    def test_invite_is_single_use(self) -> None:
        invite = self.make_invite()
        self.as_user(self.member)
        self.client.post(f"{INVITES}{invite.token}/accept/")

        self.as_user(self.outsider)
        response = self.client.post(f"{INVITES}{invite.token}/accept/")
        self.assertEqual(response.status_code, status.HTTP_410_GONE)
        self.assertFalse(
            WorkspaceMember.objects.filter(
                workspace=self.workspace, user=self.outsider
            ).exists()
        )

    def test_expired_invite_is_rejected(self) -> None:
        invite = self.make_invite(expires_at=timezone.now() - timedelta(minutes=1))
        self.as_user(self.member)
        response = self.client.post(f"{INVITES}{invite.token}/accept/")
        self.assertEqual(response.status_code, status.HTTP_410_GONE)

    def test_revoked_invite_is_rejected(self) -> None:
        invite = self.make_invite()
        response = self.client.delete(
            f"{WS}{self.workspace.id}/invites/{invite.token}/"
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.as_user(self.member)
        self.assertEqual(
            self.client.post(f"{INVITES}{invite.token}/accept/").status_code,
            status.HTTP_410_GONE,
        )

    def test_accepting_requires_authentication(self) -> None:
        invite = self.make_invite()
        self.client.force_authenticate(None)
        self.assertIn(
            self.client.post(f"{INVITES}{invite.token}/accept/").status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_accepting_twice_is_harmless_for_the_same_user(self) -> None:
        invite = self.make_invite()
        self.as_user(self.member)
        first = self.client.post(f"{INVITES}{invite.token}/accept/")
        second = self.client.post(f"{INVITES}{invite.token}/accept/")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_410_GONE)


class MemberManagementTests(BaseTeamTest):
    def setUp(self) -> None:
        super().setUp()
        WorkspaceMember.objects.create(
            workspace=self.workspace, user=self.member, role=WorkspaceMember.Role.MEMBER
        )

    def test_members_are_listed_with_their_roles(self) -> None:
        response = self.client.get(f"{WS}{self.workspace.id}/members/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        roles = {row["user"]["email"]: row["role"] for row in response.data["results"]}
        self.assertEqual(roles["owner@example.com"], "owner")
        self.assertEqual(roles["member@example.com"], "member")

    def test_adding_an_existing_user_by_email(self) -> None:
        response = self.client.post(
            f"{WS}{self.workspace.id}/members/",
            {"email": "out@example.com", "role": "viewer"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(
            WorkspaceMember.objects.filter(
                workspace=self.workspace, user=self.outsider, role="viewer"
            ).exists()
        )

    def test_adding_an_unknown_email_explains_the_alternative(self) -> None:
        response = self.client.post(
            f"{WS}{self.workspace.id}/members/",
            {"email": "nobody@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("邀请链接", response.data["detail"])

    def test_promoting_a_member(self) -> None:
        response = self.client.patch(
            f"{WS}{self.workspace.id}/members/{self.member.id}/",
            {"role": "admin"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["role"], "admin")

    def test_removing_a_member(self) -> None:
        response = self.client.delete(
            f"{WS}{self.workspace.id}/members/{self.member.id}/"
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            WorkspaceMember.objects.filter(
                workspace=self.workspace, user=self.member
            ).exists()
        )

    def test_owner_cannot_be_removed(self) -> None:
        response = self.client.delete(
            f"{WS}{self.workspace.id}/members/{self.owner.id}/"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_owner_cannot_be_demoted(self) -> None:
        response = self.client.patch(
            f"{WS}{self.workspace.id}/members/{self.owner.id}/",
            {"role": "member"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ownership_cannot_be_granted_via_role_change(self) -> None:
        response = self.client.patch(
            f"{WS}{self.workspace.id}/members/{self.member.id}/",
            {"role": "owner"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_cannot_remove_another_admin(self) -> None:
        """Parity is not authority — otherwise two admins can remove each other."""
        second = User.objects.create_user(
            email="admin2@example.com", username="admin2", password="SuperSecret123"
        )
        WorkspaceMember.objects.filter(
            workspace=self.workspace, user=self.member
        ).update(role=WorkspaceMember.Role.ADMIN)
        WorkspaceMember.objects.create(
            workspace=self.workspace, user=second, role=WorkspaceMember.Role.ADMIN
        )
        self.as_user(self.member)
        response = self.client.delete(f"{WS}{self.workspace.id}/members/{second.id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class WorkspaceVisibilityTests(BaseTeamTest):
    def test_invited_members_see_the_workspace_in_their_list(self) -> None:
        WorkspaceMember.objects.create(
            workspace=self.workspace, user=self.member, role=WorkspaceMember.Role.MEMBER
        )
        self.as_user(self.member)
        response = self.client.get(WS)
        names = [row["name"] for row in response.data["results"]] if isinstance(
            response.data, dict
        ) else [row["name"] for row in response.data]
        self.assertIn("Team", names)

    def test_outsiders_do_not(self) -> None:
        self.as_user(self.outsider)
        response = self.client.get(WS)
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        self.assertEqual(rows, [])

    def test_outsider_cannot_read_members(self) -> None:
        self.as_user(self.outsider)
        self.assertEqual(
            self.client.get(f"{WS}{self.workspace.id}/members/").status_code,
            status.HTTP_404_NOT_FOUND,
        )


class AssigneeTests(BaseTeamTest):
    def setUp(self) -> None:
        super().setUp()
        WorkspaceMember.objects.create(
            workspace=self.workspace, user=self.member, role=WorkspaceMember.Role.MEMBER
        )

    def create_task(self, **extra):
        payload = {
            "workspace": self.workspace.id,
            "task_list": self.task_list.id,
            "title": "任务",
        }
        payload.update(extra)
        return self.client.post(TASKS, payload, format="json")

    def test_assigning_a_member(self) -> None:
        response = self.create_task(assignee=self.member.id)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["assignee"], self.member.id)
        self.assertEqual(
            response.data["assignee_detail"]["email"], "member@example.com"
        )

    def test_assigning_the_owner(self) -> None:
        response = self.create_task(assignee=self.owner.id)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_rejecting_a_non_member(self) -> None:
        """Otherwise a task could be pointed at anyone's user id."""
        response = self.create_task(assignee=self.outsider.id)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("assignee", response.data["errors"])

    def test_unassigning(self) -> None:
        created = self.create_task(assignee=self.member.id)
        task_id = created.data["id"]
        response = self.client.patch(
            f"{TASKS}{task_id}/", {"assignee": None}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNone(response.data["assignee"])

    def test_removing_a_member_unassigns_but_keeps_their_tasks(self) -> None:
        """Offboarding must not delete work, and must not leave a task pointing
        at someone who is no longer in the workspace."""
        created = self.create_task(assignee=self.member.id)
        task_id = created.data["id"]
        removed = self.client.delete(f"{WS}{self.workspace.id}/members/{self.member.id}/")
        self.assertEqual(removed.status_code, status.HTTP_204_NO_CONTENT, removed.data)
        task = Task.objects.get(pk=task_id)
        self.assertIsNone(task.assignee)
        self.assertTrue(Task.objects.filter(pk=task_id).exists())


class ViewerReadOnlyTests(BaseTeamTest):
    def setUp(self) -> None:
        super().setUp()
        WorkspaceMember.objects.create(
            workspace=self.workspace, user=self.member, role=WorkspaceMember.Role.VIEWER
        )
        self.task = Task.objects.create(
            workspace=self.workspace, task_list=self.task_list, title="只读可见"
        )

    def test_viewer_can_read(self) -> None:
        self.as_user(self.member)
        response = self.client.get(f"{TASKS}?workspace={self.workspace.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_viewer_cannot_create(self) -> None:
        self.as_user(self.member)
        response = self.client.post(
            TASKS,
            {
                "workspace": self.workspace.id,
                "task_list": self.task_list.id,
                "title": "不该成功",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_viewer_cannot_update_or_delete(self) -> None:
        self.as_user(self.member)
        self.assertEqual(
            self.client.patch(
                f"{TASKS}{self.task.id}/", {"title": "改"}, format="json"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.delete(f"{TASKS}{self.task.id}/").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_viewer_cannot_toggle_or_commit(self) -> None:
        self.as_user(self.member)
        for path in ("toggle", "commit", "uncommit"):
            with self.subTest(path=path):
                self.assertEqual(
                    self.client.post(f"{TASKS}{self.task.id}/{path}/").status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_promoting_to_member_restores_write_access(self) -> None:
        self.client.patch(
            f"{WS}{self.workspace.id}/members/{self.member.id}/",
            {"role": "member"},
            format="json",
        )
        self.as_user(self.member)
        self.assertEqual(
            self.client.patch(
                f"{TASKS}{self.task.id}/", {"title": "可以改了"}, format="json"
            ).status_code,
            status.HTTP_200_OK,
        )


class MemberModelTests(BaseTeamTest):
    def test_role_ladder_is_ordered(self) -> None:
        from apps.todos import members

        self.assertTrue(members.at_least("owner", "admin"))
        self.assertTrue(members.at_least("admin", "member"))
        self.assertFalse(members.at_least("viewer", "member"))
        self.assertFalse(members.at_least(None, "viewer"))

    def test_owner_membership_row_is_created_with_the_workspace(self) -> None:
        self.assertTrue(
            WorkspaceMember.objects.filter(
                workspace=self.workspace, user=self.owner
            ).exists()
        )

    def test_invite_token_is_long_and_unique(self) -> None:
        a = self.make_invite()
        b = self.make_invite()
        self.assertNotEqual(a.token, b.token)
        self.assertGreaterEqual(len(a.token), 24)
