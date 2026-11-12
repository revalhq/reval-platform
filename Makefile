# Local development. `make dev` starts everything: Postgres (Docker), the API and the portal.
# Run `make help` for the other targets.

SHELL := /bin/bash
API_PORT ?= 4000
# Empty = first free port from 3000 up. Override with `make dev PORTAL_PORT=3100`.
PORTAL_PORT ?=
# Dependencies are public packages; pin the public registry so a global npm mirror config doesn't interfere.
NPM_FLAGS ?= --registry=https://registry.npmjs.org/

.DEFAULT_GOAL := help
.PHONY: help dev install db stop test typecheck build

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-10s %s\n", $$1, $$2}'

dev: install apps/api/.env db ## Run Postgres + API (watch mode) + portal; Ctrl-C stops everything but Postgres
	@docker compose stop api >/dev/null 2>&1 || true
	@if lsof -iTCP:$(API_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
	  echo "Port $(API_PORT) is in use by another process. Free it or run: make dev API_PORT=4001"; exit 1; fi
	@port="$(PORTAL_PORT)"; \
	if [ -z "$$port" ]; then port=3000; \
	  while lsof -iTCP:$$port -sTCP:LISTEN >/dev/null 2>&1; do port=$$((port+1)); done; \
	elif lsof -iTCP:$$port -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $$port is in use."; exit 1; fi; \
	echo ""; \
	echo "  Portal  http://localhost:$$port"; \
	echo "  API     http://localhost:$(API_PORT)   (docs: http://localhost:$(API_PORT)/docs)"; \
	echo ""; \
	trap 'kill 0' INT TERM; \
	( cd apps/api && set -a && . ./.env && set +a && \
	  PORT=$(API_PORT) PORTAL_URL=http://localhost:$$port npm run dev 2>&1 \
	  | awk '{ print "\033[36m[api]\033[0m    " $$0; fflush() }' ) & \
	( cd apps/portal && API_URL=http://localhost:$(API_PORT) NEXT_PUBLIC_API_URL=http://localhost:$(API_PORT) \
	  npx next dev --port $$port 2>&1 \
	  | awk '{ print "\033[35m[portal]\033[0m " $$0; fflush() }' ) & \
	wait

install: apps/api/node_modules apps/portal/node_modules ## Install npm dependencies (only when lockfiles change)

apps/api/node_modules: apps/api/package-lock.json
	cd apps/api && npm ci $(NPM_FLAGS)
	@touch $@

apps/portal/node_modules: apps/portal/package-lock.json
	cd apps/portal && npm ci $(NPM_FLAGS)
	@touch $@

apps/api/.env:
	cp apps/api/.env.example $@

db: ## Start Postgres in Docker and wait until it is healthy
	docker compose up -d --wait db

stop: ## Stop the Docker containers (data is kept)
	docker compose stop

test: apps/api/node_modules ## Run the API test suite
	cd apps/api && npm test

typecheck: install ## Typecheck the API and the portal
	cd apps/api && npm run typecheck
	cd apps/portal && npm run typecheck

build: install ## Production build of the API and the portal
	cd apps/api && npm run build
	cd apps/portal && API_URL=$${API_URL:-http://localhost:$(API_PORT)} npm run build
