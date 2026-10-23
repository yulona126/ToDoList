from django.contrib import admin

from .models import (
    ArchitectureDiagram,
    Document,
    Tag,
    Task,
    TaskList,
    Workspace,
    WorkspaceMember,
)


class TaskListInline(admin.TabularInline):
    model = TaskList
    extra = 0
    fields = ("name", "sort_order", "is_archived")


class DocumentInline(admin.TabularInline):
    model = Document
    extra = 0
    fields = ("title", "kind", "status", "sort_order")
    show_change_link = True


class WorkspaceMemberInline(admin.TabularInline):
    model = WorkspaceMember
    extra = 0
    fields = ("user", "role")
    readonly_fields = ("created_at",)


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "visibility", "is_archived", "created_at")
    list_filter = ("visibility", "is_archived")
    search_fields = ("name", "description", "owner__email")
    inlines = (TaskListInline, DocumentInline, WorkspaceMemberInline)


@admin.register(TaskList)
class TaskListAdmin(admin.ModelAdmin):
    list_display = ("name", "workspace", "sort_order", "is_archived")
    list_filter = ("is_archived",)
    search_fields = ("name", "workspace__name")


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "workspace")
    search_fields = ("name", "workspace__name")


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "workspace",
        "task_list",
        "status",
        "priority",
        "task_type",
        "due_date",
    )
    list_filter = ("status", "priority", "task_type", "is_archived")
    search_fields = ("title", "description")
    filter_horizontal = ("tags",)
    autocomplete_fields = ("workspace",)


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "workspace", "kind", "status", "updated_at")
    list_filter = ("kind", "status")
    search_fields = ("title", "body", "path", "workspace__name")
    filter_horizontal = ("tags",)
    autocomplete_fields = ("workspace",)


@admin.register(ArchitectureDiagram)
class ArchitectureDiagramAdmin(admin.ModelAdmin):
    list_display = ("workspace", "title", "preferred", "updated_at")
    list_filter = ("preferred",)
    search_fields = ("title", "mermaid", "workspace__name")
    autocomplete_fields = ("workspace",)
