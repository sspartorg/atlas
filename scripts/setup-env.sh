#!/usr/bin/env bash
# scripts/setup-env.sh
#
# Project setup script for running Atlas inside Atlas.
# Invoked by Atlas's orchestrator after worktree provisioning.
#
# Strategy:
#   1. Verify Node and pnpm are on PATH (fail fast if either is missing).
#   2. Render .env at the worktree root. Walk every line of .env.example;
#      for each KEY=... line, emit the override value if the key is in
#      the OVERRIDES table, otherwise emit KEY= (empty string). Comments
#      and blank lines pass through unchanged. Override keys not present
#      in .env.example are appended at the bottom. The result is a fully
#      deterministic .env: every value comes from OVERRIDES or is empty,
#      never from a leftover .env.example default.
#   3. Install workspace dependencies via pnpm so the agent CLI can
#      build / test / run things in the worktree immediately.
#
# Secret-bearing values use ${variable.KEY} placeholders that Atlas
# substitutes before execution; unset keys produce setup_failed at
# substitution time, so set every referenced key in Settings -> Shared
# Secrets (or Project -> ENV Secrets) before dispatching.
#
# This script renders .env only. It does NOT render .env.prod.
#
# Contract reference: docs/setup-script-contract.md

set -euo pipefail
step() { printf '\n[setup] %s\n' "$*"; }

# -----------------------------------------------------------------------------
# Secret values bound inside single-quote literals so Atlas's substitution
# drops the value verbatim (no bash $-interpolation, no command expansion).
# Used to assemble the override table below.
# -----------------------------------------------------------------------------
PG_USER='${variable.POSTGRES_USER}'
PG_PASSWORD='${variable.POSTGRES_PASSWORD}'
MCP_TOKEN='${variable.ATLAS_MCP_TOKEN}'

# -----------------------------------------------------------------------------
# Per-key overrides applied on top of .env.example.
#
# Order is preserved for keys also present in .env.example (their original
# position in the file). Override keys NOT in .env.example are appended at
# the bottom in this declaration order.
# -----------------------------------------------------------------------------
OVERRIDES=(
  "POSTGRES_USER=${PG_USER}"
  "POSTGRES_PASSWORD=${PG_PASSWORD}"
  "DATABASE_URL=postgres://${PG_USER}:${PG_PASSWORD}@localhost:5500/atlas"
  "ATLAS_MCP_TOKEN=${MCP_TOKEN}"
  "ATLAS_AI_ENABLED=true"
  "ATLAS_LAN_ACCESS=true"
)
# -----------------------------------------------------------------------------

step "1/3 verifying tool versions"
node --version
pnpm --version

step "2/3 rendering .env from .env.example"
if [[ ! -f .env.example ]]; then
  echo "Error: .env.example not found in $(pwd)" >&2
  exit 1
fi

# Build .env by walking .env.example. For each KEY=... line, look up the
# key in OVERRIDES: if found, emit the override value; if not, default to
# empty string. Comments and blanks pass through. Track emitted keys so we
# can append any OVERRIDES entry whose key did not appear in .env.example.
EMITTED_KEYS=""
{
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
      KEY="${BASH_REMATCH[1]}"
      VALUE=""
      for KV in "${OVERRIDES[@]}"; do
        if [[ "${KV%%=*}" == "$KEY" ]]; then
          VALUE="${KV#*=}"
          break
        fi
      done
      printf '%s=%s\n' "$KEY" "$VALUE"
      EMITTED_KEYS="${EMITTED_KEYS} ${KEY}"
    else
      printf '%s\n' "$line"
    fi
  done < .env.example

  for KV in "${OVERRIDES[@]}"; do
    KEY="${KV%%=*}"
    case " ${EMITTED_KEYS} " in
      *" ${KEY} "*) ;;
      *) printf '%s\n' "$KV" ;;
    esac
  done
} > .env

chmod 600 .env

step "3/3 installing node dependencies"
pnpm install --frozen-lockfile

step "done - .env at $(pwd)/.env"
