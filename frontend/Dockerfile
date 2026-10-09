# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# ToDoList frontend — build the React/Vite PWA, then serve it with Nginx.
#
# Build context is the **repository root** (see docker-compose.yml) so we can
# pack the Cursor MCP download zip from mcp/ + integrations/ into public/.
# ---------------------------------------------------------------------------

# --- pack Cursor MCP / Skill downloads --------------------------------------
FROM alpine:3.21 AS pack
RUN apk add --no-cache bash zip tar
WORKDIR /src
COPY mcp/ mcp/
COPY integrations/ integrations/
COPY scripts/pack-cursor-integration.sh scripts/pack-cursor-integration.sh
RUN bash scripts/pack-cursor-integration.sh


FROM node:22-alpine AS build

WORKDIR /app

# Dependency layer cached independently of source changes.
COPY frontend/package.json frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

COPY frontend/ .
# Fresh packages from the pack stage (overrides any committed copies).
COPY --from=pack /src/frontend/public/downloads ./public/downloads
RUN npm run build


FROM nginx:1.29-alpine AS runtime

# Shared `add_header` snippet (nginx does not merge add_header across levels).
COPY frontend/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf

# SPA routing + reverse proxy to the backend.
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Static build output.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
