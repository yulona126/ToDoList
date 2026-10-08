"""API-key encryption.

The user's DeepSeek key is stored encrypted and is **never** returned by the API
(docs/ai-assistant.md §1.3, §9).

Key material resolution order:

1. ``AI_ENCRYPTION_KEY`` (a Fernet key, or any string we derive one from) —
   the production setting.
2. Fallback: HKDF-SHA256 over ``DJANGO_SECRET_KEY``. Convenient for a local
   install, but rotating ``DJANGO_SECRET_KEY`` then makes every stored key
   undecryptable — hence the startup warning in config/settings.py.
"""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

logger = logging.getLogger(__name__)

_HKDF_INFO = b"todolist-ai-credential-v1"


class CredentialDecryptionError(Exception):
    """Raised when a stored key cannot be decrypted (usually a rotated secret)."""


def _fernet() -> Fernet:
    raw = getattr(settings, "AI_ENCRYPTION_KEY", "") or ""
    if not raw:
        raw = getattr(settings, "SECRET_KEY", "")

    assert raw, "SECRET_KEY must be set to derive an encryption key"

    try:
        # Accept a well-formed Fernet key directly.
        return Fernet(raw.encode() if isinstance(raw, str) else raw)
    except (ValueError, TypeError):
        pass

    # Derive a deterministic 32-byte key from arbitrary key material.
    derived = hashlib.sha256(f"{raw}:{_HKDF_INFO.decode()}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode("utf-8"))


def decrypt(token: bytes) -> str:
    try:
        return _fernet().decrypt(token).decode("utf-8")
    except InvalidToken as exc:
        raise CredentialDecryptionError(
            "Stored API key cannot be decrypted. "
            "This normally means DJANGO_SECRET_KEY or AI_ENCRYPTION_KEY changed "
            "after the key was saved. Re-enter the key in Settings."
        ) from exc


def mask(api_key: str) -> str:
    """`sk-1234567890abcdef` → `sk-1234****cdef`. Never returns the middle."""
    if not api_key:
        return ""
    if len(api_key) <= 12:
        return f"{api_key[:4]}****"
    return f"{api_key[:7]}****{api_key[-4:]}"
