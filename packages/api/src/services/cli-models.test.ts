import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { sql } from 'kysely';
import { cliModelsService } from './cli-models.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

// Workstream #4 — `cli_models` is no longer truncated by `truncateAll`
// (it's a static registry). This test exercises the service's CRUD
// against an empty registry, so we wipe it in beforeEach. To avoid
// poisoning later test files in the same session, restore the
// migration-001 + 059 baseline rows in afterAll.

const BASELINE_CLI_MODELS: ReadonlyArray<{ id: string; cli: 'claude' | 'copilot'; model_name: string; sort_order: number }> = [
    { id: 'seed-claude-opus-4-7', cli: 'claude', model_name: 'claude-opus-4-7', sort_order: 1 },
    { id: 'seed-claude-opus-4-7-1m', cli: 'claude', model_name: 'claude-opus-4-7[1m]', sort_order: 2 },
    { id: 'seed-claude-opus-4-6', cli: 'claude', model_name: 'claude-opus-4-6', sort_order: 3 },
    { id: 'seed-claude-sonnet-4-6', cli: 'claude', model_name: 'claude-sonnet-4-6', sort_order: 4 },
    { id: 'seed-claude-haiku', cli: 'claude', model_name: 'haiku', sort_order: 5 },
    { id: 'seed-copilot-sonnet-4-6', cli: 'copilot', model_name: 'claude-sonnet-4.6', sort_order: 1 },
    { id: 'seed-copilot-sonnet-4-5', cli: 'copilot', model_name: 'claude-sonnet-4.5', sort_order: 2 },
    { id: 'seed-copilot-haiku-4-5', cli: 'copilot', model_name: 'claude-haiku-4.5', sort_order: 3 },
    { id: 'seed-copilot-opus-4-6', cli: 'copilot', model_name: 'claude-opus-4.6', sort_order: 4 },
    { id: 'seed-copilot-opus-4-5', cli: 'copilot', model_name: 'claude-opus-4.5', sort_order: 5 },
    { id: 'seed-copilot-gpt-5-4', cli: 'copilot', model_name: 'gpt-5.4', sort_order: 6 },
    { id: 'seed-copilot-gpt-5-3-codex', cli: 'copilot', model_name: 'gpt-5.3-codex', sort_order: 7 },
    { id: 'seed-copilot-gpt-5-4-mini', cli: 'copilot', model_name: 'gpt-5.4-mini', sort_order: 8 },
    { id: 'seed-copilot-gpt-4-1', cli: 'copilot', model_name: 'gpt-4.1', sort_order: 9 },
    { id: 'seed-copilot-opus-4-7', cli: 'copilot', model_name: 'claude-opus-4.7', sort_order: 10 },
    { id: 'seed-copilot-gpt-5-2', cli: 'copilot', model_name: 'gpt-5.2', sort_order: 11 },
];

beforeEach(async () => {
    await truncateAll();
    // CASCADE drops the agents_cli_model_fk-dependent agent rows, which
    // truncateAll has already cleared by the time we get here.
    await sql`TRUNCATE cli_models RESTART IDENTITY CASCADE`.execute(testDb);
});

afterAll(async () => {
    // Restore the registry baseline so later test files in the same
    // session (which expect cli_models to be populated by migrations)
    // don't fail their `agents_cli_model_fk` FK on agent inserts.
    await testDb
        .insertInto('cli_models')
        .values(BASELINE_CLI_MODELS.map((r) => ({ ...r, note: null })))
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();
    await closeTestDb();
});

describe('cliModelsService', () => {
    it('list returns rows ordered by cli, sort_order, model_name', async () => {
        await cliModelsService.create({ cli: 'claude', model_name: 'opus', note: null });
        await cliModelsService.create({ cli: 'copilot', model_name: 'sonnet', note: null });
        const list = await cliModelsService.list();
        expect(list).toHaveLength(2);
        expect(list[0]!.cli).toBe('claude');
    });

    it('create assigns a sort_order that increments per-cli', async () => {
        const a = await cliModelsService.create({ cli: 'claude', model_name: 'm1', note: null });
        const b = await cliModelsService.create({ cli: 'claude', model_name: 'm2', note: null });
        const c = await cliModelsService.create({ cli: 'copilot', model_name: 'm1', note: null });
        expect(a.sort_order).toBe(1);
        expect(b.sort_order).toBe(2);
        expect(c.sort_order).toBe(1);
    });

    it('rejects an unknown cli (check constraint)', async () => {
        await expect(
            cliModelsService.create({
                cli: 'ollama' as unknown as 'claude',
                model_name: 'foo',
                note: null,
            }),
        ).rejects.toThrow();
    });

    it('rejects duplicate (cli, model_name) per UNIQUE', async () => {
        await cliModelsService.create({ cli: 'claude', model_name: 'opus', note: null });
        await expect(
            cliModelsService.create({ cli: 'claude', model_name: 'opus', note: 'dup' }),
        ).rejects.toThrow();
    });

    it('update returns null for missing id', async () => {
        expect(await cliModelsService.update('nope', { note: 'x' })).toBeNull();
    });

    it('update returns the row unchanged when no defined patches', async () => {
        const a = await cliModelsService.create({ cli: 'claude', model_name: 'm', note: 'orig' });
        const r = await cliModelsService.update(a.id, {});
        expect(r!.note).toBe('orig');
    });

    it('update patches note', async () => {
        const a = await cliModelsService.create({ cli: 'claude', model_name: 'm', note: 'orig' });
        const r = await cliModelsService.update(a.id, { note: 'new' });
        expect(r!.note).toBe('new');
    });

    it('update patches sort_order', async () => {
        const a = await cliModelsService.create({ cli: 'claude', model_name: 'm', note: null });
        const r = await cliModelsService.update(a.id, { sort_order: 99 });
        expect(r!.sort_order).toBe(99);
    });

    it('update can set note to null explicitly', async () => {
        const a = await cliModelsService.create({ cli: 'claude', model_name: 'm', note: 'orig' });
        const r = await cliModelsService.update(a.id, { note: null });
        expect(r!.note).toBeNull();
    });

    it('remove deletes the row', async () => {
        const a = await cliModelsService.create({ cli: 'claude', model_name: 'm', note: null });
        await cliModelsService.remove(a.id);
        expect(await cliModelsService.list()).toEqual([]);
    });
});
