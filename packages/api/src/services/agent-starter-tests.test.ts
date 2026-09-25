import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { adoptStarterTests } from './agent-starter-tests.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject } from '../../tests/_items.js';

// Adoption runs at install, on every boot and on upgrade, so the two things
// that matter are: it must not duplicate, and it must not overwrite the Owner.
// `agent-po-writer` is the fixture here because it ships two real tests.

const CATALOG_ID = 'agent-po-writer';

const rows = () =>
    testDb
        .selectFrom('agent_tests')
        .select(['id', 'name', 'project_id', 'source_test_id', 'source_hash'])
        .where('agent_id', '=', CATALOG_ID)
        .orderBy('source_test_id', 'asc')
        .execute();

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: CATALOG_ID });
});

afterAll(async () => {
    await closeTestDb();
});

describe('adoptStarterTests', () => {
    it('writes the shipped fixtures as real rows, bound to no project', async () => {
        const r = await adoptStarterTests(CATALOG_ID, CATALOG_ID);
        expect(r.inserted).toBeGreaterThan(0);
        const after = await rows();
        expect(after).toHaveLength(r.inserted);
        // Agent-scoped at rest (migration 021). Binding happens at run time,
        // because the item it materialises spends a real issue key.
        for (const row of after) {
            expect(row.project_id).toBeNull();
            expect(row.source_test_id).toBeTruthy();
            expect(row.source_hash).toBeTruthy();
        }
    });

    it('is idempotent — boot after boot changes nothing', async () => {
        await adoptStarterTests(CATALOG_ID, CATALOG_ID);
        const first = await rows();
        const second = await adoptStarterTests(CATALOG_ID, CATALOG_ID);
        expect(second).toEqual({ inserted: 0, upgraded: 0, skipped_edited: 0 });
        expect(await rows()).toEqual(first);
    });

    it('leaves a fixture the Owner edited alone, and says it did', async () => {
        await adoptStarterTests(CATALOG_ID, CATALOG_ID);
        const [mine] = await rows();
        await testDb
            .updateTable('agent_tests')
            .set({ name: 'my own name for it' })
            .where('id', '=', mine!.id)
            .execute();

        const r = await adoptStarterTests(CATALOG_ID, CATALOG_ID);
        expect(r.skipped_edited).toBe(1);
        expect((await rows()).find((x) => x.id === mine!.id)?.name).toBe('my own name for it');
    });

    it('upgrades an untouched fixture when the bundle body changes', async () => {
        await adoptStarterTests(CATALOG_ID, CATALOG_ID);
        const [row] = await rows();
        // Simulate a bundle that has moved on: the row is unedited (its hash
        // still matches its body) but the hash is not what the catalog produces
        // now, which is exactly the upgrade case.
        await testDb
            .updateTable('agent_tests')
            .set({ name: 'stale copy', source_hash: null })
            .where('id', '=', row!.id)
            .execute();
        const { bodyHashForTest } = await import('./agent-starter-tests.js');
        const current = await testDb
            .selectFrom('agent_tests')
            .select(['name', 'item_template', 'expectations'])
            .where('id', '=', row!.id)
            .executeTakeFirstOrThrow();
        await testDb
            .updateTable('agent_tests')
            .set({ source_hash: bodyHashForTest(current) })
            .where('id', '=', row!.id)
            .execute();

        const r = await adoptStarterTests(CATALOG_ID, CATALOG_ID);
        expect(r.upgraded).toBe(1);
        expect((await rows()).find((x) => x.id === row!.id)?.name).not.toBe('stale copy');
    });

    // Every catalog bundle ships three now, so the no-op case is an agent the
    // Owner wrote themselves: nothing upstream to adopt from.
    it('does nothing for an agent with no catalog bundle behind it', async () => {
        await insertAgent({ id: 'agent-my-own' });
        expect(await adoptStarterTests('agent-my-own', 'agent-my-own')).toEqual({
            inserted: 0,
            upgraded: 0,
            skipped_edited: 0,
        });
    });
});
