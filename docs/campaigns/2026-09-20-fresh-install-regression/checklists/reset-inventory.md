# Reset inventory

The exact wipe list for [task-02](../task-02-factory-reset.md), split DROP /
KEEP so the reset is auditable before it runs rather than mourned after.

Captured from the live host on 2026-09-20. Re-capture before executing — if
the KEEP list no longer matches `docker ps -a` and `docker volume ls`, stop and
ask the Owner. A stale KEEP list is how unrelated data dies.

---

## Hard rule

> **`docker system prune` is forbidden in every form** — `-a`, `--volumes`, or
> bare. So is `docker volume prune`, `docker container prune` and
> `docker network prune`.

This host runs four unrelated stacks beside Atlas. A single
`docker system prune -a --volumes` destroys all of them, unrecoverably, and
nothing in this campaign is worth that. Every removal below names its target
explicitly. If a command in task-02 does not name what it is deleting, it is
the wrong command.

---

## DROP — Docker

| Resource | Kind | Note |
|---|---|---|
| `atlas-postgres` | container | up 47h at capture, `pgvector/pgvector:pg16`, host port 5500 |
| `atlas-postgres-prod` | container | **absent at capture** — remove only if `docker inspect` finds it |
| `atlas-pg` | volume | explicitly named in `docker-compose.yml`, so not compose-prefixed |
| `atlas-pg-prod` | volume | **absent at capture** — same rule |
| `atlas_default` | network | recreated by the next `docker compose up` |

`pgvector/pgvector:pg16` (640 MB) is **kept**. Re-pulling it buys nothing and
costs a download; the reset's point is fresh *data*, not a fresh image cache.

### Six databases die with the volume

The `atlas-pg` volume holds more than the dev database. All six go together,
and that is intended:

| Database | Size at capture | What it was |
|---|---|---|
| `atlas` | 17 MB | dev — `DATABASE_URL` |
| `atlas_e2e` | 12 MB | dropped and recreated by `e2e/global-setup.ts` anyway |
| `atlas_test` | 21 MB | vitest default |
| `atlas_test_a` | 14 MB | leftover parallel-test DB |
| `atlas_test_engine` | 22 MB | leftover |
| `atlas_wf_real` | 26 MB | leftover from Jira bridge live testing |

Nothing in any of them is needed. `atlas_test` and `atlas_e2e` rebuild on
first test run; the other three are abandoned.

---

## DROP — disk

| Path | What it is | Recoverable? |
|---|---|---|
| `~/.config/Atlas/workspace.key` | AES-256-GCM master key, 32 B, mode 0600, created 11 Aug | **No.** See the warning below. |
| `~/Work/workspace/atlas-sdlc-sandbox/` | the one cloned project | yes — re-clonable from its remote |
| `~/Work/workspace/worktrees/` | two repo-id directories of agent worktrees | **uncommitted work in them is not** |
| `~/Work/workspace/testing/` | scratch directory from earlier sessions | no, and nothing wants it |
| `logs/` | `atlas-api.log`, 168 KB | no, and it is a dev log |
| `.atlas-dump/` | ~70 PTY raw dumps, 6.8 MB | no |
| `e2e-logs/` | 18 MB of forensic runs | no — gitignored by design |
| `test-results/` | Playwright output | regenerated |
| `playwright-report/` | 780 KB | regenerated |
| `.playwright-mcp/` | 12 MB | regenerated |
| `packages/api/mcp-config.generated.json` | written at boot | regenerated |
| `$TMPDIR/atlas-setup-*.{sh,ps1}` | setup scripts with **decrypted secrets inlined** | no — and they should not exist |
| `$TMPDIR/<git-cred-tmpdir>*/config` | contain a live `AUTHORIZATION: basic` token header | no — and they should not exist |

Both `$TMPDIR` classes are orphans: Atlas unlinks them in a `finally` and
sweeps them at boot (`project-setup-runner.ts:175`). Any that survive are
evidence of a crash mid-run, and they carry live credentials. Task-02 counts
them before deleting and records the count — a non-zero number is a finding,
not just litter.

### ⚠️ `workspace.key` is a one-way door

`crypto.ts` derives the key from a machine fingerprint when the file is
missing — but only on Linux and Windows. **macOS has no readable machine ID,
so it falls through to random bytes.** Deleting this file on this host
permanently destroys the ability to decrypt:

- `credentials.token_encrypted` and `credentials.app_private_key_encrypted`
- every row in `environment_secrets` and `project_env_vars`
- `settings.external_notification_*` tokens

This is ruled acceptable (D-6) for exactly one reason: the database holding
all of that ciphertext is dropped in the same task. Deleting the key without
dropping the volume would strand the data instead of removing it, and
`settings.ts` would start throwing "workspace.key was regenerated" on every
`v1:`-prefixed blob.

**Before deleting, confirm the volume removal has already succeeded.** Order
matters: volume first, key second.

---

## KEEP — do not touch

### Docker — every one of these belongs to another project

| Resource | Kind |
|---|---|
| `dhequest1-postgres`, `dhequest1-redis`, `dhequest1-clickhouse`, `dhequest1-activemq` | containers |
| `dhequest2-postgres`, `dhequest2-redis`, `dhequest2-clickhouse`, `dhequest2-activemq` | containers |
| `dhequest-backup-clickhouse` | container (exited 7 weeks) |
| `neel-postgres` | container (exited 10 days) |
| `dhequest1_dhequest-postgres-data`, `dhequest1_dhequest-redis-data`, `dhequest1_dhequest-clickhouse-data`, `dhequest1_dhequest-activemq-data` | volumes |
| `dhequest2_dhequest-postgres-data`, `dhequest2_dhequest-redis-data`, `dhequest2_dhequest-clickhouse-data`, `dhequest2_dhequest-activemq-data` | volumes |
| `dhequest-backup_ch-backup-data`, `shopping-site_neel-pgdata` | volumes |
| `dhequest1_default`, `dhequest2_default`, `dhequest-backup_default`, `shopping-site_default`, `bridge`, `host`, `none` | networks |
| `postgres:16-alpine`, `redis:7-alpine`, `clickhouse/clickhouse-server:24-alpine`, `apache/activemq-classic:6.1.5`, `mcr.microsoft.com/powershell:lts-alpine-3.20`, `pgvector/pgvector:pg16` | images |

An exited container is not abandoned. `neel-postgres` and
`dhequest-backup-clickhouse` still own their volumes.

### Disk

| Path | Why |
|---|---|
| `~/Work/workspace/bots-info/` | holds `sspart-bot.pem` and `app-config.json` — task-04 reads them, and the PEM is not re-downloadable |
| `~/Work/workspace/bots-info.zip`, `~/Work/workspace/.DS_Store` | ruled out of the wipe; harmless |
| `.env`, `.env.prod` | the reset is of data, not configuration. Re-deriving from `.env.example` risks losing local edits |
| `node_modules/`, `packages/*/dist` | deleting them costs a long reinstall and proves nothing about a fresh *install of Atlas* |
| `~/.claude/projects/` | the Claude CLI's own transcripts, which `cli-transcript-ingest.ts` reads. Not Atlas's to delete |
| the git repo itself | obviously, but stated because `git clean -xdff` would take `.env` and `node_modules` with it |

---

## Verification

Task-02 is not done until this holds:

1. `docker ps -a --format '{{.Names}}'` before and after differ by **exactly**
   the dropped Atlas container names and nothing else. Diff the two captures.
2. `docker volume ls --format '{{.Name}}'` before and after differ by exactly
   `atlas-pg` (and `atlas-pg-prod` if it existed).
3. `docker images` is **unchanged** — no image was removed.
4. `ls ~/Work/workspace/` shows `bots-info`, `bots-info.zip`, `.DS_Store` and
   nothing else.
5. `ls ~/.config/Atlas/` is empty or absent.
6. `ls $TMPDIR/atlas-setup-* 2>/dev/null | wc -l` returns 0, and the
   pre-deletion count is recorded in the task's Evidence section.
7. `git status --porcelain` in the Atlas repo shows no deletion of a tracked
   file.
