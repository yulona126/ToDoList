"""Uniform API error envelope.

Contract (docs/api.md §0.2):
    { "detail": "<summary>", "errors": { "<field>": ["<message>"] } }

DRF's own handler already converts ``Http404`` and Django's ``PermissionDenied``
into responses, so this module only has to reshape the payload.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.exceptions import ErrorDetail
from rest_framework.views import exception_handler as drf_exception_handler


def first_message(payload: Any) -> str:
    """Extract a human readable summary from an arbitrarily nested error payload."""
    if isinstance(payload, ErrorDetail):
        return str(payload)
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        for value in payload.values():
            message = first_message(value)
            if message:
                return message
        return ""
    if isinstance(payload, (list, tuple)):
        for value in payload:
            message = first_message(value)
            if message:
                return message
        return ""
    return str(payload)


def _normalise_errors(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return {str(key): value for key, value in payload.items()}
    return {"non_field_errors": payload}


def api_exception_handler(exc: BaseException, context: dict[str, Any]) -> Any:
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    data = response.data

    if isinstance(data, dict) and set(data.keys()) == {"detail"}:
        detail = first_message(data)
        response.data = {
            "detail": detail,
            "errors": (
                {"detail": [detail]}
                if response.status_code >= status.HTTP_400_BAD_REQUEST
                else {}
            ),
        }
    elif isinstance(data, dict):
        response.data = {
            "detail": first_message(data) or "请求参数有误",
            "errors": _normalise_errors(data),
        }
    else:
        response.data = {
            "detail": first_message(data),
            "errors": {"non_field_errors": data},
        }

    return response
