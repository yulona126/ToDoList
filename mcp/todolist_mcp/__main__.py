"""``python -m todolist_mcp`` — run the MCP server over stdio."""

from __future__ import annotations

import sys


def main() -> None:
    from . import config
    from .server import mcp

    if not config.token_is_configured():
        # A clear, non-fatal warning: the server still starts so the client can
        # list the tools, and each tool then returns a readable explanation.
        print(
            f"[todolist-mcp] WARNING: {config.TOKEN_ENV} is not set. "
            "Tools will fail with a configuration error until it is provided via "
            "the MCP client env/envFile.",
            file=sys.stderr,
            flush=True,
        )

    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
