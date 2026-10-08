"""User model with email as the login identifier."""

from __future__ import annotations

from typing import Any

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


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
