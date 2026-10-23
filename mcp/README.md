# ToDoList MCP server

A **stdio** [Model Context Protocol](https://modelcontextprotocol.io) server that exposes a
ToDoList workspace to an agent (Cursor, Claude Code, …) through four tools.

```
mcp/
├── pyproject.toml          # pins mcp==2.3.0
├── Dockerfile              # optional container mode
├── README.md
└── todolist_mcp/
    ├── __init__.py
    ├── config.py           # env parsing + clear error when TODOLIST_TOKEN is missing
    ├── client.py           # REST client (stdlib urllib), pagination, error envelope
    ├── render.py           # task data -> compact Markdown
    ├── server.py           # the four tool definitions
    └── __main__.py         # `python -m todolist_mcp`
```

## Tools

| Tool | What it does |
| --- | --- |
| `list_workspaces()` | Markdown table of workspaces: `id`, name, task counts, description. |
| `get_tasks(workspace_id, status="", due="", include_done=False, search="")` | The main read tool. Compact Markdown grouped by list, one line per task, sub-tasks indented under their parent. |
| `create_tasks(workspace_id, tasks)` | Bulk create via `POST /tasks/bulk-create/` (≤ 100 per call). Supports `description`. |
| `update_tasks(task_ids, action)` | Batch status only: `action` ∈ `done \| todo \| archive`, via `POST /tasks/bulk/` (≤ 500 ids). |
| `update_task(task_id, fields)` | Patch one task via `PATCH /tasks/{id}/`: `title`, `description`, `status`, `priority`, `task_type`, `due_date`, `task_list`, `is_archived`. |

Output shape:

```markdown
# PowerArena:2026-09 (id=4) · 6 项

## 未分组 · 6 项
- [ ] #152 参加 howto text 会 · 中 · 会议 · 10-13
- [ ] #153 real time 与 playback 均显示 ROI · 中 · 开发
  - [ ] #154 支持手动隐藏部分 ROI · 中 · 开发
```

Conventions the renderer follows (kept deliberately terse, since every token here is context):

- `- [ ]` for open tasks, `- [x]` for done ones (plain, no strikethrough). Done tasks are hidden
  unless `include_done=true` **or** `status` explicitly contains `done`.
- Every line carries the numeric `#id` — it is the only handle `update_tasks` accepts.
- Meta fields after `·`: status (only when not `todo`), priority, task type, due date (`MM-DD`,
  `!` suffix = overdue), tags as `#name`. Priority and type are always printed so the agent can
  write them back without guessing.
- Sub-tasks are fetched only for parents whose `subtask_stats.total > 0` — never speculatively.

## Configuration

Both values come from the environment of the process the MCP client starts:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TODOLIST_TOKEN` | *(required)* | Personal access token (`tdl…`), sent as `Authorization: Bearer …`. |
| `TODOLIST_API_URL` | `http://localhost:8001/api/v1` | REST base URL. |
| `TODOLIST_TIMEOUT` | `20` | Per-request timeout in seconds. |

The token is **only** read from `TODOLIST_TOKEN`. The server never looks for a token file, and
never logs one. When the variable is missing it still starts (so the client can list the tools),
prints a warning on stderr, and every tool call returns a readable configuration error.

## Running it

**Host (venv)** — the recommended mode; this is what
[`integrations/cursor/mcp.json`](../integrations/cursor/mcp.json) uses:

```bash
python3 -m venv .venv
.venv/bin/pip install "mcp==2.3.0"     # or: .venv/bin/pip install -e .
TODOLIST_TOKEN=tdl… TODOLIST_API_URL=http://localhost:8001/api/v1 \
  PYTHONPATH="$PWD" .venv/bin/python -m todolist_mcp
```

`PYTHONPATH` is enough to run from a checkout; `pip install -e .` makes the module importable
without it. Either way, the MCP client must be given the venv's `python`, not the system one —
`mcp` is not a system package.

**Container** — build the server image and run it on the compose network so it can reach the
backend by service name (`mcp/Dockerfile` is included):

```bash
docker build -t todolist-mcp:latest .
docker run -i --rm --network todolist_net \
  -e TODOLIST_API_URL=http://backend:8000/api/v1 \
  -e TODOLIST_TOKEN="$TODOLIST_TOKEN" todolist-mcp:latest
```

Container mode only makes sense while the ToDoList stack is up; the host form in
[`integrations/cursor/README.md`](../integrations/cursor/README.md) is the default.

## Which SDK API this uses

`mcp` **2.3.0** renamed the v1 `FastMCP` helper. `mcp.server.fastmcp` no longer exists; importing
it raises a `ModuleNotFoundError` whose message points at the migration guide. What 2.3.0 actually
exports:

- `from mcp.server.mcpserver import MCPServer` (also re-exported as `from mcp.server import MCPServer`) — the `FastMCP` successor. Tools are registered with the `@server.tool(...)` decorator or `server.add_tool(fn)`.
- `from mcp.server.mcpserver.exceptions import ToolError` — raising it makes the call return `isError: true` with your message in `content`; the traceback stays in the server log. Any other exception reaches the model only as a generic `Error executing tool <name>`, which is why every tool body in `server.py` converts failures into `ToolError`.
- `MCPServer.run(transport="stdio")` for the blocking entry point (`run_stdio_async()` exists for an asyncio caller).
- The client side (used only by tests) is `mcp.ClientSession` + `mcp.client.stdio.stdio_client`, with snake_case attributes (`Tool.input_schema`, `CallToolResult.is_error`, `InitializeResult.server_info`).

Note: 2.3.0 depends on **`httpx2`**, not `httpx` — `import httpx` fails inside the venv it
creates. This server therefore uses the standard library (`urllib`) and has exactly one
dependency: `mcp==2.3.0`.

## Troubleshooting

- **`502 Bad Gateway` from the API while `curl` works.** On macOS, `urllib` merges the system
  proxy settings, so a locally running proxy (Clash/Surge/…) swallows requests to `localhost`.
  `client.py` builds its opener from `getproxies_environment()` instead, i.e. only `http_proxy` /
  `https_proxy` / `no_proxy` are honored. If you still see this, set `NO_PROXY=localhost,127.0.0.1`.
- **Tools return a configuration error.** `TODOLIST_TOKEN` is not visible to the process Cursor
  started. Provide it through `env` or `envFile` in `mcp.json`, then reload the server.
- **401.** The token was revoked or is not an API token. Create a new one under
  Settings → API Tokens.
- **404 on a workspace id.** It does not exist, or belongs to another user — call
  `list_workspaces()` again; ids are not guessable.
