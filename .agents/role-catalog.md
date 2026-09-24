# Role catalog (A08)

The **SDLC role catalog** is the canonical list of roles an agent can play in Atlas's software-delivery chain. It's the single source of truth for:

- What "role" labels are valid on an agent (`agent.role_id` is a foreign key into `roles.id`).
- The curated starter prompt for each role (the `default_prompt_md` + `default_reviewer_prompt_md` columns).
- The default activation policy: which roles ship enabled vs. disabled on a fresh install.

## Eleven slugs in the type; ten rows in the DB

> **2026-09-24 update.** Migration `012_sdlc_roles_backfill.ts` seeds
> `tester`, `devops`, `security`, `designer` and the new `docs`, so ten of the
> eleven slugs now have a row and can be assigned. Only `spec-writer` remains
> type-only, deliberately: its job was folded into Architect, and seeding a row
> for a role with no agent would invite someone to wire it back up.
>
> **2026-09-12 correction (historical).** The `SdlcRole` union and `SDLC_ROLES` in
> `@atlas/shared` declared all ten slugs below, but the shipped baseline seeded
> only **five** `roles` rows — `po`, `architect`, `engineer`, `qa`,
> `automation` (the five performer agents that have curated prompts).
> `spec-writer`, `tester`, `devops`, `security` and `designer` are type-level
> only. This doc previously claimed migration 025 seeded all ten; it does not.
>
> `agents.role_id` is an FK into `roles`, so assigning one of the five
> type-only slugs used to fail with a raw `agents_role_id_fkey` 500.
> `agentsService.create` / `update` now call `assertRoleInCatalog` and return
> `400 ROLE_NOT_IN_CATALOG` naming the five that exist — same shape as
> `assertModelInRegistry` for `(cli, model)`. Adding one of the missing five
> for real means a migration plus a curated `default_prompt_md`; it is not a
> seed-data oversight to paper over.

## The 10 slugs

| `id` | Label | Seeded? | Default status | Notes |
|---|---|---|---|---|
| `po` | Product Owner | yes | active | PO Writer — brainstorm-before-scope; splits a Task into `dev` sub-tasks (each with exactly one layer label `be`/`fe`/`fullstack`) plus a `[QA]` twin and a `[DOC]` twin. Paired PO Reviewer agent checks them (`delivery` workflow). |
| `spec-writer` | Specification Writer | **no** | — | Type-only. Removed from the chain; Architect now authors the spec. |
| `engineer` | Engineer | yes | active | Coder — one dev sub-task at a time. Paired Code Reviewer agent (`build` sub-workflow; the Task's `delivery` run opens the one PR at End). Also **Fix Reviewer** — checks *how* each gate fixer made its gate green, on all four gate fail paths in `delivery` v4. The Release Reviewer also files the fix sub-tasks its own rejections need. |
| `qa` | Quality Assurance | yes | active | QA Writer — test-plan CSV per `[QA]` sub-task. Paired QA Reviewer agent (`test` sub-workflow). |
| `architect` | Software Architect | yes | active | Architect — authors one `specs/<n>-<slug>/spec.md` for the whole Task (saved to its `spec_md`) ahead of Coder (absorbed Spec Writer). Paired Architect Reviewer agent (`delivery` workflow). |
| `tester` | Exploratory Tester | yes | active | Coverage Fixer — writes the tests that close the gap `gate-coverage` measured, and the gate ratchets the floor up behind it (`delivery` v4). No exploratory-testing agent ships. |
| `automation` | Automation Engineer | yes | active | Automates `[automation-yes]` QA cases on the Task's branch. Paired Automation Reviewer agent (`test` sub-workflow, after QA Reviewer). |
| `devops` | DevOps Engineer | yes | active | Performance Fixer — brings the touched routes back under budget after `gate-perf` (`delivery` v4). |
| `security` | Security Review Lead | yes | active | Hygiene Fixer — lint, types, format, knip, secrets, dependency advisories and debug residue after `gate-hygiene` (`delivery` v4). |
| `designer` | UX/Visual Designer | yes | active | Visual Reviewer — reads the screens `gate-visual` captured, fixes overflow/contrast/theme, blesses a new baseline (`delivery` v4). |
| `docs` | Technical Writer | yes | active | Doc Writer — documents one `[DOC]` sub-task from the branch diff. Paired Doc Reviewer agent (`docs` sub-workflow). |

The slug `id` doubles as the canonical reference everywhere in the codebase — `SdlcRole` in `@atlas/shared`, the `agents.role_id` FK target, the URL param of `PATCH /api/roles/:id`. Adding a role means a migration + a shared-type bump; the runtime never invents roles on its own.

## Disable-by-default policy

The catalog enforces the disable-by-default rule at **seed time only**. Migration 025 seeds the `roles.default_status` column according to the table above; agents are no longer seeded at all — the 10 SDLC agents (5 performers + 5 paired reviewers) come from the marketplace catalog and ship `active` on install. New agents created via API/MCP that get assigned a role inherit no status from the catalog — they default to `'active'` like every other agent, and the Owner can flip them after creation.

The policy is a curation signal, not a runtime guard. The Owner can flip `agents.status` freely; A08 never re-disables a runtime-enabled agent.

## Storage model

`roles` table (created in migration `025_sdlc_role_catalog.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | The slug, e.g. `'engineer'`. |
| `label` | TEXT NOT NULL | Display string used by the Role filter chip + AgentCard subtitle fallback. |
| `description` | TEXT NOT NULL DEFAULT `''` | One-liner shown on the (future) Roles admin page. |
| `default_prompt_md` | TEXT NOT NULL DEFAULT `''` | Curated performer prompt. Owner edits via `PATCH /api/roles/:id`. |
| ~~`default_reviewer_prompt_md`~~ | — | **This column does not exist and never has** (corrected 2026-09-24, when migration 012 failed on it with `42703`). The reviewer persona lives in the paired reviewer agent's own catalog bundle, which is where it belongs — a reviewer is a separate agent, not a second prompt on a role. |
| `default_status` | TEXT NOT NULL DEFAULT `'inactive'` | CHECK: `'active'\|'inactive'`. All five seeded rows (`po`, `engineer`, `qa`, `architect`, `automation`) are `active` (verified 2026-09-14). |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | UI ordering for the Role dropdown. |
| `created_at`, `updated_at` | TIMESTAMPTZ | Auto-managed. |

`agents.role_id`:
- `TEXT REFERENCES roles(id) ON DELETE SET NULL`
- **Nullable** — autonomous agents (Theme 09 / Theme 09b: ai-news, market-research, regulations, jira-to-epic, ai-readiness) sit outside the SDLC chain and keep `role_id = NULL`.
- Indexed (`idx_agents_role_id`) for the Role filter chip's per-role count query.
- The 10 existing SDLC agents are backfilled by migration 025.

## Prompt-ownership rules

Two distinct strings exist per agent:

1. **`roles.default_prompt_md`** — the catalog default. Edited via `PATCH /api/roles/:id`. Editing it does **not** propagate to any existing agent — it's the starting point for newly-created agents (and a reference the Owner can reset back to via the future "Reset to role default" action on the Agent Detail Prompt tab).
2. **`agents.prompt_md`** — the per-agent prompt the runner actually uses. Edited via `PATCH /api/agents/:id` (Owner) or via the Prompt tab in the web UI. This is what `buildPrompt()` reads when dispatching a run.

The runner *never* consults the role catalog at dispatch time. The catalog is seed-time data only. This keeps the dispatch path predictable: the prompt that ran is always the prompt on the agent row at that moment.

## How to consume

- **Shared type:** `SdlcRole` (union) + `SDLC_ROLES` (const array) + `IRole` (full row shape) in `@atlas/shared/types`.
- **Labels:** `SDLC_ROLE_LABELS: Record<SdlcRole, string>` in `@atlas/shared/constants`.
- **Default activation:** `SDLC_ROLE_DEFAULT_STATUS: Record<SdlcRole, AgentStatus>` in `@atlas/shared/constants` (mirrors `roles.default_status` for seed-side use).
- **Zod:** `SdlcRoleSchema`, `UpdateRoleSchema` in `@atlas/shared/schemas`.
- **API:** `GET /api/roles` (list) · `GET /api/roles/:id` (single) · `PATCH /api/roles/:id` (Owner-only).
- **Web hook:** `useRoles()` in `packages/web/src/hooks/useRoles.ts` (TanStack Query, infinite cache — catalog only changes via migration).
- **MCP:** `crud_agent` `create` / `update` accept `role_id` (nullable). No separate `roles` tool surface yet.

## How to add a role

1. Append the slug to `SdlcRole` in `packages/shared/src/types/index.ts`.
2. Append an entry to `SDLC_ROLES`, `SDLC_ROLE_LABELS`, and `SDLC_ROLE_DEFAULT_STATUS` in `packages/shared/src/constants/index.ts`.
3. Extend the `SdlcRoleSchema` enum in `packages/shared/src/schemas/index.ts`.
4. Author a new numbered migration that inserts the `roles` row with its curated `default_prompt_md` (the five existing rows live in `001_baseline.sql`).
5. Optionally add a catalog agent for it under `packages/api/src/marketplace/catalog/`.
6. Update this doc's table.

The catalog shape is governed by code, not by runtime data — there's no Owner-facing "create role" action by design (a runtime-created role would have no shared-type backing and would break the Zod validation at the route boundary).

## Related

- `data-model.md` — the `Role` entity sits next to `Agent` and is referenced by `IAgent.role_id`.
- `api-surface.md` — `/api/roles` routes, migration 025, `rolesService`.
- `pages/15-agents.md` — the Role filter chip on the Agents page is the catalog's primary UI surface today.
- A01 (Done, 2026-05-25) — introduced `agents.designation` as a free-text display label. A08 makes the catalog the canonical source; `designation` remains as an optional override layered on top.
- The 5 autonomous agents (Theme 09 / 09b) — out of scope for the catalog. They're tagged via `kind_slug` and `role_id` stays NULL.
