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

# A relocatable CPython so node-gyp (better-sqlite3 build) needs no system
# Python. Pinned release from astral-sh/python-build-standalone.
PY_VERSION := 3.12.13
PY_RELEASE := 20260728
PY_DIR := $(TOOL)/python
PY_BIN := $(PY_DIR)/bin
PYTHON := $(PY_BIN)/python3

CACHE := $(TOOL)/npm-cache
PM2_HOME := $(TOOL)/pm2
PM2 := $(ROOT)/node_modules/.bin/pm2
# A local $HOME so node-gyp (npm_config_python builds) and other tools keep
# their caches (.cache/node-gyp) inside the repo instead of /root or a user's
# home — the toolchain stays portable and needs nothing from a real home dir.
LOCAL_HOME := $(TOOL)/home

# Port the dashboard binds (kept in sync with ecosystem.config.cjs / .env);
# `make stop` uses it to detect a survivor pm2 could not kill.
DASHBOARD_PORT := $(shell grep '^DASHBOARD_PORT=' "$(ROOT)/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' )
ifeq ($(strip $(DASHBOARD_PORT)),)
DASHBOARD_PORT := 5311
endif

# Native modules (better-sqlite3) need a compiler newer than RHEL8's default
# g++ 8.x. Prefer, in order: a local install at /usr/local/gcc-<ver> (custom),
# Red Hat's gcc-toolset at /opt/rh/gcc-toolset-<N>, then whatever is on PATH.
# GCC 9+ builds the pinned better-sqlite3 (C++17); GCC 10+ is only needed for
# v11's C++20, which we avoid pinning.
GCC_CUSTOM := $(shell for d in /usr/local/gcc-*; do [ -x "$$d/bin/g++" ] && echo "$$d"; done 2>/dev/null | sort -V | tail -1)
GCC_TOOLSET_DIR := $(shell for d in /opt/rh/gcc-toolset-*; do [ -x "$$d/root/usr/bin/g++" ] && echo "$$d"; done 2>/dev/null | sort -V | tail -1)
ifneq ($(GCC_CUSTOM),)
$(info using custom gcc: $(GCC_CUSTOM))
export LD_LIBRARY_PATH := $(GCC_CUSTOM)/lib64:$(GCC_CUSTOM)/lib:$(LD_LIBRARY_PATH)
else ifneq ($(GCC_TOOLSET_DIR),)
$(info using gcc-toolset: $(GCC_TOOLSET_DIR))
export LD_LIBRARY_PATH := $(GCC_TOOLSET_DIR)/root/usr/lib64:$(LD_LIBRARY_PATH)
endif

# Inherited PATH can carry root-only entries (e.g. /root/.local/bin) or
# nonexistent dirs; neither is usable by a normal user on a company machine.
# Filter them out so the toolchain works without root.
CLEAN_PATH := $(shell echo "$$PATH" | tr ':' '\n' | grep -v '^/root' | while read -r p; do [ -d "$$p" ] && printf "%s:" "$$p"; done | sed 's/:$$//')

export HOME := $(LOCAL_HOME)
ifneq ($(GCC_CUSTOM),)
export PATH := $(GCC_CUSTOM)/bin:$(NODE_BIN):$(PY_BIN):$(CLEAN_PATH)
else ifneq ($(GCC_TOOLSET_DIR),)
export PATH := $(GCC_TOOLSET_DIR)/root/usr/bin:$(NODE_BIN):$(PY_BIN):$(CLEAN_PATH)
else
export PATH := $(NODE_BIN):$(PY_BIN):$(CLEAN_PATH)
endif
export npm_config_cache := $(CACHE)
export npm_config_python := $(PYTHON)
# Always install optional dependencies. Rollup ships its native binary as an
# optional dep, and on RHEL8 npm's libc detection can be wrong, skipping
# @rollup/rollup-linux-x64-gnu and breaking `vite build` with "Cannot find
# module". --include=optional forces them in regardless.
export npm_config_include := optional
# Force development so npm install/build never omit devDependencies. A company
# shell often exports NODE_ENV=production, which makes `npm install` skip all
# dev deps (react, vite, tsc) and the build then fails. Runtime NODE_ENV stays
# production via ecosystem.config.cjs.
export NODE_ENV := development
# Pin the platform so npm installs the right native optional deps (rollup's
# @rollup/rollup-linux-x64-gnu) even when npm's own detection is off — e.g. on
# RHEL8 where libc detection can be wrong and the build then fails with
# "Cannot find module @rollup/rollup-linux-x64-gnu". Only set for x86_64 glibc
# linux; other platforms (arm, musl) keep npm's default detection.
IS_LINUX_X64 := $(shell [ "$$(uname -s)" = Linux ] && [ "$$(uname -m)" = x86_64 ] && echo 1)
ifneq ($(IS_LINUX_X64),)
export npm_config_os := linux
export npm_config_cpu := x64
export npm_config_libc := $(shell ldd --version 2>/dev/null | grep -qi musl && echo musl || echo glibc)
endif
export PM2_HOME := $(PM2_HOME)

.DEFAULT_GOAL := help
.PHONY: help setup node python install build dev start stop restart status logs test lint typecheck format clean

help:
	@echo 'Disk Dashboard — portable toolchain'
	@echo ''
	@echo '  make setup       one-time: download local Node + Python, npm install, write .env'
	@echo '  make node        print the local Node/npm versions'
	@echo '  make python      print the local Python version'
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
	@mkdir -p "$(CACHE)" "$(PM2_HOME)" "$(LOCAL_HOME)"
	@echo '==> Local Node ready:'
	@"$(NODE)" --version

$(PY_BIN)/python3:
	@echo '==> Downloading CPython $(PY_VERSION) into $(TOOL) ...'
	@mkdir -p "$(TOOL)"
	@curl -fsSL "https://github.com/astral-sh/python-build-standalone/releases/download/$(PY_RELEASE)/cpython-$(PY_VERSION)%2B$(PY_RELEASE)-x86_64-unknown-linux-gnu-install_only.tar.gz" -o "$(TOOL)/python.tar.gz"
	@mkdir -p "$(PY_DIR)"
	@tar -xzf "$(TOOL)/python.tar.gz" -C "$(PY_DIR)" --strip-components=1
	@rm -f "$(TOOL)/python.tar.gz"
	@echo '==> Local Python ready:'
	@"$(PYTHON)" --version

setup: $(NODE_BIN)/node $(PY_BIN)/python3
	@echo '==> Checking C++17 support for native modules ...'
	@if ! echo 'int main(){return 0;}' | g++ -std=c++17 -x c++ - -o /dev/null 2>/dev/null; then \
		echo '   No usable g++ found. RHEL8 ships g++ 8.x which is too old; install'; \
		echo '   a newer compiler and re-run make setup:'; \
		echo '     dnf install gcc-toolset-13'; \
		echo '     (a login shell will put it on PATH via /etc/profile.d)'; \
		exit 1; \
	fi
	@echo '==> Installing dependencies with local npm (python: $(PYTHON)) ...'
	@"$(NPM)" install
	@echo '==> Ensuring rollup native binary is present ...'
	@if [ ! -f "$(ROOT)/node_modules/@rollup/rollup-linux-x64-gnu/rollup.linux-x64-gnu.node" ]; then \
		echo '   npm skipped @rollup/rollup-linux-x64-gnu — fetching the binary directly.'; \
		mkdir -p "$(TOOL)/rollup-gnu" && \
		curl -fsSL "https://registry.npmjs.org/@rollup/rollup-linux-x64-gnu/-/rollup-linux-x64-gnu-4.62.3.tgz" -o "$(TOOL)/rollup-gnu.tgz" && \
		tar -xzf "$(TOOL)/rollup-gnu.tgz" -C "$(TOOL)/rollup-gnu" && \
		mkdir -p "$(ROOT)/node_modules/@rollup/rollup-linux-x64-gnu" && \
		cp "$(TOOL)/rollup-gnu/package/package.json" "$(ROOT)/node_modules/@rollup/rollup-linux-x64-gnu/" && \
		cp "$(TOOL)/rollup-gnu/package/rollup.linux-x64-gnu.node" "$(ROOT)/node_modules/@rollup/rollup-linux-x64-gnu/" && \
		rm -f "$(TOOL)/rollup-gnu.tgz" && rm -rf "$(TOOL)/rollup-gnu" && \
		echo '   @rollup/rollup-linux-x64-gnu installed manually.'; \
	fi
	@if [ ! -f "$(ROOT)/node_modules/@rollup/rollup-linux-x64-gnu/rollup.linux-x64-gnu.node" ]; then \
		echo '   ERROR: could not fetch @rollup/rollup-linux-x64-gnu. Check network access to registry.npmjs.org.'; \
		exit 1; \
	fi
	@if [ ! -f "$(ROOT)/.env" ]; then \
		echo '==> Writing .env (relative to this repo) ...'; \
		SECRET=$$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'); \
		printf 'DASHBOARD_PORT=5311\nDASHBOARD_HOST=0.0.0.0\nDASHBOARD_WEB_DIR=web/dist\nDASHBOARD_ADMIN_DB=server/admin.db\nDASHBOARD_COOKIE_SECRET=%s\nDASHBOARD_LOG_LEVEL=info\n' "$$SECRET" > "$(ROOT)/.env"; \
		echo '   .env written with a random cookie secret.'; \
	else \
		echo '==> .env already exists — leaving it alone.'; \
	fi
	@echo '==> Setup complete. Run: make start'

# ── Toolchain info ──────────────────────────────────────────────────────────

node: $(NODE_BIN)/node
	@"$(NODE)" --version
	@"$(NPM)" --version

python: $(PY_BIN)/python3
	@"$(PYTHON)" --version

# ── Install ─────────────────────────────────────────────────────────────────

install: $(NODE_BIN)/node $(PY_BIN)/python3
	@"$(NPM)" ci

# ── Build / dev / test ──────────────────────────────────────────────────────

build: $(NODE_BIN)/node
	@echo '==> Building with NODE_ENV=production (dev React would double-mount and run slower) ...'
	# tsc does not delete outputs for sources that were removed, so stale .js from
	# deleted modules would otherwise survive every rebuild and get served.
	@rm -rf "$(ROOT)/server/dist" "$(ROOT)/web/dist"
	@bash -c 'ulimit -v unlimited 2>/dev/null || echo "  WARNING: cannot raise virtual-memory limit — WASM build may fail"; NODE_ENV=production "$(NPM)" run build'

dev: $(NODE_BIN)/node
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
	@echo '==> Stopping disk-dashboard ...'
	@"$(PM2)" stop disk-dashboard 2>/dev/null || true
	@sleep 2
	@# pm2's graceful stop waits on in-flight requests before its SIGKILL
	@# timeout, and an app orphaned by a dead pm2 daemon is invisible to pm2
	@# entirely. If the port is still listening after the graceful stop, force
	@# the exact process holding it down (never `pkill -f` the entrypoint path —
	@# that matches this very shell). ss needs no privileges to see LISTEN pids.
	@if ss -ltn 2>/dev/null | grep -qE ':$(DASHBOARD_PORT) '; then \
		echo "==> port $(DASHBOARD_PORT) still listening - force killing..."; \
		"$(PM2)" delete disk-dashboard 2>/dev/null || true; \
		PID=$$(ss -ltnp 2>/dev/null | sed -n "s/.*:$(DASHBOARD_PORT) .*pid=\([0-9]*\).*/\1/p" | head -1); \
		if [ -n "$$PID" ]; then kill -9 "$$PID" 2>/dev/null && echo "==> killed pid $$PID"; \
		else pkill -f 'server/dist/server/src/index[.]js' 2>/dev/null || true; fi; \
	fi
	@"$(PM2)" status || true

restart:
	@echo '==> Restarting (delete + start so .env changes are picked up) ...'
	@"$(PM2)" delete disk-dashboard 2>/dev/null || true
	@"$(PM2)" start "$(ROOT)/ecosystem.config.cjs"
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
