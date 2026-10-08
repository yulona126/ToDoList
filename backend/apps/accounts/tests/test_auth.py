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


# ------------------------------------------------------------- API tokens
class ApiTokenTests(APITestCase):
    """Personal access tokens power the CLI / MCP integrations (docs/mcp-and-skills.md)."""

    TOKENS_URL = "/api/v1/auth/tokens/"

    def setUp(self) -> None:
        from apps.accounts.models import ApiToken

        self.ApiToken = ApiToken
        self.user = User.objects.create_user(
            email="dev@example.com", username="dev", password="SuperSecret123"
        )
        self.client.force_authenticate(self.user)

    def _issue(self, **extra):
        return self.client.post(
            self.TOKENS_URL, {"name": "cursor-mcp", **extra}, format="json"
        )

    def test_issue_returns_the_secret_exactly_once(self) -> None:
        response = self._issue()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        raw = response.data["token"]
        self.assertTrue(raw.startswith("tdl_"))
        self.assertEqual(response.data["name"], "cursor-mcp")

        # Listing must not leak it again.
        listing = self.client.get(self.TOKENS_URL)
        self.assertEqual(listing.data["count"], 1)
        self.assertNotIn("token", listing.data["results"][0])
        self.assertEqual(listing.data["results"][0]["prefix"], raw[:12])

    def test_the_secret_is_not_stored_in_plaintext(self) -> None:
        raw = self._issue().data["token"]
        row = self.ApiToken.objects.get()
        self.assertNotEqual(row.key_hash, raw)
        self.assertNotIn(raw, row.key_hash)
        self.assertEqual(len(row.key_hash), 64)  # sha256 hex

    def test_bearer_token_authenticates(self) -> None:
        raw = self._issue().data["token"]
        self.client.force_authenticate(None)
        response = self.client.get(ME_URL, HTTP_AUTHORIZATION=f"Bearer {raw}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["email"], "dev@example.com")

    def test_token_keyword_also_works(self) -> None:
        raw = self._issue().data["token"]
        self.client.force_authenticate(None)
        response = self.client.get(ME_URL, HTTP_AUTHORIZATION=f"Token {raw}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_last_used_at_is_recorded(self) -> None:
        raw = self._issue().data["token"]
        self.client.force_authenticate(None)
        self.client.get(ME_URL, HTTP_AUTHORIZATION=f"Bearer {raw}")
        self.assertIsNotNone(self.ApiToken.objects.get().last_used_at)

    def test_revoked_token_is_rejected(self) -> None:
        created = self._issue()
        raw, pk = created.data["token"], created.data["id"]
        self.client.force_authenticate(self.user)
        self.assertEqual(
            self.client.delete(f"{self.TOKENS_URL}{pk}/").status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.client.force_authenticate(None)
        response = self.client.get(ME_URL, HTTP_AUTHORIZATION=f"Bearer {raw}")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_expired_token_is_rejected(self) -> None:
        from datetime import timedelta

        from django.utils import timezone

        raw = self._issue(expires_in_days=1).data["token"]
        row = self.ApiToken.objects.get()
        row.expires_at = timezone.now() - timedelta(minutes=1)
        row.save(update_fields=["expires_at"])

        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(ME_URL, HTTP_AUTHORIZATION=f"Bearer {raw}").status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_garbage_token_is_rejected(self) -> None:
        self.client.force_authenticate(None)
        for header in ("Bearer tdl_not-a-real-token", "Bearer tdl_"):
            with self.subTest(header=header):
                self.assertEqual(
                    self.client.get(ME_URL, HTTP_AUTHORIZATION=header).status_code,
                    status.HTTP_401_UNAUTHORIZED,
                )

    def test_tokens_are_scoped_to_their_owner(self) -> None:
        raw = self._issue().data["token"]
        other_workspace = self.client.post(
            "/api/v1/workspaces/", {"name": "Mine"}, format="json"
        ).data

        stranger = User.objects.create_user(
            email="other@example.com", username="other", password="SuperSecret123"
        )
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(self.TOKENS_URL).data["count"], 0)
        # A stranger's token must not expose the first user's data.
        theirs = self.client.post(
            self.TOKENS_URL, {"name": "other"}, format="json"
        ).data["token"]
        self.client.force_authenticate(None)
        listing = self.client.get(
            "/api/v1/workspaces/", HTTP_AUTHORIZATION=f"Bearer {theirs}"
        )
        self.assertEqual(listing.data["count"], 0)
        del other_workspace

    def test_another_users_token_cannot_be_revoked(self) -> None:
        created = self._issue()
        stranger = User.objects.create_user(
            email="other@example.com", username="other", password="SuperSecret123"
        )
        self.client.force_authenticate(stranger)
        self.assertEqual(
            self.client.delete(f"{self.TOKENS_URL}{created.data['id']}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_jwt_still_works_alongside_tokens(self) -> None:
        from apps.accounts.views import _token_pair

        self.client.force_authenticate(None)
        access = _token_pair(self.user)["access"]
        response = self.client.get(ME_URL, HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_token_management_requires_authentication(self) -> None:
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(self.TOKENS_URL).status_code, status.HTTP_401_UNAUTHORIZED
        )

    def test_blank_name_is_rejected(self) -> None:
        self.assertEqual(
            self.client.post(self.TOKENS_URL, {"name": ""}, format="json").status_code,
            status.HTTP_400_BAD_REQUEST,
        )
