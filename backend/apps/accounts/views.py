"""Authentication endpoints (docs/api.md §1)."""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, serializers as drf_serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import (
    LoginSerializer,
    PasswordChangeSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    UserSerializer,
)

User = get_user_model()


def _token_pair(user: Any) -> dict[str, str]:
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


@extend_schema(
    request=RegisterSerializer,
    responses={201: dict},
    description="Create an account and return a JWT pair.",
    auth=[],
)
class RegisterView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        payload = {"user": UserSerializer(user).data, **_token_pair(user)}
        return Response(payload, status=status.HTTP_201_CREATED)


@extend_schema(
    request=LoginSerializer,
    responses={200: dict},
    description="Exchange email + password for a JWT pair.",
    auth=[],
)
class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    permission_classes = [AllowAny]


@extend_schema(
    request=inline_serializer(
        "LogoutRequest", fields={"refresh": drf_serializers.CharField()}
    ),
    responses={205: None},
    description="Blacklist the supplied refresh token.",
)
class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        raw_refresh = request.data.get("refresh")
        if not raw_refresh:
            return Response(
                {"detail": "缺少 refresh 字段。", "errors": {"refresh": ["该字段为必填项。"]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            RefreshToken(raw_refresh).blacklist()
        except TokenError:
            # Already expired or blacklisted — logout is idempotent from the client's view.
            pass
        return Response(status=status.HTTP_205_RESET_CONTENT)


@extend_schema(responses={200: UserSerializer})
class MeView(generics.RetrieveUpdateAPIView):
    """`GET` / `PATCH` the authenticated user."""

    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self) -> Any:
        return self.request.user

    def get_serializer_class(self) -> type:
        if self.request.method in ("PUT", "PATCH"):
            return ProfileUpdateSerializer
        return UserSerializer

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        super().update(request, *args, **kwargs)
        return Response(UserSerializer(self.get_object()).data)


@extend_schema(
    request=PasswordChangeSerializer,
    responses={204: None},
    description="Change the password of the authenticated user.",
)
class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = PasswordChangeSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
