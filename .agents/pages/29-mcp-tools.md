# MCP Tools

**Route:** `/agents/mcp-tools`  •  **Component:** `packages/web/src/pages/McpTools.tsx`

## Purpose
Read-only reference for what an agent can actually call — the same catalogue the
Agent Detail used to offer — that picker was removed by B14, so this catalogue is now the single reader. *(corrected 2026-09-20 — campaign task-21.)*

## States
- Loading: three `<Skeleton>` rows inside a group shell (`:82`).
- Error: `isError` → a bordered panel (`:64`).
- Empty: `groups.length === 0` → dashed panel, "No MCP tools registered." (`:184`).
- Populated: one section per group, each with a `prettyGroupLabel(group.group_name)` heading, a count chip, and the group's tools as rows.

## UI elements
Nothing interactive. Every element is a label:
- Breadcrumb — **Agents** → `/agents`, then **MCP Tools** (`:34`).
- Subtitle — `{totalTools} tools · {groups.length} categories` (`:59`), rendered only when `totalTools > 0`.
- Per group: `GROUP_LABELS[key]` display name, falling back to `key.replace(/_/g,' ').toLowerCase()` for a group the label map doesn't know (`:20`).
- Per tool: name + description, as stored in `tool_catalog`.

## Modals / drawers
None.

## Hooks used
- `useQuery(['tool-catalog'])` → `api.toolCatalog.get()`. No refetch policy; the data only changes on API boot.

## API endpoints touched
- `GET /api/tool-catalog` — returns `{groups: IToolCatalogGroup[]}`, grouped server-side from the `tool_catalog` table ordered by `sort_order` (`routes/tool-catalog.ts:10`)

## Permissions / guards
- Auth: post-onboarding only. Read-only route, no token gate.

## Edge cases / quirks
- **The table is derived, never hand-maintained.** `syncToolCatalog` runs as a boot step (`main.ts:288`) and projects from `ALL_TOOL_REGISTRATIONS` in `packages/mcp/src/tools/registrations.ts`. Adding an MCP tool means adding it to its `<GROUP>_TOOLS` array — this page and the Allowed Tools picker both follow automatically. Editing `tool_catalog` rows by hand is pointless; the next boot overwrites them.
- A tool marked `excludeFromCatalog` in its registration never reaches the table, so it will not appear here.
- `{totalTools} tools · {groups.length} categories` has no singular form. Cosmetic; see the plural note in `functional-checklist.md`.

## Related pages
- [`16-agent-detail.md`](16-agent-detail.md) — the Allowed Tools picker that consumes the same catalogue
- [`api-surface.md`](../api-surface.md) — MCP tool catalogue section (A06)

## Coming soon on this page
- None.
