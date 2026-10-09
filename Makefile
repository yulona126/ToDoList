# ---------------------------------------------------------------------------
# ToDoList — common operations
# ---------------------------------------------------------------------------
SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help
.PHONY: help up down build restart logs ps shell dbshell migrate makemigrations \
        test test-backend lint-backend typecheck-frontend build-frontend \
        dev-backend dev-frontend backup restore superuser clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-20s\033[0m %s\n", $$1, $$2}'

# --- lifecycle --------------------------------------------------------------

up: ## Build and start the whole stack (web :8081, api :8001, db :5433)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  Web app  → http://localhost:$${WEB_PORT:-8081}"
	@echo "  API docs → http://localhost:$${API_HOST_PORT:-8001}/api/docs/"
	@echo "  Admin    → http://localhost:$${WEB_PORT:-8081}/admin/"

down: ## Stop the stack (keeps volumes)
	$(COMPOSE) down

down-v: ## Stop the stack AND delete all data volumes
	$(COMPOSE) down -v

build: ## Rebuild both images
	$(COMPOSE) build

restart: ## Restart every service
	$(COMPOSE) restart

ps: ## Show service status
	$(COMPOSE) ps

logs: ## Tail logs (make logs S=backend)
	$(COMPOSE) logs -f $(S)

# --- backend ----------------------------------------------------------------

shell: ## Django shell inside the backend container
	$(COMPOSE) exec backend python manage.py shell

dbshell: ## psql into the database
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-todolist} -d $${POSTGRES_DB:-todolist}

migrate: ## Apply migrations
	$(COMPOSE) exec backend python manage.py migrate

makemigrations: ## Generate migrations from model changes
	$(COMPOSE) exec backend python manage.py makemigrations

superuser: ## Create a Django superuser
	$(COMPOSE) exec backend python manage.py createsuperuser

test-backend: ## Run the backend test suite in an isolated container
	docker run --rm \
		-e DJANGO_SECRET_KEY=test-key-not-secret \
		-e POSTGRES_HOST=db -e POSTGRES_DB=todolist -e POSTGRES_USER=todolist \
		-e POSTGRES_PASSWORD=todolist_dev_password \
		--network todolist_net \
		todolist-backend:latest \
		python manage.py test --verbosity=2

# --- frontend ---------------------------------------------------------------

# The npm cache on some machines contains root-owned files; keep it local.
export npm_config_cache := $(CURDIR)/.npm-cache

dev-frontend: ## Run the Vite dev server (proxies /api to :8001)
	cd frontend && npm run dev

typecheck-frontend: ## tsc --noEmit
	cd frontend && npm run typecheck

build-frontend: ## Production build of the SPA (packs Cursor MCP downloads first)
	./scripts/pack-cursor-integration.sh
	cd frontend && npm run build

# --- maintenance ------------------------------------------------------------

backup: ## Dump the database to ./backups/
	./scripts/backup.sh

restore: ## Restore a dump: make restore F=backups/todolist-YYYYmmdd-HHMMSS.dump
	./scripts/restore.sh $(F)

clean: ## Remove build artefacts and the local npm cache
	rm -rf frontend/dist frontend/node_modules/.vite .npm-cache
