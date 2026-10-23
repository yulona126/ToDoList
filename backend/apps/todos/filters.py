"""Query filtering for the todos endpoints (docs/api.md §4 filter table)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import django_filters
from django.db.models import Q
from django.utils import timezone
from rest_framework.filters import OrderingFilter

from .models import Document, Tag, Task, TaskList, Workspace


class CSVFilter(django_filters.BaseInFilter, django_filters.CharFilter):
    """Comma separated multi-value filter, e.g. ``?status=todo,doing``."""


class DefaultArchivedFilterMixin:
    """Makes "exclude archived" the default rather than the absent-filter case.

    ``django-filter`` simply skips a filter whose parameter is missing, so
    without this a plain ``GET /workspaces/`` would happily include archived
    rows. Injecting the documented default keeps the contract in docs/api.md.
    """

    archived_default: str = "false"

    def __init__(
        self,
        data: Any = None,
        queryset: Any = None,
        *,
        request: Any = None,
        prefix: Any = None,
    ) -> None:
        param = getattr(self, "archived_param", None)
        if data is not None and param is not None and param not in data:
            data = data.copy() if hasattr(data, "copy") else dict(data)
            data[param] = self.archived_default
        super().__init__(data=data, queryset=queryset, request=request, prefix=prefix)


class WorkspaceFilter(DefaultArchivedFilterMixin, django_filters.FilterSet):
    archived_param = "include_archived"
    include_archived = django_filters.BooleanFilter(method="filter_include_archived")
    search = django_filters.CharFilter(method="filter_search")

    class Meta:
        model = Workspace
        fields = ("visibility",)

    def filter_include_archived(
        self, queryset: Any, name: str, value: bool | None
    ) -> Any:
        if value:
            return queryset
        return queryset.filter(is_archived=False)

    def filter_search(self, queryset: Any, name: str, value: str) -> Any:
        return queryset.filter(Q(name__icontains=value) | Q(description__icontains=value))


class TaskListFilter(DefaultArchivedFilterMixin, django_filters.FilterSet):
    workspace = django_filters.NumberFilter(field_name="workspace_id", required=True)
    archived_param = "include_archived"
    include_archived = django_filters.BooleanFilter(method="filter_include_archived")

    class Meta:
        model = TaskList
        fields = ("workspace",)

    def filter_include_archived(
        self, queryset: Any, name: str, value: bool | None
    ) -> Any:
        if value:
            return queryset
        return queryset.filter(is_archived=False)


class TagFilter(django_filters.FilterSet):
    workspace = django_filters.NumberFilter(field_name="workspace_id", required=True)

    class Meta:
        model = Tag
        fields = ("workspace",)


class TaskFilter(DefaultArchivedFilterMixin, django_filters.FilterSet):
    workspace = django_filters.NumberFilter(field_name="workspace_id", required=True)
    task_list = django_filters.CharFilter(method="filter_task_list")
    status = CSVFilter(field_name="status", lookup_expr="in")
    priority = CSVFilter(field_name="priority", lookup_expr="in")
    task_type = CSVFilter(field_name="task_type", lookup_expr="in")
    tag = django_filters.CharFilter(method="filter_tag")
    parent = django_filters.CharFilter(method="filter_parent")
    due = django_filters.CharFilter(method="filter_due")
    search = django_filters.CharFilter(method="filter_search")
    archived_param = "is_archived"
    is_archived = django_filters.BooleanFilter(method="filter_is_archived")

    class Meta:
        model = Task
        fields = ("workspace", "task_list", "status", "priority", "task_type", "is_archived")

    def filter_is_archived(self, queryset: Any, name: str, value: bool) -> Any:
        return queryset.filter(is_archived=bool(value))

    # -- individual filters --------------------------------------------------
    def filter_task_list(self, queryset: Any, name: str, value: str) -> Any:
        if value.lower() == "null":
            return queryset.filter(task_list__isnull=True)
        if not str(value).isdigit():
            return queryset.none()
        return queryset.filter(task_list_id=int(value))

    def filter_tag(self, queryset: Any, name: str, value: str) -> Any:
        """AND semantics: a task must carry *every* requested tag."""
        raw_ids = [part for part in str(value).split(",") if part.strip()]
        for raw_id in raw_ids:
            if not raw_id.strip().isdigit():
                return queryset.none()
            queryset = queryset.filter(tags__id=int(raw_id))
        return queryset

    def filter_parent(self, queryset: Any, name: str, value: str) -> Any:
        if value.lower() == "null":
            return queryset.filter(parent__isnull=True)
        if not str(value).isdigit():
            return queryset.none()
        return queryset.filter(parent_id=int(value))

    def filter_due(self, queryset: Any, name: str, value: str) -> Any:
        today = timezone.localdate()
        value = value.lower()
        if value == "today":
            return queryset.filter(due_date=today)
        if value == "week":
            return queryset.filter(due_date__gte=today, due_date__lte=today + timedelta(days=7))
        if value == "overdue":
            return queryset.filter(due_date__lt=today).exclude(status=Task.Status.DONE)
        if value == "none":
            return queryset.filter(due_date__isnull=True)
        return queryset

    def filter_search(self, queryset: Any, name: str, value: str) -> Any:
        return queryset.filter(Q(title__icontains=value) | Q(description__icontains=value))


class TaskOrderingFilter(OrderingFilter):
    """Ordering that survives non-alphabetical enums.

    ``ordering=priority`` must mean urgent → high → medium → low, not the
    alphabetical order of the stored strings.
    """

    FIELD_MAP = {"priority": "priority_rank"}

    def get_ordering(self, request: Any, queryset: Any, view: Any) -> Any:
        ordering = super().get_ordering(request, queryset, view)
        if not ordering:
            return ordering
        mapped: list[str] = []
        for term in ordering:
            term = str(term)
            descending = term.startswith("-")
            name = term.lstrip("-")
            name = self.FIELD_MAP.get(name, name)
            mapped.append(f"-{name}" if descending else name)
        return mapped


class DocumentFilter(DefaultArchivedFilterMixin, django_filters.FilterSet):
    workspace = django_filters.NumberFilter(field_name="workspace_id", required=True)
    kind = CSVFilter(field_name="kind", lookup_expr="in")
    status = CSVFilter(field_name="status", lookup_expr="in")
    tag = django_filters.CharFilter(method="filter_tag")
    search = django_filters.CharFilter(method="filter_search")
    archived_param = "include_archived"
    include_archived = django_filters.BooleanFilter(method="filter_include_archived")

    class Meta:
        model = Document
        fields = ("workspace", "kind", "status")

    def filter_include_archived(
        self, queryset: Any, name: str, value: bool | None
    ) -> Any:
        if value:
            return queryset
        return queryset.exclude(status=Document.Status.ARCHIVED)

    def filter_tag(self, queryset: Any, name: str, value: str) -> Any:
        raw_ids = [part for part in str(value).split(",") if part.strip()]
        for raw_id in raw_ids:
            if not raw_id.strip().isdigit():
                return queryset.none()
            queryset = queryset.filter(tags__id=int(raw_id))
        return queryset

    def filter_search(self, queryset: Any, name: str, value: str) -> Any:
        return queryset.filter(Q(title__icontains=value) | Q(body__icontains=value))
