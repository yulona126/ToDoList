"""Todo routes, mounted at ``/api/v1/``."""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DocumentViewSet,
    FlowView,
    InviteAcceptView,
    InvitePreviewView,
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

urlpatterns = [
    path("flow/", FlowView.as_view(), name="flow"),
    path("invites/<str:token>/", InvitePreviewView.as_view(), name="invite-preview"),
    path(
        "invites/<str:token>/accept/",
        InviteAcceptView.as_view(),
        name="invite-accept",
    ),
] + router.urls
