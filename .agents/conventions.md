# Conventions — How to Use & Maintain `.agents/`

A short version of these rules lives in the project root `CLAUDE.md`. This file is the detailed handbook.

---

## What this folder is for

`.agents/` documents the **functional aspect** of Atlas. It exists so that:

- Future conversations don't re-explore the codebase to remember what a button does.
- Tests and automation (unit, integration, API, UI, E2E) have a single, accurate spec to write against.
- Design and product changes (especially "remove this button") can be reasoned about with full context.

**It is not** a place for:

- Code conventions or rules of engagement — those live in `CLAUDE.md`.
- Implementation plans — those live in local `.claude/plans/` (transient).

## Commit discipline (Theme 11)

Every chore an agent performs gets one commit. Format:

```
<type>(<scope>): <summary>

Refs: <atlas-item-id>
<optional body — WHY, not WHAT>
```

- `<type>` ∈ `feat | fix | refactor | test | docs | chore | perf | style | build | ci`
- `<scope>` ∈ `api | web | shared | mcp | infra | docs` (or your role slug for cross-cutting work)
- `<summary>` ≤ 60 chars, imperative ("add", not "added")
- `Refs:` line is mandatory for issue-attached runs (UUID or short-id like `ATL-7`)
- Never `--no-verify`. Never `--amend`.

The verifier in `services/commit-verifier.ts` audits this rule per run; the Agent Detail Overview tab shows the last 10 audits as colored dots (green/amber/red/grey). Owners see at a glance whether an agent is following discipline. Verbatim rule lives in `services/commit-discipline.ts` `COMMIT_DISCIPLINE_PROMPT_SECTION` and is injected into every issue-attached run's prompt.

---

## Reading order

Front-load context cheaply:

1. `README.md` (this folder's index) — always loaded first.
2. Whichever framework file matches the question (`architecture.md`, `data-model.md`, `api-surface.md`, `routes-map.md`, `coming-soon.md`, `glossary.md`).
3. The specific `pages/<NN-slug>.md` for the page in question.

If you find yourself reading code to answer a behavior question, **stop** — find or write the doc instead.

---

## Per-page doc template

Every file under `pages/` follows this shape. Keep the prose tight; favor bullets and tables.

```markdown
# <Page Name>

**Route:** `/path`  •  **Component:** `packages/web/src/pages/<File>.tsx`

## Purpose
One sentence on why this page exists.

## States
- Empty: <when shown, what's rendered>
- Loading: <skeleton / spinner>
- Error: <error UI>
- Populated: <main view>

## UI elements
Group by section (Header / Body / Right rail / Footer). For every interactive piece:
- **<Label>** — what it does, which API call or modal it triggers, where the handler lives (`file:line`)

## Modals / drawers
- `<ComponentName>` — purpose, on-confirm action

## Hooks used
- `useX` — what data it fetches, refetch policy if any

## API endpoints touched
- `GET /api/...` — purpose
- `POST /api/...` — purpose

## Permissions / guards
- Auth: post-onboarding only (default; only the onboarding page is exempt)
- Page-specific guards

## Edge cases / quirks
- Things a future agent should know before changing a button

## Related pages
- Links to other page docs

## Coming soon on this page
- (mirrors `coming-soon.md`)
```

---

## Update protocol (mandatory)

When code change → doc change. Same commit, same PR. No exceptions.

### Triggers and what to update

| You changed… | You must update… |
|---|---|
| A button, menu item, tab, drawer, modal trigger, filter chip, or any other interactive element on a page | That page's `pages/<NN-slug>.md` (UI elements section) |
| An API route signature, payload, or response shape | `api-surface.md` + every page doc that calls that endpoint (cross-check via `routes-map.md`) |
| A status transition (added / removed / renamed) | `data-model.md` (status machine section) |
| An entity field (added / removed) | `data-model.md` (entity sections) |
| A new page or route | Create a new `pages/<NN-slug>.md`, add it to `README.md` index and `routes-map.md` |
| A coming-soon item shipped | Remove its row from `coming-soon.md`, update the page doc's "Coming soon on this page" section |
| A new coming-soon stub appeared | Add a row to `coming-soon.md` and reference it from the page doc |
| A UI file is deleted (component / hook / tab) | Sweep `coming-soon.md` for stubs whose `Location` column points at the deleted file; delete those rows. Sweep `.agents/pages/*.md` for references to the deleted component, hook, or route; strip them. Audit `.agents/api-surface.md` for related route catalog rows. (Lesson from B14 / Foundation autonomous-tab rip-out: code was deleted cleanly, docs drifted for weeks.) |
| An SSE event added / removed | `api-surface.md` (SSE catalogue) + `architecture.md` (SSE flow) |
| Sidenav / Topbar / AppShell | `routes-map.md` (sidenav structure section) |
| A new service or runner | `api-surface.md` (services index) + relevant page docs |
| A migration added | `api-surface.md` (migrations index) |

### If you cannot update the doc in the same change

Leave a single-line `TODO(.agents):` comment referencing the file that needs updating. Do not commit code without either the doc update or this marker. Reviewers should flag bare `TODO(.agents):` markers older than a week.

---

## Style rules

- **Terse > comprehensive.** Aim for 150–300 words per page doc. The point is fast scan + grep, not a manual.
- **No prose paragraphs** when a bullet list will do. No prose at all when a table will do.
- **Always include `file:line` references.** Future agents should be able to jump straight to the code without searching.
- **Snake_case in field/endpoint names** (matches API). PascalCase for component names. Camel for hook names.
- **No emojis.**
- **No "what" comments.** Only document *behavior, edge cases, and why* — never paraphrase code that's already self-evident.
- **Group by section.** When listing UI elements, group them by Header / Body / Right rail / Footer (or whatever sections the page actually has). Don't dump everything in one list.

---

## Adding a new page doc

1. Look up the next available filename number under `pages/`. Use the format `NN-slug.md` where `slug` is the page's URL slug.
2. Copy the template above into the new file.
3. Add a row to `routes-map.md`.
4. Add a line to `README.md`'s "Pages" index.
5. If the page introduces new hooks/endpoints/components, update `api-surface.md` and `data-model.md` accordingly.

---

## Removing a feature

1. Delete the row(s) in the affected page doc's UI elements section.
2. Remove related rows from `routes-map.md`.
3. If the feature was previously in `coming-soon.md`, drop that row too.
4. If the change removes a status transition, an entity field, or an endpoint, propagate through `data-model.md` and `api-surface.md`.
5. If a whole page is removed, delete the page file AND remove it from `README.md` and `routes-map.md`.

---

## Self-check before pushing

Pre-commit hook (not required, but recommended) could flag the following:

- A change inside `packages/web/src/pages/*.tsx` without a touch in `.agents/pages/`.
- A change inside `packages/api/src/routes/*.ts` without a touch in `.agents/api-surface.md`.
- A change inside `packages/shared/src/status-machine/*.ts` without a touch in `.agents/data-model.md`.

Until the hook exists, this is on the author + reviewer.
