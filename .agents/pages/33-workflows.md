# Workflows

**Route:** `/workflows` • **Component:** `packages/web/src/pages/Workflows.tsx` • **Slug:** `workflows`

## Purpose
Card list of every workflow (ADR 0014, ADR 0015). A workflow is a graph of agents that runs back-to-back in one workflow run — one worktree, one branch, one PR. A **Task workflow** (`input_kind='item'`) runs one Task and works its sub-tasks through **sub-workflows** (`input_kind='sub_task'`), which are listed here too. The page is the entry to the builder and the place to create a workflow, blank, from a shipped template, or by importing a bundle someone exported.

## States
- **Loading**: 3 rounded skeleton cards.
- **Error**: `Alert` "Couldn't load workflows: {message}".
- **Empty**: dashed `EmptyState` — "No workflows yet" + **New workflow** outlined button.
- **Populated**: responsive card grid (1 / 2 / 3 columns at xs / sm / lg).

## UI elements
**Header**
- H2 "Workflows"; metadata subtitle `N workflows · M active` (mono counts).
- **Import** (outlined, all widths) → opens `ImportWorkflowDialog`.
- **New workflow** (green, desktop) → opens `NewWorkflowDialog`. Mobile shows a `PageFab` instead.

**Workflow card** (click / Enter → `/workflows/:id`)
- `account_tree` tile, name, `{project name} · N agents`.
- **Active / Inactive** pill (`status`).
- Description (2-line clamp) when set.
- Footer metas: **Trigger** (`Manual` / `On item ready` / `Scheduled · next {date}` when `next_run_at`), **Input** (`Per Task` / `Project run` / `Sub-task workflow`, `INPUT_KIND_LABEL` in `pages/workflows/labels.ts`), **Last run** (relative `last_run_at`).

**`NewWorkflowDialog`** (`pages/workflows/NewWorkflowDialog.tsx`)
- **Project** select (required — Create stays disabled until picked).
- Radio cards: **Blank** ("A Start and an End node…", meta `Per Task · Push + PR`; creates `Untitled workflow` with a Start → End pass edge server-side) + one card per template from `GET /api/workflows/templates` showing description, `input · delivery` meta (e.g. `Per Task · Push + PR` for Delivery, `Sub-task workflow · Back to the Task` for Build / Test) and agent chips. Chips use the installed agent's name + accent; catalog agents that aren't installed render as a humanized id with a dashed border.
- When the selected template needs uninstalled agents: "Installs from the marketplace: …".
- **Create workflow** → `POST /api/workflows` (blank) or `POST /api/workflows/from-template` → navigates to the builder. Creating **Delivery** also creates the project's **Build sub-task** and **Test sub-task** workflows when missing (its Sub-tasks steps name them as `template:build` / `template:test`). Errors show inline as an `Alert`.

**`ImportWorkflowDialog`** (`pages/workflows/ImportWorkflowDialog.tsx`)
- **Project** select + a click-to-choose `.zip` drop box. **Import** stays disabled until both are set.
- **Import** → `POST /api/workflows/import` (multipart: `project_id` field first, then `file`). On success: toast `Imported {name}` with detail `Installed … · Reused … · Sub-workflows …`, close, navigate to `/workflows/:id` of the imported workflow. A rejected bundle (400 with the reason, e.g. `Workflow bundle: missing workflow.json`) shows inline as an `Alert`.
- What an import does (see `api-surface.md` → Workflow bundles): creates the bundle's sub-workflows then the workflow in the chosen project, installs agents you don't have from the bundle (activated), reuses agents you do have untouched, suffixes a clashing name with ` (imported)` / ` (imported 2)`, and rolls everything back if any step fails.

## Why these affordances exist
- **Templates first-class in the create dialog** — templates (`delivery`, `build`, `test`, `ai-readiness`) are the starting points for the SDLC chain; see `swarm-architecture.md`.
- **Project picked up front** — every Task workflow belongs to one project's repository and Tasks, and a Sub-tasks step may only name a sub-workflow of the same project.
- **Import** — the Owner's ask: "similar to export and import agent … so that people can reuse the content." Bundles come from a builder's **Export** or a marketplace workflow's **Export** (starter or published). Publishing a workflow to the Marketplace stores the same bundle, and its **Use in a project** runs the same import.

## Hooks used
- `useWorkflows()` — `['workflows','list',null]`
- `useProjects()` — project names on cards + dialog select
- `useWorkflowTemplates({enabled})`, `useCreateWorkflow`, `useCreateWorkflowFromTemplate`, `useAgents` (dialog)
- `useImportWorkflow()` (import dialog) — invalidates `['workflows']`, `['agents']`, `['marketplace']`

## API endpoints touched
- `GET /api/workflows`
- `GET /api/workflows/templates`
- `POST /api/workflows`
- `POST /api/workflows/from-template`
- `POST /api/workflows/import`
- `GET /api/projects`, `GET /api/agents`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- List refreshes on SSE `counts_changed` (workflow create/update/delete broadcast it) and `workflow_run_updated`.
- From-template installs missing catalog agents, so `['agents']` is invalidated too.

## Connectivity
- **Pages**: [Workflow Detail](34-workflow-detail.md) — card click / after create / after import. [Marketplace](27-marketplace.md) — Workflows tab lists the templates.
- **Entities**: `workflow`.

## Coming soon on this page
None.
