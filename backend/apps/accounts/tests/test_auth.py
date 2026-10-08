"""Auth contract tests — mirrors docs/api.md §1."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()

REGISTER_URL = "/api/v1/auth/register/"
LOGIN_URL = "/api/v1/auth/login/"
REFRESH_URL = "/api/v1/auth/refresh/"
LOGOUT_URL = "/api/v1/auth/logout/"
ME_URL = "/api/v1/auth/me/"
PASSWORD_URL = "/api/v1/auth/password/change/"
HEALTH_URL = "/api/v1/health/"


class RegistrationTests(APITestCase):
    payload = {
        "email": "Dev@Example.com",
        "username": "devy",
        "password": "SuperSecret123",
        "password_confirm": "SuperSecret123",
    }

    def test_register_returns_user_and_tokens(self) -> None:
        response = self.client.post(REGISTER_URL, self.payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertEqual(response.data["user"]["username"], "devy")
        # Email is normalised to lower case and never echoed as a password.
        self.assertEqual(response.data["user"]["email"], "dev@example.com")
        self.assertNotIn("password", response.data["user"])

    def test_register_rejects_duplicate_email(self) -> None:
        self.client.post(REGISTER_URL, self.payload, format="json")
        response = self.client.post(
            REGISTER_URL, {**self.payload, "username": "other"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("errors", response.data)
        self.assertIn("email", response.data["errors"])

    def test_register_rejects_password_mismatch(self) -> None:
        response = self.client.post(
            REGISTER_URL, {**self.payload, "password_confirm": "Different123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password_confirm", response.data["errors"])

    def test_register_rejects_weak_password(self) -> None:
        response = self.client.post(
            REGISTER_URL,
            {
                **self.payload,
                "password": "12345678",
                "password_confirm": "12345678",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password", response.data["errors"])

    def test_register_rejects_invalid_username(self) -> None:
        response = self.client.post(
            REGISTER_URL, {**self.payload, "username": "bad name!"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data["errors"])


class LoginTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="dev@example.com", username="dev", password="SuperSecret123"
        )

    def test_login_with_email(self) -> None:
        response = self.client.post(
            LOGIN_URL, {"email": "dev@example.com", "password": "SuperSecret123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertEqual(response.data["user"]["id"], self.user.id)

    def test_login_is_case_insensitive_on_email(self) -> None:
        response = self.client.post(
            LOGIN_URL, {"email": "DEV@example.com", "password": "SuperSecret123"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

    def test_login_with_wrong_password(self) -> None:
        response = self.client.post(
            LOGIN_URL, {"email": "dev@example.com", "password": "nope"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("detail", response.data)
        self.assertIn("errors", response.data)


class SessionTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="dev@example.com", username="dev", password="SuperSecret123"
        )
        login = self.client.post(
            LOGIN_URL, {"email": "dev@example.com", "password": "SuperSecret123"}, format="json"
        )
        self.access = login.data["access"]
        self.refresh = login.data["refresh"]

    def _auth(self) -> None:
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access}")

    def test_me_requires_authentication(self) -> None:
        response = self.client.get(ME_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_returns_current_user(self) -> None:
        self._auth()
        response = self.client.get(ME_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "dev@example.com")

    def test_me_patch_updates_profile(self) -> None:
        self._auth()
        response = self.client.patch(
            ME_URL, {"display_name": "开发者", "username": "coder"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["display_name"], "开发者")
        self.assertEqual(response.data["username"], "coder")
        self.user.refresh_from_db()
        self.assertEqual(self.user.display_name, "开发者")

    def test_me_patch_rejects_taken_username(self) -> None:
        User.objects.create_user(email="other@example.com", username="taken", password="SuperSecret123")
        self._auth()
        response = self.client.patch(ME_URL, {"username": "taken"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.data["errors"])

    def test_refresh_rotates_tokens(self) -> None:
        response = self.client.post(REFRESH_URL, {"refresh": self.refresh}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIn("access", response.data)

    def test_logout_blacklists_refresh_token(self) -> None:
        self._auth()
        response = self.client.post(LOGOUT_URL, {"refresh": self.refresh}, format="json")
        self.assertEqual(response.status_code, status.HTTP_205_RESET_CONTENT)

        retry = self.client.post(REFRESH_URL, {"refresh": self.refresh}, format="json")
        self.assertEqual(retry.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_is_idempotent_for_unknown_token(self) -> None:
        self._auth()
        response = self.client.post(LOGOUT_URL, {"refresh": "not-a-token"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_205_RESET_CONTENT)

    def test_logout_requires_refresh_field(self) -> None:
        self._auth()
        response = self.client.post(LOGOUT_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class PasswordChangeTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="dev@example.com", username="dev", password="SuperSecret123"
        )
        login = self.client.post(
            LOGIN_URL, {"email": "dev@example.com", "password": "SuperSecret123"}, format="json"
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

    def test_password_change_and_relogin(self) -> None:
        response = self.client.post(
            PASSWORD_URL,
            {"old_password": "SuperSecret123", "new_password": "BrandNewPass456"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        self.client.credentials()
        relogin = self.client.post(
            LOGIN_URL, {"email": "dev@example.com", "password": "BrandNewPass456"}, format="json"
        )
        self.assertEqual(relogin.status_code, status.HTTP_200_OK)

    def test_password_change_rejects_wrong_old_password(self) -> None:
        response = self.client.post(
            PASSWORD_URL,
            {"old_password": "wrong", "new_password": "BrandNewPass456"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("old_password", response.data["errors"])


class HealthTests(APITestCase):
    def test_health_is_public(self) -> None:
        response = self.client.get(HEALTH_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "ok")
        self.assertEqual(response.data["db"], "ok")
        self.assertIn("version", response.data)


class SchemaTests(APITestCase):
    def test_openapi_schema_generates(self) -> None:
        """Guards against schema-breaking changes in serializers."""
        response = self.client.get(reverse("schema"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
