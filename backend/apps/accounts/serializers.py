"""Serializers for registration, login, profile and password management."""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model

from .models import ApiToken
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

User = get_user_model()


class UserSerializer(serializers.ModelSerializer["User"]):
    """Read model for the authenticated user (docs/api.md §1)."""

    name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "username", "display_name", "name", "date_joined")
        read_only_fields = ("id", "email", "date_joined", "name")


class RegisterSerializer(serializers.Serializer[Any]):
    email = serializers.EmailField()
    username = serializers.CharField(min_length=2, max_length=32)
    password = serializers.CharField(write_only=True, min_length=8, style={"input_type": "password"})
    password_confirm = serializers.CharField(write_only=True, style={"input_type": "password"})
    display_name = serializers.CharField(required=False, allow_blank=True, max_length=64)

    def validate_email(self, value: str) -> str:
        value = value.lower().strip()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("该邮箱已被注册。")
        return value

    def validate_username(self, value: str) -> str:
        value = value.strip()
        if not value.replace("_", "").replace("-", "").isalnum():
            raise serializers.ValidationError("用户名只能包含字母、数字、下划线和连字符。")
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("该用户名已被占用。")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs.get("password") != attrs.get("password_confirm"):
            raise serializers.ValidationError({"password_confirm": ["两次输入的密码不一致。"]})

        # Runs Django's configured AUTH_PASSWORD_VALIDATORS.
        probe = User(
            email=attrs.get("email", ""),
            username=attrs.get("username", ""),
        )
        try:
            validate_password(attrs["password"], probe)
        except Exception as exc:  # django.core.exceptions.ValidationError
            messages = getattr(exc, "messages", [str(exc)])
            raise serializers.ValidationError({"password": list(messages)}) from exc

        return attrs

    @transaction.atomic
    def create(self, validated_data: dict[str, Any]) -> "User":
        validated_data.pop("password_confirm", None)
        password = validated_data.pop("password")
        display_name = validated_data.pop("display_name", "") or validated_data["username"]
        return User.objects.create_user(
            password=password, display_name=display_name, **validated_data
        )


class LoginSerializer(TokenObtainPairSerializer):
    """Email + password login that also returns the serialized user."""

    username_field = "email"

    default_error_messages = {"no_active_account": "邮箱或密码不正确。"}

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class ProfileUpdateSerializer(serializers.ModelSerializer["User"]):
    class Meta:
        model = User
        fields = ("username", "display_name")

    def validate_username(self, value: str) -> str:
        value = value.strip()
        if not value.replace("_", "").replace("-", "").isalnum():
            raise serializers.ValidationError("用户名只能包含字母、数字、下划线和连字符。")
        qs = User.objects.filter(username__iexact=value).exclude(pk=self.instance.pk if self.instance else None)
        if qs.exists():
            raise serializers.ValidationError("该用户名已被占用。")
        return value


class PasswordChangeSerializer(serializers.Serializer[Any]):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_old_password(self, value: str) -> str:
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("当前密码不正确。")
        return value

    def validate_new_password(self, value: str) -> str:
        user = self.context["request"].user
        try:
            validate_password(value, user)
        except Exception as exc:
            messages = getattr(exc, "messages", [str(exc)])
            raise serializers.ValidationError(list(messages)) from exc
        return value

    def save(self, **kwargs: Any) -> "User":
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


# --------------------------------------------------------------------- tokens


class ApiTokenSerializer(serializers.ModelSerializer["ApiToken"]):
    """Read model for a personal access token. Never exposes the secret."""

    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = ApiToken
        fields = (
            "id",
            "name",
            "prefix",
            "is_active",
            "last_used_at",
            "expires_at",
            "created_at",
        )
        read_only_fields = fields


class ApiTokenCreateSerializer(serializers.Serializer[Any]):
    name = serializers.CharField(max_length=60, allow_blank=False)
    expires_in_days = serializers.IntegerField(
        required=False, allow_null=True, min_value=1, max_value=3650
    )

    def create(self, validated_data: dict[str, Any]) -> tuple[ApiToken, str]:
        from datetime import timedelta

        from django.utils import timezone

        days = validated_data.get("expires_in_days")
        expires_at = timezone.now() + timedelta(days=days) if days else None
        return ApiToken.issue(
            self.context["request"].user, validated_data["name"], expires_at=expires_at
        )
