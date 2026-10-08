"""Serializers for the todos domain. Field names mirror docs/api.md exactly."""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone
from rest_framework import serializers

from .models import Tag, Task, TaskList, Workspace, WorkspaceMember

User = get_user_model()


def accessible_workspace_ids(user: Any) -> list[int]:
    return list(Workspace.objects.for_user(user).values_list("id", flat=True))


class UserBriefSerializer(serializers.ModelSerializer["User"]):
    name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "username", "display_name", "name")


class WorkspaceStatsSerializer(serializers.Serializer[Any]):
    """Nested read-only counter block (documented as ``stats``)."""

    total = serializers.IntegerField()
    todo = serializers.IntegerField()
    doing = serializers.IntegerField()
    blocked = serializers.IntegerField()
    done = serializers.IntegerField()
    overdue = serializers.IntegerField()


class WorkspaceSerializer(serializers.ModelSerializer[Workspace]):
    role = serializers.SerializerMethodField()
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = (
            "id",
            "name",
            "description",
            "visibility",
            "is_archived",
            "sort_order",
            "role",
            "stats",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "role", "stats", "created_at", "updated_at", "visibility")

    def get_role(self, obj: Workspace) -> str:
        return WorkspaceMember.Role.OWNER if obj.owner_id == self._user_id else WorkspaceMember.Role.MEMBER

    def get_stats(self, obj: Workspace) -> dict[str, int]:
        if hasattr(obj, "stat_total"):
            return {
                "total": obj.stat_total,
                "todo": obj.stat_todo,
                "doing": obj.stat_doing,
                "blocked": obj.stat_blocked,
                "done": obj.stat_done,
                "overdue": obj.stat_overdue,
            }
        # Fallback for freshly created / retrieved-without-annotation instances.
        tasks = obj.tasks.filter(is_archived=False)
        today = timezone.localdate()
        return {
            "total": tasks.count(),
            "todo": tasks.filter(status=Task.Status.TODO).count(),
            "doing": tasks.filter(status=Task.Status.DOING).count(),
            "blocked": tasks.filter(status=Task.Status.BLOCKED).count(),
            "done": tasks.filter(status=Task.Status.DONE).count(),
            "overdue": tasks.filter(due_date__lt=today).exclude(status=Task.Status.DONE).count(),
        }

    @property
    def _user_id(self) -> int | None:
        request = self.context.get("request")
        return getattr(getattr(request, "user", None), "id", None)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("工作区名称不能为空。")
        return value


class WorkspaceMemberSerializer(serializers.ModelSerializer[WorkspaceMember]):
    user = UserBriefSerializer(read_only=True)
    joined_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = ("id", "user", "role", "joined_at")


class TaskListStatsSerializer(serializers.Serializer[Any]):
    total = serializers.IntegerField()
    done = serializers.IntegerField()


class TaskListSerializer(serializers.ModelSerializer[TaskList]):
    stats = serializers.SerializerMethodField()

    class Meta:
        model = TaskList
        fields = (
            "id",
            "workspace",
            "name",
            "description",
            "sort_order",
            "is_archived",
            "stats",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "stats", "created_at", "updated_at")

    def get_stats(self, obj: TaskList) -> dict[str, int]:
        if hasattr(obj, "stat_total"):
            return {"total": obj.stat_total, "done": obj.stat_done}
        tasks = obj.tasks.filter(is_archived=False)
        return {
            "total": tasks.count(),
            "done": tasks.filter(status=Task.Status.DONE).count(),
        }

    def validate_workspace(self, value: Workspace) -> Workspace:
        user = self.context["request"].user
        if not Workspace.objects.for_user(user).filter(pk=value.pk).exists():
            raise serializers.ValidationError("工作区不存在。")
        return value

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("清单名称不能为空。")
        return value


class TagSerializer(serializers.ModelSerializer[Tag]):
    task_count = serializers.SerializerMethodField()

    class Meta:
        model = Tag
        fields = ("id", "workspace", "name", "task_count", "created_at")
        read_only_fields = ("id", "task_count", "created_at")

    def get_task_count(self, obj: Tag) -> int:
        if hasattr(obj, "active_task_count"):
            return obj.active_task_count
        return obj.tasks.filter(is_archived=False).count()

    def validate_workspace(self, value: Workspace) -> Workspace:
        user = self.context["request"].user
        if not Workspace.objects.for_user(user).filter(pk=value.pk).exists():
            raise serializers.ValidationError("工作区不存在。")
        return value

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("标签名称不能为空。")
        return value


class TaskSerializer(serializers.ModelSerializer[Task]):
    """Read + write representation of a task (docs/api.md §4)."""

    workspace_name = serializers.CharField(source="workspace.name", read_only=True)
    task_list_name = serializers.CharField(source="task_list.name", read_only=True, default=None)
    tags = TagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        write_only=True,
        required=False,
        queryset=Tag.objects.all(),
        source="tags",
    )
    is_overdue = serializers.BooleanField(read_only=True)
    subtask_stats = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = (
            "id",
            "workspace",
            "workspace_name",
            "task_list",
            "task_list_name",
            "parent",
            "title",
            "description",
            "status",
            "priority",
            "task_type",
            "due_date",
            "completed_at",
            "sort_order",
            "is_archived",
            "is_overdue",
            "tags",
            "tag_ids",
            "subtask_stats",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "workspace_name",
            "task_list_name",
            "completed_at",
            "is_overdue",
            "subtask_stats",
            "created_at",
            "updated_at",
        )

    # -- read helpers -------------------------------------------------------
    def get_subtask_stats(self, obj: Task) -> dict[str, int]:
        if hasattr(obj, "subtask_total"):
            return {"total": obj.subtask_total, "done": obj.subtask_done}
        subtasks = obj.subtasks.all()
        return {
            "total": subtasks.count(),
            "done": subtasks.filter(status=Task.Status.DONE).count(),
        }

    # -- validation ---------------------------------------------------------
    def validate_workspace(self, value: Workspace) -> Workspace:
        user = self.context["request"].user
        if not Workspace.objects.for_user(user).filter(pk=value.pk).exists():
            raise serializers.ValidationError("工作区不存在。")
        return value

    def validate_title(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("任务标题不能为空。")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        instance: Task | None = self.instance
        workspace: Workspace | None = attrs.get("workspace") or (
            instance.workspace if instance else None
        )
        if workspace is None:
            raise serializers.ValidationError({"workspace": ["该字段为必填项。"]})

        # `task_list` may be explicitly set to null to move a task to the inbox.
        if "task_list" in attrs:
            task_list = attrs["task_list"]
            if task_list is not None and task_list.workspace_id != workspace.id:
                raise serializers.ValidationError(
                    {"task_list": ["清单必须属于同一工作区。"]}
                )

        if "parent" in attrs:
            parent = attrs["parent"]
            if parent is not None:
                if parent.workspace_id != workspace.id:
                    raise serializers.ValidationError(
                        {"parent": ["父任务必须属于同一工作区。"]}
                    )
                if parent.parent_id is not None:
                    raise serializers.ValidationError(
                        {"parent": ["子任务不能再嵌套子任务（最多一层）。"]}
                    )
                if instance is not None and parent.pk == instance.pk:
                    raise serializers.ValidationError({"parent": ["任务不能作为自己的父任务。"]})
                if instance is not None and instance.subtasks.exists():
                    raise serializers.ValidationError(
                        {"parent": ["该任务已有子任务，不能再成为其他任务的子任务。"]}
                    )

        if instance is not None and instance.subtasks.exists() and "task_list" in attrs:
            task_list = attrs["task_list"]
            if task_list is not None and any(
                child.task_list_id != task_list.id for child in instance.subtasks.all()
            ):
                raise serializers.ValidationError(
                    {"task_list": ["请先将其子任务移动到同一清单。"]}
                )

        # Tags are writable via `tag_ids`; DRF puts them under "tags".
        tag_list = attrs.get("tags")
        if tag_list:
            mismatched = [tag.name for tag in tag_list if tag.workspace_id != workspace.id]
            if mismatched:
                raise serializers.ValidationError(
                    {"tag_ids": [f"标签 {name} 不属于该工作区。" for name in mismatched]}
                )

        return attrs

    def create(self, validated_data: dict[str, Any]) -> Task:
        request = self.context.get("request")
        if request is not None and getattr(request, "user", None) is not None:
            validated_data.setdefault("created_by", request.user)
        if validated_data.get("sort_order") in (None, 0):
            validated_data["sort_order"] = self._next_sort_order(validated_data)
        return super().create(validated_data)

    @staticmethod
    def _next_sort_order(validated_data: dict[str, Any]) -> int:
        qs = Task.objects.filter(workspace=validated_data["workspace"])
        parent = validated_data.get("parent")
        task_list = validated_data.get("task_list")
        if parent is not None:
            qs = qs.filter(parent=parent)
        else:
            qs = qs.filter(parent__isnull=True, task_list=task_list)
        last = qs.order_by("-sort_order").values_list("sort_order", flat=True).first()
        return (last or 0) + 1


class TaskReorderItemSerializer(serializers.Serializer[Any]):
    id = serializers.IntegerField()
    sort_order = serializers.IntegerField(min_value=0)
    task_list = serializers.IntegerField(required=False, allow_null=True)


class ReorderSerializer(serializers.Serializer[Any]):
    items = TaskReorderItemSerializer(many=True, allow_empty=True)

    def validate_items(self, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(value) > 500:
            raise serializers.ValidationError("单次最多重排 500 条。")
        return value


class ListReorderItemSerializer(serializers.Serializer[Any]):
    id = serializers.IntegerField()
    sort_order = serializers.IntegerField(min_value=0)


class ListReorderSerializer(serializers.Serializer[Any]):
    items = ListReorderItemSerializer(many=True, allow_empty=True)


class BulkActionSerializer(serializers.Serializer[Any]):
    class Action(models.TextChoices):
        DONE = "done", "done"
        TODO = "todo", "todo"
        ARCHIVE = "archive", "archive"
        DELETE = "delete", "delete"

    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    action = serializers.ChoiceField(choices=Action.choices)

    def validate_ids(self, value: list[int]) -> list[int]:
        if len(value) > 500:
            raise serializers.ValidationError("单次最多操作 500 条。")
        return value
