#!/usr/bin/env bash
# scripts/bootstrap.sh - one-command macOS / Linux installer for the Atlas repo.
#
# The bash sibling of scripts/bootstrap.ps1. Same steps, same order, same
# end state: tools installed, .env + .env.prod created, ATLAS_MCP_TOKEN
# generated, pnpm install, Postgres up + migrated, `atlas` registered with
# Claude Code CLI (and Copilot CLI), then `pnpm doctor`.
#
#   bash scripts/bootstrap.sh [--skip-optional-clis] [--non-interactive] [--dry-run]
#
# Supported: macOS (Homebrew), Debian/Ubuntu (apt), Fedora/RHEL (dnf),
# Arch (pacman). Anything else prints the manual steps and exits 1.
#
# Idempotent: every step checks first and says "keep" when there is nothing
# to do, so re-running on a configured machine changes nothing. The only
# commands that always run are `pnpm db:up / db:wait / db:migrate` and
# `pnpm doctor`, which are no-ops on a machine that is already up.
#
# Why this does NOT call scripts/setup-env.sh: that script is the
# Atlas-inside-Atlas project setup hook. Its values are `${variable.KEY}`
# placeholders the orchestrator substitutes before running it, and it blanks
# every key it does not override. Run by hand it would write the literal text
# `${variable.POSTGRES_USER}` into .env. bootstrap.ps1 copies the *.example
# files as-is and lets docker-compose's `${POSTGRES_USER:-atlas}` defaults
# apply; this script does exactly the same.
#
# Constraints: macOS still ships bash 3.2, so no associative arrays, no
# mapfile, no ${var,,}. Every command that changes the machine goes through
# `run` / `run_sh`, which is what makes --dry-run honest (and testable - see
# packages/api/tests/bootstrap-sh.test.ts).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Test seam: the Debian/Fedora/Arch branches are chosen from os-release, and a
# test cannot write /etc/os-release. Nothing else reads this variable.
OS_RELEASE_FILE="${ATLAS_BOOTSTRAP_OS_RELEASE:-/etc/os-release}"
MCP_URL='http://127.0.0.1:4500/mcp'
# Byte-for-byte the JSON bootstrap.ps1 passes to `claude mcp add-json`.
MCP_ADD_JSON='{"url":"http://127.0.0.1:4500/mcp"}'

DRY_RUN=0
NON_INTERACTIVE=0
SKIP_OPTIONAL=0
STEP=0
TOTAL=14
STEP_NAME='startup'
PLATFORM=''
PM=''
APT_UPDATED=0
DOCKER_GROUP_ADDED=0
# Set when this run installs a tool, so --dry-run can plan the steps that
# depend on it (registration needs claude) even though it is not really there.
PLANNED_CLAUDE=0
PLANNED_COPILOT=0

usage() {
    cat <<'EOF'
Usage: bash scripts/bootstrap.sh [options]

One-command install for Atlas on macOS and Linux. Installs Git, Node >= 20,
pnpm >= 9, Docker (+ compose), and optionally gh, the GitHub Copilot CLI
extension and Claude Code CLI; creates .env / .env.prod; generates
ATLAS_MCP_TOKEN; runs pnpm install; starts and migrates Postgres; registers
the atlas MCP server; finishes with pnpm doctor.

Options:
  --skip-optional-clis  Skip gh / Copilot / Claude Code CLI installs.
  --non-interactive     Take the default for every prompt (install missing
                        tools, keep existing ones and files).
  --dry-run             Print every command that would change the machine,
                        change nothing.
  -h, --help            Show this help.

Safe to re-run: finished steps report "keep".
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-optional-clis) SKIP_OPTIONAL=1 ;;
        --non-interactive) NON_INTERACTIVE=1 ;;
        --dry-run) DRY_RUN=1 ;;
        -h | --help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

# -----------------------------------------------------------------------------
# Output helpers
# -----------------------------------------------------------------------------

step() {
    STEP=$((STEP + 1))
    STEP_NAME="$1"
    printf '\n=== [%d/%d] %s ===\n' "$STEP" "$TOTAL" "$1"
}
info() { printf '[bootstrap] %s\n' "$*"; }
keep() { printf '[bootstrap] keep: %s\n' "$*"; }
warn() { printf '[bootstrap] WARNING: %s\n' "$*" >&2; }
die() { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

on_exit() {
    local code=$?
    if [ "$code" -ne 0 ] && [ "$STEP" -gt 0 ]; then
        printf '\n[bootstrap] Step %d/%d (%s) failed with exit code %d.\n' "$STEP" "$TOTAL" "$STEP_NAME" "$code" >&2
        printf '[bootstrap] Fix the error above, then re-run:  bash scripts/bootstrap.sh\n' >&2
        printf '[bootstrap] Finished steps are detected and kept, so it resumes where it stopped.\n' >&2
    fi
}
trap on_exit EXIT

# Every machine-changing command goes through one of these two.
run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[dry-run] %s\n' "$*"
    else
        printf '[bootstrap] $ %s\n' "$*"
        "$@"
    fi
}
# For the few installers that are a pipeline (curl ... | sh).
run_sh() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[dry-run] %s\n' "$1"
    else
        printf '[bootstrap] $ %s\n' "$1"
        bash -c "$1"
    fi
}

as_root() {
    if [ "$(id -u)" -eq 0 ]; then run "$@"; else run sudo "$@"; fi
}
root_prefix() {
    if [ "$(id -u)" -eq 0 ]; then printf ''; else printf 'sudo '; fi
}

# ask_yn "question" Y|N -> exit 0 for yes. Non-interactive, or no terminal on
# stdin (curl | bash), takes the default.
ask_yn() {
    local prompt="$1" default="$2" answer=''
    if [ "$NON_INTERACTIVE" -eq 1 ] || [ ! -t 0 ]; then
        info "$prompt [auto: $default]"
    else
        read -r -p "[bootstrap] $prompt [$default] " answer || answer=''
    fi
    [ -n "$answer" ] || answer="$default"
    case "$answer" in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}

have() { command -v "$1" >/dev/null 2>&1; }
first_line() { "$@" 2>/dev/null | head -n 1 || true; }
# "v22.3.0" / "9.12.1" / "git version 2.43.0" -> 22 / 9 / 2
major_of() { printf '%s' "$1" | sed -E 's/[^0-9]*([0-9]+).*/\1/'; }

# -----------------------------------------------------------------------------
# Platform
# -----------------------------------------------------------------------------

manual_steps() {
    STEP=0 # not a resumable failure; skip the "re-run" hint
    cat >&2 <<'EOF'
[bootstrap] This platform is not supported by the one-command installer.
[bootstrap] Install these by hand, then run the repo steps below:
  - Git
  - Node.js >= 20 (https://nodejs.org or fnm/nvm)
  - pnpm >= 9     (corepack enable pnpm)
  - Docker Engine + Compose v2 (https://docs.docker.com/engine/install/)
  - optional: gh, Claude Code CLI (npm install -g @anthropic-ai/claude-code)
Then, from the repo root:
  cp .env.example .env && cp .env.prod.example .env.prod
  pnpm install && pnpm db:up && pnpm db:wait && pnpm db:migrate
  claude mcp add-json atlas --scope user '{"url":"http://127.0.0.1:4500/mcp"}'
  pnpm doctor
EOF
}

detect_platform() {
    step 'Detect platform'
    case "$(uname -s)" in
        Darwin)
            PLATFORM='macOS'
            PM='brew'
            ensure_brew
            ;;
        Linux)
            local id='' like=''
            if [ -r "$OS_RELEASE_FILE" ]; then
                id="$(sed -n 's/^ID=//p' "$OS_RELEASE_FILE" | tr -d '"')"
                like="$(sed -n 's/^ID_LIKE=//p' "$OS_RELEASE_FILE" | tr -d '"')"
            fi
            case " $id $like " in
                *" debian "* | *" ubuntu "*) PLATFORM="Linux ($id)"; PM='apt' ;;
                *" fedora "* | *" rhel "* | *" centos "*) PLATFORM="Linux ($id)"; PM='dnf' ;;
                *" arch "*) PLATFORM="Linux ($id)"; PM='pacman' ;;
                *) manual_steps; die "unsupported Linux distribution '${id:-unknown}'." ;;
            esac
            ;;
        *)
            manual_steps
            die "unsupported OS '$(uname -s)'."
            ;;
    esac
    info "Platform: $PLATFORM, package manager: $PM"
}

ensure_brew() {
    if have brew; then
        keep "Homebrew $(first_line brew --version | sed 's/^Homebrew //')"
        return
    fi
    ask_yn 'Homebrew is not installed and every other install uses it. Install Homebrew now?' Y ||
        die 'Homebrew is required on macOS. Install it from https://brew.sh and re-run.'
    # shellcheck disable=SC2016 # expanded by the inner bash, on purpose
    run_sh 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    # The installer does not touch this shell's PATH. Not in --dry-run: an
    # existing brew found here would leak its whole bin dir into the plan.
    [ "$DRY_RUN" -eq 1 ] && return
    local b
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
        if [ -x "$b" ]; then eval "$("$b" shellenv)"; break; fi
    done
    have brew || die 'brew is still not on PATH after install. Open a new terminal and re-run.'
}

pkg_install() {
    case "$PM" in
        brew) run brew install "$@" ;;
        apt)
            if [ "$APT_UPDATED" -eq 0 ]; then as_root apt-get update; APT_UPDATED=1; fi
            as_root apt-get install -y "$@"
            ;;
        dnf) as_root dnf install -y "$@" ;;
        pacman) as_root pacman -S --needed --noconfirm "$@" ;;
    esac
}

# NodeSource and get.docker.com are curl | sh installers; minimal images
# (and some server installs) ship without curl.
need_curl() { have curl || pkg_install curl ca-certificates; }

# Installs into the directory owning `probe_dir` need sudo only when it is not
# ours: /usr (NodeSource, distro node) yes; Homebrew, fnm, nvm no.
maybe_root() {
    local probe_dir="$1"
    shift
    if [ -w "$probe_dir" ]; then run "$@"; else as_root "$@"; fi
}

# -----------------------------------------------------------------------------
# Core tools (minimums match packages/api/src/scripts/check-prereqs.ts)
# -----------------------------------------------------------------------------

ensure_git() {
    step 'Git'
    if have git; then keep "$(first_line git --version)"; return; fi
    pkg_install git
}

ensure_node() {
    step 'Node.js (>= 20)'
    if have node; then
        local v
        v="$(first_line node --version)"
        if [ "$(major_of "$v")" -ge 20 ] 2>/dev/null; then keep "node $v"; return; fi
        warn "node $v is older than the required 20; installing a current release."
    fi
    local p
    p="$(root_prefix)"
    case "$PM" in
        brew) pkg_install node ;;
        apt)
            need_curl
            run_sh "curl -fsSL https://deb.nodesource.com/setup_22.x | ${p}bash -"
            pkg_install nodejs
            ;;
        dnf)
            need_curl
            run_sh "curl -fsSL https://rpm.nodesource.com/setup_22.x | ${p}bash -"
            pkg_install nodejs
            ;;
        pacman) pkg_install nodejs npm ;;
    esac
    [ "$DRY_RUN" -eq 1 ] || have node || die 'node is not on PATH after install. Open a new terminal and re-run.'
}

ensure_pnpm() {
    step 'pnpm (>= 9)'
    if have pnpm; then
        local v
        v="$(first_line pnpm --version)"
        if [ "$(major_of "$v")" -ge 9 ] 2>/dev/null; then keep "pnpm $v"; return; fi
        warn "pnpm $v is older than the required 9; enabling the repo-pinned version via corepack."
    fi
    case "$PM" in
        # Arch splits corepack out of nodejs but packages pnpm itself.
        pacman) pkg_install pnpm ;;
        # Homebrew's prefix is the user's; no sudo.
        brew) run corepack enable pnpm ;;
        # corepack ships with Node and installs its known-good pnpm (>= 9 on
        # Node 20+). Writes shims next to node, which NodeSource puts in /usr.
        *)
            local dir='/usr/bin'
            if have node; then dir="$(dirname "$(command -v node)")"; fi
            maybe_root "$dir" corepack enable pnpm
            ;;
    esac
    [ "$DRY_RUN" -eq 1 ] || have pnpm || die 'pnpm is not on PATH after corepack enable. Run: npm install -g pnpm'
}

docker_up() { docker info >/dev/null 2>&1; }

ensure_docker() {
    if [ "$PLATFORM" = 'macOS' ]; then step 'Docker Desktop'; else step 'Docker Engine + Compose'; fi
    if have docker; then
        keep "$(first_line docker --version)"
    else
        case "$PM" in
            brew) run brew install --cask docker ;;
            apt | dnf) need_curl; run_sh "curl -fsSL https://get.docker.com | $(root_prefix)sh" ;;
            pacman) pkg_install docker docker-compose ;;
        esac
        if [ "$PLATFORM" != 'macOS' ]; then
            as_root systemctl enable --now docker
        fi
        if [ "$PLATFORM" != 'macOS' ] && [ "$(id -u)" -ne 0 ]; then
            as_root usermod -aG docker "${USER:-$(id -un)}"
            DOCKER_GROUP_ADDED=1
            info "Added ${USER:-you} to the docker group. It takes effect at your next login (or run: newgrp docker)."
        fi
    fi

    [ "$DRY_RUN" -eq 1 ] && ! have docker && return
    if ! docker compose version >/dev/null 2>&1; then
        [ "$DRY_RUN" -eq 1 ] && { warn 'docker compose v2 not found (would fail here).'; return; }
        die 'docker compose v2 is missing. Install the compose plugin: https://docs.docker.com/compose/install/linux/'
    fi

    if docker_up; then keep 'Docker engine is running'; return; fi
    if [ "$PLATFORM" = 'macOS' ]; then
        run open -a Docker
    else
        as_root systemctl start docker
    fi
    [ "$DRY_RUN" -eq 1 ] && return
    # Fresh docker group membership only applies to new login sessions, so a
    # daemon that root can reach but we cannot will not fix itself by waiting.
    if [ "$PLATFORM" != 'macOS' ] && ! docker_up && sudo -n docker info >/dev/null 2>&1; then
        die 'Docker runs, but this user cannot reach it yet. Run: newgrp docker (or log out and in), then re-run.'
    fi
    info 'Waiting up to 120 s for the Docker engine ...'
    local i=0
    while [ "$i" -lt 60 ]; do
        docker_up && { info 'Docker engine is responsive.'; return; }
        sleep 2
        i=$((i + 1))
    done
    die 'Docker engine did not come up. Start Docker (Desktop) by hand, then re-run.'
}

# -----------------------------------------------------------------------------
# Optional CLIs
# -----------------------------------------------------------------------------

ensure_gh() {
    step 'GitHub CLI (gh) - optional'
    if [ "$SKIP_OPTIONAL" -eq 1 ]; then info 'skipped (--skip-optional-clis)'; return; fi
    if have gh; then keep "$(first_line gh --version)"; return; fi
    ask_yn 'Install GitHub CLI (gh)? Useful for PAT helpers and the Copilot extension.' Y ||
        { info 'skipped by choice'; return; }
    case "$PM" in
        pacman) pkg_install github-cli ;;
        *) pkg_install gh ;;
    esac
}

has_copilot_ext() { have gh && gh extension list 2>/dev/null | grep -q 'github/gh-copilot'; }

ensure_copilot() {
    step 'GitHub Copilot CLI (gh extension) - optional'
    if [ "$SKIP_OPTIONAL" -eq 1 ]; then info 'skipped (--skip-optional-clis)'; return; fi
    if has_copilot_ext; then keep 'gh-copilot extension'; return; fi
    if ! have gh && [ "$DRY_RUN" -eq 0 ]; then info 'gh is not installed; skipping.'; return; fi
    ask_yn 'Install the GitHub Copilot CLI extension? Needs gh auth login afterwards.' Y ||
        { info 'skipped by choice'; return; }
    if [ "$DRY_RUN" -eq 1 ]; then
        run gh extension install github/gh-copilot
        PLANNED_COPILOT=1
        return
    fi
    gh auth status >/dev/null 2>&1 || warn 'gh is not signed in; the install may fail. Run gh auth login and re-run if so.'
    run gh extension install github/gh-copilot || warn 'gh extension install failed (continuing). Re-run after gh auth login.'
}

ensure_claude() {
    step 'Claude Code CLI (claude) - optional'
    if [ "$SKIP_OPTIONAL" -eq 1 ]; then info 'skipped (--skip-optional-clis)'; return; fi
    if have claude; then keep "claude $(first_line claude --version)"; return; fi
    ask_yn 'Install Claude Code CLI? Needed only for live agent runs (ATLAS_AI_ENABLED=true).' Y ||
        { info 'skipped by choice'; return; }
    # Homebrew's npm prefix is the user's; NodeSource's is /usr and needs sudo.
    local prefix='/usr'
    if [ "$PM" = 'brew' ]; then prefix="$HOME"; fi
    if have npm; then prefix="$(npm prefix -g 2>/dev/null || echo "$prefix")"; fi
    maybe_root "$prefix" npm install -g @anthropic-ai/claude-code
    PLANNED_CLAUDE=1
}

# -----------------------------------------------------------------------------
# Repo setup
# -----------------------------------------------------------------------------

ensure_env_files() {
    step 'Env files (.env, .env.prod)'
    # Both, always: the dev and prod stacks coexist and each reads its own.
    local pair example target
    for pair in '.env.example:.env' '.env.prod.example:.env.prod'; do
        example="${pair%%:*}"
        target="${pair#*:}"
        [ -f "$example" ] || die "missing $example at the repo root."
        if [ -f "$target" ]; then keep "$target already exists"; continue; fi
        run cp "$example" "$target"
        run chmod 600 "$target"
    done
}

# 48 random bytes, base64url without padding - the same shape bootstrap.ps1
# and the API's own boot-time generator produce.
new_token() {
    if have openssl; then
        openssl rand -base64 48
    else
        head -c 48 /dev/urandom | base64
    fi | tr -d '\n=' | tr '+/' '-_'
}

ensure_mcp_token() {
    step 'ATLAS_MCP_TOKEN'
    local target file
    for target in .env .env.prod; do
        file="$target"
        if [ ! -f "$file" ]; then
            # Only reachable in --dry-run, where step 9 printed the copy.
            [ "$DRY_RUN" -eq 1 ] && printf '[dry-run] generate ATLAS_MCP_TOKEN into %s\n' "$target"
            continue
        fi
        if grep -Eq '^ATLAS_MCP_TOKEN=[^[:space:]]+' "$file"; then
            keep "$target already has ATLAS_MCP_TOKEN"
            continue
        fi
        ask_yn "ATLAS_MCP_TOKEN is empty in $target. Generate a random token?" Y ||
            { info "skipped for $target"; continue; }
        if [ "$DRY_RUN" -eq 1 ]; then
            printf '[dry-run] generate ATLAS_MCP_TOKEN into %s\n' "$target"
            continue
        fi
        local token tmp
        token="$(new_token)"
        tmp="$(mktemp "$file.XXXXXX")"
        # Replace the (empty) line in place, or append one; keep the mode.
        awk -v t="$token" '
            /^ATLAS_MCP_TOKEN=/ { print "ATLAS_MCP_TOKEN=" t; done = 1; next }
            { print }
            END { if (!done) print "ATLAS_MCP_TOKEN=" t }
        ' "$file" >"$tmp"
        chmod 600 "$tmp"
        mv "$tmp" "$file"
        info "Generated ATLAS_MCP_TOKEN in $target."
    done
}

ensure_pnpm_install() {
    step 'pnpm install'
    if [ -d node_modules ] &&
        ! ask_yn 'node_modules exists. Refresh it with pnpm install?' N; then
        keep 'existing node_modules'
        return
    fi
    run pnpm install
}

ensure_database() {
    step 'Database (Postgres via Docker Compose)'
    # Each is a no-op when the container is up and migrations are applied.
    run pnpm db:up
    run pnpm db:wait
    run pnpm db:migrate
}

# Adds mcpServers.atlas = {type: http, url} to a JSON config file unless an
# entry is already there. An existing, different entry is kept: it is the
# Owner's, and bootstrap.ps1 defaults that prompt to Keep as well.
merge_mcp_json() {
    local path="$1" label="$2"
    if [ -f "$path" ] && grep -q '"atlas"' "$path"; then
        keep "atlas already in $label"
        return
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[dry-run] add mcpServers.atlas {"type":"http","url":"%s"} to %s\n' "$MCP_URL" "$path"
        return
    fi
    mkdir -p "$(dirname "$path")"
    node -e '
        const fs = require("fs");
        const [path, url] = process.argv.slice(1);
        const cfg = fs.existsSync(path) && fs.readFileSync(path, "utf8").trim()
            ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers.atlas = { type: "http", url };
        fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
    ' "$path" "$MCP_URL"
    info "Added atlas to $label."
}

ensure_mcp_clients() {
    step 'MCP client registration'
    if have claude || [ "$PLANNED_CLAUDE" -eq 1 ]; then
        if have claude && claude mcp get atlas >/dev/null 2>&1; then
            keep 'atlas already registered with Claude Code CLI'
        elif ! run claude mcp add-json atlas --scope user "$MCP_ADD_JSON"; then
            warn 'claude mcp add-json failed; writing ~/.claude.json directly.'
            merge_mcp_json "$HOME/.claude.json" "$HOME/.claude.json"
        fi
    else
        info 'claude not installed; skipping Claude Code CLI registration.'
    fi

    if has_copilot_ext || [ "$PLANNED_COPILOT" -eq 1 ]; then
        merge_mcp_json "$HOME/.copilot/mcp-config.json" 'GitHub Copilot CLI config'
    else
        info 'gh-copilot extension not installed; skipping Copilot CLI config.'
    fi
}

run_doctor() {
    step 'Verify (pnpm doctor)'
    run pnpm doctor
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

cd "$REPO_ROOT"
info "Repo root: $REPO_ROOT"
[ "$DRY_RUN" -eq 1 ] && info 'DRY RUN: printing commands, changing nothing.'
[ "$NON_INTERACTIVE" -eq 1 ] && info 'NON-INTERACTIVE: every prompt takes its default.'
[ "$SKIP_OPTIONAL" -eq 1 ] && info 'Skipping optional CLIs (gh / Copilot / Claude).'

detect_platform
ensure_git
ensure_node
ensure_pnpm
ensure_docker
ensure_gh
ensure_copilot
ensure_claude
ensure_env_files
ensure_mcp_token
ensure_pnpm_install
ensure_database
ensure_mcp_clients
run_doctor

printf '\n=== Bootstrap complete ===\n'
[ "$DRY_RUN" -eq 1 ] && info 'Dry run: nothing was changed.'
cat <<'EOF'
Next:

    pnpm dev

Then open http://localhost:4000
API: http://localhost:4001   MCP: http://localhost:4500/mcp   Postgres: localhost:5500

For live agent runs, sign in to the CLIs that need a browser:
    claude login         # Anthropic
    gh auth login        # GitHub (also unlocks gh copilot)
Optional: Ollama (https://ollama.com) enables the free local `ollama` CLI option.
EOF
if [ "$DOCKER_GROUP_ADDED" -eq 1 ]; then
    info 'You were added to the docker group: log out and back in before pnpm dev.'
fi
