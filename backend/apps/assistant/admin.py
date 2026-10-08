from django.contrib import admin

from .models import AiCredential, AiUsageRecord


@admin.register(AiCredential)
class AiCredentialAdmin(admin.ModelAdmin):
    list_display = ("user", "provider", "model", "is_active", "last_verified_at", "created_at")
    list_filter = ("provider", "is_active")
    search_fields = ("user__email", "user__username", "model")
    readonly_fields = ("api_key_encrypted", "created_at", "updated_at", "last_verified_at")

    def has_add_permission(self, request) -> bool:  # noqa: ANN001
        # Keys must be entered through the app so they are encrypted on write.
        return False


@admin.register(AiUsageRecord)
class AiUsageRecordAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "user",
        "kind",
        "source",
        "model",
        "ok",
        "total_tokens",
        "cached_tokens",
        "latency_ms",
        "created_tasks",
    )
    list_filter = ("kind", "source", "ok")
    search_fields = ("user__email", "user__username", "model", "error")
    readonly_fields = tuple(field.name for field in AiUsageRecord._meta.fields)

    def has_add_permission(self, request) -> bool:  # noqa: ANN001
        return False
