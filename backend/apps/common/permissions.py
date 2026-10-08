"""Cross-cutting DRF permissions."""

from __future__ import annotations

from typing import Any

from rest_framework.permissions import BasePermission


class IsObjectOwnerOrMember(BasePermission):
    """Object-level guard for anything reachable from a Workspace.

    Workspace-aware querysets already hide foreign rows, so this is a
    defence-in-depth check rather than the primary mechanism.
    """

    message = "You do not have access to this resource."

    def has_object_permission(self, request: Any, view: Any, obj: Any) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False

        workspace = getattr(obj, "workspace", None)
        if workspace is None:
            # The object *is* a workspace (or a member row pointing at one).
            workspace = getattr(obj, "workspace", obj)

        owner_id = getattr(workspace, "owner_id", None)
        if owner_id == user.id:
            return True

        members = getattr(workspace, "members", None)
        if members is not None:
            return members.filter(pk=user.pk).exists()
        return False
