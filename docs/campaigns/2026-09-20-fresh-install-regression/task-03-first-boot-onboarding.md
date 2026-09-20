# 03 — First boot and onboarding from zero

**Status:** todo
**Depends on:** [task-02](task-02-factory-reset.md)
**Scope:** infra

## Why

This is the moment the campaign exists for: the first time on this machine
that `pnpm dev` has to *create* a Postgres container rather than reuse one,
generate a `workspace.key` rather than read one, and run a brand-new baseline
against an empty database. Every one of those paths is untested here.

It is also the first real check on [task-01](task-01-migration-squash.md) — a
baseline that dumps cleanly can still fail to boot an app.

## What to do

1. **Confirm the starting state is actually empty.** `docker ps -a | grep atlas`
   returns nothing, `docker volume ls | grep atlas` returns nothing,
   `ls ~/.config/Atlas/` is absent. If not, task-02 did not finish.

2. **Run `pnpm doctor` first.** `packages/api/src/scripts/check-prereqs.ts`
   exists to catch a missing docker, node or git before the chain starts.
   Record what it reports on a clean machine — this is the output a new
   adopter sees.

3. **Boot.** `pnpm dev` runs `db:up && db:wait && db:migrate && pnpm --parallel -r dev`.
   Watch each stage:
   - `db:up` must fall through to `docker compose up -d postgres` and **create**
     `atlas-postgres`. If it reports reusing a container, the reset was
     incomplete.
   - `db:wait` polls until `pg_isready`.
   - `db:migrate` applies **one** migration. Confirm with
     `pnpm db:status` — exactly `001_baseline.ts`, not 46 rows.
   - The API's own `bootStep('migration', migrateLatest)` runs it again as
     belt-and-braces and must be a no-op.

4. **Watch the boot log for the sequence** in `packages/api/src/main.ts`:
   migration → seed → orphan sweeps → `syncToolCatalog` → `syncAgentDefaults` →
   db ping → `buildApp` → scheduler → MCP host on 4500. Any step that throws is
   a P0 finding.

5. **Check what the seed created, and what it refused to.** `runSeed` syncs the
   on-disk marketplace catalog into `marketplace_agents` and explicitly never
   creates `agents` rows. Expected on a fresh DB:

   | Table | Expected | Source |
   |---|---|---|
   | `roles` | 5 | baseline |
   | `cli_models` | 19 | baseline (16) + what was 029 (3) |
   | `guardrail_rules` | 14 | baseline |
   | `guardrail_scripts` | 7 | `seed.ts::seedGuardrailScripts` |
   | `agent_templates` | 5 | `seed.ts::seedAgentTemplates` |
   | `tool_catalog` | 13 | `syncToolCatalog` at boot |
   | `marketplace_agents` | 16 | `seed.ts::syncMarketplaceCatalog` |
   | `agents` | **0** | never auto-created |
   | `projects`, `items` | **0** | — |

   A mismatch here means the baseline lost reference data — go back to
   task-01 step 3.

6. **Confirm the key was generated.** `ls -l ~/.config/Atlas/workspace.key`
   shows a fresh 32-byte file, mode 0600, with today's date.

7. **Onboard through the browser**, not the API. Open `http://localhost:4000`
   and confirm `RouteGuard` (`App.tsx:215`) redirects every path to
   `/onboarding`. Then:
   - Step 1: display name and accent colour. Test that Enter advances.
   - Step 2: workspace folder. Point it at `~/Work/workspace`, which now
     contains only `bots-info`.
   - Finish. `POST /api/settings/onboard` creates the folder recursively
     **before** the DB write (`services/settings.ts:164`), sets `owner_name`,
     `workspace_path` and `onboarding_complete = 1`.
   - The success view holds ~5 s while it prefetches the dashboard, then
     redirects to `/`.

8. **Test the guard both ways.** After onboarding, navigating to `/onboarding`
   must redirect to `/`. Before onboarding it was the only exempt route.

9. **Capture the console.** Keep DevTools open from first paint. Any error or
   warning on the onboarding wizard or the first dashboard render is a finding
   — this is a new adopter's first impression.

10. **Record the negative cases** rather than skipping them: a relative
    workspace path and an uncreatable folder must both return
    `400 validation_error` with "Could not create workspace folder …" shown as
    the submit error, and onboarding must **not** be marked complete.

## Done when

- [ ] `pnpm doctor` output on a clean machine is pasted
- [ ] `db:up` created the container — paste the line proving it was not reused
- [ ] `pnpm db:status` lists exactly one applied migration — paste it
- [ ] The nine-row seed table above is verified by query — paste the counts
- [ ] `agents`, `projects` and `items` are all 0
- [ ] `ls -l ~/.config/Atlas/workspace.key` shows a file created today
- [ ] Onboarding completes through the UI and lands on `/`
- [ ] `/onboarding` after completion redirects to `/`
- [ ] A relative workspace path is rejected with the documented error and
      leaves `onboarding_complete` false
- [ ] **Zero console errors** from first paint through the first dashboard
      render — or each one filed in [findings.md](findings.md)
- [ ] MCP host is listening on 4500 — `curl -s http://127.0.0.1:4500/mcp`
      responds

## Evidence

*(filled during execution)*
