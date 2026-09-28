#!/usr/bin/env bash
# Perf + visual harness stack: a production web build over an API on a large
# seeded database, on its own ports so it never touches the dev stack.
#
#   scripts/perf-stack.sh up     # drop/create atlas_perf, migrate, seed, build, start
#   scripts/perf-stack.sh down   # stop both servers (leaves the DB for inspection)
#   scripts/perf-stack.sh drop   # down + DROP DATABASE atlas_perf
#
# Then: PERF=1 PERF_BASE_URL=http://localhost:4700 PERF_LABEL=before \
#         pnpm exec playwright test -c playwright.perf.config.ts
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=atlas_perf
WEB_PORT=4700
API_PORT=4701
MCP_PORT=4710
DB_URL="postgres://atlas:atlas@localhost:5500/${DB}"
LOGS="$ROOT/e2e-logs/perf-stack"
psql() { docker exec atlas-postgres psql -U atlas -d postgres -qc "$1"; }

down() {
    # By port, not by name: the dev stack runs the same commands on other ports.
    for port in "$WEB_PORT" "$API_PORT" "$MCP_PORT"; do
        pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN || true)
        [ -n "$pids" ] && kill $pids 2>/dev/null || true
    done
    [ -f "$LOGS/pids" ] && xargs kill 2>/dev/null <"$LOGS/pids" || true
    rm -f "$LOGS/pids"
}

wait_for() {
    for _ in $(seq 1 120); do curl -sf -o /dev/null "$1" && return 0; sleep 0.5; done
    echo "timed out waiting for $1" >&2; exit 1
}

case "${1:-}" in
up)
    down
    mkdir -p "$LOGS"
    psql "DROP DATABASE IF EXISTS ${DB} WITH (FORCE);"
    psql "CREATE DATABASE ${DB};"
    (cd "$ROOT" && DATABASE_URL="$DB_URL" pnpm --filter @atlas/api exec tsx src/db/run-migrations.ts latest >/dev/null)
    (cd "$ROOT" && DATABASE_URL="$DB_URL" pnpm exec tsx e2e/fixtures/perf-seed.ts)
    (cd "$ROOT" && pnpm -F @atlas/web build >"$LOGS/build.log" 2>&1)
    # Plain tsx, not watch: an edit elsewhere must not restart it mid-measurement.
    (cd "$ROOT" && DATABASE_URL="$DB_URL" API_PORT=$API_PORT ATLAS_MCP_PORT=$MCP_PORT WEB_PORT=$WEB_PORT \
        ATLAS_AI_ENABLED=false ATLAS_MCP_TOKEN_OPEN=1 ATLAS_LOG_LEVEL=error ATLAS_REQUEST_LOG=false \
        ATLAS_CLAUDE_BINARY="$ROOT/e2e/fixtures/fake-claude.js" \
        nohup pnpm --filter @atlas/api start >"$LOGS/api.log" 2>&1 & echo $! >>"$LOGS/pids")
    (cd "$ROOT" && WEB_PORT=$WEB_PORT API_PROXY_TARGET="http://127.0.0.1:${API_PORT}" \
        nohup pnpm --filter @atlas/web exec vite preview --strictPort --host 127.0.0.1 --port $WEB_PORT \
        >"$LOGS/web.log" 2>&1 & echo $! >>"$LOGS/pids")
    wait_for "http://127.0.0.1:${API_PORT}/api/settings"
    wait_for "http://127.0.0.1:${WEB_PORT}/"
    echo "perf stack up: web http://localhost:${WEB_PORT}  api :${API_PORT}  db ${DB}"
    ;;
down) down ;;
drop) down; psql "DROP DATABASE IF EXISTS ${DB} WITH (FORCE);" ;;
*) echo "usage: $0 up|down|drop" >&2; exit 2 ;;
esac
