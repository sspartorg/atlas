import { db } from '../db/kysely-client.js';
import { ALL_TOOL_REGISTRATIONS } from '@atlas/mcp/registrations';

// A06 — single source of truth for what shows up in the Allowed Tools picker.
//
// History: this file used to hand-curate a 12-entry array that mirrored a
// subset of the MCP tool registrations. It drifted — when feat(08) added
// `getAgentMemory` / `updateAgentMemory` and later themes added guardrails /
// reminders / item-link / similar-items / project tools, the picker had no
// way to surface them, so the Owner couldn't grant them through the UI even
// though the agent runner would honor them if granted some other way.
//
// Now: the canonical list lives in `@atlas/mcp/registrations`. Every MCP tool
// registration carries the `group_name`, `description`, and `sort_order` the
// picker needs, plus an `excludeFromCatalog` flag for runner-injected-only
// tools (none today — Task 12 retired the previous occupants of that flag).
//
// Adding a new MCP tool is one edit in `@atlas/mcp/tools/<group>.ts`; the
// picker and the MCP server both pick it up on the next API boot.
interface ToolCatalogEntry {
    tool_name: string;
    group_name: string;
    description: string;
    sort_order: number;
}

function projectRegistrations(): ToolCatalogEntry[] {
    return ALL_TOOL_REGISTRATIONS.filter((t) => !t.excludeFromCatalog).map((t) => ({
        tool_name: t.name,
        group_name: t.group_name,
        description: t.description,
        sort_order: t.sort_order,
    }));
}

export async function syncToolCatalog(): Promise<void> {
    const catalog = projectRegistrations();
    // Upsert-by-replace: easier than per-row diffing, and the catalog is
    // small (single-digit rows per group). agent_allowed_tools.tool_name
    // is a free-text reference (no FK constraint), so delete + insert is
    // safe — granted-but-no-longer-registered names get filtered at lookup
    // time by the matrix UI's LEFT JOIN.
    await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('tool_catalog').execute();
        /* v8 ignore next — ALL_TOOL_REGISTRATIONS always has entries in practice */
        if (catalog.length === 0) return;
        await trx.insertInto('tool_catalog').values(catalog).execute();
    });
}
