#!/usr/bin/env bash
# User-guide stack: a production web build over an API with REAL agent runs
# (ATLAS_AI_ENABLED=true, the real `claude` on PATH), on its own database,
# data dir and MCP port, so the screenshots in docs/guide/images never show the
# SIMULATED chip and never show the Owner's own projects.
#
#   scripts/guide-stack.sh up     # drop/create atlas_guide, migrate, seed, build, start
#   scripts/guide-stack.sh down   # stop the servers (leaves the DB and /tmp/atlas-guide)
#   scripts/guide-stack.sh drop   # down + DROP DATABASE atlas_guide + rm -rf /tmp/atlas-guide
#
# Then: pnpm guide:populate        (real runs — spends tokens)
#       pnpm guide:capture
#
# Web/API sit on 6010/6001 because that is where playwright.config.ts points,
# so the e2e suite and this stack cannot run at the same time.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=atlas_guide
WEB_PORT=6010
API_PORT=6001
# Not 4500: a real agent's `atlas` MCP calls must reach this API, never the dev one.
MCP_PORT=4720
DB_URL="postgres://atlas:atlas@localhost:5500/${DB}"
# Outside the repo on purpose: Claude Code walks up from its cwd for CLAUDE.md,
# and a worktree nested in this repo would hand every guide run Atlas's own rules.
DATA=/tmp/atlas-guide
LOGS="$DATA/logs"
psql() { docker exec atlas-postgres psql -U atlas -d postgres -qc "$1"; }

down() {
    for port in "$WEB_PORT" "$API_PORT" "$MCP_PORT"; do
        pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN || true)
        [ -n "$pids" ] && kill $pids 2>/dev/null || true
    done
    [ -f "$LOGS/pids" ] && xargs kill 2>/dev/null <"$LOGS/pids" || true
    rm -f "$LOGS/pids"
}

wait_for() {
    for _ in $(seq 1 240); do curl -sf -o /dev/null "$1" && return 0; sleep 0.5; done
    echo "timed out waiting for $1" >&2; exit 1
}

case "${1:-}" in
up)
    down
    (cd "$ROOT" && pnpm db:up >/dev/null && pnpm db:wait >/dev/null)
    rm -rf "$DATA"
    mkdir -p "$LOGS"
    psql "DROP DATABASE IF EXISTS ${DB} WITH (FORCE);"
    psql "CREATE DATABASE ${DB};"
    (cd "$ROOT" && DATABASE_URL="$DB_URL" pnpm --filter @atlas/api exec tsx src/db/run-migrations.ts latest >/dev/null)
    (cd "$ROOT" && DATABASE_URL="$DB_URL" GUIDE_DATA="$DATA" pnpm exec tsx e2e/fixtures/guide-seed.ts)
    (cd "$ROOT" && pnpm -F @atlas/web build >"$LOGS/build.log" 2>&1)
    # Every value the root .env would otherwise supply that could leak into the
    # guide or write outside $DATA is pinned here; dotenv never overrides these.
    # `exec` + </dev/null so no subshell is left holding the caller's stdout open.
    (cd "$ROOT" && exec env DATABASE_URL="$DB_URL" API_PORT=$API_PORT ATLAS_MCP_PORT=$MCP_PORT WEB_PORT=$WEB_PORT \
        ATLAS_AI_ENABLED=true ATLAS_MCP_TOKEN_OPEN=1 ATLAS_DATA_DIR="$DATA/keys" \
        ATLAS_LOG_FILE=off ATLAS_PTY_DUMP=false ATLAS_LOG_LEVEL=warn ATLAS_REQUEST_LOG=false \
        nohup pnpm --filter @atlas/api start >"$LOGS/api.log" 2>&1 </dev/null) & echo $! >>"$LOGS/pids"
    (cd "$ROOT" && exec env WEB_PORT=$WEB_PORT API_PROXY_TARGET="http://127.0.0.1:${API_PORT}" \
        nohup pnpm --filter @atlas/web exec vite preview --strictPort --host 127.0.0.1 --port $WEB_PORT \
        >"$LOGS/web.log" 2>&1 </dev/null) & echo $! >>"$LOGS/pids"
    wait_for "http://127.0.0.1:${API_PORT}/api/settings"
    wait_for "http://127.0.0.1:${WEB_PORT}/"
    echo "guide stack up: web http://localhost:${WEB_PORT}  api :${API_PORT}  db ${DB}  data ${DATA}"
    ;;
down) down ;;
drop) down; psql "DROP DATABASE IF EXISTS ${DB} WITH (FORCE);"; rm -rf "$DATA" ;;
*) echo "usage: $0 up|down|drop" >&2; exit 2 ;;
esac
