# Marketplace Agent Detail

**Route:** `/agents/marketplace/:id`  •  **Component:** `packages/web/src/pages/MarketplaceAgentDetail.tsx`

## Purpose
Read the whole catalog entry — prompt, runtime, settings, quality
checklist — before deciding to install it. Catalog entries carry no schedule,
handoff rules or git flags (ADR 0014: workflows own those).

## States
- Loading: skeleton block.
- Not found: `full.isError` → message + a **Back to marketplace** button (`:180`).
- Populated: header + action row, prompt body, runtime / custom-settings blocks, quality checklist.
- The checklist renders a "None." line when the array is empty.

## UI elements

**Header**
- Breadcrumb / **back** button → `/agents/marketplace` (`:193`).
- Name, category, kind, `cli` + `model`, upgrade chip when `summaryRow.upgrade_available`.

**Action row** (`:274`) — exactly one primary action, chosen by install state:
- **Export** — plain `href` to `api.marketplace.exportZipUrl(agent.id)` (`GET …/export`). A real download, not an SPA action.
- **Add to my agents** — when `!isInstalled`; opens `AddFromMarketplaceModal`.
- **Review upgrade** — when installed *and* `hasUpgrade`; navigates to `/agents/:installedAgentId`, where `AcceptUpgradeModal` does the field-level diff.
- **Open installed agent** — when installed with no upgrade pending.

**CLI warning** — `CliUnavailableAlert` under the header when `GET /api/cli/availability` reports `agent.cli`'s binary missing: "`<binary>` is not installed on this machine — runs will fail until it is, or switch the agent to `<available cli>` after installing." (the "after installing" tail is dropped once installed).

**Body sections**
- `prompt_md` rendered verbatim (`:370`).
- **Runtime** (status, framework, role_id, designation, memory_cadence) / **Custom settings** label blocks.
- **Quality checklist** — the agent's quality gate, reported in `atlas-outcome`.

## Modals / drawers
- `AddFromMarketplaceModal` — takes a slug (defaults to the catalog id) and calls `handleInstall(slug)`. Two faces:
  - **first attempt** — explains that a fresh local copy is made and that local edits never travel back to the marketplace
  - both faces also show the CLI warning above. The same modal opens from a catalog card's **Add**.
  - **rename retry** — when the install came back `409`, shows the conflicting id in a warning panel and pre-fills `details.suggested_id`; the existing local agent is left untouched

## Hooks used
- `useMarketplaceAgentFull(id)` (`hooks/useMarketplace.ts`) → `['marketplace','full',id]` → `api.marketplace.get(id)` — the full entry.
- `useMarketplaceCatalog()` → `['marketplace','list','detail']` → `api.marketplace.list({limit:100})` — only to read *this* entry's `is_installed` / `installed_agent_id` / `upgrade_available`, which the full payload does not carry.
- `useMissingCli(agent.cli)` (via `CliUnavailableAlert`); modal: `useMarketplaceAgentFull(id)` for the CLI warning.

## API endpoints touched
- `GET /api/marketplace/agents/:id` — full catalog entry (`IMarketplaceAgentFull`)
- `GET /api/marketplace/agents` — summary row, for install state
- `POST /api/marketplace/agents/:id/install` — install, optional `{agent_id}` slug override
- `GET /api/cli/availability` — CLI warning
- `GET /api/marketplace/agents/:id/export` — zip download

## Permissions / guards
- Auth: post-onboarding only. Install is `requireMcpToken`-gated like every other write.

## Edge cases / quirks
- **Every non-409 install error must toast.** `handleInstall`'s catch splits on `details.conflicting_id && details.suggested_id`; anything else (e.g. `MODEL_NOT_IN_REGISTRY` when the catalog names a pruned model) toasts with the message in `detail`. It used to re-throw inside an async click handler — an unhandled rejection with no UI at all (`:143`).
- `closeAdd()` is a no-op while `installing`, so the dialog can't be dismissed mid-POST.
- Install invalidates `['agents']` **and** `['marketplace']` before navigating, so both the Agents list and the catalog's `is_installed` flags are correct on arrival.
- The suggested slug from `suggestAlternateSlug` appends a random 4-char suffix, so the retry effectively cannot collide again.

## Related pages
- [`27-marketplace.md`](27-marketplace.md) — the catalog grid and bulk install
- [`16-agent-detail.md`](16-agent-detail.md) — upgrade review, prompt editing

## Coming soon on this page
- None.
