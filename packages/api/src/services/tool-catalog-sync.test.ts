import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_TOOL_REGISTRATIONS } from '@atlas/mcp/registrations';
import { testDb, truncateAll } from '../../tests/_pg-db.js';
import { syncToolCatalog } from './tool-catalog-sync.js';

// A06 — guards the picker → MCP coupling. After `syncToolCatalog()`:
//   1. every non-excluded registration shows up as a `tool_catalog` row
//   2. no stale rows remain (delete-then-insert idempotency)
//   3. Task 12 retired the previous occupants of `excludeFromCatalog`
//      (`submit_review`, `performer_done`); the test simply verifies
//      they no longer appear as catalog entries at all.
describe('tool-catalog-sync', () => {
    beforeEach(async () => {
        await truncateAll();
    });

    it('seeds one row per non-excluded MCP registration', async () => {
        await syncToolCatalog();
        const rows = await testDb
            .selectFrom('tool_catalog')
            .selectAll()
            .execute();

        const expected = ALL_TOOL_REGISTRATIONS.filter((t) => !t.excludeFromCatalog);
        expect(rows).toHaveLength(expected.length);

        const rowNames = new Set(rows.map((r) => r.tool_name));
        for (const reg of expected) {
            expect(rowNames.has(reg.name)).toBe(true);
        }
    });

    it('does not surface the retired `submit_review` / `performer_done` tools', async () => {
        await syncToolCatalog();
        for (const name of ['submit_review', 'performer_done']) {
            const row = await testDb
                .selectFrom('tool_catalog')
                .select('tool_name')
                .where('tool_name', '=', name)
                .executeTakeFirst();
            expect(row, `${name} should not appear in the catalog`).toBeUndefined();
        }
    });

    it('is idempotent — re-running replaces but does not duplicate', async () => {
        await syncToolCatalog();
        const firstCount = (
            await testDb.selectFrom('tool_catalog').selectAll().execute()
        ).length;
        await syncToolCatalog();
        const secondCount = (
            await testDb.selectFrom('tool_catalog').selectAll().execute()
        ).length;
        expect(secondCount).toBe(firstCount);
    });

    it('carries the MCP description verbatim into the catalog', async () => {
        await syncToolCatalog();
        const rows = await testDb
            .selectFrom('tool_catalog')
            .selectAll()
            .execute();
        const byName = new Map(rows.map((r) => [r.tool_name, r]));
        for (const reg of ALL_TOOL_REGISTRATIONS) {
            if (reg.excludeFromCatalog) continue;
            const row = byName.get(reg.name);
            expect(row, `missing row for ${reg.name}`).toBeDefined();
            expect(row?.description).toBe(reg.description);
            expect(row?.group_name).toBe(reg.group_name);
            expect(row?.sort_order).toBe(reg.sort_order);
        }
    });
});
