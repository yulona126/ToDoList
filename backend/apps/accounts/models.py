"""User model with email as the login identifier."""

from __future__ import annotations

from typing import Any

import hashlib
import secrets

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.common.models import TimeStampedModel


class UserManager(BaseUserManager["User"]):
    use_in_migrations = True

    def get_by_natural_key(self, username: str) -> "User":
        """Email logins are case-insensitive.

        ``ModelBackend.authenticate`` resolves the user through this method, so
        overriding it is what makes ``DEV@example.com`` find ``dev@example.com``.
        """
        return self.get(**{f"{self.model.USERNAME_FIELD}__iexact": username})

    def _create_user(
        self, email: str, username: str, password: str | None, **extra: Any
    ) -> "User":
        if not email:
            raise ValueError("An email address is required.")
        if not username:
            raise ValueError("A username is required.")

        email = self.normalize_email(email).lower()
        user: User = self.model(email=email, username=username, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(
        self, email: str, username: str, password: str | None = None, **extra: Any
    ) -> "User":
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, username, password, **extra)

    def create_superuser(
        self, email: str, username: str, password: str | None = None, **extra: Any
    ) -> "User":
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if extra.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, username, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Application user.

    ``email`` is the unique login identifier; ``username`` is the public handle
    and is also unique (it is used in shared-workspace views later on).
    """

    email = models.EmailField("email address", unique=True, db_index=True)
    username = models.CharField("username", max_length=32, unique=True, db_index=True)
    display_name = models.CharField("display name", max_length=64, blank=True)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"
        ordering = ("id",)

    def __str__(self) -> str:
        return self.email

    @property
    def name(self) -> str:
        """Best available human label."""
        return self.display_name or self.username


#: Prefix that marks a token as ours, so the auth class can tell a personal
#: access token apart from a JWT without guessing.
API_TOKEN_PREFIX = "tdl_"


def hash_api_token(raw: str) -> str:
    """Tokens are stored as a SHA-256 digest — never in plaintext.

    No salt/iterations on purpose: the token is 256 bits of `secrets` entropy,
    so it is not brute-forceable and we want the lookup to be a single indexed
    equality check on every authenticated request.
    """
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ApiToken(TimeStampedModel):
    """A long-lived personal access token for CLI / MCP / CI integrations.

    JWT access tokens expire in an hour and refresh tokens rotate, which is
    unusable for a tool that runs outside the browser. These do not rotate and
    are revocable from Settings.
    """

    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="api_tokens"
    )
    name = models.CharField(max_length=60, help_text="Where this token is used")
    #: Display-only identifier (`tdl_ab12cd34`), safe to show and log.
    prefix = models.CharField(max_length=16, db_index=True)
    key_hash = models.CharField(max_length=64, unique=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["user", "revoked_at"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.prefix}…)"

    @classmethod
    def issue(cls, user: Any, name: str, *, expires_at: Any = None) -> tuple["ApiToken", str]:
        """Create a token. Returns (row, plaintext) — the plaintext is shown once."""
        raw = f"{API_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
        token = cls.objects.create(
            user=user,
            name=name.strip()[:60] or "token",
            prefix=raw[:12],
            key_hash=hash_api_token(raw),
            expires_at=expires_at,
        )
        return token, raw

    @classmethod
    def resolve(cls, raw: str) -> "ApiToken | None":
        """Look up a live token by its plaintext."""
        token = (
            cls.objects.select_related("user")
            .filter(key_hash=hash_api_token(raw), revoked_at__isnull=True)
            .first()
        )
        if token is None:
            return None
        if token.expires_at is not None and token.expires_at <= timezone.now():
            return None
        return token

    @property
    def is_active(self) -> bool:
        if self.revoked_at is not None:
            return False
        return self.expires_at is None or self.expires_at > timezone.now()

    def touch(self) -> None:
        """Record usage, but at most once a minute to avoid a write per request."""
        now = timezone.now()
        if self.last_used_at is not None and (now - self.last_used_at).total_seconds() < 60:
            return
        ApiToken.objects.filter(pk=self.pk).update(last_used_at=now)
        self.last_used_at = now
