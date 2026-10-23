"""Todo routes, mounted at ``/api/v1/``."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .views import (
    DocumentViewSet,
    TagViewSet,
    TaskListViewSet,
    TaskViewSet,
    WorkspaceViewSet,
)

app_name = "todos"

router = DefaultRouter()
router.register("workspaces", WorkspaceViewSet, basename="workspace")
router.register("lists", TaskListViewSet, basename="tasklist")
router.register("tags", TagViewSet, basename="tag")
router.register("tasks", TaskViewSet, basename="task")
router.register("documents", DocumentViewSet, basename="document")

urlpatterns = router.urls
