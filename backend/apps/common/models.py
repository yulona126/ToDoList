"""Shared abstract models."""

from __future__ import annotations

from django.db import models


class TimeStampedModel(models.Model):
    """Adds self-managed ``created_at`` / ``updated_at`` columns."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
