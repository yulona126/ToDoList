"""Minimal DeepSeek client.

Deliberately thin: OpenAI-compatible ``POST /chat/completions``, no streaming,
**no automatic retries** (docs/ai-assistant.md §9: a retried request may be
billed twice, so we surface the error and let the user decide).
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from .prompts import strip_code_fence

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 30.0

#: Errors we are willing to report verbatim to the user (they are actionable).
class AiError(Exception):
    """Anything that should be shown to the user as a 502."""


class AiNotConfigured(AiError):
    """No usable credential — a client mistake, mapped to 400."""


class AiInvalidInput(AiError):
    """Bad request from our own user (e.g. blank text) — mapped to 400."""


class AiQuotaExceeded(AiError):
    """Daily token budget spent — mapped to 429."""


class AiUnavailable(AiError):
    """Upstream provider failed — mapped to 502."""


@dataclass
class ChatResult:
    payload: dict[str, Any]
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    raw_content: str = ""
    finish_reason: str = ""


def validate_base_url(base_url: str) -> str:
    """SSRF guard (docs §9): https only, no loopback / private hosts."""
    parsed = urlparse(base_url)
    if parsed.scheme != "https":
        raise AiError("base_url 必须是 https:// 地址。")
    host = (parsed.hostname or "").lower()
    if not host:
        raise AiError("base_url 缺少主机名。")
    if host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"} or host.endswith(".local"):
        raise AiError("base_url 不允许指向本机地址。")
    if host.startswith(("10.", "192.168.", "169.254.")) or host.startswith("172."):
        raise AiError("base_url 不允许指向内网地址。")
    return base_url.rstrip("/")


class DeepSeekClient:
    def __init__(self, *, api_key: str, base_url: str, model: str) -> None:
        self.api_key = api_key
        self.base_url = validate_base_url(base_url)
        self.model = model

    def _post(self, body: dict[str, Any]) -> ChatResult:
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        timeout = httpx.Timeout(
            READ_TIMEOUT, connect=CONNECT_TIMEOUT, write=CONNECT_TIMEOUT, pool=CONNECT_TIMEOUT
        )

        started = time.monotonic()
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.post(url, headers=headers, json=body)
        except httpx.TimeoutException as exc:
            raise AiError(f"调用 {self.base_url} 超时，请重试。") from exc
        except httpx.HTTPError as exc:
            raise AiError(f"无法连接 {self.base_url}：{exc}") from exc

        latency_ms = int((time.monotonic() - started) * 1000)

        if response.status_code == 401:
            raise AiError("API Key 无效或已被撤销（401）。")
        if response.status_code == 402:
            raise AiError("DeepSeek 账户余额不足（402）。")
        if response.status_code == 429:
            raise AiError("DeepSeek 触发限流（429），请稍后重试。")
        if response.status_code >= 400:
            detail = response.text[:300]
            raise AiError(f"DeepSeek 返回 {response.status_code}：{detail}")

        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            raise AiError("DeepSeek 返回了非 JSON 响应。") from exc

        choices = data.get("choices") or []
        if not choices:
            raise AiError("DeepSeek 未返回任何结果。")

        content = (choices[0].get("message") or {}).get("content") or ""
        usage = data.get("usage") or {}
        prompt_details = usage.get("prompt_tokens_details") or {}

        return ChatResult(
            payload=self._loads(content),
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            # DeepSeek reports cache hits here; not every tier populates it.
            cached_tokens=int(
                usage.get("prompt_cache_hit_tokens")
                or prompt_details.get("cached_tokens")
                or 0
            ),
            total_tokens=int(usage.get("total_tokens") or 0),
            latency_ms=latency_ms,
            raw_content=content,
            finish_reason=str(choices[0].get("finish_reason") or ""),
        )

    @staticmethod
    def _loads(content: str) -> dict[str, Any]:
        """Parse the model's JSON tolerantly. Never raises — a bad reply is
        reported as "no tasks" *plus* the reason (see the caller)."""
        cleaned = strip_code_fence(content)
        if not cleaned:
            return {}
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning("AI returned unparseable content: %.200s", content)
            return {"_parse_error": cleaned[:500]}

        # A bare array is a common deviation from the requested envelope.
        if isinstance(parsed, list):
            return {"tasks": parsed}

        if isinstance(parsed, dict):
            for key in ("tasks", "items", "data", "result", "task_list"):
                value = parsed.get(key)
                if isinstance(value, list):
                    return {"tasks": value}
                if isinstance(value, dict):
                    # {"tasks": {"1": {...}, "2": {...}}}
                    return {
                        "tasks": [v for v in value.values() if isinstance(v, dict)]
                    }
            return parsed

        return {} if parsed is None else {"tasks": parsed}

    def chat_json(
        self,
        *,
        system_prompt: str,
        user_message: str,
        max_tokens: int,
    ) -> ChatResult:
        body = {
            "model": self.model,
            "messages": [
                # Static prefix first so the provider's context cache can hit.
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": 0,
            "max_tokens": max_tokens,
            "stream": False,
            "response_format": {"type": "json_object"},
        }
        return self._post(body)

    def verify(self) -> tuple[int, str]:
        """Cheapest possible liveness probe. Returns (latency_ms, model)."""
        body = {
            "model": self.model,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
            "stream": False,
        }
        result = self._post(body)
        return result.latency_ms, self.model
