"""Runtime configuration.

Everything comes from the environment. The token is **never** read from a file
by this process: the MCP client (Cursor) is responsible for injecting
``TODOLIST_TOKEN`` via ``env`` or ``envFile``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_API_URL = "http://localhost:8001/api/v1"
DEFAULT_TIMEOUT = 20.0

TOKEN_ENV = "TODOLIST_TOKEN"
API_URL_ENV = "TODOLIST_API_URL"
TIMEOUT_ENV = "TODOLIST_TIMEOUT"

MISSING_TOKEN_HELP = (
    f"{TOKEN_ENV} 未设置：MCP server 无法访问 ToDoList API。\n"
    f"请在 Cursor 的 MCP 配置（.cursor/mcp.json）里为该 server 配置 "
    f'"{TOKEN_ENV}": "tdl…"（或指向含该变量的 envFile），'
    "然后重启 / reload Cursor 的 MCP server。\n"
    "Token 在 ToDoList 网页端「设置 → API Tokens」创建，明文只显示一次。"
    f"[{TOKEN_ENV} is not set; configure it in .cursor/mcp.json before using the tools.]"
)


class ConfigError(Exception):
    """Raised when the environment is unusable. Message is safe to show to a user."""


@dataclass(frozen=True)
class Config:
    api_url: str
    token: str
    timeout: float

    @property
    def auth_header(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


def load_config() -> Config:
    """Read and validate configuration from the environment.

    Raises:
        ConfigError: with a short, human-readable, secret-free message.
    """
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        raise ConfigError(MISSING_TOKEN_HELP)

    api_url = os.environ.get(API_URL_ENV, "").strip() or DEFAULT_API_URL
    if not api_url.startswith(("http://", "https://")):
        raise ConfigError(
            f"{API_URL_ENV} 必须以 http:// 或 https:// 开头，当前值不是合法 URL。"
            f"[{API_URL_ENV} must be an absolute http(s) URL.]"
        )
    api_url = api_url.rstrip("/")

    raw_timeout = os.environ.get(TIMEOUT_ENV, "").strip()
    try:
        timeout = float(raw_timeout) if raw_timeout else DEFAULT_TIMEOUT
    except ValueError:
        raise ConfigError(
            f"{TIMEOUT_ENV} 必须是数字（秒），当前值无法解析。[{TIMEOUT_ENV} must be a number.]"
        ) from None
    if timeout <= 0:
        raise ConfigError(f"{TIMEOUT_ENV} 必须大于 0。[{TIMEOUT_ENV} must be > 0.]")

    return Config(api_url=api_url, token=token, timeout=timeout)


def token_is_configured() -> bool:
    """Cheap check used at startup so we can warn on stderr without crashing."""
    return bool(os.environ.get(TOKEN_ENV, "").strip())
