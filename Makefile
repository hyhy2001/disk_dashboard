# Portable dashboard toolchain.
#
# Everything lives inside this repository: a local Node install under .tooling/,
# the npm cache under .tooling/npm-cache, and PM2's state under .tooling/pm2.
# Nothing is read from $HOME or /usr — move the folder to another machine and
# `make setup` brings the toolchain back.
#
#   make setup       one-time: download local Node, npm ci, install pm2, write .env
#   make node        print the local Node/npm versions
#   make install     npm ci (after setup)
#   make build       typecheck + build server & web
#   make dev         run the dev servers (Vite + tsx watch) in the foreground
#   make start       start the production server under local PM2
#   make stop        stop PM2
#   make restart     restart PM2
#   make status      PM2 status
#   make logs        tail PM2 logs
#   make test        vitest run
#   make lint        eslint
#   make typecheck   tsc --noEmit for server & web
#   make format      prettier write
#   make clean       remove tooling, node_modules, dist, logs, local DB

SHELL := /bin/bash

# Local toolchain paths — absolute, so `make` works regardless of cwd.
ROOT := $(abspath .)
TOOL := $(ROOT)/.tooling

NODE_VERSION := v22.22.2
NODE_DIR := $(TOOL)/node
NODE_BIN := $(NODE_DIR)/bin
NODE := $(NODE_BIN)/node
NPM := $(NODE_BIN)/npm
CACHE := $(TOOL)/npm-cache
PM2_HOME := $(TOOL)/pm2
PM2 := $(ROOT)/node_modules/.bin/pm2

export PATH := $(NODE_BIN):$(PATH)
export npm_config_cache := $(CACHE)
export PM2_HOME := $(PM2_HOME)

.DEFAULT_GOAL := help
.PHONY: help setup node install build dev start stop restart status logs test lint typecheck format clean

help:
	@echo 'Disk Dashboard — portable toolchain'
	@echo ''
	@echo '  make setup       one-time: download local Node, npm ci, install pm2, write .env'
	@echo '  make node        print the local Node/npm versions'
	@echo '  make install     npm ci (after setup)'
	@echo '  make build       typecheck + build server & web'
	@echo '  make dev         run dev servers in the foreground'
	@echo '  make start       start production server under local PM2'
	@echo '  make stop        stop PM2'
	@echo '  make restart     restart PM2'
	@echo '  make status      PM2 status'
	@echo '  make logs        tail PM2 logs'
	@echo '  make test        vitest run'
	@echo '  make lint        eslint'
	@echo '  make typecheck   tsc --noEmit'
	@echo '  make format      prettier write'
	@echo '  make clean       remove tooling, node_modules, dist, logs, local DB'

# ── One-time toolchain bootstrap ────────────────────────────────────────────

$(NODE_BIN)/node:
	@echo '==> Downloading Node $(NODE_VERSION) into $(TOOL) ...'
	@mkdir -p "$(TOOL)"
	@curl -fsSL "https://nodejs.org/dist/$(NODE_VERSION)/node-$(NODE_VERSION)-linux-x64.tar.xz" -o "$(TOOL)/node.tar.xz"
	@mkdir -p "$(NODE_DIR)"
	@tar -xJf "$(TOOL)/node.tar.xz" -C "$(NODE_DIR)" --strip-components=1
	@rm -f "$(TOOL)/node.tar.xz"
	@mkdir -p "$(CACHE)" "$(PM2_HOME)"
	@echo '==> Local Node ready:'
	@"$(NODE)" --version

setup: $(NODE_BIN)/node
	@echo '==> Installing dependencies with local npm (cache: $(CACHE)) ...'
	@"$(NPM)" install
	@if [ ! -f "$(ROOT)/.env" ]; then \
		echo '==> Writing .env (relative to this repo) ...'; \
		SECRET=$$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'); \
		printf 'DASHBOARD_PORT=5311\nDASHBOARD_HOST=127.0.0.1\nDASHBOARD_WEB_DIR=web/dist\nDASHBOARD_ADMIN_DB=server/admin.db\nDASHBOARD_COOKIE_SECRET=%s\nDASHBOARD_LOG_LEVEL=info\n' "$$SECRET" > "$(ROOT)/.env"; \
		echo '   .env written with a random cookie secret.'; \
	else \
		echo '==> .env already exists — leaving it alone.'; \
	fi
	@echo '==> Setup complete. Run: make start'

# ── Toolchain info ──────────────────────────────────────────────────────────

node: $(NODE_BIN)/node
	@"$(NODE)" --version
	@"$(NPM)" --version

# ── Install ─────────────────────────────────────────────────────────────────

install: $(NODE_BIN)/node
	@"$(NPM)" ci

# ── Build / dev / test ──────────────────────────────────────────────────────

build: $(NODE_BIN)/node
	@"$(NPM)" run build

dev: $(NODE_BIN)/node
	"$(NODE)" "$(ROOT)/node_modules/.bin/vitest" --version >/dev/null 2>&1; \
	@"$(NPM)" run dev

test: $(NODE_BIN)/node
	@"$(NPM)" test

lint: $(NODE_BIN)/node
	@"$(NPM)" run lint

typecheck: $(NODE_BIN)/node
	@"$(NPM)" run typecheck

format: $(NODE_BIN)/node
	@"$(NPM)" run format

# ── Production (local PM2) ──────────────────────────────────────────────────

start: build $(PM2)
	@echo '==> Starting disk-dashboard under local PM2 (PM2_HOME=$(PM2_HOME)) ...'
	@"$(PM2)" start "$(ROOT)/ecosystem.config.cjs"
	@"$(PM2)" save
	@"$(PM2)" status

stop:
	@"$(PM2)" stop disk-dashboard 2>/dev/null || true

restart:
	@"$(PM2)" restart disk-dashboard 2>/dev/null || { echo '==> not running — starting fresh'; "$(PM2)" start "$(ROOT)/ecosystem.config.cjs"; }
	@"$(PM2)" save

status:
	@"$(PM2)" status

logs:
	@"$(PM2)" logs disk-dashboard

# ── Cleanup ─────────────────────────────────────────────────────────────────

clean:
	@"$(PM2)" delete disk-dashboard 2>/dev/null || true
	rm -rf "$(TOOL)" "$(ROOT)/node_modules" "$(ROOT)/server/dist" "$(ROOT)/web/dist" "$(ROOT)/logs"
	rm -f "$(ROOT)/server/admin.db" "$(ROOT)/server/admin.db-shm" "$(ROOT)/server/admin.db-wal"
	@echo '==> Removed tooling, node_modules, dist, logs, and the local admin DB.'
	@echo '    Run `make setup` to rebuild the toolchain from scratch.'
