"""Authentication for long-lived personal access tokens.

Runs *before* ``JWTAuthentication`` in the DRF authenticator list. It returns
``None`` for anything that is not one of our tokens, so ordinary JWT bearer
tokens fall through untouched.
"""

from __future__ import annotations

from typing import Any

from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .models import API_TOKEN_PREFIX, ApiToken

#: `Authorization: Bearer tdl_…` is the primary form; `Token tdl_…` is accepted
#: because several CLI tools default to it.
ACCEPTED_KEYWORDS = {b"bearer", b"token"}


class ApiTokenAuthentication(BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request: Any) -> tuple[Any, ApiToken] | None:
        header = get_authorization_header(request).split()
        if not header:
            return None

        if len(header) == 2 and header[0].lower() in ACCEPTED_KEYWORDS:
            raw = header[1].decode("utf-8", errors="ignore")
        elif len(header) == 1:
            # Bare token, e.g. `Authorization: tdl_…`
            raw = header[0].decode("utf-8", errors="ignore")
        else:
            return None

        if not raw.startswith(API_TOKEN_PREFIX):
            # Not ours — let JWTAuthentication try.
            return None

        token = ApiToken.resolve(raw)
        if token is None:
            raise AuthenticationFailed("API Token 无效、已撤销或已过期。")

        if not token.user.is_active:
            raise AuthenticationFailed("该账号已被停用。")

        token.touch()
        return (token.user, token)

    def authenticate_header(self, request: Any) -> str:
        return self.keyword
