# Marketplace

**Route:** `/agents/marketplace`  •  **Component:** `packages/web/src/pages/Marketplace.tsx`

## Purpose
The **only** sanctioned way an agent gets into the workspace (ADR 0007): browse
the 16-entry curated catalog and install one, several, or all of them.

## States
- Empty: `marketplace.data.length === 0` → subtitle reads "No catalog agents". Should never happen in practice — `syncMarketplaceCatalog` runs on every boot inside one transaction, so `marketplace_agents` holds all 16 rows or none.
- Loading: `<Skeleton>` grid.
- Error: the query surfaces through the card grid; no dedicated error panel.
- Populated: cards grouped by `category`, one section per `AgentCategory` present in the response. Empty categories are dropped, not rendered as empty buckets.

## UI elements

**Header**
- **Search** — plain `TextField`, drives `query`, which is part of the query key (`['marketplace','list',query,category]`), so typing refetches server-side rather than filtering in memory (`Marketplace.tsx:38`).
- **Category chips** — `all` + one per `AgentCategory`; same story, part of the query key.
- Subtitle counts `totalCount` and `upgradeCount` (`a.upgrade_available`).

**Body — `MarketplaceAgentCard`** (one per catalog entry)
- **Checkbox** — only rendered for `!a.is_installed`; `installableIds` is what Select-all covers (`Marketplace.tsx:59`).
- **Card body click** → `/agents/marketplace/:id`.
- **Install (single)** → on success toasts `Installed <name>` and navigates to `/agents/:installedId`.

**Footer — `BulkInstallBar`** (visible when `selected.size > 0`)
- **Select all** — selects every *installable* id, never an already-installed one.
- **Add selected** → `addSelected()` (`Marketplace.tsx:73`). Runs `runBulkInstall`, invalidates `['agents']` and `['marketplace']`, then branches:
  - all succeeded → navigate to `/agents`
  - partial → toast `Added N agents · couldn't add <ids>` with the per-id reasons in `detail`, **keep the failures selected** so Retry is one click, and stay on the page
  - none succeeded → toast `Couldn't add the selected agents` + the same detail, failures stay selected

## Modals / drawers
None on this route. The rename-on-conflict flow lives on the detail page.

## Hooks used
- `useQuery(['marketplace','list',query,category])` → `api.marketplace.list({q, category, limit:100})`. No `staleTime` override; invalidated by `['marketplace']` after any install.

## API endpoints touched
- `GET /api/marketplace/agents?q&category&kind&limit` — catalog list with `is_installed`, `installed_agent_id`, `upgrade_available`
- `POST /api/marketplace/agents/:id/install` — install; `409` with `details.{conflicting_id,suggested_id}` on a slug clash, `400 MODEL_NOT_IN_REGISTRY` when the catalog entry names a pruned model

## Permissions / guards
- Auth: post-onboarding only.
- Writes go through `requireMcpToken`, which is open when `ATLAS_MCP_TOKEN` is empty (dev default).

## Edge cases / quirks
- **Failure reasons are the point.** `bulkInstall.ts` carries `{id, status, reason}` per rejection. It used to return a bare `{ok:false}`, so the toast could only say "2 couldn't be added" — which is exactly why a pruned-model FK violation stayed invisible for as long as it did. Do not collapse this back to a count.
- **Install is not a bulk endpoint.** `runBulkInstall` fans out one `POST …/install` per id. The pool is `max: 10` with no `connectionTimeoutMillis`, so extra installs queue rather than fail.
- **A clean sweep navigates away.** Partial failure deliberately does not, or the Owner would never see which ones failed.
- `role_id` on a catalog entry must exist in `roles`. Five `SdlcRole` slugs in `@atlas/shared` are not seeded — see `functional-checklist.md` **C2**.

## Related pages
- [`28-marketplace-detail.md`](28-marketplace-detail.md) — per-entry detail, rename-retry, export
- [`15-agents.md`](15-agents.md) — where installed agents land
- [`16-agent-detail.md`](16-agent-detail.md) — upgrade review

## Coming soon on this page
- None. Every control here is live.
