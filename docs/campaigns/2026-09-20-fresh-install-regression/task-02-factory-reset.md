# 02 — Factory reset, disk and Docker, Atlas-only

**Status:** done — 2026-09-20
**Depends on:** [task-01](task-01-migration-squash.md)
**Scope:** infra

## Why

Nobody on this machine has watched Atlas install from nothing.
`packages/api/src/scripts/db-up.ts` inspects `atlas-postgres` first and reuses a
running container, starts a stopped one, and only falls through to
`docker compose up -d postgres` when the container is absent — so `pnpm dev`
has never created one here. The first-boot path is untested, and so is the
key-generation path in `crypto.ts`, whose key file dates from 11 Aug.

This task removes every trace of Atlas's state and nothing else.

## What to do

Work from [`checklists/reset-inventory.md`](checklists/reset-inventory.md)
literally. It is the authority; this file is the procedure.

1. **Re-capture the live inventory and diff it against the checklist.**
   ```
   docker ps -a --format '{{.Names}}' | sort > /tmp/containers-before.txt
   docker volume ls --format '{{.Name}}' | sort > /tmp/volumes-before.txt
   docker network ls --format '{{.Name}}' | sort > /tmp/networks-before.txt
   docker images --format '{{.Repository}}:{{.Tag}}' | sort > /tmp/images-before.txt
   ```
   If anything in the checklist's KEEP list is missing, or anything unfamiliar
   has appeared, **stop and ask the Owner**. A stale KEEP list is how unrelated
   data dies.

2. **Stop the app.** Kill any running `pnpm dev`, and confirm ports 4000, 4001
   and 4500 are free: `lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(4000|4001|4500)'`
   returns nothing.

3. **Count the credential-bearing orphans before deleting them.**
   ```
   ls -1 "$TMPDIR"/atlas-setup-* 2>/dev/null | wc -l
   ```
   Record the number. It should be 0. A non-zero count means a run crashed
   leaving a file with **decrypted secrets inlined**, and that is a P1 finding
   for [findings.md](findings.md), not just litter. Do the same sweep for
   orphaned git-config temp directories, which carry a live
   `AUTHORIZATION: basic` header.

4. **Remove the Atlas containers, by name.** Never by prune.
   ```
   docker rm -f atlas-postgres
   docker inspect atlas-postgres-prod >/dev/null 2>&1 && docker rm -f atlas-postgres-prod
   ```

5. **Remove the Atlas volumes, by name.**
   ```
   docker volume rm atlas-pg
   docker volume ls --format '{{.Name}}' | grep -qx atlas-pg-prod && docker volume rm atlas-pg-prod
   ```
   This is where the six databases die together — `atlas`, `atlas_e2e`,
   `atlas_test`, `atlas_test_a`, `atlas_test_engine`, `atlas_wf_real`.

6. **Remove the Atlas network.** `docker network rm atlas_default`. It is
   recreated by the next compose up.

7. **Delete the master key — after step 5 has succeeded, not before.**
   ```
   rm ~/.config/Atlas/workspace.key
   ```
   ⚠️ Irreversible on macOS. `crypto.ts` derives from a machine fingerprint
   only on Linux and Windows; here it falls through to random bytes. This is
   safe **only** because the ciphertext it protected died with the volume.
   Deleting it first would strand the data instead of removing it.

8. **Delete the workspace contents**, keeping `bots-info`:
   ```
   rm -rf ~/Work/workspace/atlas-sdlc-sandbox ~/Work/workspace/worktrees ~/Work/workspace/testing
   ```
   Then `ls ~/Work/workspace/` and confirm only `bots-info`, `bots-info.zip`
   and `.DS_Store` remain.

9. **Delete the repo-local scratch**:
   `logs/`, `.atlas-dump/`, `e2e-logs/`, `test-results/`, `playwright-report/`,
   `.playwright-mcp/`, `packages/api/mcp-config.generated.json`.
   Keep `e2e-logs/README.md` and the `findings-template.md` scaffold if
   `.gitignore` tracks them — check `git status` afterwards.

10. **Delete the `$TMPDIR` orphans** counted in step 3.

11. **Re-capture and diff.** Produce `/tmp/containers-after.txt` and the three
    siblings, and diff each against its `-before` twin.

## Done when

- [x] Container diff shows only `atlas-postgres`
- [x] Volume diff shows only `atlas-pg`; `atlas-pg-prod` never existed
- [x] Image diff is empty — no image removed
- [x] All 10 non-Atlas containers and all 10 non-Atlas volumes still present
- [x] `ls -A ~/Work/workspace/` shows only `bots-info`, `bots-info.zip`, `.DS_Store`
- [x] `~/.config/Atlas/` is empty
- [x] 0 orphans, and the pre-deletion count was also 0
- [x] `git status --porcelain` is clean
- [x] No atlas-named container or volume remains
- [x] No prune of any kind was run — every removal named its target

## Evidence

Executed 2026-09-20.

Orphan `atlas-setup-*` count before deletion: **0**
Orphan git-config temp dir count before deletion: **0**

Both zero, so no crashed run had left decrypted secrets or a live token on
disk. Nothing to file.

**Docker diffs.** Before/after captures of containers, volumes, networks and
images:

```
=== CONTAINER DIFF ===       === VOLUME DIFF ===
1d0                          1d0
< atlas-postgres              < atlas-pg

=== NETWORK DIFF ===         === IMAGE DIFF (must be empty) ===
1d0                          IMAGES UNCHANGED
< atlas_default
```

Exactly three resources removed, each by explicit name. 10 containers and 10
volumes remain, all non-Atlas:
`third-party-stack-1-*` (4), `third-party-stack-2-*` (4), `third-party-backup-clickhouse`,
`another-project-postgres`, and their volumes plus `another project's volume`.

`atlas-postgres-prod` and `atlas-pg-prod` did not exist, so the conditional
branches were no-ops.

**Six databases died with the volume**, as intended: `atlas`, `atlas_e2e`,
`atlas_test`, `atlas_test_a`, `atlas_test_engine`, `atlas_wf_real`.

**Key deletion ordering held.** The volume removal was confirmed gone before
`rm ~/.config/Atlas/workspace.key` ran, so no ciphertext was stranded. The
directory is now empty; `crypto.ts` will generate a fresh key on first boot —
a path this machine has not exercised since 11 Aug.

**Preserved.** `~/Work/workspace/bots-info/` intact, PEM mode 0600 and
unmodified:

```
PEM sha256: 3d9dab455e6fd15f79e11a38571b37de6119e8cae9d33c346e553bbe1ceb34aa
```

That checksum is the baseline for [task-04](task-04-bot-credential.md)'s final
check. `.env` and `.env.prod` untouched; `node_modules/` untouched.

**Repo scratch removed** (33.3 MB): `logs/` 200K, `.atlas-dump/` 3.3M,
`e2e-logs/` 18M, `test-results/` 12K, `playwright-report/` 780K,
`.playwright-mcp/` 12M, plus `packages/api/mcp-config.generated.json`.
`git ls-files` confirmed none held a tracked file before deletion, and
`git status --porcelain` is clean after.
