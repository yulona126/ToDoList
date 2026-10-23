"""Domain models: Workspace → TaskList → Task (+ Tag, Document, WorkspaceMember).

Design notes
------------
* ``Workspace.owner`` is the single anchor for data isolation. Every downstream
  queryset is funnelled through :meth:`WorkspaceQuerySet.for_user`.
* ``WorkspaceMember`` exists in V1 but only ever holds the owner row. Its
  presence means turning on shared workspaces later needs **no schema change**
  and **no view change** (the ``for_user`` filter already honours memberships).
* ``Task.workspace`` is denormalised so cross-list filtering and the "inbox"
  bucket (a task without a list) stay cheap.
* ``Task.parent`` allows exactly one extra level; the constraint is enforced in
  the serializer, keeping ordering and rendering simple.
* ``Document`` holds workspace-native Markdown (plans / notes). Repo files stay
  in git; optional ``path`` is only a pointer for later Project Brain work.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.common.models import TimeStampedModel

if TYPE_CHECKING:  # pragma: no cover
    from django.contrib.auth.models import AbstractBaseUser


class WorkspaceQuerySet(models.QuerySet["Workspace"]):
    def for_user(self, user: "AbstractBaseUser") -> "WorkspaceQuerySet":
        """Workspaces the user may read. Already written for the shared case."""
        if not user or not user.is_authenticated:
            return self.none()
        return self.filter(models.Q(owner=user) | models.Q(members=user)).distinct()

    def with_stats(self) -> "WorkspaceQuerySet":
        """Attach the task counters used by the sidebar badges."""
        today = timezone.localdate()
        active = models.Q(tasks__is_archived=False)
        return self.annotate(
            stat_total=models.Count("tasks", filter=active, distinct=True),
            stat_todo=models.Count(
                "tasks", filter=active & models.Q(tasks__status=Task.Status.TODO), distinct=True
            ),
            stat_doing=models.Count(
                "tasks", filter=active & models.Q(tasks__status=Task.Status.DOING), distinct=True
            ),
            stat_blocked=models.Count(
                "tasks", filter=active & models.Q(tasks__status=Task.Status.BLOCKED), distinct=True
            ),
            stat_done=models.Count(
                "tasks", filter=active & models.Q(tasks__status=Task.Status.DONE), distinct=True
            ),
            stat_overdue=models.Count(
                "tasks",
                filter=active
                & models.Q(tasks__due_date__lt=today)
                & ~models.Q(tasks__status=Task.Status.DONE),
                distinct=True,
            ),
        )


class Workspace(TimeStampedModel):
    """A project, a release, or a "vision" — the top-level container."""

    class Visibility(models.TextChoices):
        PRIVATE = "private", "Private"
        SHARED = "shared", "Shared"

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="owned_workspaces",
    )
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    visibility = models.CharField(
        max_length=16, choices=Visibility.choices, default=Visibility.PRIVATE
    )
    is_archived = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)

    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="WorkspaceMember",
        through_fields=("workspace", "user"),
        related_name="workspaces",
        blank=True,
    )

    objects = WorkspaceQuerySet.as_manager()

    class Meta:
        ordering = ("sort_order", "-created_at")
        indexes = [
            models.Index(fields=["owner", "is_archived"]),
            models.Index(fields=["visibility"]),
        ]

    def __str__(self) -> str:
        return self.name


class WorkspaceMember(TimeStampedModel):
    """Membership row. V1 only ever writes the owner's row — reserved for sharing."""

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"
        VIEWER = "viewer", "Viewer"

    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_memberships",
    )
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.MEMBER)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sent_workspace_invitations",
    )

    class Meta:
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user"], name="uniq_workspace_member"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user} @ {self.workspace} ({self.role})"


class TaskList(TimeStampedModel):
    """A named group inside a workspace: 需求梳理 / 开发 / 联调 …"""

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="lists")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    sort_order = models.IntegerField(default=0)
    is_archived = models.BooleanField(default=False)

    class Meta:
        ordering = ("sort_order", "created_at")
        indexes = [models.Index(fields=["workspace", "is_archived"])]

    def __str__(self) -> str:
        return self.name


class Tag(TimeStampedModel):
    """Workspace-scoped label (workspace-scoped so sharing stays trivial)."""

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="tags")
    name = models.CharField(max_length=40)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"], name="uniq_workspace_tag_name"
            )
        ]

    def __str__(self) -> str:
        return self.name


class TaskQuerySet(models.QuerySet["Task"]):
    def for_user(self, user: "AbstractBaseUser") -> "TaskQuerySet":
        if not user or not user.is_authenticated:
            return self.none()
        return self.filter(workspace__in=Workspace.objects.for_user(user))

    def top_level(self) -> "TaskQuerySet":
        return self.filter(parent__isnull=True)

    def active(self) -> "TaskQuerySet":
        return self.filter(is_archived=False)

    def with_related(self) -> "TaskQuerySet":
        return self.select_related("workspace", "task_list", "parent").prefetch_related("tags")


class Task(TimeStampedModel):
    """A single actionable item."""

    class Status(models.TextChoices):
        TODO = "todo", "Todo"
        DOING = "doing", "Doing"
        BLOCKED = "blocked", "Blocked"
        DONE = "done", "Done"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        URGENT = "urgent", "Urgent"

    class Type(models.TextChoices):
        DEV = "dev", "Development"
        MEETING = "meeting", "Meeting"
        COMMUNICATION = "communication", "Communication"
        DESIGN = "design", "Design"
        RESEARCH = "research", "Research"
        OTHER = "other", "Other"

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="tasks")
    task_list = models.ForeignKey(
        TaskList,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tasks",
        help_text="Null means the task lives in the workspace inbox.",
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="subtasks",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_tasks",
    )

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.TODO)
    priority = models.CharField(
        max_length=16, choices=Priority.choices, default=Priority.MEDIUM
    )
    task_type = models.CharField(max_length=20, choices=Type.choices, default=Type.OTHER)

    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    #: 唯一需要用户做的"整理"动作：把它拉进"现在"。
    #: NULL = backlog（默认，零成本）；有值 = 已承诺。
    #: 半开区间查询见 apps/todos/flow.py（不要用 __week，会跨年误匹配）。
    committed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    sort_order = models.IntegerField(default=0)
    is_archived = models.BooleanField(default=False)

    tags = models.ManyToManyField(Tag, blank=True, related_name="tasks")

    objects = TaskQuerySet.as_manager()

    class Meta:
        ordering = ("sort_order", "created_at")
        indexes = [
            models.Index(fields=["workspace", "is_archived", "status"]),
            models.Index(fields=["workspace", "task_list"]),
            models.Index(fields=["workspace", "due_date"]),
            models.Index(fields=["parent"]),
        ]

    def __str__(self) -> str:
        return self.title

    def save(self, *args: Any, **kwargs: Any) -> None:
        # Keep `completed_at` consistent with `status` no matter who saves.
        if self.status == self.Status.DONE and self.completed_at is None:
            self.completed_at = timezone.now()
        elif self.status != self.Status.DONE:
            self.completed_at = None

        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            kwargs["update_fields"] = set(update_fields) | {"completed_at", "updated_at"}

        super().save(*args, **kwargs)

    @property
    def is_overdue(self) -> bool:
        if self.due_date is None or self.status == self.Status.DONE:
            return False
        return self.due_date < timezone.localdate()

    def toggle_status(self) -> "Task":
        self.status = (
            self.Status.TODO if self.status == self.Status.DONE else self.Status.DONE
        )
        self.save(update_fields=["status", "completed_at", "updated_at"])
        return self


def architecture_image_upload_to(instance: "ArchitectureDiagram", filename: str) -> str:
    """Keep uploads namespaced by workspace id."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    if ext not in {"png", "jpg", "jpeg", "webp", "svg", "gif"}:
        ext = "bin"
    return f"architecture/{instance.workspace_id}/diagram.{ext}"


class ArchitectureDiagram(TimeStampedModel):
    """Exactly one architecture diagram per workspace (Mermaid and/or image)."""

    class Preferred(models.TextChoices):
        MERMAID = "mermaid", "Mermaid"
        IMAGE = "image", "Image"

    workspace = models.OneToOneField(
        Workspace,
        on_delete=models.CASCADE,
        related_name="architecture",
    )
    title = models.CharField(max_length=200, blank=True, default="")
    # Editable source of truth for developer diagrams.
    mermaid = models.TextField(blank=True, default="")
    # Optional static export (draw.io / Excalidraw / screenshot).
    image = models.FileField(
        upload_to=architecture_image_upload_to,
        blank=True,
        null=True,
        max_length=512,
    )
    preferred = models.CharField(
        max_length=16,
        choices=Preferred.choices,
        default=Preferred.MERMAID,
    )

    class Meta:
        ordering = ("-updated_at",)

    def __str__(self) -> str:
        return self.title or f"Architecture #{self.workspace_id}"

    @property
    def has_content(self) -> bool:
        return bool(self.mermaid.strip()) or bool(self.image)


class DocumentQuerySet(models.QuerySet["Document"]):
    def for_user(self, user: "AbstractBaseUser") -> "DocumentQuerySet":
        if not user or not user.is_authenticated:
            return self.none()
        return self.filter(workspace__in=Workspace.objects.for_user(user))

    def active(self) -> "DocumentQuerySet":
        return self.exclude(status=Document.Status.ARCHIVED)

    def with_related(self) -> "DocumentQuerySet":
        return self.select_related("workspace", "created_by").prefetch_related("tags")


class Document(TimeStampedModel):
    """Workspace-scoped Markdown document (plan / note / decision / spec)."""

    class Kind(models.TextChoices):
        PLAN = "plan", "Plan"
        NOTE = "note", "Note"
        DECISION = "decision", "Decision"
        SPEC = "spec", "Spec"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="documents"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_documents",
    )

    title = models.CharField(max_length=200)
    body = models.TextField(blank=True, default="")
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.PLAN)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.ACTIVE
    )
    # Optional relative path when the same doc also lives in a git repo.
    path = models.CharField(max_length=512, blank=True, default="")
    sort_order = models.IntegerField(default=0)

    tags = models.ManyToManyField(Tag, blank=True, related_name="documents")

    objects = DocumentQuerySet.as_manager()

    class Meta:
        ordering = ("sort_order", "-updated_at")
        indexes = [
            models.Index(fields=["workspace", "status"]),
            models.Index(fields=["workspace", "kind"]),
        ]

    def __str__(self) -> str:
        return self.title


class TaskEvent(TimeStampedModel):
    """一个任务发生过什么 —— 只追加，不修改。

    这是"完全掌握一个 story"的全部来源。它由系统在每次状态变化时自动写入，
    **不需要用户维护**：用户只做一个动作（拉进"现在"），其余事件由 API 层
    与 MCP 写回时顺手记录。

    设计约束：
    * 只追加。删除任务时级联删除事件（否则会出现孤儿）。
    * `note` 只存一句话的事实（"curl 了 401/400/404"），不存富文本。
      它会在 `get_context` 里被带给 AI，所以要短。
    """

    class Kind(models.TextChoices):
        CREATED = "created", "Created"
        COMMITTED = "committed", "Pulled into Now"
        UNCOMMITTED = "uncommitted", "Sent back to backlog"
        COMPLETED = "completed", "Completed"
        REOPENED = "reopened", "Reopened"
        BLOCKED = "blocked", "Blocked"
        UNBLOCKED = "unblocked", "Unblocked"
        MOVED = "moved", "Moved list"
        NOTED = "noted", "Note"

    class Source(models.TextChoices):
        UI = "ui", "Web UI"
        MCP = "mcp", "MCP / agent"
        SYSTEM = "system", "System"

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.UI)
    note = models.TextField(blank=True, default="")
    from_value = models.CharField(max_length=120, blank=True, default="")
    to_value = models.CharField(max_length=120, blank=True, default="")

    class Meta:
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=["task", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.task_id} {self.kind}"
