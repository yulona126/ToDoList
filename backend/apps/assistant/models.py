"""AI assistant models (docs/ai-assistant.md §4)."""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel

from . import crypto


class AiCredential(TimeStampedModel):
    """One provider credential per user.

    The API key is stored encrypted and is **never** serialised back to the
    client — the API only ever exposes :meth:`masked_key`.
    """

    class Provider(models.TextChoices):
        DEEPSEEK = "deepseek", "DeepSeek"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_credential",
    )
    provider = models.CharField(
        max_length=20, choices=Provider.choices, default=Provider.DEEPSEEK
    )
    base_url = models.URLField(default="https://api.deepseek.com", max_length=200)
    #: Deliberately free-form: model names change faster than releases.
    model = models.CharField(max_length=64, default="deepseek-flash")
    api_key_encrypted = models.BinaryField()
    is_active = models.BooleanField(default=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "AI credential"
        verbose_name_plural = "AI credentials"

    def __str__(self) -> str:
        return f"{self.user} · {self.provider} · {self.model}"

    # -- key handling --------------------------------------------------------
    def set_api_key(self, raw_key: str) -> None:
        self.api_key_encrypted = crypto.encrypt(raw_key.strip())

    def get_api_key(self) -> str:
        """Decrypt on demand. Raises ``CredentialDecryptionError`` if rotated."""
        return crypto.decrypt(bytes(self.api_key_encrypted))

    @property
    def masked_key(self) -> str:
        try:
            return crypto.mask(self.get_api_key())
        except crypto.CredentialDecryptionError:
            return "****"

    @property
    def usable(self) -> bool:
        return bool(self.is_active and self.api_key_encrypted)


class AiUsageRecord(TimeStampedModel):
    """Per-call audit trail: also the source of the quota calculation."""

    class Kind(models.TextChoices):
        PARSE = "parse", "Parse"
        SPLIT = "split", "Split"
        TEST = "test", "Test"

    class Source(models.TextChoices):
        LOCAL = "local", "Local parser"
        AI = "ai", "AI"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ai_usage"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.AI)
    model = models.CharField(max_length=64, blank=True, default="")
    ok = models.BooleanField(default=True)
    error = models.TextField(blank=True, default="")

    prompt_tokens = models.PositiveIntegerField(default=0)
    completion_tokens = models.PositiveIntegerField(default=0)
    cached_tokens = models.PositiveIntegerField(default=0)
    total_tokens = models.PositiveIntegerField(default=0)

    latency_ms = models.PositiveIntegerField(default=0)
    created_tasks = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["user", "source", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.user} {self.kind} {self.total_tokens}tok ok={self.ok}"

    @classmethod
    def tokens_since(cls, user: Any, since: Any) -> int:
        return (
            cls.objects.filter(
                user=user, source=cls.Source.AI, created_at__gte=since
            ).aggregate(total=models.Sum("total_tokens"))["total"]
            or 0
        )
