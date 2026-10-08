"""Root URL configuration for the ToDoList API."""

from __future__ import annotations

from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.common.views import HealthView

urlpatterns = [
    path("admin/", admin.site.urls),
    # Liveness/readiness probe used by Docker healthcheck and any load balancer.
    path("api/v1/health/", HealthView.as_view(), name="health"),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/", include("apps.todos.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
]
