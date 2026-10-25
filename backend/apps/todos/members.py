"""Membership rules: who may do what inside a workspace.

Kept out of the viewsets because the same questions ("is this person an admin?",
"may a viewer write?") are asked from several places — member management, invite
acceptance, task assignment and the task write guard. One implementation, one
place to change the policy.

The role ladder is ordered, so "at least admin" is a comparison rather than a
set membership test that has to be repeated in every call site.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.utils import timezone

from .models import Workspace, WorkspaceInvite, WorkspaceMember

if TYPE_CHECKING:
    from apps.accounts.models import User

Role = WorkspaceMember.Role

#: Higher may do everything a lower role may do, within its own scope.
ROLE_RANK: dict[str, int] = {
    Role.VIEWER: 1,
    Role.MEMBER: 2,
    Role.ADMIN: 3,
    Role.OWNER: 4,
}


def role_of(user: "User", workspace: Workspace) -> str | None:
    """The caller's effective role, or None when they are not in the workspace.

    `Workspace.owner` wins over the membership row: an owner cannot be demoted by
    editing their own membership, which would otherwise be a way to lock
    themselves out of their workspace.
    """
    if not user or not user.is_authenticated:
        return None
    if workspace.owner_id == user.id:
        return Role.OWNER
    membership = workspace.memberships.filter(user=user).first()
    return membership.role if membership else None


def rank(role: str | None) -> int:
    return ROLE_RANK.get(role or "", 0)


def at_least(role: str | None, minimum: str) -> bool:
    return rank(role) >= rank(minimum)


def can_manage_members(role: str | None) -> bool:
    return at_least(role, Role.ADMIN)


def can_write_content(role: str | None) -> bool:
    """Viewers are read-only; everyone else may create and edit tasks."""
    return at_least(role, Role.MEMBER)


def assignable_members(workspace: Workspace) -> list["User"]:
    """Everyone who may be assigned a task: the owner plus all members."""
    from apps.accounts.models import User

    ids = set(workspace.memberships.values_list("user_id", flat=True))
    ids.add(workspace.owner_id)
    return list(User.objects.filter(pk__in=ids).order_by("email"))


def add_member(
    workspace: Workspace,
    user: "User",
    role: str = Role.MEMBER,
    invited_by: "User | None" = None,
) -> WorkspaceMember:
    """Idempotent: re-adding an existing member updates their role."""
    membership, created = WorkspaceMember.objects.get_or_create(
        workspace=workspace,
        user=user,
        defaults={"role": role, "invited_by": invited_by},
    )
    if not created and membership.role != role:
        membership.role = role
        membership.save(update_fields=["role", "updated_at"])
    return membership


class InviteError(Exception):
    """Raised when an invite cannot be used. Carries the HTTP status to return."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def accept_invite(invite: WorkspaceInvite, user: "User") -> WorkspaceMember:
    """Consume an invite and join the workspace.

    Ordering matters: the status is re-checked here rather than trusted from the
    caller, so two people racing on the same link cannot both succeed.
    """
    status = invite.status
    if status == WorkspaceInvite.Status.ACCEPTED:
        raise InviteError("这个邀请已经被使用过了。", 410)
    if status == WorkspaceInvite.Status.REVOKED:
        raise InviteError("这个邀请已被撤销。", 410)
    if status == WorkspaceInvite.Status.EXPIRED:
        raise InviteError("这个邀请已过期，请让对方重新生成。", 410)

    if workspace_has_user(invite.workspace, user):
        # Already in: consume the invite so it cannot be reused by someone else.
        _mark_accepted(invite, user)
        return WorkspaceMember.objects.get(workspace=invite.workspace, user=user)

    membership = add_member(
        invite.workspace, user, role=invite.role, invited_by=invite.invited_by
    )
    _mark_accepted(invite, user)
    return membership


def _mark_accepted(invite: WorkspaceInvite, user: "User") -> None:
    invite.accepted_at = timezone.now()
    invite.accepted_by = user
    invite.save(update_fields=["accepted_at", "accepted_by", "updated_at"])


def workspace_has_user(workspace: Workspace, user: "User") -> bool:
    if workspace.owner_id == user.id:
        return True
    return workspace.memberships.filter(user=user).exists()


def removable_role(actor_role: str | None, target_role: str) -> bool:
    """Admins may not remove or demote owners, or other admins at parity."""
    if target_role == Role.OWNER:
        return False
    if actor_role == Role.OWNER:
        return True
    return actor_role == Role.ADMIN and target_role == Role.MEMBER or (
        actor_role == Role.ADMIN and target_role == Role.VIEWER
    )
