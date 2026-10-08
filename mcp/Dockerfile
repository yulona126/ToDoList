# Optional container mode for the ToDoList MCP server.
#
#   docker build -t todolist-mcp:latest /path/to/ToDoList/mcp
#   docker run -i --rm --network todolist_net \
#     -e TODOLIST_API_URL=http://backend:8000/api/v1 \
#     -e TODOLIST_TOKEN="$TODOLIST_TOKEN" todolist-mcp:latest
#
# The image is deliberately minimal: it carries only the mcp SDK, and the token
# is always injected at run time (never baked in).
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY todolist_mcp ./todolist_mcp
RUN pip install --no-cache-dir "mcp==2.3.0"

# MCP servers speak JSON-RPC on stdio; keep stdout clean.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

ENTRYPOINT ["python", "-m", "todolist_mcp"]
