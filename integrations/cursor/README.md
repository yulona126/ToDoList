# Cursor integration for ToDoList

Two pieces, both installed into **your project's** `.cursor/` directory:

| Piece | Installs to | Purpose |
| --- | --- | --- |
| Agent Skill | `<project>/.cursor/skills/todolist-plan/SKILL.md` | Teaches Cursor *when* and *how* to pull your ToDoList into a plan. |
| MCP config | `<project>/.cursor/mcp.json` | Starts the `todolist` stdio server so the tools exist. |

## Install

**From the web UI (other machines):** open ToDoList → **Settings → Cursor integration**,
download the MCP package, and follow the on-page steps. No full repo needed.
Refresh the downloadable zips with `scripts/pack-cursor-integration.sh`.

**From this repo:**

```bash
# from a checkout of ToDoList
scripts/install-cursor-integration.sh /path/to/your/project     # or omit for $PWD
```

The script is idempotent, merges into an existing `mcp.json` with a real JSON parser (unrelated
`mcpServers` entries are preserved), and prints the next steps. It never reads or writes a token.

Manual install is just as fine: copy `cursor/skills/todolist-plan/` to `<project>/.cursor/skills/`
and merge the entry from [`mcp.json`](mcp.json) into `<project>/.cursor/mcp.json`.

## 1. Create a token

Cursor needs a personal access token:

1. Open ToDoList → **Settings → API Tokens**.
2. Create a token; the plaintext is shown **only once**. It starts with `tdl`, then an
   underscore, then a random suffix.
3. Store it in the env file referenced by `mcp.json` (keep it out of the repo):

   ```bash
   mkdir -p ~/.config/todolist && chmod 700 ~/.config/todolist
   printf 'TODOLIST_TOKEN=%s\n' '<paste-your-token-here>' > ~/.config/todolist/mcp.env
   chmod 600 ~/.config/todolist/mcp.env
   ```

Never commit a token, and never put it in `mcp.json` — the committed template deliberately
contains no secret.

## 2. `mcp.json` forms

### Primary — host Python, token from `envFile`

[`mcp.json`](mcp.json) is this form. Paths are absolute because Cursor starts the server from an
arbitrary working directory:

```json
{
  "mcpServers": {
    "todolist": {
      "command": "/Users/yulon/code/ToDoList/mcp/.venv/bin/python",
      "args": ["-m", "todolist_mcp"],
      "env": {
        "PYTHONPATH": "/Users/yulon/code/ToDoList/mcp",
        "TODOLIST_API_URL": "http://localhost:8001/api/v1"
      },
      "envFile": "/Users/yulon/.config/todolist/mcp.env"
    }
  }
}
```

Two things that silently break this config, so double-check them:

- `command` must be the **venv** interpreter. `mcp` is not installed system-wide.
- `PYTHONPATH` must point at the directory that *contains* `todolist_mcp/` (i.e. `…/ToDoList/mcp`).
  Alternatively run `mcp/.venv/bin/pip install -e /path/to/ToDoList/mcp` and drop `PYTHONPATH`.

`envFile` is a plain `KEY=value` file; entries from `env` and `envFile` are merged, with `env`
taking precedence. The file format is shown in [`mcp.env.example`](mcp.env.example).

### Alternative — token from Cursor's environment

If you would rather export the token in the shell you launch Cursor from, drop `envFile` and use
the `${env:…}` interpolation instead:

```json
{
  "mcpServers": {
    "todolist": {
      "command": "/Users/yulon/code/ToDoList/mcp/.venv/bin/python",
      "args": ["-m", "todolist_mcp"],
      "env": {
        "PYTHONPATH": "/Users/yulon/code/ToDoList/mcp",
        "TODOLIST_API_URL": "http://localhost:8001/api/v1",
        "TODOLIST_TOKEN": "${env:TODOLIST_TOKEN}"
      }
    }
  }
}
```

(GUI-launched apps do not inherit your shell exports; `envFile` is usually the more reliable of
the two.)

### Alternative — container, on the compose network

Reaches the backend by service name, so no host port or venv is involved:

```json
{
  "mcpServers": {
    "todolist": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--network", "todolist_net",
        "-e", "TODOLIST_API_URL=http://backend:8000/api/v1",
        "-e", "TODOLIST_TOKEN=${env:TODOLIST_TOKEN}",
        "todolist-mcp:latest"
      ]
    }
  }
}
```

Build the image once from [`../mcp`](../mcp) (`docker build -t todolist-mcp:latest ../mcp`). The
container form cannot use `envFile` (that is a Cursor-side mechanism), so the token has to come
from `${env:…}` or be listed in `env` — which is one more reason the host form is the default.

## 3. The skill

Cursor discovers skills in `<project>/.cursor/skills/` and `<project>/.agents/skills/` (project
scope) or `~/.cursor/skills/` (user scope). Each skill is a folder containing `SKILL.md` with YAML
frontmatter; `name` must be lowercase letters/digits/hyphens and must equal the folder name.
`description` is what the agent matches on, so it states both what the skill does and when to use
it.

[`skills/todolist-plan/SKILL.md`](skills/todolist-plan/SKILL.md) triggers on 「整理开发计划」
「把 todolist 导入」「这个版本还剩什么」「生成 TODO」and their English equivalents, then walks the
agent through `list_workspaces` → `get_tasks` → fold into the requested plan → offer
`create_tasks` for new work. Its hard rules: never invent ids, always read before writing, ask
when the workspace is ambiguous, and keep the task `#id`s in the output so later
`update_tasks` calls can target them.

To install it at user scope instead of per project:

```bash
mkdir -p ~/.cursor/skills
cp -R integrations/cursor/skills/todolist-plan ~/.cursor/skills/
```

## 4. Verify

1. Cursor → **Settings → MCP**: `todolist` should be listed and running, with four tools.
2. Ask Cursor: 「整理开发计划」or "list my todolist workspaces".
3. If nothing happens, check Cursor's MCP logs. The server is designed to still start without
   `TODOLIST_TOKEN` (a warning goes to stderr) and to answer each tool call with a readable
   error, so a misconfigured token shows up as a tool error rather than a dead server.

See [`../../mcp/README.md`](../../mcp/README.md) for the server itself, its environment variables
and its troubleshooting notes.
