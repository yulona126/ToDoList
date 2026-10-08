# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# ToDoList frontend — build the React/Vite PWA, then serve it with Nginx.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Dependency layer cached independently of source changes.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

COPY . .
RUN npm run build


FROM nginx:1.29-alpine AS runtime

# Shared `add_header` snippet (nginx does not merge add_header across levels).
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf

# SPA routing + reverse proxy to the backend.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static build output.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
