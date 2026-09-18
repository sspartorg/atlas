# Marketplace Workflow Detail

**Routes:** `/agents/marketplace/workflows/:templateId` (starter) and `/agents/marketplace/workflows/published/:publishedId` (published by you)  •  **Component:** `packages/web/src/pages/MarketplaceWorkflowDetail.tsx`

## Purpose
Look at a marketplace workflow before using it: its graph, the agents it installs and the sub-workflows it creates. Then use it in a project or export it as a bundle. Two kinds share the page — the component builds one view model (`templateView` / `publishedView`) and renders it the same way:
- a **starter workflow** shipped in `packages/api/src/marketplace/workflows/*.json`;
- a workflow **you published** from a builder's **Publish** (`published_workflows`, migration 041), which can also be unpublished.

## States
- Loading: two skeleton blocks.
- Not found (unknown template, unknown published id / 404, or the request failed): "Marketplace workflow not found." + **Back to marketplace**.
- Populated: header, description (when set), canvas preview + side panel.

## UI elements
**Header**
- **Marketplace** back button → `/agents/marketplace?tab=workflows`.
- `account_tree` tile, name (H1), chips: input kind (`Per Task` / `Project run` / `Sub-task workflow`), trigger, delivery; a published workflow adds `Published {date}`.
- **Export** — plain `href`. Starter: `GET /api/workflows/templates/:id/export` (the template, its `template:` sub-workflows and their **catalog** agents). Published: `GET /api/marketplace/workflows/:id/export` (the zip stored at publish time — the same bundle the builder's Export produces). Import either from **Workflows → Import**.
- **Unpublish** (published only; outlined, error colour) → `ConfirmActionModal` "Unpublish {name}?" / "It leaves the marketplace. Workflows already created from it stay as they are." → `DELETE /api/marketplace/workflows/:id` → toast `Unpublished {name}` → back to the Workflows tab. Failure toasts "Could not unpublish workflow".
- **Use in a project** (green):
  - Starter → `NewWorkflowDialog` with this template pre-selected; pick a project → **Create workflow** → `POST /api/workflows/from-template` → the builder.
  - Published → `UsePublishedWorkflowDialog`: **Project** select → **Add workflow** → `POST /api/marketplace/workflows/:id/use {project_id}` (the ordinary bundle import) → toast `Imported {name}` with `Installed … · Reused … · Sub-workflows …` detail (`importDetail`) → the builder. API errors show inline as an `Alert`.

**Body**
- **Canvas preview** — read-only `WorkflowCanvas` + `toFlow`, lazy-loaded (`pages/marketplace/WorkflowGraphPreview.tsx`) so `@xyflow/react` stays out of the initial bundle. Sub-tasks steps show their sub-workflow's name (starter: the `template:<id>` template; published: the bundle ref's `sub_workflows[].name`); agent nodes you haven't installed show the raw id + "not installed".
- **Agents** list — every agent it involves (sub-workflows' included) with accent + name — catalog names for a starter, your installed agents' names first for a published one — and **Installed** / **Installs from the marketplace** (starter) / **Installs with this workflow** (published; the bundle carries the agent).
- **Sub-workflows** — starter: one link per `template:<id>` sub-workflow (→ that template's page), "Created with this workflow unless the project already has them." Published: plain names, "Created with this workflow." (a bundle import always creates them, suffixing a clashing name).

## Hooks used
- `useWorkflowTemplates` (starter), `usePublishedWorkflow(id)` (published, `['workflows','published','detail',id]`), `useUnpublishWorkflow`, `useAgents`, `useMarketplaceCatalog` (via `useCatalogAgentsById` / `useKnownAgentsById`), `useSetPageTitle`, `useToast`
- Dialogs: `useProjects`, `useCreateWorkflowFromTemplate` (starter), `useImportPublishedWorkflow` (published)

## API endpoints touched
- `GET /api/workflows/templates`, `GET /api/marketplace/workflows/:id`, `GET /api/agents`, `GET /api/marketplace/agents?limit=100`
- `GET /api/workflows/templates/:id/export`, `GET /api/marketplace/workflows/:id/export` (links)
- `POST /api/workflows/from-template`, `POST /api/marketplace/workflows/:id/use`, `DELETE /api/marketplace/workflows/:id`, `GET /api/projects`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Starter export 404s ("Agent … does not exist") when a template names an agent missing from `marketplace_agents`; never happens once the catalog has synced.
- Templates are read from disk on every request, so there is no per-template endpoint — the page finds its template in the list.
- A published entry outlives the workflow it came from (`source_workflow_id` → null); publishing the same workflow again replaces the entry, so its URL stays the same.

## Related pages
- [`27-marketplace.md`](27-marketplace.md) — Workflows tab
- [`33-workflows.md`](33-workflows.md) — New workflow dialog, Import
- [`34-workflow-detail.md`](34-workflow-detail.md) — where "Use in a project" lands; **Publish**

## Coming soon on this page
- None.
