"""Serializers for the AI assistant endpoints (docs/ai-assistant.md §5)."""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.todos.models import Workspace

from .models import AiCredential, AiUsageRecord


class AiUsageSerializer(serializers.Serializer[Any]):
    prompt_tokens = serializers.IntegerField()
    completion_tokens = serializers.IntegerField()
    cached_tokens = serializers.IntegerField()
    total_tokens = serializers.IntegerField()


class AiCredentialSerializer(serializers.ModelSerializer[AiCredential]):
    """Read model. **Never** exposes the API key — only a mask."""

    configured = serializers.SerializerMethodField()
    key_mask = serializers.SerializerMethodField()
    models_available = serializers.SerializerMethodField()
    tokens_used_today = serializers.SerializerMethodField()
    daily_token_budget = serializers.SerializerMethodField()

    class Meta:
        model = AiCredential
        fields = (
            "configured",
            "provider",
            "model",
            "base_url",
            "key_mask",
            "is_active",
            "models_available",
            "tokens_used_today",
            "daily_token_budget",
            "last_verified_at",
            "last_error",
        )

    def get_configured(self, obj: AiCredential) -> bool:
        return obj.usable

    def get_key_mask(self, obj: AiCredential) -> str:
        return obj.masked_key

    def get_models_available(self, obj: AiCredential) -> list[str]:
        from django.conf import settings

        return list(getattr(settings, "AI_MODELS", []) or [obj.model])

    def get_tokens_used_today(self, obj: AiCredential) -> int:
        from .services import tokens_used_today

        return tokens_used_today(obj.user)

    def get_daily_token_budget(self, obj: AiCredential) -> int:
        from django.conf import settings

        return int(getattr(settings, "AI_DAILY_TOKEN_BUDGET", 0) or 0)


class AiCredentialUpdateSerializer(serializers.Serializer[Any]):
    """Write model. An empty ``api_key`` means "keep the stored key"."""

    api_key = serializers.CharField(
        required=False, allow_blank=True, write_only=True, trim_whitespace=True
    )
    provider = serializers.ChoiceField(
        choices=AiCredential.Provider.choices, required=False
    )
    model = serializers.CharField(required=False, allow_blank=False, max_length=64)
    base_url = serializers.URLField(required=False, max_length=200)
    is_active = serializers.BooleanField(required=False)

    def validate_base_url(self, value: str) -> str:
        from .deepseek import AiError, validate_base_url

        try:
            return validate_base_url(value)
        except AiError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_api_key(self, value: str) -> str:
        value = value.strip()
        if value and len(value) < 8:
            raise serializers.ValidationError("API Key 看起来太短了。")
        return value


class AiParseRequestSerializer(serializers.Serializer[Any]):
    workspace = serializers.IntegerField()
    text = serializers.CharField(allow_blank=False, max_length=20_000, trim_whitespace=True)
    mode = serializers.ChoiceField(
        choices=("local", "ai"),
        default="local",
        required=False,
        help_text=(
            "local (default) = marker rules only, never calls a model. "
            "ai = hand the text to the model regardless of markers."
        ),
    )
    default_list = serializers.IntegerField(required=False, allow_null=True)
    default_type = serializers.CharField(required=False, allow_blank=True, max_length=20)

    def validate_workspace(self, value: int) -> Workspace:
        request = self.context["request"]
        workspace = Workspace.objects.for_user(request.user).filter(pk=value).first()
        if workspace is None:
            raise serializers.ValidationError("工作区不存在。")
        return workspace

    def validate_default_list(self, value: int | None) -> int | None:
        if value is None:
            return None
        from apps.todos.models import TaskList

        request = self.context["request"]
        exists = TaskList.objects.filter(
            pk=value, workspace__in=Workspace.objects.for_user(request.user)
        ).exists()
        if not exists:
            raise serializers.ValidationError("清单不存在。")
        return value


class AiSplitRequestSerializer(serializers.Serializer[Any]):
    task_id = serializers.IntegerField()


class AiUsageRecordSerializer(serializers.ModelSerializer[AiUsageRecord]):
    class Meta:
        model = AiUsageRecord
        fields = (
            "id",
            "kind",
            "source",
            "model",
            "ok",
            "error",
            "prompt_tokens",
            "completion_tokens",
            "cached_tokens",
            "total_tokens",
            "latency_ms",
            "created_tasks",
            "created_at",
        )
