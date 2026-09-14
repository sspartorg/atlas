import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import Knex from 'knex';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent } from '../../tests/_items.js';
import {
    CHECKLIST_LABEL_UPDATES,
    DESCRIPTION_UPDATES,
    up,
    down,
} from './migrations/034_catalog_description_checklist_sync.js';

const knex = Knex({ client: 'pg', connection: process.env['DATABASE_URL'] ?? '', pool: { min: 0, max: 1 } });
const catalog = (agent: string, file: string) =>
    readFileSync(join(import.meta.dirname, '..', 'marketplace', 'catalog', agent, file), 'utf8');

afterAll(async () => {
    await knex.destroy();
});

describe('migration 034 targets match the current catalog', () => {
    it.each(DESCRIPTION_UPDATES.map((u) => [u.agentId, u.to]))('%s description', (agentId, to) => {
        expect((JSON.parse(catalog(agentId, 'manifest.json')) as { description: string }).description).toBe(to);
    });

    it('coder checklist labels', () => {
        const labels = (JSON.parse(catalog('agent-coder', 'checklists.json')) as Array<{ label: string }>).map(
            (c) => c.label,
        );
        for (const u of CHECKLIST_LABEL_UPDATES) expect(labels).toContain(u.to);
    });
});

describe('migration 034 — installed agent description + checklist sync', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertAgent({ id: 'agent-coder' });
        await insertAgent({ id: 'agent-qa-reviewer' });
    });

    it('rewrites prior catalog values and leaves Owner edits alone, and down() restores', async () => {
        const coder = DESCRIPTION_UPDATES.find((u) => u.agentId === 'agent-coder');
        const [oldCoder] = coder?.from ?? [];
        await testDb.updateTable('agents').set({ description: oldCoder ?? '' }).where('id', '=', 'agent-coder').execute();
        await testDb.updateTable('agents').set({ description: 'Owner wrote this' }).where('id', '=', 'agent-qa-reviewer').execute();
        await testDb
            .insertInto('agent_checklists')
            .values([
                { agent_id: 'agent-coder', label: 'pnpm typecheck clean across affected packages', sort_order: 0, required: true },
                { agent_id: 'agent-coder', label: 'Owner custom check', sort_order: 1, required: true },
            ])
            .execute();

        await up(knex);
        const desc = async (id: string) =>
            (await testDb.selectFrom('agents').select('description').where('id', '=', id).executeTakeFirstOrThrow()).description;
        const labels = async () =>
            (await testDb.selectFrom('agent_checklists').select('label').orderBy('sort_order').execute()).map((r) => r.label);

        expect(await desc('agent-coder')).toBe(coder?.to);
        expect(await desc('agent-qa-reviewer')).toBe('Owner wrote this');
        expect(await labels()).toEqual(['Project typecheck and lint scripts clean (where declared)', 'Owner custom check']);

        await down(knex);
        expect(await desc('agent-coder')).toBe(oldCoder);
        expect(await labels()).toEqual(['pnpm typecheck clean across affected packages', 'Owner custom check']);
    });
});
