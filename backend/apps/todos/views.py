"""Todo API viewsets (docs/api.md §2–§5)."""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Case, Count, IntegerField, Q, Value, When
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.request import Request
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from apps.common.mixins import ScopedDetailMixin
from apps.common.permissions import IsObjectOwnerOrMember

from .filters import (
    TagFilter,
    TaskFilter,
    TaskListFilter,
    TaskOrderingFilter,
    WorkspaceFilter,
)
from .models import Tag, Task, TaskList, Workspace, WorkspaceMember
from .serializers import (
    BulkActionSerializer,
    ListReorderSerializer,
    ReorderSerializer,
    TagSerializer,
    TaskListSerializer,
    TaskSerializer,
    WorkspaceMemberSerializer,
    WorkspaceSerializer,
)
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
    @action(detail=True, methods=["get"], url_path="members")
    def members(self, request: Request, pk: str | None = None) -> Response:
        workspace = self.get_object()
        queryset = workspace.memberships.select_related("user").order_by("created_at")
        page = self.paginate_queryset(queryset)
        serializer = WorkspaceMemberSerializer(
            page if page is not None else queryset, many=True
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)


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
        task.toggle_status()
        return Response(self.get_serializer(task).data)

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

        by_workspace: dict[int, list[dict[str, Any]]] = {}
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                return Response(
                    {"detail": f"第 {index + 1} 条格式不正确。", "errors": {}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            workspace_id = item.get("workspace")
            if not isinstance(workspace_id, int):
                return Response(
                    {"detail": f"第 {index + 1} 条缺少 workspace。", "errors": {}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            title = str(item.get("title") or "").strip()
            if not title:
                return Response(
                    {"detail": f"第 {index + 1} 条缺少标题。", "errors": {}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            by_workspace.setdefault(workspace_id, []).append({**item, "title": title})

        created: list[Task] = []
        for workspace_id, rows in by_workspace.items():
            workspace = (
                Workspace.objects.for_user(request.user).filter(pk=workspace_id).first()
            )
            if workspace is None:
                return Response(
                    {"detail": f"工作区 {workspace_id} 不存在。", "errors": {}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            created.extend(bulk_create_tasks(request.user, workspace, rows))

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
                updated = queryset.update(
                    status=Task.Status.DONE, completed_at=now, updated_at=now
                )
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
