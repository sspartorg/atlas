import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { syncAgentDefaults } from './agent-defaults-sync.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

// Task 12 — `agent-defaults-sync` now reads from the `marketplace_agents`
// table (the catalog-backed source of truth) instead of the legacy
// `AGENT_SEEDS` array. Both performer- and reviewer-role rows flow
// through the same `prompt_version === 1 && prompt_md !== catalog`
// gate.

async function insertCatalogEntry(id: string, prompt_md: string): Promise<void> {
    await testDb
        .insertInto('marketplace_agents')
        .values({
            id,
            name: id,
            category: 'software-dev',
            cli: 'claude',
            model: 'claude-opus-4-7',
            framework: 'sdlc',
            description: 'test',
            designation: 'test',
            accent_color: '#000000',
            sort_order: 1,
            glyph: 'engineering',
            role_id: null,
            status: 'active',
            kind_slug: 'custom',
            settings_json: JSON.stringify({}) as never,
            memory_cadence: 1,
            effort: 'medium',
            prompt_md,
            content_hash: id,
            version: 1,
            summary: 'test',
            published_at: new Date('2026-06-08T00:00:00Z'),
        })
        .onConflict((oc) => oc.column('id').doUpdateSet({ prompt_md }))
        .execute();
}

async function insertInstalledAgent(
    id: string,
    overrides: { prompt_md: string; prompt_version: number },
): Promise<void> {
    await testDb
        .insertInto('cli_models')
        .values({
            id: `test-cli-claude-claude-opus-4-7`,
            cli: 'claude',
            model_name: 'claude-opus-4-7',
            note: null,
            sort_order: 0,
        })
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();
    await testDb
        .insertInto('agents')
        .values({
            id,
            name: id,
            category: 'software-dev',
            cli: 'claude',
            model: 'claude-opus-4-7',
            framework: 'sdlc',
            description: '',
            designation: '',
            accent_color: '#000000',
            sort_order: 1,
            glyph: 'engineering',
            role_id: null,
            status: 'active',
            kind_slug: 'custom',
            settings_json: JSON.stringify({}) as never,
            memory_cadence: 1,
            effort: 'medium',
            prompt_md: overrides.prompt_md,
            prompt_version: overrides.prompt_version,
        })
        .execute();
}

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('syncAgentDefaults — catalog-driven reconciliation', () => {
    it('patches agent prompt_md when prompt_version === 1 and the body differs from the catalog', async () => {
        const CATALOG = '# Reviewer\n\nfresh catalog body';
        const STALE = '# Reviewer (stale)\n\nold body';
        await insertCatalogEntry('agent-po-reviewer', CATALOG);
        await insertInstalledAgent('agent-po-reviewer', {
            prompt_md: STALE,
            prompt_version: 1,
        });

        await syncAgentDefaults();

        const updated = await testDb
            .selectFrom('agents')
            .select(['prompt_md'])
            .where('id', '=', 'agent-po-reviewer')
            .executeTakeFirst();

        expect(updated?.prompt_md).toBe(CATALOG);
    });

    it('does NOT touch agent prompt_md when prompt_version > 1 (Owner has edited)', async () => {
        const CATALOG = '# catalog body';
        const OWNER_EDIT = '# Owner custom\n\nno brainstorm-exit on purpose';
        await insertCatalogEntry('agent-po-reviewer', CATALOG);
        await insertInstalledAgent('agent-po-reviewer', {
            prompt_md: OWNER_EDIT,
            prompt_version: 2,
        });

        await syncAgentDefaults();

        const updated = await testDb
            .selectFrom('agents')
            .select(['prompt_md'])
            .where('id', '=', 'agent-po-reviewer')
            .executeTakeFirst();

        expect(updated?.prompt_md).toBe(OWNER_EDIT);
    });

    it('snapshots the patched body into agent_prompt_versions with the catalog edited_by tag', async () => {
        const CATALOG = '# fresh catalog body';
        await insertCatalogEntry('agent-po-reviewer', CATALOG);
        await insertInstalledAgent('agent-po-reviewer', {
            prompt_md: '# stale body',
            prompt_version: 1,
        });

        await syncAgentDefaults();

        const row = await testDb
            .selectFrom('agent_prompt_versions')
            .select(['body_md', 'version', 'edited_by'])
            .where('agent_id', '=', 'agent-po-reviewer')
            .where('version', '=', 1)
            .executeTakeFirst();

        expect(row).toBeDefined();
        expect(row?.body_md).toBe(CATALOG);
        expect(row?.edited_by).toBe('Owner (catalog sync)');
    });

    it('skips catalog entries whose prompt_md is empty (early-continue guard)', async () => {
        // Exercises the `cat.prompt_md.length === 0` guard on line 34.
        // A catalog entry with an empty body must not update the installed agent.
        await insertCatalogEntry('agent-empty-prompt', '');
        await insertInstalledAgent('agent-empty-prompt', {
            prompt_md: 'installed body',
            prompt_version: 1,
        });

        await syncAgentDefaults();

        const updated = await testDb
            .selectFrom('agents')
            .select(['prompt_md'])
            .where('id', '=', 'agent-empty-prompt')
            .executeTakeFirst();

        // The installed prompt was NOT clobbered with the empty catalog body.
        expect(updated?.prompt_md).toBe('installed body');
    });

    it('skips agents that have no matching marketplace_agents row', async () => {
        await insertInstalledAgent('agent-orphan', {
            prompt_md: 'whatever',
            prompt_version: 1,
        });

        await syncAgentDefaults();

        const updated = await testDb
            .selectFrom('agents')
            .select(['prompt_md'])
            .where('id', '=', 'agent-orphan')
            .executeTakeFirst();

        expect(updated?.prompt_md).toBe('whatever');
    });
});

// ADR 0024 — migration 020 rewrote every saved `gate` node to name a checker
// agent. Without this, the Owner's existing Delivery workflow parks on its
// first gate with "agent-tests-check is missing or inactive", which is a
// migration that only half happened.
describe('syncAgentDefaults — agents an installed workflow needs', () => {
    async function workflowNaming(agentId: string): Promise<void> {
        await testDb
            .insertInto('workflows')
            .values({
                id: `wf-${agentId}`,
                project_id: null,
                name: 'Delivery',
                // `none` + no worktree is the one shape that needs no project
                // (`workflows_project_required_check`): this test is about
                // scanning saved graphs, not about what a workflow runs on.
                input_kind: 'none',
                use_worktree: false,
                trigger: 'manual',
                graph: JSON.stringify({
                    nodes: [
                        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                        { id: 'cov', type: 'gate', agent_id: agentId, position: { x: 0, y: 1 } },
                        { id: 'end', type: 'end', position: { x: 0, y: 2 } },
                    ],
                    edges: [
                        { id: 'e1', source: 'start', target: 'cov', kind: 'pass' },
                        { id: 'e2', source: 'cov', target: 'end', kind: 'pass' },
                    ],
                }),
            } as never)
            .execute();
    }

    it('installs a published agent a saved graph names but nobody installed', async () => {
        await insertCatalogEntry('agent-tests-check', 'checker prompt');
        await workflowNaming('agent-tests-check');

        await syncAgentDefaults();

        const row = await testDb
            .selectFrom('agents')
            .select(['id', 'prompt_md'])
            .where('id', '=', 'agent-tests-check')
            .executeTakeFirst();
        expect(row).toMatchObject({ id: 'agent-tests-check', prompt_md: 'checker prompt' });
    });

    // Narrow on purpose: completing a migration is not licence to install the
    // whole catalog behind the Owner's back.
    it('installs nothing for a published agent no workflow names', async () => {
        await insertCatalogEntry('agent-market-research', 'scout prompt');

        await syncAgentDefaults();

        expect(
            await testDb.selectFrom('agents').select('id').where('id', '=', 'agent-market-research').executeTakeFirst(),
        ).toBeUndefined();
    });

    it('does not fail the boot when an agent cannot be installed', async () => {
        // A model the Owner pruned from `cli_models` is the realistic case:
        // `install` throws on the FK, and boot must survive it.
        await insertCatalogEntry('agent-perf-check', 'checker prompt');
        await testDb
            .updateTable('marketplace_agents')
            .set({ model: 'model-that-is-not-registered' })
            .where('id', '=', 'agent-perf-check')
            .execute();
        await workflowNaming('agent-perf-check');

        await expect(syncAgentDefaults()).resolves.toBeUndefined();
        expect(
            await testDb.selectFrom('agents').select('id').where('id', '=', 'agent-perf-check').executeTakeFirst(),
        ).toBeUndefined();
    });
});
