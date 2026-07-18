# Atlas Setup-Script Contract

> **Audience.** AI agents (Claude, Copilot, Codex, future) and human engineers who need to author the per-project setup script Atlas runs every time it provisions an agent worktree. Read this end-to-end before generating a script. The contract here is the *only* one Atlas's runner enforces — claims that contradict it will produce a broken script.
>
> **Source of truth.** Every behaviour in this document is verified against the code in `packages/api/src/services/project-setup-runner.ts` and `packages/api/src/services/secret-substitution.ts`. File:line citations appear inline so a reviewer (or an AI agent regenerating this doc) can spot-check any claim.

---

## Table of contents

1. [The contract in ten lines](#1-the-contract-in-ten-lines)
2. [Where the script lives](#2-where-the-script-lives)
3. [Execution environment](#3-execution-environment)
4. [Variable substitution: `${variable.KEY}`](#4-variable-substitution-variablekey)
5. [Secrets storage (two tiers)](#5-secrets-storage-two-tiers)
6. [Cross-platform parity rules](#6-cross-platform-parity-rules)
7. [Hard requirements (MUST)](#7-hard-requirements-must)
8. [Hard prohibitions (MUST NOT)](#8-hard-prohibitions-must-not)
9. [Authoring patterns](#9-authoring-patterns)
10. [Worked examples — five archetypes](#10-worked-examples--five-archetypes)
11. [Testing your setup script](#11-testing-your-setup-script)
12. [Troubleshooting](#12-troubleshooting)
13. [Quick reference card](#13-quick-reference-card)

---

## 1. The contract in ten lines

1. A Atlas project carries **two** setup-script bodies: one bash (`setup_sh_body`) and one PowerShell (`setup_ps1_body`). Either may be empty. (`packages/api/src/db/migrations/004_project_setup_scripts.ts`)
2. Atlas picks the script that matches the host platform — Windows runs `.ps1`, POSIX runs `.sh`. **No Git-Bash fallback on Windows.** (`project-setup-runner.ts:31-34, 83-88`)
3. The script runs **inside the worktree** that was just provisioned for the agent. `cwd = <project>/../worktrees/<projectId>/<branchSlug>`. (`project-setup-runner.ts:122`, `worktree-orchestrator.ts:189-193`)
4. Before the script is written to disk, every `${variable.KEY}` placeholder is **substituted** with the corresponding secret value. No other syntax is touched. (`secret-substitution.ts:25-33`)
5. Secrets resolve from a merged map: **global** `environment_secrets` overlaid by **per-project** `project_env_vars`. Project tier wins on key collision. (`secret-substitution.ts:35-47`)
6. An unresolved `${variable.KEY}` is fatal — the run finalises with `status = 'setup_failed'` and the CLI never spawns. (`project-setup-runner.ts:100-107`)
7. The script gets **5 minutes**. Configurable via the `ATLAS_SETUP_TIMEOUT_MS` env var on the API host. Stdout/stderr captured up to 8 MB. (`project-setup-runner.ts:47-48, 113`)
8. On failure the output is **redacted** — every secret value with length ≥ 4 is replaced with `***` before storage in `agent_runs.setup_output_text`. (`project-setup-runner.ts:49, 54-61`)
9. Secrets at rest are AES-256-GCM encrypted with a workspace key file under `%APPDATA%/Atlas/workspace.key` (Windows) or `~/.config/Atlas/workspace.key` (POSIX). (`crypto.ts:7, 12-24`)
10. The script must be **idempotent** — Atlas runs it every time a worktree is provisioned for an agent run, not just once at project creation.

That is the whole contract. Sections 2–9 describe each line in more depth. Sections 10–13 are operational.

---

## 2. Where the script lives

### UI

Project Detail page → **Setup** tab. Two text editors, one labelled "Bash (POSIX)" and one labelled "PowerShell (Windows)". Save persists via `PATCH /api/projects/:id` with the `setup_sh_body` / `setup_ps1_body` fields. (`packages/web/src/pages/project/SetupTab.tsx`)

### Database

Both bodies are columns on the `projects` table:

```text
projects.setup_sh_body   text NOT NULL DEFAULT ''
projects.setup_ps1_body  text NOT NULL DEFAULT ''
```

An empty body is a legitimate state — it means "no setup is required on this platform" and the runner short-circuits to `{ok: true}`. (`project-setup-runner.ts:90-92`)

---

## 3. Execution environment

The runner spawns one of:

| Host           | Command                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| `process.platform === 'win32'` | `powershell.exe -NoProfile -NonInteractive -File <tmpfile.ps1>` |
| every other platform           | `bash <tmpfile.sh>`                                              |

(`project-setup-runner.ts:114-117`)

### Working directory

The worktree root — the on-disk path computed as `<project.git_path>/../worktrees/<projectId>/<branchSlug>` and confirmed staged before the runner is called. The script may freely create files anywhere under this directory. (`project-setup-runner.ts:122`, `worktree-orchestrator.ts:189-193`)

### Environment variables visible to the script

The child receives `{ ...process.env }` — **the same env the API host process has**. Notably this means:

- The script can see system PATH, USER, HOME / USERPROFILE, etc.
- It can **not** read the resolved Atlas secrets from `process.env` — they are inlined into the script body by substitution, not exported. (`project-setup-runner.ts:21-26, 123`)
- `GIT_CONFIG_GLOBAL` may be set by the orchestrator for git auth; treat as read-only.

### Stdout / stderr capture

Combined buffer up to 8 MB. On failure, the buffer is masked (every secret value ≥ 4 chars replaced with `***`) and stored in `agent_runs.setup_output_text`. On success, output is discarded. (`project-setup-runner.ts:48-49, 54-61, 141-142`)

### Timeout

`ATLAS_SETUP_TIMEOUT_MS` env var on the API host; default `300_000` ms (5 minutes). Exceeding it sends SIGTERM and the runner finalises with `kind: 'timeout'`. (`project-setup-runner.ts:47, 113, 144-149`)

### Failure semantics

Four failure kinds the runner can emit:

| `kind`          | Cause                                                       | Stored as                  |
| --------------- | ----------------------------------------------------------- | -------------------------- |
| `unknown_secret`  | `${variable.KEY}` referenced a key not in either tier       | `setup_failed`             |
| `nonzero`         | Script exited with a non-zero exit code                     | `setup_failed` + exit code |
| `timeout`         | Script ran beyond the configured timeout                    | `setup_failed`             |
| `spawn_failed`    | Could not launch `powershell.exe` / `bash`                  | `setup_failed`             |

Any of the four sets `agent_runs.status = 'setup_failed'` and rolls the item back to `ready` so the owner can fix the script and re-dispatch immediately. The CLI **is never spawned** on a failed setup. (`project-setup-runner.ts:38-45, 142-158`)

---

## 4. Variable substitution: `${variable.KEY}`

### Exact syntax

```regex
\$\{variable\.([A-Za-z_][A-Za-z0-9_]*)\}
```

(`secret-substitution.ts:25`)

That is the only thing the runner replaces. Every other `$`-prefixed expression survives unchanged so PowerShell `$env:USERNAME`, bash `${HOME}`, here-strings, etc. work normally.

| Reference syntax        | Resolved?        | Outcome                                    |
| ----------------------- | ---------------- | ------------------------------------------ |
| `${variable.GITHUB_PAT}`  | yes              | inlined verbatim into script body          |
| `${variable.api_token}`   | yes (key allowed)| inlined verbatim                           |
| `${variable.}` (empty)    | no               | left literal — regex doesn't match          |
| `${GITHUB_PAT}`           | no               | left literal — wrong shape                  |
| `${env.GITHUB_PAT}`       | no               | left literal — wrong namespace              |
| `${secret.GITHUB_PAT}`    | no               | left literal — wrong namespace              |
| `$variable.GITHUB_PAT`    | no               | left literal — missing `{}`                 |

### Key shape

Keys match the shell-identifier shape `[A-Za-z_][A-Za-z0-9_]*`. Mixed case is **allowed**, but the convention everywhere in Atlas's UI is **UPPER_SNAKE_CASE**. Stick to UPPER_SNAKE in scripts you author. (`secret-substitution.ts:25`)

### Failure mode

A reference to an unset key throws `UnknownSecretError("Unknown secret: ${variable.KEY}")` and the runner returns `kind: 'unknown_secret'`. The item rolls back to `ready`. Fix: add the key to either the global registry or the project's secrets, then re-dispatch. (`secret-substitution.ts:18-23, 28-32`, `project-setup-runner.ts:100-107`)

### Substitution happens once, before disk write

The replaced body is what gets written to the tmpfile. Inside the script the values are **literal text**, not interpolations. That means a value containing characters significant to PowerShell or bash (`'`, `"`, `` ` ``, `$`, `;`) will be interpreted as code. **Quote your placeholders.** See `[Authoring patterns](#9-authoring-patterns)` for the safe-quote idiom.

---

## 5. Secrets storage (two tiers)

Atlas stores secrets in two places. The runner merges them at execution time and the merged map is what every `${variable.KEY}` resolves against.

### Tier 1 — Global (`environment_secrets`)

Workspace-wide. The same key/value is visible to every project. Used for credentials that belong to the *team*, not to one repo: organisation registry tokens, shared CI API keys, etc.

- Storage: `environment_secrets` table, columns `(id, key, value_encrypted, updated_at)` with a unique index on `key`. (`packages/api/src/db/migrations/005_environment_secrets_and_setup_runner.ts:26-34`)
- UI: **Settings → Shared Secrets** tab.
- API: `GET / PUT /api/environment-secrets` (`packages/api/src/services/environment-secrets.ts`)

### Tier 2 — Per-project (`project_env_vars`)

Scoped to one project. Used for credentials specific to a single repo: a repo-specific deploy key, a service principal for one product line, etc.

- Storage: `project_env_vars` (one row per key per project). (`packages/api/src/services/project-env-file.ts`)
- UI: **Project Detail → ENV Secrets** modal (`packages/web/src/pages/project/ProjectEnvSecretsModal.tsx`)
- API: `PUT /api/projects/:id/env`

### Merge order

```text
merged := {}
for (k, v) in environment_secrets:          merged[k] = v   # global first
for (k, v) in project_env_vars(projectId):  merged[k] = v   # project overwrites
```

**Project tier wins on key collision.** No UI warning today when a project key shadows a global one — silent shadowing is the model. (`secret-substitution.ts:35-47`)

### Encryption at rest

- Algorithm: AES-256-GCM (`packages/api/src/services/crypto.ts:7`).
- Key file: `%APPDATA%/Atlas/workspace.key` (Windows) or `~/.config/Atlas/workspace.key` (POSIX). Override via the `ATLAS_DATA_DIR` env var. (`crypto.ts:12-24`)
- Key derivation: HKDF-SHA256 over a machine fingerprint (Windows MachineGuid or POSIX `/etc/machine-id`), with random-key fallback when no stable fingerprint is available. (`crypto.ts:38-71, 113-118`)
- Filesystem ACL: `chmod 0o600` on POSIX, `icacls /inheritance:r /grant:r <user>:(R,W)` on Windows. (`crypto.ts:74-94`)

---

## 6. Cross-platform parity rules

Atlas stores **both** a `.sh` body and a `.ps1` body on every project, but at run time only one runs (the one matching the API host's OS). That gives you two obligations:

### 6.1 Achieve the same end-state on both

If the bash script leaves a `node_modules/` populated and an `.env` rendered, the PowerShell script must leave **exactly the same end-state** when run from a fresh worktree. An agent that depends on `.env` being present will break if the parity twin is missing.

### 6.2 PowerShell stays under PS 5.1 syntax

The Windows hosts in scope ship **Windows PowerShell 5.1** (`powershell.exe`), not PowerShell 7 (`pwsh.exe`). Two consequences:

- **No `&&` / `||` pipeline-chain operators.** Replace `A && B` with `A; if ($?) { B }`. Same for `||`.
- **No ternary (`?:`), no null-coalescing (`??`), no null-conditional (`?.`).** Use `if / else` and explicit `$null -eq` checks.

### 6.3 PowerShell stays ASCII-only

`powershell.exe` reads non-BOM UTF-8 as ANSI and parser-errors on em-dashes, curly quotes, smart arrows, the middle-dot character, and other typographic Unicode.

- Allowed: ASCII printable (`0x20–0x7E`), `\r\n`, `\n`.
- Disallowed in `.ps1` content: `—`, `–`, `'`, `'`, `"`, `"`, `→`, `…`, `·`, any non-ASCII whitespace.

The bash body has no such restriction — UTF-8 is fine in `.sh`.

### 6.4 Don't shell out to platform-only tools without a parity twin

If your bash uses `make`, your PowerShell needs `make` or an equivalent (`msbuild`, `dotnet`, a hand-rolled `Invoke-Build`, etc.). If your PowerShell uses `choco`, your bash needs a parity install path (`apt-get install -y`, `brew install`, a tarball download). No tool may appear in only one body.

---

## 7. Hard requirements (MUST)

A setup script that ships to a Atlas project **MUST**:

| #   | Requirement                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Be idempotent.** Atlas re-runs the script every time it provisions a worktree. Re-runs must reach the same end-state and exit zero whether the worktree was fresh or reused. |
| R2  | **Exit non-zero on any error.** Use `set -e` (bash) or `$ErrorActionPreference = 'Stop'` plus explicit `exit 1` on caught failures (PowerShell). A silent partial setup is worse than a loud failure. |
| R3  | **Use `${variable.KEY}` for every secret.** No hard-coded tokens, no `git config user.password=...` in plain text. The substitution is the *only* sanctioned channel for secrets. |
| R4  | **Print human-readable progress.** Each major step prefixed with a tag, e.g. `[setup] installing dependencies...`. The masked log is the reviewer's debug surface; make it readable. |
| R5  | **Stay inside the worktree.** Writes belong under `cwd`. No `cd` to other directories without `cd -` back. No edits to repo-level config outside the worktree. |
| R6  | **Quote your placeholders.** `${variable.GITHUB_PAT}` lands as literal text after substitution; if the value contains shell metacharacters and the placeholder is unquoted, the script breaks. PowerShell: wrap in single quotes when assigning to a variable, then use the variable. Bash: same. (See the patterns section for the exact idiom.) |
| R7  | **Tolerate flaky networks gracefully.** A failed `pnpm install` should retry once with a clean cache before exiting; a failed `apt-get` should `apt-get update` once before failing. |
| R8  | **Use PS 5.1-compatible syntax in `.ps1`** (no `&&`/`||`, no ternary, no null-coalescing) and **ASCII-only content**. See rules in [section 6](#6-cross-platform-parity-rules). |

---

## 8. Hard prohibitions (MUST NOT)

A setup script **MUST NOT**:

| #   | Prohibition                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **Prompt interactively.** No `Read-Host`, no `read -p`, no `Get-Credential`, no `apt-get install` without `-y`. The runner runs `-NonInteractive` and any prompt hangs until the timeout. |
| P2  | **Hard-code secrets.** A literal `Bearer abc123...` in the script is a leak. Always go through `${variable.KEY}`. |
| P3  | **Skip git hooks / signing.** No `--no-verify`, no `--no-gpg-sign`, no `core.hooksPath=/dev/null`. Hook policy is enforced separately and bypassing it in setup is out of scope. |
| P4  | **Modify global state.** No `git config --global`, no `npm config set` on `~/.npmrc`, no system-wide PATH edits, no registry writes on Windows. Worktree-local config only. |
| P5  | **Push, deploy, or send anything.** Setup is *preparation*, not delivery. No `git push`, no `npm publish`, no `curl` to webhooks, no `Send-MailMessage`. |
| P6  | **Spawn long-running services.** No `npm run dev &`, no `Start-Process` for a daemon that survives the script. The 5-minute clock applies to the whole script; if you start a server it will be killed when the runner returns. |
| P7  | **Read files outside the worktree** *unless* they are well-known package caches or registry config that the agent itself will rely on. No reaching into another project's worktree. |
| P8  | **Print secret values.** Even though the runner masks values ≥ 4 chars before storage, `echo $TOKEN` is brittle — short tokens won't be masked, and a `*** *** ***` log looks suspicious to a reviewer. Don't echo secrets at all. |
| P9  | **Use Unicode in `.ps1` content.** See [section 6.3](#63-powershell-stays-ascii-only). Use plain dashes, straight quotes, the word "arrow" instead of `→`. |
| P10 | **Assume the worktree was used before.** First run on a fresh clone and the hundredth re-run must take the same code path. Don't gate on file existence in a way that produces a different end-state. |

---

## 9. Authoring patterns

The patterns below are conventions, not strict requirements. Following them produces scripts that read consistently across projects.

### 9.1 Header block

Start every script with: shebang (bash), strict mode, and a one-line description.

```bash
#!/usr/bin/env bash
set -euo pipefail

# [setup] <project-name> — prepares the worktree for agent runs.
# - installs dependencies
# - renders .env from project secrets
# - applies database migrations against the worktree-local db
```

```powershell
# [setup] <project-name> - prepares the worktree for agent runs.
# - installs dependencies
# - renders .env from project secrets
# - applies database migrations against the worktree-local db

$ErrorActionPreference = 'Stop'
```

### 9.2 The `step` helper

A one-line wrapper that tags every progress message so the reviewer's log reads cleanly.

```bash
step() { printf '\n[setup] %s\n' "$*"; }

step "1/4 installing node dependencies"
pnpm install --frozen-lockfile
```

```powershell
function Step($msg) { Write-Host ("`n[setup] " + $msg) }

Step "1/4 installing node dependencies"
pnpm install --frozen-lockfile
if (-not $?) { exit 1 }
```

### 9.3 Secret handling

Assign the substituted value to a local variable inside single quotes, then use the variable. That way a value containing `'` or `$` is still a problem (the substitution is verbatim), but a value containing `"` or `` ` `` is harmless.

```bash
GITHUB_PAT='${variable.GITHUB_PAT}'
echo "machine github.com login token password $GITHUB_PAT" > "$HOME/.netrc"
chmod 600 "$HOME/.netrc"
```

```powershell
$GithubPat = '${variable.GITHUB_PAT}'
"machine github.com login token password $GithubPat" `
    | Out-File -FilePath "$env:USERPROFILE\.netrc" -Encoding ascii
```

> Caveat: if a secret value contains a literal `'`, you have to either escape it on the way in or use a here-string. For most tokens (PATs, API keys), only `[A-Za-z0-9_-]` characters appear, so the single-quote idiom is safe.

### 9.4 PS 5.1 pipeline-chain

Replace `&&` with `; if ($?) { ... }`:

```powershell
Step "running migrations"
pnpm db:migrate
if (-not $?) {
    Step "migrate failed; cleaning cache and retrying once"
    pnpm store prune
    pnpm db:migrate
    if (-not $?) { exit 1 }
}
```

### 9.5 Idempotent file rendering

When rendering `.env` or similar, write only when the content differs — avoids spurious file-system events:

```bash
desired=$(cat <<EOF
DATABASE_URL=${variable.DEV_DB_URL}
NODE_ENV=development
EOF
)
if [[ ! -f .env ]] || [[ "$(cat .env)" != "$desired" ]]; then
    printf '%s\n' "$desired" > .env
fi
```

```powershell
$desired = @"
DATABASE_URL=${variable.DEV_DB_URL}
NODE_ENV=development
"@
if (-not (Test-Path '.env') -or ((Get-Content '.env' -Raw) -ne $desired)) {
    Set-Content -Path '.env' -Value $desired -Encoding ascii
}
```

---

## 10. Worked examples — five archetypes

Every archetype shows the **.sh** and **.ps1** body side by side. Both bodies are complete — paste them into the Setup tab as-is and they will run.

### Archetype A — Node.js web app (pnpm + Postgres)

Most common shape. Cloned repo has a `package.json`, a `.env.example`, and a knex / prisma migration set.

**setup_sh_body**
```bash
#!/usr/bin/env bash
set -euo pipefail
step() { printf '\n[setup] %s\n' "$*"; }

step "1/4 verifying tool versions"
node --version
pnpm --version

step "2/4 installing node dependencies"
pnpm install --frozen-lockfile

step "3/4 rendering .env from project secrets"
cat > .env <<EOF
DATABASE_URL=${variable.DEV_DB_URL}
GITHUB_PAT=${variable.GITHUB_PAT}
LOG_LEVEL=info
EOF
chmod 600 .env

step "4/4 applying database migrations"
pnpm db:migrate

step "done"
```

**setup_ps1_body**
```powershell
# Atlas setup - Node.js web app
$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host ("`n[setup] " + $m) }

Step "1/4 verifying tool versions"
node --version
pnpm --version

Step "2/4 installing node dependencies"
pnpm install --frozen-lockfile
if (-not $?) { exit 1 }

Step "3/4 rendering .env from project secrets"
$envBody = @"
DATABASE_URL=${variable.DEV_DB_URL}
GITHUB_PAT=${variable.GITHUB_PAT}
LOG_LEVEL=info
"@
Set-Content -Path '.env' -Value $envBody -Encoding ascii

Step "4/4 applying database migrations"
pnpm db:migrate
if (-not $?) { exit 1 }

Step "done"
```

Required secrets: `DEV_DB_URL`, `GITHUB_PAT`.

---

### Archetype B — Python data pipeline (uv + DuckDB)

Cloned repo has `pyproject.toml`, an empty `data/` directory the pipeline writes into, and a smoke notebook.

**setup_sh_body**
```bash
#!/usr/bin/env bash
set -euo pipefail
step() { printf '\n[setup] %s\n' "$*"; }

step "1/4 verifying uv is installed"
uv --version

step "2/4 creating virtualenv and syncing dependencies"
uv venv
uv sync --frozen

step "3/4 rendering data-source credentials"
cat > .env <<EOF
SNOWFLAKE_USER=${variable.SNOWFLAKE_USER}
SNOWFLAKE_PASSWORD=${variable.SNOWFLAKE_PASSWORD}
SNOWFLAKE_ACCOUNT=${variable.SNOWFLAKE_ACCOUNT}
EOF
chmod 600 .env

step "4/4 ensuring data/ exists"
mkdir -p data

step "done"
```

**setup_ps1_body**
```powershell
# Atlas setup - Python data pipeline
$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host ("`n[setup] " + $m) }

Step "1/4 verifying uv is installed"
uv --version

Step "2/4 creating virtualenv and syncing dependencies"
uv venv
uv sync --frozen
if (-not $?) { exit 1 }

Step "3/4 rendering data-source credentials"
$envBody = @"
SNOWFLAKE_USER=${variable.SNOWFLAKE_USER}
SNOWFLAKE_PASSWORD=${variable.SNOWFLAKE_PASSWORD}
SNOWFLAKE_ACCOUNT=${variable.SNOWFLAKE_ACCOUNT}
"@
Set-Content -Path '.env' -Value $envBody -Encoding ascii

Step "4/4 ensuring data/ exists"
if (-not (Test-Path 'data')) { New-Item -ItemType Directory -Path 'data' | Out-Null }

Step "done"
```

Required secrets: `SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD`, `SNOWFLAKE_ACCOUNT`.

---

### Archetype C — .NET service (dotnet + EF migrations)

Cloned repo has a `.sln` at the worktree root and one project under `src/Service/`.

**setup_sh_body**
```bash
#!/usr/bin/env bash
set -euo pipefail
step() { printf '\n[setup] %s\n' "$*"; }

step "1/4 verifying dotnet is on PATH"
dotnet --version

step "2/4 restoring nuget packages"
dotnet restore

step "3/4 rendering appsettings.Development.json from secrets"
cat > src/Service/appsettings.Development.json <<EOF
{
  "ConnectionStrings": {
    "DefaultConnection": "${variable.DEV_DB_URL}"
  },
  "ApiKeys": {
    "Reporting": "${variable.REPORTING_API_KEY}"
  }
}
EOF

step "4/4 applying EF migrations"
dotnet ef database update --project src/Service

step "done"
```

**setup_ps1_body**
```powershell
# Atlas setup - .NET service
$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host ("`n[setup] " + $m) }

Step "1/4 verifying dotnet is on PATH"
dotnet --version

Step "2/4 restoring nuget packages"
dotnet restore
if (-not $?) { exit 1 }

Step "3/4 rendering appsettings.Development.json from secrets"
$cfg = @"
{
  "ConnectionStrings": {
    "DefaultConnection": "${variable.DEV_DB_URL}"
  },
  "ApiKeys": {
    "Reporting": "${variable.REPORTING_API_KEY}"
  }
}
"@
Set-Content -Path 'src/Service/appsettings.Development.json' -Value $cfg -Encoding ascii

Step "4/4 applying EF migrations"
dotnet ef database update --project src/Service
if (-not $?) { exit 1 }

Step "done"
```

Required secrets: `DEV_DB_URL`, `REPORTING_API_KEY`.

---

### Archetype D — Go CLI

Cloned repo has a `go.mod` at the root and a single `main` package.

**setup_sh_body**
```bash
#!/usr/bin/env bash
set -euo pipefail
step() { printf '\n[setup] %s\n' "$*"; }

step "1/3 verifying go toolchain"
go version

step "2/3 downloading modules"
go mod download

step "3/3 building binary into ./bin/cli"
mkdir -p bin
go build -o bin/cli ./...

step "done"
```

**setup_ps1_body**
```powershell
# Atlas setup - Go CLI
$ErrorActionPreference = 'Stop'
function Step($m) { Write-Host ("`n[setup] " + $m) }

Step "1/3 verifying go toolchain"
go version

Step "2/3 downloading modules"
go mod download
if (-not $?) { exit 1 }

Step "3/3 building binary into ./bin/cli.exe"
if (-not (Test-Path 'bin')) { New-Item -ItemType Directory -Path 'bin' | Out-Null }
go build -o bin/cli.exe ./...
if (-not $?) { exit 1 }

Step "done"
```

Required secrets: none. (A pure code-only CLI doesn't need credentials at build time.)

---

### Archetype E — Static site (no setup required)

The trivial case. Cloned repo is plain HTML/CSS/JS — nothing to install. Either leave both bodies empty (runner short-circuits to `{ok: true}`), or write a single-line affirmation so the run log shows the script *did* fire.

**setup_sh_body**
```bash
#!/usr/bin/env bash
echo "[setup] static site - no preparation required"
```

**setup_ps1_body**
```powershell
Write-Host "[setup] static site - no preparation required"
```

Required secrets: none.

---

## 11. Testing your setup script

There are three stages of testing. Run them in order.

### Stage 1 — Local syntax check (no Atlas involved)

Replace every `${variable.KEY}` with a dummy literal value and run the script directly. Catches shell syntax errors, missing tools on the host, and obvious sequencing bugs.

```bash
# bash
sed 's/\${variable\.DEV_DB_URL}/postgres:\/\/localhost\/dev/g' setup.sh > /tmp/dry.sh
bash /tmp/dry.sh
```

```powershell
# PowerShell - substitute by hand and source the body
$body = Get-Content setup.ps1 -Raw
$body = $body -replace '\$\{variable\.DEV_DB_URL\}', 'postgres://localhost/dev'
$body | Out-File -FilePath $env:TEMP\dry.ps1 -Encoding ascii
powershell.exe -NoProfile -NonInteractive -File $env:TEMP\dry.ps1
```

### Stage 2 — Atlas dry-run

Paste the bodies into the project's Setup tab. Set every referenced key in either tier (Settings → Shared Secrets for org-wide values, Project Detail → ENV Secrets for project-specific). Dispatch any agent at the project — even a no-op one. Atlas will run the setup before the CLI spawns and you can observe the lifecycle from the run-detail page.

### Stage 3 — Inspect the captured log

On any failure, `agent_runs.setup_output_text` carries the redacted output. Read it via:

- Run-detail page → **Output** panel (top section, before the CLI transcript).
- Or directly: `SELECT setup_output_text FROM agent_runs WHERE id = '<run-id>';`

Long-running secrets show as `***`; short values (< 4 chars) leak through, which is one more reason not to use short secret values.

---

## 12. Troubleshooting

| Symptom (status / kind)              | Likely cause                                                  | Fix                                                                                            |
| ------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `setup_failed` / `unknown_secret`     | Referenced `${variable.X}` with no key `X` in either tier      | Add the key, or fix a typo. Re-dispatch.                                                       |
| `setup_failed` / `unknown_secret`     | Used `${env.X}` or `${secret.X}` thinking it was substituted | Switch to `${variable.X}`. Only that prefix is honoured. (`secret-substitution.ts:25`)         |
| `setup_failed` / `nonzero` (exit 1)   | `set -e` tripped on a command that returned non-zero          | Read the redacted log; the last few lines name the failing command. Fix and re-dispatch.        |
| `setup_failed` / `nonzero` on PS only | Used `&&` or `||` in `.ps1`                                  | Replace with `; if ($?) { ... }`. See [section 6.2](#62-powershell-stays-under-ps-51-syntax). |
| `setup_failed` / `nonzero` on PS only | Em-dash / curly quote in `.ps1`                              | Strip all non-ASCII characters from the PS body. See [section 6.3](#63-powershell-stays-ascii-only). |
| `setup_failed` / `timeout`            | Script ran more than 5 minutes                                | Either raise `ATLAS_SETUP_TIMEOUT_MS` on the API host, or split the work (e.g., move a heavy compile into an in-tree cache the script populates lazily). |
| `setup_failed` / `spawn_failed`       | `powershell.exe` or `bash` not on PATH for the API process    | Install / repair the interpreter. PS 5.1 ships with Windows; bash on Windows requires Git-Bash or WSL on PATH. |
| Script runs interactively → hangs     | Used `Read-Host`, `Get-Credential`, or `apt-get` w/o `-y`     | Remove the prompt; supply defaults. Runner runs `-NonInteractive` and waits for the timeout. (`project-setup-runner.ts:115-116`) |
| Secret appears in plain text in log   | Secret value is shorter than 4 chars                          | Replace the short secret with a longer value. Short secrets are not masked. (`project-setup-runner.ts:49, 57`) |
| Long-running daemon dies              | Started a server in the script (e.g., `npm run dev &`)        | Don't. Setup is preparation. The agent itself launches services if it needs them.              |

---

## 13. Quick reference card

> **Print or pin this. Everything an AI agent needs to remember when generating a setup script.**

**Syntax**
- Only `${variable.KEY}` is substituted. No `${env.X}`, no `${secret.X}`, no bare `${X}`.
- Key shape: `[A-Za-z_][A-Za-z0-9_]*`. Convention: UPPER_SNAKE_CASE.

**Lifecycle**
- Bodies live on `projects.setup_sh_body` and `projects.setup_ps1_body`.
- Runner picks by OS. Windows = `.ps1`. Anything else = `.sh`.
- cwd = the worktree root. Timeout 5 min. Re-run on every worktree provisioning.

**Secrets**
- Global → `environment_secrets` (Settings → Shared Secrets).
- Project → `project_env_vars` (Project Detail → ENV Secrets).
- Project tier overrides global on key collision.

**MUST**
- Idempotent. Non-zero exit on any error. Quote your placeholders. Print progress. Stay inside the worktree.

**MUST NOT**
- Prompt interactively. Hard-code secrets. `--no-verify`. Modify global state. Push or deploy. Spawn long-running services. Print secret values. Use Unicode in `.ps1`. Use `&&` / `||` in `.ps1`.

**Self-check before submitting (AI agents: read this list back before answering)**
1. Are there exactly two bodies (`.sh` and `.ps1`)? Are they parity twins?
2. Is every secret referenced as `${variable.KEY}` with no other namespace?
3. Does the `.ps1` body contain only ASCII printable characters?
4. Does the `.ps1` body avoid `&&`, `||`, `??`, ternary `?:`?
5. Does every command-failure branch lead to `exit 1`?
6. Are there any interactive prompts? Any `apt-get` without `-y`?
7. If you re-run the script on the same worktree, does it still exit 0?
8. Did you print each step with a `[setup] ...` prefix?

If any answer is "no", revise before returning the script.

---

*Last verified against code: every behaviour citation in this document points to a file:line in `packages/api/src/services/` or `packages/api/src/db/migrations/`. If you find a divergence, the code wins — please file an issue with the citation that drifted.*
