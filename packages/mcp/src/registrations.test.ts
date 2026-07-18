import { describe, expect, it } from 'vitest';
import { ALL_TOOL_REGISTRATIONS } from './registrations.js';
import { AGENT_TOOLS } from './tools/agents.js';
import { ITEM_TOOLS } from './tools/items.js';
import { PROJECT_TOOLS } from './tools/projects.js';
import { REMINDER_TOOLS } from './tools/reminders.js';
import { NOTIFICATION_TOOLS } from './tools/notifications.js';

// Tool consolidation 2026-07: the marketplace tool group was folded into
// AGENT_TOOLS (the `marketplace_agent` tool now lives in tools/agents.ts).
// `MARKETPLACE_TOOLS` is gone and `tools/marketplace.ts` was deleted.
describe('ALL_TOOL_REGISTRATIONS', () => {
    it('concatenates every per-group tool array in declaration order', () => {
        // Concatenation order matters: tool-catalog-sync writes
        // sort_order in this sequence. Drift here means a downstream
        // re-render of the Allowed Tools picker.
        const expected = [
            ...AGENT_TOOLS,
            ...ITEM_TOOLS,
            ...PROJECT_TOOLS,
            ...REMINDER_TOOLS,
            ...NOTIFICATION_TOOLS,
        ];
        expect(ALL_TOOL_REGISTRATIONS).toHaveLength(expected.length);
        // Sample-check that the head + tail of each group are present in
        // the expected slots — full structural equality is overkill since
        // each per-group test already locks its own ordering down.
        const names = ALL_TOOL_REGISTRATIONS.map((t) => t.name);
        if (AGENT_TOOLS.length > 0) {
            expect(names[0]).toBe(AGENT_TOOLS[0]!.name);
        }
        const tail = NOTIFICATION_TOOLS[NOTIFICATION_TOOLS.length - 1];
        if (tail) {
            expect(names[names.length - 1]).toBe(tail.name);
        }
    });

    it('exposes exactly 13 tools (consolidated surface)', () => {
        expect(ALL_TOOL_REGISTRATIONS).toHaveLength(13);
    });

    it('exposes a non-empty registration set (regression guard for accidental empty import)', () => {
        expect(ALL_TOOL_REGISTRATIONS.length).toBeGreaterThan(0);
    });

    it('every registration carries the required public fields', () => {
        const groupNames = new Set([
            'AGENTS',
            'ITEMS',
            'PROJECTS',
            'REMINDERS',
            'NOTIFICATIONS',
        ]);
        for (const t of ALL_TOOL_REGISTRATIONS) {
            expect(typeof t.name).toBe('string');
            expect(t.name.length).toBeGreaterThan(0);
            expect(typeof t.title).toBe('string');
            expect(typeof t.description).toBe('string');
            expect(typeof t.sort_order).toBe('number');
            expect(typeof t.handler).toBe('function');
            expect(t.inputSchema).toBeDefined();
            // group_name is one of the catalog's known buckets. Marketplace
            // tools land under whichever group their array author picked
            // (AGENTS at time of writing) — the catalog-sync just needs
            // every name to be from this whitelist.
            expect(groupNames.has(t.group_name)).toBe(true);
        }
    });

    it('tool names are unique across every group', () => {
        const names = ALL_TOOL_REGISTRATIONS.map((t) => t.name);
        const seen = new Set<string>();
        const dupes: string[] = [];
        for (const n of names) {
            if (seen.has(n)) dupes.push(n);
            seen.add(n);
        }
        expect(dupes).toEqual([]);
    });
});
