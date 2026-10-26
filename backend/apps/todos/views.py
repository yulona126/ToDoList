"""Todo API viewsets (docs/api.md §2–§5)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Case, Count, IntegerField, Q, Value, When
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend

from apps.accounts.models import User
from apps.common.mixins import ScopedDetailMixin
from apps.common.permissions import IsObjectOwnerOrMember

from . import events as ev
from . import members
from .flow import flow_summary, story_timeline
from .filters import (
    DocumentFilter,
    TagFilter,
    TaskFilter,
    TaskListFilter,
    TaskOrderingFilter,
    WorkspaceFilter,
)
from .models import (
    ArchitectureDiagram,
    Document,
    Tag,
    Task,
    TaskList,
    Workspace,
    WorkspaceMember,
    TaskEvent,
    WorkspaceInvite,
)
from .serializers import (
    PlanSerializer,
    MemberAddSerializer,
    MemberRoleSerializer,
    InviteCreateSerializer,
    WorkspaceInviteSerializer,
    ArchitectureDiagramSerializer,
    BulkActionSerializer,
    DocumentSerializer,
    ListReorderSerializer,
    ReorderSerializer,
    TagSerializer,
    TaskEventSerializer,
    TaskListSerializer,
    TaskSerializer,
    WorkspaceMemberSerializer,
    WorkspaceSerializer,
)

ALLOWED_ARCHITECTURE_IMAGE_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/svg+xml",
    "image/gif",
}
ALLOWED_ARCHITECTURE_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"}
MAX_ARCHITECTURE_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MiB
from .services import bulk_create_tasks


def _priority_rank_expression() -> Any:
    """Order priorities semantically, not alphabetically."""
    return Case(
        When(priority=Task.Priority.URGENT, then=Value(0)),
        When(priority=Task.Priority.HIGH, then=Value(1)),
        When(priority=Task.Priority.MEDIUM, then=Value(2)),
        When(priority=Task.Priority.LOW, then=Value(3)),
        default=Value(4),
        output_field=IntegerField(),
    )


def _parse_day(value: Any) -> date | None:
    """Accept `YYYY-MM-DD`, an ISO datetime, or None. Bad input means "today"."""
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _role_or_deny(request: Request, workspace: Workspace, minimum: str) -> str:
    """Raise 403 unless the caller holds at least `minimum` in the workspace."""
    role = members.role_of(request.user, workspace)
    if not members.at_least(role, minimum):
        raise PermissionDenied("你的角色没有这个权限。")
    return role or ""


class WorkspaceViewSet(viewsets.ModelViewSet[Workspace]):
    """`/api/v1/workspaces/` — the top-level container."""

    serializer_class = WorkspaceSerializer
    permission_classes = [IsAuthenticated, IsObjectOwnerOrMember]
    filterset_class = WorkspaceFilter
    ordering_fields = ("sort_order", "created_at", "updated_at", "name")
    ordering = ("sort_order", "-created_at")

    def get_queryset(self) -> Any:
        return Workspace.objects.for_user(self.request.user).with_stats()

    @extend_schema(
        request=WorkspaceSerializer,
        responses={201: WorkspaceSerializer},
        description="Create a workspace. The caller becomes its owner.",
    )
    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer: Any) -> None:
        user = self.request.user
        limit = settings.MAX_WORKSPACES_PER_USER
        if Workspace.objects.for_user(user).count() >= limit:
            raise ValidationError(
                {"detail": f"每个账号最多可创建 {limit} 个工作区。"}
            )
        workspace = serializer.save(owner=user)
        # Reserved for sharing: V1 writes exactly one row, the owner's.
        WorkspaceMember.objects.create(
            workspace=workspace,
            user=user,
            role=WorkspaceMember.Role.OWNER,
        )

    @extend_schema(
        responses={200: WorkspaceMemberSerializer(many=True)},
        description="List workspace members. V1 returns the owner only.",
    )
    @extend_schema(
        methods=["GET"], responses={200: WorkspaceMemberSerializer(many=True)},
        description="List members. Any member may read this (needed for assignee pickers).",
    )
    @extend_schema(methods=["POST"], request=MemberAddSerializer)
    @action(detail=True, methods=["get", "post"], url_path="members")
    def members(self, request: Request, pk: str | None = None) -> Response:
        workspace = self.get_object()

        if request.method == "POST":
            _role_or_deny(request, workspace, members.Role.ADMIN)
            payload = MemberAddSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            user = User.objects.filter(
                email__iexact=payload.validated_data["email"]
            ).first()
            if user is None:
                return Response(
                    {
                        "detail": "这个邮箱还没有注册。用邀请链接更方便。",
                        "errors": {"email": ["找不到该用户。"]},
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )
            if user.id == workspace.owner_id:
                return Response(
                    {"detail": "TA 已经是这个工作区的所有者。", "errors": {}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            membership = members.add_member(
                workspace, user,
                role=payload.validated_data["role"],
                invited_by=request.user,
            )
            return Response(
                WorkspaceMemberSerializer(membership).data,
                status=status.HTTP_201_CREATED,
            )

        queryset = workspace.memberships.select_related("user").order_by("created_at")
        page = self.paginate_queryset(queryset)
        serializer = WorkspaceMemberSerializer(
            page if page is not None else queryset, many=True
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @extend_schema(request=MemberRoleSerializer, responses={200: WorkspaceMemberSerializer})
    @action(
        detail=True, methods=["patch", "delete"], url_path=r"members/(?P<user_id>[^/.]+)"
    )
    def member_detail(
        self, request: Request, pk: str | None = None, user_id: str | None = None
    ) -> Response:
        workspace = self.get_object()
        actor_role = _role_or_deny(request, workspace, members.Role.ADMIN)

        membership = (
            workspace.memberships.select_related("user")
            .filter(user_id=user_id)
            .first()
        )
        if membership is None:
            return Response(
                {"detail": "成员不存在。", "errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )

        target_role = (
            members.Role.OWNER
            if membership.user_id == workspace.owner_id
            else membership.role
        )
        if not members.removable_role(actor_role, target_role):
            raise PermissionDenied("你不能修改或移除这个成员。")

        if request.method == "DELETE":
            membership.delete()
            # Removing someone from the team must not leave tasks assigned to a
            # non-member: that breaks the invariant enforced on assign, and the
            # assignee picker would show a name nobody can look up.
            Task.objects.filter(
                workspace=workspace, assignee_id=membership.user_id
            ).update(assignee=None, updated_at=timezone.now())
            return Response(status=status.HTTP_204_NO_CONTENT)

        payload = MemberRoleSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        membership.role = payload.validated_data["role"]
        membership.save(update_fields=["role", "updated_at"])
        return Response(WorkspaceMemberSerializer(membership).data)

    @extend_schema(
        methods=["GET"], responses={200: WorkspaceInviteSerializer(many=True)},
        description="Pending and past invites. Admin only.",
    )
    @extend_schema(methods=["POST"], request=InviteCreateSerializer)
    @action(detail=True, methods=["get", "post"], url_path="invites")
    def invites(self, request: Request, pk: str | None = None) -> Response:
        workspace = self.get_object()
        _role_or_deny(request, workspace, members.Role.ADMIN)

        if request.method == "POST":
            payload = InviteCreateSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            ttl = payload.validated_data.get("ttl_days")
            invite = WorkspaceInvite.objects.create(
                workspace=workspace,
                role=payload.validated_data["role"],
                invited_by=request.user,
                expires_at=timezone.now()
                + timedelta(days=ttl or WorkspaceInvite.DEFAULT_TTL_DAYS),
            )
            return Response(
                WorkspaceInviteSerializer(invite).data,
                status=status.HTTP_201_CREATED,
            )

        queryset = workspace.invites.select_related("invited_by", "accepted_by")
        return Response(WorkspaceInviteSerializer(queryset, many=True).data)

    @extend_schema(request=None, responses={204: None})
    @action(detail=True, methods=["delete"], url_path=r"invites/(?P<token>[^/.]+)")
    def revoke_invite(
        self, request: Request, pk: str | None = None, token: str | None = None
    ) -> Response:
        workspace = self.get_object()
        _role_or_deny(request, workspace, members.Role.ADMIN)
        invite = workspace.invites.filter(token=token).first()
        if invite is None:
            return Response(
                {"detail": "邀请不存在。", "errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if invite.accepted_at is None:
            invite.revoked_at = timezone.now()
            invite.save(update_fields=["revoked_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _architecture_or_empty(self, workspace: Workspace) -> ArchitectureDiagram | None:
        try:
            return workspace.architecture
        except ArchitectureDiagram.DoesNotExist:
            return None

    @extend_schema(
        responses={200: ArchitectureDiagramSerializer},
        description="Get the workspace architecture diagram (empty shell if none yet).",
    )
    @action(detail=True, methods=["get", "put", "delete"], url_path="architecture")
    def architecture(self, request: Request, pk: str | None = None) -> Response:
        workspace = self.get_object()
        diagram = self._architecture_or_empty(workspace)

        if request.method == "GET":
            if diagram is None:
                return Response(
                    {
                        "workspace": workspace.id,
                        "title": "",
                        "mermaid": "",
                        "image_url": None,
                        "preferred": ArchitectureDiagram.Preferred.MERMAID,
                        "has_content": False,
                        "created_at": None,
                        "updated_at": None,
                    }
                )
            return Response(
                ArchitectureDiagramSerializer(diagram, context={"request": request}).data
            )

        if request.method == "DELETE":
            if diagram is not None:
                if diagram.image:
                    diagram.image.delete(save=False)
                diagram.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # PUT — upsert Mermaid / title / preferred (image via separate action).
        serializer = ArchitectureDiagramSerializer(
            diagram,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        if diagram is None:
            diagram = ArchitectureDiagram(workspace=workspace)
        for field in ("title", "mermaid", "preferred"):
            if field in serializer.validated_data:
                setattr(diagram, field, serializer.validated_data[field])
        diagram.save()
        return Response(
            ArchitectureDiagramSerializer(diagram, context={"request": request}).data
        )

    @extend_schema(
        request={"multipart/form-data": {"type": "object", "properties": {"image": {"type": "string", "format": "binary"}}}},
        responses={200: ArchitectureDiagramSerializer},
        description="Upload or replace the architecture image (png/jpg/webp/svg, ≤5MB).",
    )
    @action(
        detail=True,
        methods=["post", "delete"],
        url_path="architecture/image",
    )
    def architecture_image(self, request: Request, pk: str | None = None) -> Response:
        workspace = self.get_object()
        diagram = self._architecture_or_empty(workspace)

        if request.method == "DELETE":
            if diagram is not None and diagram.image:
                diagram.image.delete(save=False)
                diagram.image = None
                if diagram.preferred == ArchitectureDiagram.Preferred.IMAGE:
                    diagram.preferred = ArchitectureDiagram.Preferred.MERMAID
                diagram.save(update_fields=["image", "preferred", "updated_at"])
            if diagram is None:
                return Response(
                    {
                        "workspace": workspace.id,
                        "title": "",
                        "mermaid": "",
                        "image_url": None,
                        "preferred": ArchitectureDiagram.Preferred.MERMAID,
                        "has_content": False,
                        "created_at": None,
                        "updated_at": None,
                    }
                )
            return Response(
                ArchitectureDiagramSerializer(diagram, context={"request": request}).data
            )

        upload = request.FILES.get("image")
        if upload is None:
            raise ValidationError({"image": ["请选择要上传的图片文件。"]})
        if upload.size and upload.size > MAX_ARCHITECTURE_IMAGE_BYTES:
            raise ValidationError({"image": ["图片不能超过 5MB。"]})

        name = (upload.name or "").lower()
        content_type = (getattr(upload, "content_type", None) or "").lower()
        ext_ok = any(name.endswith(ext) for ext in ALLOWED_ARCHITECTURE_IMAGE_EXTS)
        type_ok = content_type in ALLOWED_ARCHITECTURE_IMAGE_TYPES or content_type == ""
        if not ext_ok and not type_ok:
            raise ValidationError(
                {"image": ["仅支持 png / jpg / webp / svg / gif。"]}
            )

        if diagram is None:
            diagram = ArchitectureDiagram(workspace=workspace)
            diagram.save()
        if diagram.image:
            diagram.image.delete(save=False)
        diagram.image = upload
        diagram.preferred = ArchitectureDiagram.Preferred.IMAGE
        diagram.save()
        return Response(
            ArchitectureDiagramSerializer(diagram, context={"request": request}).data
        )


class TaskListViewSet(ScopedDetailMixin, viewsets.ModelViewSet[TaskList]):
    """`/api/v1/lists/` — task groups inside a workspace."""

    serializer_class = TaskListSerializer
    permission_classes = [IsAuthenticated, IsObjectOwnerOrMember]
    filterset_class = TaskListFilter
    ordering_fields = ("sort_order", "created_at", "updated_at", "name")
    ordering = ("sort_order", "created_at")

    def get_queryset(self) -> Any:
        return (
            TaskList.objects.filter(
                workspace__in=Workspace.objects.for_user(self.request.user)
            )
            .select_related("workspace")
            .annotate(
                stat_total=Count(
                    "tasks", filter=Q(tasks__is_archived=False), distinct=True
                ),
                stat_done=Count(
                    "tasks",
                    filter=Q(tasks__is_archived=False, tasks__status=Task.Status.DONE),
                    distinct=True,
                ),
            )
        )

    @extend_schema(
        request=ListReorderSerializer,
        responses={200: dict},
        description="Bulk update list ordering. Pass the lists in their new order.",
    )
    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request: Request) -> Response:
        serializer = ListReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = serializer.validated_data["items"]

        accessible = {
            obj.id: obj
            for obj in TaskList.objects.filter(
                workspace__in=Workspace.objects.for_user(request.user),
                id__in=[item["id"] for item in items],
            )
        }

        updated = 0
        with transaction.atomic():
            for item in items:
                task_list = accessible.get(item["id"])
                if task_list is None:
                    continue
                task_list.sort_order = item["sort_order"]
                task_list.save(update_fields=["sort_order", "updated_at"])
                updated += 1
        return Response({"updated": updated})


class TagViewSet(ScopedDetailMixin, viewsets.ModelViewSet[Tag]):
    """`/api/v1/tags/` — workspace-scoped labels."""

    serializer_class = TagSerializer
    permission_classes = [IsAuthenticated, IsObjectOwnerOrMember]
    filterset_class = TagFilter
    ordering_fields = ("name", "created_at")
    ordering = ("name",)
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self) -> Any:
        return Tag.objects.filter(
            workspace__in=Workspace.objects.for_user(self.request.user)
        ).annotate(
            active_task_count=Count(
                "tasks", filter=Q(tasks__is_archived=False), distinct=True
            )
        )


class TaskViewSet(ScopedDetailMixin, viewsets.ModelViewSet[Task]):
    """`/api/v1/tasks/` — the main resource."""

    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated, IsObjectOwnerOrMember]
    filterset_class = TaskFilter
    filter_backends = (DjangoFilterBackend, TaskOrderingFilter, SearchFilter)
    ordering_fields = (
        "sort_order",
        "created_at",
        "updated_at",
        "due_date",
        "title",
        "status",
        "priority",
    )
    ordering = ("sort_order", "created_at")

    def _assert_can_write(self, workspace: Workspace) -> None:
        """Viewers are read-only. Enforced here because every task write path
        (create, update, delete, toggle, commit, bulk) funnels through this
        viewset."""
        role = members.role_of(self.request.user, workspace)
        if not members.can_write_content(role):
            raise PermissionDenied("只读成员不能修改任务。")

    def perform_create(self, serializer: Any) -> None:
        self._assert_can_write(serializer.validated_data["workspace"])
        task = serializer.save()
        ev.record_event(task, TaskEvent.Kind.CREATED, source=TaskEvent.Source.UI)

    def perform_update(self, serializer: Any) -> None:
        self._assert_can_write(serializer.instance.workspace)
        super().perform_update(serializer)

    def perform_destroy(self, instance: Task) -> None:
        self._assert_can_write(instance.workspace)
        super().perform_destroy(instance)

    def get_queryset(self) -> Any:
        return (
            Task.objects.for_user(self.request.user)
            .select_related("workspace", "task_list", "parent")
            .prefetch_related("tags")
            .annotate(
                subtask_total=Count("subtasks", distinct=True),
                subtask_done=Count(
                    "subtasks",
                    filter=Q(subtasks__status=Task.Status.DONE),
                    distinct=True,
                ),
                priority_rank=_priority_rank_expression(),
            )
        )

    # -- custom actions ------------------------------------------------------
    @extend_schema(
        request=None,
        responses={200: TaskSerializer},
        description="Flip a task between `done` and `todo`.",
    )
    @action(detail=True, methods=["post"], url_path="toggle")
    def toggle(self, request: Request, pk: str | None = None) -> Response:
        task = self.get_object()
        self._assert_can_write(task.workspace)
        if task.status == Task.Status.DONE:
            ev.reopen_task(task, source=TaskEvent.Source.UI)
        else:
            ev.complete_task(
                task,
                source=TaskEvent.Source.UI,
                note=str(request.data.get("note") or ""),
            )
        return Response(self.get_serializer(task).data)

    # -- flow actions (docs/story-flow.md) ---------------------------------
    @extend_schema(
        request=None,
        responses={200: TaskSerializer},
        description="Pull a task into Now. Writes a `committed` event.",
    )
    @action(detail=True, methods=["post"], url_path="commit")
    def commit(self, request: Request, pk: str | None = None) -> Response:
        task = self.get_object()
        self._assert_can_write(task.workspace)
        day = _parse_day(request.data.get("planned_for"))
        ev.commit_task(task, source=TaskEvent.Source.UI, planned_for=day)
        return Response(self.get_serializer(task).data)

    @extend_schema(
        request=PlanSerializer,
        responses={200: TaskSerializer},
        description="Move a Now item to another day (or clear it with null).",
    )
    @action(detail=True, methods=["post"], url_path="plan")
    def plan(self, request: Request, pk: str | None = None) -> Response:
        task = self.get_object()
        self._assert_can_write(task.workspace)
        payload = PlanSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        ev.plan_task(
            task,
            payload.validated_data.get("planned_for"),
            source=TaskEvent.Source.UI,
        )
        return Response(self.get_serializer(task).data)

    @extend_schema(
        request=None,
        responses={200: TaskSerializer},
        description="Send a task back to the backlog. Writes an `uncommitted` event.",
    )
    @action(detail=True, methods=["post"], url_path="uncommit")
    def uncommit(self, request: Request, pk: str | None = None) -> Response:
        task = self.get_object()
        self._assert_can_write(task.workspace)
        ev.uncommit_task(task, source=TaskEvent.Source.UI)
        return Response(self.get_serializer(task).data)

    @extend_schema(
        responses={200: TaskEventSerializer(many=True)},
        description="The story timeline: everything that happened to this task.",
    )
    @action(detail=True, methods=["get"], url_path="events")
    def events(self, request: Request, pk: str | None = None) -> Response:
        task = self.get_object()
        queryset = task.events.all()
        return Response(
            {
                "count": queryset.count(),
                "results": TaskEventSerializer(queryset, many=True).data,
                "summary": story_timeline(task),
            }
        )

    @extend_schema(
        request=ReorderSerializer,
        responses={200: dict},
        description="Bulk update task ordering (and optionally their list).",
    )
    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request: Request) -> Response:
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = serializer.validated_data["items"]

        accessible = {
            task.id: task
            for task in Task.objects.for_user(request.user).filter(
                id__in=[item["id"] for item in items]
            )
        }

        updated = 0
        with transaction.atomic():
            for item in items:
                task = accessible.get(item["id"])
                if task is None:
                    continue

                task.sort_order = item["sort_order"]
                update_fields = ["sort_order", "updated_at"]

                if "task_list" in item:
                    list_id = item["task_list"]
                    if list_id is None:
                        task.task_list = None
                    elif TaskList.objects.filter(
                        id=list_id, workspace_id=task.workspace_id
                    ).exists():
                        task.task_list_id = list_id
                    update_fields.append("task_list")

                task.save(update_fields=update_fields)
                updated += 1

        return Response({"updated": updated})

    @extend_schema(
        request=dict,
        responses={201: dict, 400: dict},
        description=(
            "Create many tasks (with optional sub-tasks) in one transaction. "
            "Used by the AI confirmation panel and any bulk paste flow."
        ),
    )
    @action(detail=False, methods=["post"], url_path="bulk-create")
    def bulk_create(self, request: Request) -> Response:
        items = request.data.get("tasks")
        if not isinstance(items, list) or not items:
            return Response(
                {"detail": "tasks 必须是非空数组。", "errors": {"tasks": ["不能为空。"]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(items) > 100:
            return Response(
                {"detail": "单次最多创建 100 条任务。", "errors": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # A top-level `workspace` is accepted as a default so callers do not have
        # to repeat it on every item.
        default_workspace = request.data.get("workspace")

        by_workspace: dict[int, list[tuple[int, dict[str, Any]]]] = {}
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                return Response(
                    {"detail": f"第 {index + 1} 条格式不正确。", "errors": {}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            workspace_id = item.get("workspace", default_workspace)
            if not isinstance(workspace_id, int):
                return Response(
                    {
                        "detail": f"第 {index + 1} 条缺少 workspace（也可在顶层传一次）。",
                        "errors": {},
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            title = str(item.get("title") or "").strip()
            if not title:
                return Response(
                    {"detail": f"第 {index + 1} 条缺少标题。", "errors": {}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            by_workspace.setdefault(workspace_id, []).append(
                (index, {**item, "title": title})
            )

        created: list[Task] = []
        for workspace_id, indexed_rows in by_workspace.items():
            workspace = (
                Workspace.objects.for_user(request.user).filter(pk=workspace_id).first()
            )
            if workspace is None:
                return Response(
                    {"detail": f"工作区 {workspace_id} 不存在。", "errors": {}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Validate `task_list` up front. `bulk_create_tasks` would otherwise
            # fall back to the inbox when a list id is unknown or belongs to
            # another workspace — the task would silently land in 未分组 and the
            # caller would believe it had been filed correctly.
            valid_list_ids = set(workspace.lists.values_list("id", flat=True))
            for index, row in indexed_rows:
                list_id = row.get("task_list")
                if list_id is None:
                    continue
                if not isinstance(list_id, int) or list_id not in valid_list_ids:
                    return Response(
                        {
                            "detail": (
                                f"第 {index + 1} 条的清单 {list_id!r} 不属于工作区 "
                                f"{workspace_id}。"
                            ),
                            "errors": {"tasks": [f"第 {index + 1} 条 task_list 无效。"]},
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            created.extend(
                bulk_create_tasks(
                    request.user, workspace, [row for _, row in indexed_rows]
                )
            )

        if created:
            self._attribute_to_recent_ai_usage(request.user, len(created))

        return Response(
            {
                "created": len(created),
                "tasks": self.get_serializer(created, many=True).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @staticmethod
    def _attribute_to_recent_ai_usage(user: Any, count: int) -> None:
        """Credit a recent AI parse with the tasks it produced.

        Deliberately a heuristic: the confirm step is a separate request, so we
        attribute to the user's most recent AI usage row from the last 15
        minutes. Worst case a manual bulk-create shortly after an AI parse is
        mis-attributed, which only affects a display counter — and it beats
        sending a draft id the client would have to round-trip.
        """
        from datetime import timedelta

        from apps.assistant.models import AiUsageRecord

        cutoff = timezone.now() - timedelta(minutes=15)
        latest = (
            AiUsageRecord.objects.filter(
                user=user,
                created_at__gte=cutoff,
                source=AiUsageRecord.Source.AI,
            )
            .order_by("-created_at")
            .first()
        )
        if latest is None:
            return
        latest.created_tasks = latest.created_tasks + count
        latest.save(update_fields=["created_tasks", "updated_at"])

    @extend_schema(
        request=BulkActionSerializer,
        responses={200: dict},
        description="Apply `done` / `todo` / `archive` / `delete` to many tasks at once.",
    )
    @action(detail=False, methods=["post"], url_path="bulk")
    def bulk(self, request: Request) -> Response:
        serializer = BulkActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["ids"]
        action_name = serializer.validated_data["action"]

        queryset = Task.objects.for_user(request.user).filter(id__in=ids)
        now = timezone.now()

        with transaction.atomic():
            if action_name == BulkActionSerializer.Action.DONE:
                # Not queryset.update(): each task needs its own `completed`
                # event, otherwise the story timeline is empty and the lead-time
                # metrics measure nothing.
                updated = ev.bulk_complete(queryset, source=TaskEvent.Source.UI)
            elif action_name == BulkActionSerializer.Action.TODO:
                updated = queryset.update(
                    status=Task.Status.TODO, completed_at=None, updated_at=now
                )
            elif action_name == BulkActionSerializer.Action.ARCHIVE:
                updated = queryset.update(is_archived=True, updated_at=now)
            else:  # delete
                updated = queryset.count()
                queryset.delete()

        return Response({"updated": updated}, status=status.HTTP_200_OK)


class DocumentViewSet(ScopedDetailMixin, viewsets.ModelViewSet[Document]):
    """`/api/v1/documents/` — workspace-native Markdown documents."""

    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated, IsObjectOwnerOrMember]
    filterset_class = DocumentFilter
    filter_backends = (DjangoFilterBackend, OrderingFilter)
    ordering_fields = ("sort_order", "created_at", "updated_at", "title", "kind", "status")
    ordering = ("sort_order", "-updated_at")

    def get_queryset(self) -> Any:
        return Document.objects.for_user(self.request.user).with_related()


class FlowView(APIView):
    """`GET /api/v1/flow/?workspace=<id>`

    The one screen that replaces backlog grooming. Every number is derived, so
    reading it costs the user nothing.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: dict}, description="Derived throughput / WIP / aging numbers.")
    def get(self, request: Request) -> Response:
        raw = request.query_params.get("workspace")
        if not raw or not str(raw).isdigit():
            return Response(
                {"detail": "缺少 workspace 参数。", "errors": {"workspace": ["必填。"]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        workspace = (
            Workspace.objects.for_user(request.user).filter(pk=int(raw)).first()
        )
        if workspace is None:
            return Response(
                {"detail": "工作区不存在。", "errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"workspace": workspace.id, **flow_summary(workspace)})


class InvitePreviewView(APIView):
    """`GET /api/v1/invites/<token>/` — what the join page shows before signing in.

    Public on purpose: the invitee often has no account yet, so the page has to
    explain who is inviting them to what before asking them to sign up. Only the
    workspace name, the inviter and the role are exposed — never the contents.
    """

    permission_classes = [AllowAny]
    authentication_classes: list[Any] = []

    @extend_schema(responses={200: dict})
    def get(self, request: Request, token: str) -> Response:
        invite = (
            WorkspaceInvite.objects.select_related("workspace", "invited_by")
            .filter(token=token)
            .first()
        )
        if invite is None:
            return Response(
                {"detail": "邀请不存在。", "errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            {
                "token": invite.token,
                "workspace_name": invite.workspace.name,
                "workspace_description": invite.workspace.description,
                "role": invite.role,
                "role_label": dict(members.Role.choices).get(invite.role, invite.role),
                "status": invite.status,
                "invited_by": (
                    invite.invited_by.get_display_name()
                    if invite.invited_by and hasattr(invite.invited_by, "get_display_name")
                    else (invite.invited_by.email if invite.invited_by else "")
                ),
                "expires_at": invite.expires_at,
                "is_usable": invite.is_usable,
            }
        )


class InviteAcceptView(APIView):
    """`POST /api/v1/invites/<token>/accept/` — join the workspace."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: dict})
    def post(self, request: Request, token: str) -> Response:
        invite = (
            WorkspaceInvite.objects.select_related("workspace", "invited_by")
            .filter(token=token)
            .first()
        )
        if invite is None:
            return Response(
                {"detail": "邀请不存在。", "errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            membership = members.accept_invite(invite, request.user)
        except members.InviteError as error:
            return Response(
                {"detail": error.message, "errors": {}},
                status=error.status_code,
            )
        return Response(
            {
                "workspace": invite.workspace_id,
                "workspace_name": invite.workspace.name,
                "role": membership.role,
            }
        )
