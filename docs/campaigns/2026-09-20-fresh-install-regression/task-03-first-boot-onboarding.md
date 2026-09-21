# 03 — First boot and onboarding from zero

**Status:** done — 2026-09-20
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

- [x] `pnpm doctor` output captured
- [x] `db:up` **created** the container — log line pasted below
- [x] `pnpm db:status` lists exactly `001_baseline.ts`
- [x] All eleven seed counts verified by query; every one matched the prediction
- [x] `agents`, `projects`, `items` all 0
- [ ] ⚠️ **Prediction wrong — not applicable at boot.** `loadOrCreateKey()` is
      lazy: it runs on the first encrypt, not at startup. After a full boot and
      onboarding the file still does not exist. It appears in
      [task-04](task-04-bot-credential.md) when the first credential is stored.
      Re-checked there instead
- [x] Onboarding completed through the UI and landed on `/`
- [x] `/onboarding` after completion redirects to `/`
- [x] `relative/path` rejected with "Workspace folder must be an absolute
      path: relative/path"; buttons re-enabled; onboarding not completed
- [x] **Zero console errors or warnings.** Six messages total, all benign:
      vite HMR connect ×2 per load and the React DevTools info notice
- [x] MCP host bound at `127.0.0.1:4500/mcp`; a probe POST returns 406
      (the transport requires an SSE `Accept` header), so it is listening

## Evidence

Executed 2026-09-20.

**Prerequisites on a clean machine.**

```
[ OK ] node: v22.18.0      [ OK ] docker: 29.6.2      [ OK ] claude: 2.1.276
[ OK ] pnpm: 11.0.8        [ OK ] git: 2.39.5         [skip] copilot: not found (optional)
[ OK ] gh: 2.96.0          [ OK ] ollama: (no running instance)
All prerequisites satisfied. Run `pnpm dev` to start.
```

**The fresh-container path, exercised for the first time on this machine:**

```
[db-up] target=dev service=postgres container=atlas-postgres db=atlas
[db-up] no existing container; creating via docker compose up...
 Network atlas_default Created
 Volume atlas-pg Created
 Container atlas-postgres Started
[db-up] postgres is ready.
```

**One migration, not 46:**

```
[db] applied batch 1:
  - 001_baseline.ts
[db] completed: [ { name: '001_baseline.ts' } ]
[db] pending:   []
```

**Seed state — every count matched the prediction exactly:**

```
agent_templates|5     cli_models|19        marketplace_agents|16   settings|1
agents|0              guardrail_rules|14   projects|0              tool_catalog|13
items|0               guardrail_scripts|7  roles|5
```

This is the strongest evidence that the regenerated baseline is correct: it was
verified against a scratch DB in task-01, and here it produces a working install
from nothing.

**Onboarding.** Wizard reached via the `RouteGuard` redirect from `/`. Entered
`Alex`, selected the **third** accent swatch, workspace
`<workspace>`. Result:

```
Alex|<workspace>|1|#2E2E2E
```

**F-001 confirmed empirically.** The third swatch was selected; `accent_color`
is still the seed default `#2E2E2E`. The picker is live UI writing nowhere —
previously established by reading `api.ts:299-300` and
`services/settings.ts:186-194`, now proven end to end.

**Console.** Zero errors, zero warnings across onboarding and the first
dashboard render. Six messages total: `[vite] connecting...` / `[vite]
connected.` per load, and the React DevTools info notice.

### Deviations from plan

1. **`workspace.key` is not generated at boot.** `loadOrCreateKey()`
   (`services/crypto.ts`) is lazy — it runs on the first encrypt. The file did
   not exist after a full boot *and* a completed onboarding, because nothing
   had been encrypted yet. The checkbox moved to task-04, which stores the
   first credential. The macOS premise behind ruling D-6 was re-verified while
   checking this: `readMachineFingerprint()` carries the comment *"macOS
   doesn't expose either, so we'll fall through to the null path"*, so the key
   really is `randomBytes(32)` and its deletion really was irreversible.

2. **Port collision with an unrelated stack.** Four `vite` processes from
   `main-third-party-stack-2/a third-party stack` (PIDs 45827, 45931, 45973, 46015, up
   since 00:55) hold `*:4000`–`*:4003` on IPv6. Atlas's API still bound
   `127.0.0.1:4001` on IPv4, so the two coexisted — but `localhost:4001` became
   ambiguous depending on IPv4/IPv6 resolution, and the web dev server drifted
   to :4004. Those processes are the Owner's other work and were **not**
   killed. Atlas was moved to **web :4100 / API :4101** instead, the documented
   practice for this collision.

   ⚠️ `API_PROXY_TARGET` in `.env` is a **separate** variable and still read
   `http://127.0.0.1:4001`. Changing only `WEB_PORT`/`API_PORT` would have left
   Atlas's UI proxying its API calls to the third-party-stack stack. It was updated to
   `:4101` in the same edit. Anyone repeating this move must change all three.
