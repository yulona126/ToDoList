"""AI assistant routes, mounted at ``/api/v1/ai/``."""

from __future__ import annotations

from django.urls import path

from .views import (
    AiCredentialTestView,
    AiCredentialView,
    AiParseView,
    AiSplitView,
    AiUsageView,
)

app_name = "assistant"

urlpatterns = [
    path("credential/", AiCredentialView.as_view(), name="credential"),
    path("credential/test/", AiCredentialTestView.as_view(), name="credential-test"),
    path("parse/", AiParseView.as_view(), name="parse"),
    path("split/", AiSplitView.as_view(), name="split"),
    path("usage/", AiUsageView.as_view(), name="usage"),
]
