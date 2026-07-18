# Role catalog (A08)

The **SDLC role catalog** is the canonical list of roles an agent can play in Atlas's software-delivery chain. It's the single source of truth for:

- What "role" labels are valid on an agent (`agent.role_id` is a foreign key into `roles.id`).
- The curated starter prompt for each role (the `default_prompt_md` + `default_reviewer_prompt_md` columns).
- The default activation policy: which roles ship enabled vs. disabled on a fresh install.

## The 10 roles

| `id` | Label | Default status | Notes |
|---|---|---|---|
| `po` | Product Owner | active | PO Writer — Brainstorm-before-scope agent. Reviewer persona handles the brainstorm-exit shape. |
| `spec-writer` | Specification Writer | active | Writes per-Story specs ahead of code. |
| `engineer` | Engineer | active | Coder. The reviewer persona is the canonical **Engineering-Reviewer** the spec calls out. |
| `qa` | Quality Assurance | active | QA Writer — owns the regression net. |
| `architect` | Software Architect | inactive | Architecture docs ahead of implementation. |
| `tester` | Exploratory Tester | inactive | Manual + persona-driven exploration (distinct from QA's automation). |
| `automation` | Automation Engineer | inactive | CI/CD, build tooling, release automation. |
| `devops` | DevOps Engineer | inactive | Infra-as-code, deploys, observability, secrets rotation. |
| `security` | Security Review Lead | inactive | Cross-cutting security review. Escalates findings to Owner — no paired performer. |
| `designer` | UX/Visual Designer | inactive | Mockups + component specs. |

The slug `id` doubles as the canonical reference everywhere in the codebase — `SdlcRole` in `@atlas/shared`, the `agents.role_id` FK target, the URL param of `PATCH /api/roles/:id`. Adding a role means a migration + a shared-type bump; the runtime never invents roles on its own.

## Disable-by-default policy

The catalog enforces the disable-by-default rule at **seed time only**. Migration 025 seeds the `roles.default_status` column according to the table above; the existing 10 SDLC agents (PO Writer, Spec Writer, Coder, QA Writer + the 6 inactive shells) keep the same `agents.status` they had pre-A08. New agents created via API/MCP that get assigned a role inherit no status from the catalog — they default to `'active'` like every other agent, and the Owner can flip them after creation.

The policy is a curation signal, not a runtime guard. The Owner can flip `agents.status` freely; A08 never re-disables a runtime-enabled agent.

## Storage model

`roles` table (created in migration `025_sdlc_role_catalog.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | The slug, e.g. `'engineer'`. |
| `label` | TEXT NOT NULL | Display string used by the Role filter chip + AgentCard subtitle fallback. |
| `description` | TEXT NOT NULL DEFAULT `''` | One-liner shown on the (future) Roles admin page. |
| `default_prompt_md` | TEXT NOT NULL DEFAULT `''` | Curated performer prompt. Owner edits via `PATCH /api/roles/:id`. |
| `default_reviewer_prompt_md` | TEXT NOT NULL DEFAULT `''` | Curated reviewer-persona prompt. Empty for roles with no paired reviewer (architect, tester, automation, devops, security, designer). |
| `default_status` | TEXT NOT NULL DEFAULT `'inactive'` | CHECK: `'active'\|'inactive'`. Active for `po`, `spec-writer`, `engineer`, `qa`. |
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
- **MCP:** `createAgent` and `updateAgent` accept `role_id` (nullable). No separate `roles` tool surface yet.

## How to add a role

1. Append the slug to `SdlcRole` in `packages/shared/src/types/index.ts`.
2. Append an entry to `SDLC_ROLES`, `SDLC_ROLE_LABELS`, and `SDLC_ROLE_DEFAULT_STATUS` in `packages/shared/src/constants/index.ts`.
3. Extend the `SdlcRoleSchema` enum in `packages/shared/src/schemas/index.ts`.
4. Add a `RoleSeed` entry in `packages/api/src/db/seeds/sdlc-roles.ts` with the curated prompt + reviewer prompt.
5. Author a new migration (e.g. `026_…`) that inserts the role row + (optionally) backfills any existing agents that should adopt the new role.
6. Update this doc's table.

The catalog shape is governed by code, not by runtime data — there's no Owner-facing "create role" action by design (a runtime-created role would have no shared-type backing and would break the Zod validation at the route boundary).

## Related

- `data-model.md` — the `Role` entity sits next to `Agent` and is referenced by `IAgent.role_id`.
- `api-surface.md` — `/api/roles` routes, migration 025, `rolesService`.
- `pages/15-agents.md` — the Role filter chip on the Agents page is the catalog's primary UI surface today.
- A01 (Done, 2026-05-25) — introduced `agents.designation` as a free-text display label. A08 makes the catalog the canonical source; `designation` remains as an optional override layered on top.
- The 5 autonomous agents (Theme 09 / 09b) — out of scope for the catalog. They're tagged via `kind_slug` and `role_id` stays NULL.
