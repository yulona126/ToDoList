"""AI assistant views (docs/ai-assistant.md §5)."""

from __future__ import annotations

from typing import Any

from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.todos.models import Task

from .deepseek import AiError, AiInvalidInput, AiNotConfigured, AiQuotaExceeded
from .models import AiCredential, AiUsageRecord
from .serializers import (
    AiCredentialSerializer,
    AiCredentialUpdateSerializer,
    AiParseRequestSerializer,
    AiSplitRequestSerializer,
    AiUsageRecordSerializer,
)
from .services import (
    client_for,
    parse_text,
    quota_remaining,
    record_usage,
    split_task,
    tokens_used_today,
)


def _handle_ai_error(exc: AiError) -> Response:
    """Map service errors onto HTTP status codes (docs §5)."""
    if isinstance(exc, (AiNotConfigured, AiInvalidInput)):
        code = status.HTTP_400_BAD_REQUEST
    elif isinstance(exc, AiQuotaExceeded):
        code = status.HTTP_429_TOO_MANY_REQUESTS
    else:
        code = status.HTTP_502_BAD_GATEWAY
    return Response({"detail": str(exc), "errors": {}}, status=code)


class AiCredentialView(APIView):
    """`GET` / `PUT` / `DELETE /api/v1/ai/credential/`."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: AiCredentialSerializer})
    def get(self, request: Request) -> Response:
        credential = AiCredential.objects.filter(user=request.user).first()
        if credential is None:
            return Response(
                {
                    "configured": False,
                    "provider": AiCredential.Provider.DEEPSEEK,
                    "model": "",
                    "base_url": "https://api.deepseek.com",
                    "key_mask": "",
                    "is_active": False,
                    "models_available": _models_available(),
                    "tokens_used_today": tokens_used_today(request.user),
                    "daily_token_budget": _daily_budget(),
                    "last_verified_at": None,
                    "last_error": "",
                }
            )
        return Response(AiCredentialSerializer(credential).data)

    @extend_schema(
        request=AiCredentialUpdateSerializer, responses={200: AiCredentialSerializer}
    )
    def put(self, request: Request) -> Response:
        serializer = AiCredentialUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        credential = AiCredential.objects.filter(user=request.user).first()
        created = credential is None
        if credential is None:
            credential = AiCredential(user=request.user)
            credential.set_api_key("")  # placeholder until a key arrives

        api_key = data.get("api_key")
        if api_key:
            credential.set_api_key(api_key)
        elif created:
            raise ValidationError(
                {"api_key": ["首次配置必须提供 API Key。"]}
            )

        if "provider" in data:
            credential.provider = data["provider"]
        if "model" in data and data["model"]:
            credential.model = data["model"]
        if "base_url" in data:
            credential.base_url = data["base_url"]
        if "is_active" in data:
            credential.is_active = data["is_active"]

        credential.save()
        return Response(AiCredentialSerializer(credential).data)

    @extend_schema(responses={204: None})
    def delete(self, request: Request) -> Response:
        AiCredential.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AiCredentialTestView(APIView):
    """`POST /api/v1/ai/credential/test/` — cheapest possible liveness probe."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: dict, 400: dict, 502: dict})
    def post(self, request: Request) -> Response:
        credential = AiCredential.objects.filter(user=request.user).first()
        if credential is None or not credential.api_key_encrypted:
            return Response(
                {"detail": "尚未配置 API Key。", "errors": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        client = client_for(credential)
        try:
            latency_ms, model = client.verify()
        except AiError as exc:
            credential.last_error = str(exc)[:500]
            credential.save(update_fields=["last_error", "updated_at"])
            record_usage(
                request.user,
                AiUsageRecord.Kind.TEST,
                model=credential.model,
                ok=False,
                error=str(exc),
            )
            return _handle_ai_error(exc)

        credential.last_error = ""
        credential.last_verified_at = timezone.now()
        credential.save(update_fields=["last_error", "last_verified_at", "updated_at"])
        record_usage(
            request.user,
            AiUsageRecord.Kind.TEST,
            model=credential.model,
            latency_ms=latency_ms,
        )
        return Response({"ok": True, "model": model, "latency_ms": latency_ms})


class AiParseView(APIView):
    """`POST /api/v1/ai/parse/` — text → draft tasks (local rules first)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=AiParseRequestSerializer, responses={200: dict})
    def post(self, request: Request) -> Response:
        serializer = AiParseRequestSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            result = parse_text(
                request.user,
                data["workspace"],
                data["text"],
                mode=data.get("mode", "auto"),
                default_list_id=data.get("default_list"),
                default_task_type=data.get("default_type") or None,
            )
        except AiError as exc:
            return _handle_ai_error(exc)

        return Response(result)


class AiSplitView(APIView):
    """`POST /api/v1/ai/split/` — propose sub-tasks for one task."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=AiSplitRequestSerializer, responses={200: dict})
    def post(self, request: Request) -> Response:
        serializer = AiSplitRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        task = (
            Task.objects.for_user(request.user)
            .filter(pk=serializer.validated_data["task_id"])
            .first()
        )
        if task is None:
            return Response(
                {"detail": "任务不存在。", "errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if task.subtasks.exists():
            return Response(
                {"detail": "该任务已有子任务，请先清空。", "errors": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = split_task(request.user, task)
        except AiError as exc:
            return _handle_ai_error(exc)

        return Response(result)


class AiUsageView(APIView):
    """`GET /api/v1/ai/usage/?days=30` — token accounting + reputation of savings."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request: Request) -> Response:
        try:
            days = max(1, min(365, int(request.query_params.get("days", 30))))
        except (TypeError, ValueError):
            days = 30

        since = timezone.now() - timedelta(days=days)
        queryset = AiUsageRecord.objects.filter(user=request.user, created_at__gte=since)

        totals = queryset.filter(source=AiUsageRecord.Source.AI).aggregate(
            prompt_tokens=Sum("prompt_tokens"),
            completion_tokens=Sum("completion_tokens"),
            cached_tokens=Sum("cached_tokens"),
            total_tokens=Sum("total_tokens"),
        )
        ai_calls = queryset.filter(source=AiUsageRecord.Source.AI).count()
        local_calls = queryset.filter(source=AiUsageRecord.Source.LOCAL).count()
        created_tasks = (
            queryset.aggregate(total=Sum("created_tasks"))["total"] or 0
        )

        recent = queryset.select_related("user")[:20]

        return Response(
            {
                "days": days,
                "ai_calls": ai_calls,
                "local_calls": local_calls,
                # The headline "did this save tokens" metric.
                "local_ratio": round(local_calls / (ai_calls + local_calls), 3)
                if (ai_calls + local_calls)
                else 0.0,
                "created_tasks": created_tasks,
                "tokens": {
                    "prompt_tokens": totals["prompt_tokens"] or 0,
                    "completion_tokens": totals["completion_tokens"] or 0,
                    "cached_tokens": totals["cached_tokens"] or 0,
                    "total_tokens": totals["total_tokens"] or 0,
                },
                "tokens_used_today": tokens_used_today(request.user),
                "quota_remaining": quota_remaining(request.user),
                "daily_token_budget": _daily_budget(),
                "recent": AiUsageRecordSerializer(recent, many=True).data,
            }
        )



def _models_available() -> list[str]:
    from django.conf import settings

    return list(getattr(settings, "AI_MODELS", []) or [])


def _daily_budget() -> int:
    from django.conf import settings

    return int(getattr(settings, "AI_DAILY_TOKEN_BUDGET", 0) or 0)
