# AGENTS.md — Atlas

Rules of engagement for any AI coding agent operating in this repo (Claude, Codex, Cursor, Aider, Gemini, etc.). **Read this file first.**

**Product:** Atlas
**Architecture:** pnpm monorepo · `@atlas/web` · `@atlas/api` · `@atlas/shared`

---

## 🔴 HARD RULES — Never Violate

### 1. `packages/shared` is PROTECTED
- **Never edit any file in `packages/shared/` without explicit owner instruction and a stated reason.**
- If you think shared needs to change, stop and ask first.
- `@atlas/shared` is the single source of truth for types, constants, status machine, and Zod schemas.
- Both `@atlas/api` and `@atlas/web` import from it — a breaking change here breaks everything.

### 2. Status transition logic lives ONLY in `packages/shared/src/status-machine/`
- Never duplicate status logic in routes, components, or hooks.
- Import `getValidNextStatuses` and `isValidTransition` from `@atlas/shared` wherever you need them.

### 3. DB access is ONLY from `packages/api`
- `packages/web` never imports from `packages/api`, never accesses the DB directly.
- Web talks to the API via typed fetch at `packages/web/src/api/api.ts`.

### 4. API responses must match `@atlas/shared` types exactly
- Never add fields not in the interface.
- Never return snake_case in some routes and camelCase in others — use snake_case throughout (matching SQLite column names).

### 5. TypeScript strict mode everywhere
- No `any` without a comment explaining WHY it's unavoidable.
- No non-null assertions (`!`) without a comment.
- `exactOptionalPropertyTypes` is enabled — don't use `undefined` where a property is required.

### 6. Never commit or push audit/forensic artifacts
- The remote `github.com/sspartorg/atlas` must never contain audit logs, forensic findings dumps, screenshots, `.har`/`.ndjson` traces, or per-run handoff files.
- Patterns that stay LOCAL ONLY: `e2e-logs/**` (except `README.md` and the empty `findings-template.md` scaffold), `docs/visual-audit/**`, `.atlas/**`, `playwright-forensic-report/**`, `test-results/**`, `verification-*.png`, loose `findings-*.md` outside the template, and any `*-screenshots/` directory.
- `.gitignore` already covers the common cases (`e2e-logs/*`, `docs/visual-audit/`, `.atlas/`, `verification-*.png`, `playwright-forensic-report/`, `test-results/`). Before `git add`, still eyeball staged + untracked entries — anything matching the patterns above must NOT be added even if it slipped past gitignore.
- If a finding genuinely needs to be persisted, write it as a tracked artifact (ADR under `docs/adr/`, a `.agents/` doc, or a PR description) with prose + `file:line` evidence. The fix goes in code; the rationale goes in a commit message or ADR; the raw evidence stays local.
- Do NOT preemptively add new filename-pattern ignores (e.g. `findings-*.md`) — every cleanup session uses different names, so speculative patterns rot quickly. Surface a new class of file to the Owner first.

---

## Package Responsibilities

```
packages/shared/    → Types, constants, status machine, Zod schemas. Zero runtime deps except zod.
packages/api/       → Fastify server, SQLite DB, all business logic, REST routes, SSE.
packages/web/       → React UI, MUI components, React Router, TanStack Query.
```

### Import rules
- `@atlas/api` imports from `@atlas/shared` ✅
- `@atlas/web` imports from `@atlas/shared` ✅
- `@atlas/web` does NOT import from `@atlas/api` ❌
- `@atlas/shared` has NO imports from api or web ❌

Per-package coding patterns live in `packages/web/AGENTS.md`, `packages/api/AGENTS.md`, `packages/shared/AGENTS.md`.

---

## File Organization Rules

### API (`packages/api/src/`)
- `routes/` — One file per resource (`agents.ts`, `projects.ts`, etc.). No inline business logic in routes.
- `services/` — Business logic, CLI spawning, external-notification transport. Called from routes, not the other way.
- `db/` — DB singleton, migrations (numbered `.sql` files), seed data.
- Route files register as Fastify plugins. Validate inputs with Zod schemas from `@atlas/shared`.

### Web (`packages/web/src/`)
- `theme/` — MUI theme + tokens. The ONLY place colors, spacing, and motion values are defined.
- `components/` — Shared UI components. Must use MUI components, not raw HTML+CSS.
- `pages/` — One folder per route. Route-level components only.
- `hooks/` — Custom hooks (`useAgents`, `useSSE`, etc.). Data fetching lives here, not in components.
- `api/api.ts` — Typed fetch wrapper. All API calls go through this file.

---

## Coding Conventions

- **Component naming:** PascalCase (`AgentCard.tsx`)
- **Hook naming:** camelCase with `use` prefix (`useAgents.ts`)
- **Constant naming:** SCREAMING_SNAKE (`AGENT_CATEGORIES`)
- **Type naming:** PascalCase with `I` prefix for interfaces (`IAgent`)
- **File naming:** kebab-case for utilities, PascalCase for components
- **No default exports** — use named exports everywhere
- **No comments explaining what the code does** — only WHY (hidden constraints, workarounds, non-obvious invariants)

---

## MUI Usage Rules (Web only)
- Use MUI `sx` prop over CSS modules or styled-components
- Use `theme.palette.*` and `theme.spacing()` — never hardcode `#hex` or `px` values
- Use tokens from `packages/web/src/theme/tokens.ts` for any value not in MUI's palette
- No Tailwind, no raw CSS files, no inline `style` attributes (except for dynamic `fontVariationSettings`)

For full MUI/data-fetching/status-display patterns, see `packages/web/AGENTS.md`.

---

## Atlas Domain Rules

### Single-owner, no multi-user
- No auth screens, no login flows, no user tables, no session tokens
- The Owner is always assumed to be the logged-in user
- All UI is in first-person singular ("Your projects", not "Team projects")

### Agent escalation constraint
- Agents escalate ONLY to the Owner — never to other agents
- The reassign endpoint validates this at the API layer
- The reassign UI only shows the Owner and valid agents for the current status

### Status transitions
- The UI must HIDE invalid transitions (not grey them out, not show them at all)
- Valid transitions come from `getValidNextStatuses()` in `@atlas/shared`
- Never hardcode a list of statuses in a component — always derive from the status machine

### No invented data
- No fields not in the `@atlas/shared` types (no priority, story points, tracker links)
- Empty states use spec-compliant copy — do not invent placeholder text
- Counts, dates, and IDs use `JetBrains Mono` font via `sx={{ fontFamily: 'mono' }}`

---

## Agents & Seed Data
- Agent seed data lives in `packages/api/src/db/seed.ts` — never hardcode agent info in components
- 10 seeded agents with categories: `software-dev` | `marketing` | `content` | `design`
- Each agent has an `accent_color` from the Atlas palette — use it for agent chips and avatars
- CLI values: `claude` | `copilot` | `ollama` — these map to real CLI tools wired in Phase 5. `ollama` is not a separate binary: it runs Claude Code against Ollama's Anthropic-compatible API. Branch on `CLI_DIALECT` from `@atlas/shared`, never on the raw `cli` value

---

## Visual baselines & regression gate

Playwright visual snapshots live under `e2e/visual/__snapshots__/`. Every push to `main` and every PR runs `.github/workflows/visual-snapshots.yml`, which asserts the current renders match the committed baselines. A red pixel diff blocks the PR and uploads a diff artifact for 30 days.

`e2e/visual/snapshots.spec.ts` is gated on `CI=true` and only compares against Linux Chromium baselines — a local Windows or macOS run would produce PNGs the CI comparison never accepts. Do not run `--update-snapshots` from your dev machine.

### Updating baselines

Any intentional visual change (palette, layout, adding a component to a covered route, adding a route to the covered set) must regenerate baselines:

1. Push your visual change on a feature branch and open the PR.
2. Attach the `seed-visual` label to that PR.
3. `.github/workflows/visual-baseline.yml` runs — re-executes `playwright test e2e/visual/ --update-snapshots` on Linux CI and commits new PNGs to your PR branch under `github-actions[bot]`.
4. `visual-snapshots.yml` sees the seed label and skips this run (avoiding a race against pre-seed baselines). Once the seed push lands, subsequent CI passes run the gate against the new PNGs.
5. Review the diff in the seed's commit — that IS the visual change under review.

Do **not** manually edit or delete files under `e2e/visual/__snapshots__/`. Always regenerate via the workflow. Do **not** `.gitignore` that directory — the ~50 MB of PNGs is intentional and load-bearing.

To re-seed the whole `main` branch (e.g. after a theme overhaul):
```
gh workflow run visual-baseline.yml -r main
```

---

## What NOT to Do
- Do not create new packages without asking
- Do not install packages with `--save-dev` in the wrong package
- Do not add Prettier/ESLint ignores without a reason
- Do not modify `pnpm-workspace.yaml` or `tsconfig.base.json` without asking
- Do not add environment variables without updating the settings schema in `@atlas/shared`
- Do not use `console.log` in production code (use Fastify's logger in API, suppress in web)
- Do not use `git commit --no-verify` to skip the secretlint pre-commit hook unless you have manually reviewed the staged diff for credentials — the hook is the last line of defense before history.

---

## `.agents/` Documentation — Read First, Update Always

This repo ships with `.agents/` — a terse, indexed functional documentation set covering every page, every API endpoint, the data model, the status machine, the SSE catalogue, and every stubbed / coming-soon feature. **Always read the relevant `.agents/` files before answering questions about behavior or making functional changes.** Do not re-explore the codebase to relearn behavior — the docs are the cache.

### Where to look

| Question | File |
|---|---|
| Page behavior, buttons, modals | `.agents/pages/<NN-slug>.md` |
| Route → page → endpoint map | `.agents/routes-map.md` |
| API surface, SSE events, services, migrations | `.agents/api-surface.md` |
| Entities, relationships, status machine | `.agents/data-model.md` |
| System architecture, request + SSE flow | `.agents/architecture.md` |
| Stubs & coming-soon features | `.agents/coming-soon.md` |
| Domain terms | `.agents/glossary.md` |
| How to use & maintain these docs | `.agents/conventions.md` |

Start at `.agents/README.md` for the full index of page docs.

### Self-update rule (non-negotiable)

When you change code that alters page functionality, you **must** update the corresponding `.agents/` files **in the same change**. This is not optional — the docs are useless the moment they go stale.

| If you changed… | Update… |
|---|---|
| Any button, menu item, tab, drawer, modal trigger, filter chip, or other interactive element on a page | That page's `.agents/pages/<NN-slug>.md` (UI elements section) |
| An API route signature, payload, or response shape | `.agents/api-surface.md` and every page doc that calls the endpoint (cross-check via `routes-map.md`) |
| A status transition (added / removed / renamed) | `.agents/data-model.md` (status machine section) |
| An entity field (added / removed) | `.agents/data-model.md` (entity sections) |
| A new page or route | Create `.agents/pages/<NN-slug>.md`, add it to `.agents/README.md` and `.agents/routes-map.md` |
| A coming-soon stub was shipped | Remove the row from `.agents/coming-soon.md` AND update the page doc's "Coming soon on this page" section |
| A new coming-soon stub appeared | Add a row to `.agents/coming-soon.md` and reference it from the page doc |
| An SSE event added / removed | `.agents/api-surface.md` (SSE catalogue) + `.agents/architecture.md` (SSE flow) |
| A new service or runner | `.agents/api-surface.md` (services index) + any pages it affects |
| A migration added | `.agents/api-surface.md` (migrations index) |
| Sidenav / Topbar / AppShell | `.agents/routes-map.md` (sidenav structure section) |

If you genuinely cannot update the doc in the same change, leave a single-line `TODO(.agents):` comment pointing at the file to update. Reviewers should flag any bare `TODO(.agents):` older than a week.

Detailed maintenance protocol lives in `.agents/conventions.md`.

---

## Quick links for unfamiliar agents

- New to this repo? Read this file → `.agents/README.md` → `.agents/architecture.md`.
- About to change a page? Read `.agents/pages/<NN-slug>.md` first.
- About to add an endpoint? Update `.agents/api-surface.md` in the same change.
- Found a stubbed feature? Cross-check `.agents/coming-soon.md` before "fixing" it — it may be intentional and tracked.
- Per-package coding patterns (MUI, hooks, data fetching, etc.): `packages/<pkg>/AGENTS.md`.
