# Onboarding

**Route:** `/onboarding` • **Component:** `packages/web/src/pages/Onboarding.tsx` • **Slug:** `01-onboarding`

## Purpose
Two-step setup wizard the user is forced through on first boot. Captures owner name + accent color, then workspace folder. On submit, flips `settings.onboarding_complete` and redirects to `/`.

## States
- **Loading**: `settings.isPending` → `WizardSkeleton` (Onboarding.tsx:272-274)
- **Step 1 — Display Name + Accent** (lines 322-464)
- **Step 2 — Workspace Path** (lines 465-596)
- **Submitting**: `submitState === 'submitting'` disables buttons; spinner on Finish (line 572)
- **Success**: `SuccessView` (line 320), 5s delay then auto-navigate to `/` (line 202)
- **Error**: submit error shown below action row (lines 583-594)

## UI elements
**Step 1**
- **Display name** TextField (line 362) — required; Enter advances to step 2 (line 366)
- **Accent color swatches** (lines 409-443) — 6-option radio group; arrow keys cycle (lines 257-269)
- **Next** button (lines 455-462) — validates name, advances to step 2

**Step 2**
- **Workspace path** FolderPicker (lines 502-510) — opens native folder dialog; Enter triggers Finish (line 508)
- **Info Alert** (lines 528-552) — "You can change it later in Settings → Environment"
- **Back** button (lines 557-564) — returns to step 1; disabled during submit
- **Finish Setup** button (lines 566-580) — calls `api.settings.onboard()` (line 245)

## Why these affordances exist
- **Display name** — Every artifact (plans, comments, reporter chips) is signed against the Owner; with no users table, this string is the only identity the app can stamp.
- **Accent color** — Reused as the Owner chip everywhere; picking it during onboarding avoids a second forced Settings detour.
- **Workspace folder** — Hosts the SQLite DB and every cloned repo; the app refuses to render the post-onboarding shell until a real path exists.
- **Finish Setup** — Single submit that flips `onboarding_complete`; collapses three separate writes into the only transaction the app is guaranteed to make.

## Modals / drawers
None. `FolderPicker` opens the OS dialog directly.

## Hooks used
- `useSettings()` — fetches settings (line 169); also used by the success-state poll
- `useQueryClient()` — prefetches dashboard/agents/projects/counts/notifications during the 5s success window (lines 184-200)

## API endpoints touched
- `POST /api/settings/onboard` — `{ owner_name, accent_color, workspace_path }` (line 245)
- Prefetched during success: `GET /api/counts/dashboard`, `/api/agents`, `/api/projects`, `/api/counts`, `/api/notifications`

## Permissions / guards
- This is the **only** route exempt from the onboarding redirect. The route guard (App.tsx:61-88) sends every other path to `/onboarding` until `settings.onboarding_complete` is true, and once true, sends `/onboarding` → `/`.

## Edge cases / quirks
- `pendingSettings` ref (line 179) caches the API response before the navigation delay so the dashboard renders with fresh data the instant the redirect fires.
- Workspace error text clears as soon as the user changes the path (lines 211-220).
- Color selection persists into `settings.accent_color` and is reused for the Owner chip everywhere.

## Connectivity
- **Pages**: [Dashboard](01-dashboard.md) — post-onboarding redirect target; [Settings → Profile](19-settings.md) — owner_name, accent, workspace_path are all re-editable here once onboarding completes.
- **Routes**: `POST /api/settings/onboard` — the only mutation that flips `onboarding_complete`; the prefetch fan-out (`/api/counts/dashboard`, `/api/agents`, `/api/projects`, `/api/counts`, `/api/notifications`) primes the Dashboard so the redirect feels instant rather than skeleton-first.
- **Entities**: `settings` (single row) — see `data-model.md`.

## Coming soon on this page
None.
