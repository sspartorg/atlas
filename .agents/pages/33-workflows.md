# Workflows

**Route:** `/workflows` • **Component:** `packages/web/src/pages/Workflows.tsx` • **Slug:** `workflows`

## Purpose
Card list of every workflow (ADR 0014). A workflow is a graph of agents that runs back-to-back in one workflow run — one worktree, one branch, one PR. The page is the entry to the builder and the place to create a workflow, blank or from a shipped template.

## States
- **Loading**: 3 rounded skeleton cards.
- **Error**: `Alert` "Couldn't load workflows: {message}".
- **Empty**: dashed `EmptyState` — "No workflows yet" + **New workflow** outlined button.
- **Populated**: responsive card grid (1 / 2 / 3 columns at xs / sm / lg).

## UI elements
**Header**
- H2 "Workflows"; metadata subtitle `N workflows · M active` (mono counts).
- **New workflow** (green, desktop) → opens `NewWorkflowDialog`. Mobile shows a `PageFab` instead.

**Workflow card** (click / Enter → `/workflows/:id`)
- `account_tree` tile, name, `{project name} · N agents`.
- **Active / Inactive** pill (`status`).
- Description (2-line clamp) when set.
- Footer metas: **Trigger** (`Manual` / `On item ready` / `Scheduled · next {date}` when `next_run_at`), **Input** (`Per item` / `Project run`), **Last run** (relative `last_run_at`).

**`NewWorkflowDialog`** (`pages/workflows/NewWorkflowDialog.tsx`)
- **Project** select (required — Create stays disabled until picked).
- Radio cards: **Blank** ("A Start and an End node…", creates `Untitled workflow` with a Start → End pass edge server-side) + one card per template from `GET /api/workflows/templates` showing description, `input · delivery` meta and agent chips. Chips use the installed agent's name + accent; catalog agents that aren't installed render as a humanized id with a dashed border.
- When the selected template needs uninstalled agents: "Installs from the marketplace: …".
- **Create workflow** → `POST /api/workflows` (blank) or `POST /api/workflows/from-template` → navigates to the builder. Errors show inline as an `Alert`.

## Why these affordances exist
- **Templates first-class in the create dialog** — the hard cut removed per-agent handoffs with no auto-conversion; templates (`planning`, `dev`, `qa`, `ai-readiness`) are how the Owner rebuilds those chains.
- **Project picked up front** — every item workflow belongs to one project's repository and items; the API rejects an item workflow without one.

## Hooks used
- `useWorkflows()` — `['workflows','list',null]`
- `useProjects()` — project names on cards + dialog select
- `useWorkflowTemplates({enabled})`, `useCreateWorkflow`, `useCreateWorkflowFromTemplate`, `useAgents` (dialog)

## API endpoints touched
- `GET /api/workflows`
- `GET /api/workflows/templates`
- `POST /api/workflows`
- `POST /api/workflows/from-template`
- `GET /api/projects`, `GET /api/agents`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- List refreshes on SSE `counts_changed` (workflow create/update/delete broadcast it) and `workflow_run_updated`.
- From-template installs missing catalog agents, so `['agents']` is invalidated too.

## Connectivity
- **Pages**: [Workflow Detail](34-workflow-detail.md) — card click / after create.
- **Entities**: `workflow`.

## Coming soon on this page
None.
