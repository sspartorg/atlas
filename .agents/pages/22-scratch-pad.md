# Scratch Pad

**Route:** `/scratch-pad` • **Component:** `packages/web/src/pages/ScratchPad.tsx` • **Sidenav:** under WORKSPACE, immediately below Dashboard.

## Purpose
A free-form markdown-tile workspace for the Owner. Use it to capture half-formed thoughts, meeting notes, or rough ideas before they become an Epic or a Story. Each tile is a standalone markdown document — no linkage to projects, items, or agents.

## States
- Loading — no loader chrome; React Query stale-while-revalidate keeps the page populated across navigations.
- Empty — `HeroEmptyState` "No scratch pad tiles yet" with copy: "Use New tile to capture a thought. Tiles autosave every 5 seconds while open."
- Populated — responsive CSS grid (`auto-fill, minmax(260px, 1fr)`) of tile cards, sorted newest-first by `updated_at`.

## UI elements
**Page header**
- Title `Scratch Pad` + one-line description.
- **New tile** button → calls `useCreateScratchPad()` with `{}`. On success, opens the editor pointed at the new tile.

**Tile card (`TileCard`)**
- Title (bold, 2-line clamp; falls back to "Untitled tile" when blank).
- Body preview (5-line clamp, first 140 chars trimmed; placeholder italic when blank).
- Updated-at timestamp, short locale format (e.g. `May 28, 6:14 PM`).
- Click anywhere → opens the editor modal.

## Modal — `ScratchPadEditor` (`packages/web/src/components/ScratchPadEditor.tsx`)
- Plain Google-Keep-style surface: single full-height `<textarea>` (min-height 60vh, max-height 80vh, line-height 1.6). No markdown preview, no view-mode chips, no formatting toolbar.
- Title editable inline at the top of the dialog; placeholder reads "Title (auto from first 3 words if blank)".
- Delete icon (header) — clicking it opens the shared `ConfirmDeleteModal` (same component used by epics / stories / bugs / projects / agents). Confirming deletes the tile via `useDeleteScratchPad(id)` and closes the editor on success.
- Close icon — flushes pending changes synchronously, then closes.
- Footer: soft "Saved · 12s ago" indicator (relative time, re-ticks every second while the modal is open) or "Saving..." while a mutation is in flight.
- Autosave debounce: 5000 ms after the last keystroke. The autosave compares against the last-saved snapshot, so an idle modal doesn't re-fire PATCH every 5 s.
- **Inferred title:** when the user closes (or the autosave fires) with a blank title, the editor sends the first 3 whitespace-separated words of the body as the title, or `"Untitled"` if the body is also blank. `packages/api/src/services/scratch-pad.ts` re-applies the same `inferTitle()` logic server-side as a backstop for MCP and scripted callers.

## Why these affordances exist
- **Single-page grid, no tabs** — scratch pad is a pad, not a system; one flat surface is the whole point.
- **Local-first edit state** — the modal keeps title + body in `useState`, not in React Query. Typing stays fluid even if PATCH is slow / queued.
- **5s autosave + flush on close** — the spec called for autosave every 5 s + on close; the implementation does both with a single ref-tracked snapshot so we never re-write identical bytes.
- **Delete uses the shared modal** — every deletable in the app (epics, stories, bugs, projects, agents, credentials) routes through `ConfirmDeleteModal`; scratch pad matches that convention so the destructive-action UX stays uniform.

## Hooks used
- `useScratchPadList()` — list query (`['scratch-pad']`).
- `useCreateScratchPad()` — create mutation (invalidates list on success).
- `useUpdateScratchPad()` — patch mutation (invalidates list).
- `useDeleteScratchPad()` — delete mutation (invalidates list).
- `useSetPageTitle('Scratch Pad')`.
- `useToast()` — surfaces create failures.

## API endpoints touched
- `GET /api/scratch-pad` — list.
- `POST /api/scratch-pad` — create.
- `PATCH /api/scratch-pad/:id` — update title / body_md.
- `DELETE /api/scratch-pad/:id` — delete.

## Coming soon on this page
None.
