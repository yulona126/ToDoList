"""Health probe used by Docker healthcheck and reverse proxies."""

from __future__ import annotations

from django.conf import settings
from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """`GET /api/v1/health/` — 200 when the database answers, 503 otherwise."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    @extend_schema(
        responses={200: dict, 503: dict},
        description="Liveness/readiness probe. Returns 503 when the database is unreachable.",
    )
    def get(self, request: Request) -> Response:
        db_status = "ok"
        http_status = status.HTTP_200_OK
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception:  # pragma: no cover - depends on infra state
            db_status = "unreachable"
            http_status = status.HTTP_503_SERVICE_UNAVAILABLE

        return Response(
            {
                "status": "ok" if db_status == "ok" else "error",
                "db": db_status,
                "version": settings.APP_VERSION,
            },
            status=http_status,
        )
