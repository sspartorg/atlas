# 02 — Factory reset, disk and Docker, Atlas-only

**Status:** todo
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

- [ ] `diff /tmp/containers-before.txt /tmp/containers-after.txt` shows **only**
      the removed Atlas container names — paste the diff
- [ ] `diff /tmp/volumes-before.txt /tmp/volumes-after.txt` shows only
      `atlas-pg` (and `atlas-pg-prod` if it existed) — paste it
- [ ] `diff /tmp/images-before.txt /tmp/images-after.txt` is **empty** — no
      image was removed
- [ ] Every `dhequest*`, `shopping-site*` and `neel-postgres` container and
      volume is still present — paste `docker ps -a` and `docker volume ls`
- [ ] `ls ~/Work/workspace/` shows only `bots-info`, `bots-info.zip`, `.DS_Store`
- [ ] `ls ~/.config/Atlas/` is empty or the directory is absent
- [ ] `ls -1 "$TMPDIR"/atlas-setup-* 2>/dev/null | wc -l` returns 0, and the
      pre-deletion count is recorded below
- [ ] `git status --porcelain` shows no tracked file deleted
- [ ] `docker ps -a | grep atlas` returns nothing
- [ ] No `docker system prune`, `volume prune`, `container prune` or
      `network prune` appears anywhere in this task's shell history

## Evidence

*(filled during execution)*

Orphan `atlas-setup-*` count before deletion: ____
Orphan git-config temp dir count before deletion: ____
