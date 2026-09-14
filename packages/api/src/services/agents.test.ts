// Service-layer tests for agentsService (src/services/agents.ts).
// These test the DB operations directly, not via app.inject (that's
// src/routes/agents.test.ts).

import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

// Spy on the SSE bus so the broadcast assertions below can see it. The real
// module is harmless in tests (it writes to zero connected clients), but then
// there is nothing to assert against — and "the write happened but no client
// was told" is exactly the bug this guards.
vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
import { agentsService, ModelNotInRegistryError } from './agents.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { broadcastSSE } from '../routes/events.js';
import { insertProject, insertItem } from '../../tests/_items.js';
import { ApiError } from '../utils/errors.js';

// Minimal valid agent create input, reused across tests.
const BASE_AGENT = {
    name: 'Test Writer',
    category: 'software-dev' as const,
    cli: 'claude' as const,
    model: 'claude-opus-4-7',
    accent_color: '#31AB46',
};

beforeEach(async () => {
    await truncateAll();
    // Restore the (cli, model) row the insertAgent factory relies on.
    await testDb
        .insertInto('cli_models')
        .values({ id: 'test-cli-claude-opus-4-7', cli: 'claude', model_name: 'claude-opus-4-7', sort_order: 1, note: null })
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();
    await testDb
        .insertInto('cli_models')
        .values({ id: 'test-cli-copilot-model', cli: 'copilot', model_name: 'claude-sonnet-4.6', sort_order: 1, note: null })
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();
});

afterAll(async () => {
    await closeTestDb();
});

// ──────────────────────────────────────────────────────────────────────────────
// list / get
// ──────────────────────────────────────────────────────────────────────────────

describe('agentsService.list', () => {
    it('returns empty array when no agents exist', async () => {
        expect(await agentsService.list()).toEqual([]);
    });

    it('returns all agents ordered by name', async () => {
        await agentsService.create({ ...BASE_AGENT, name: 'Zebra Agent' });
        await agentsService.create({ ...BASE_AGENT, name: 'Alpha Agent' });
        const list = await agentsService.list();
        expect(list).toHaveLength(2);
        expect(list[0]!.name).toBe('Alpha Agent');
        expect(list[1]!.name).toBe('Zebra Agent');
    });
});

describe('agentsService.get', () => {
    it('returns the agent when it exists', async () => {
        const created = await agentsService.create(BASE_AGENT);
        const found = await agentsService.get(created.id);
        expect(found).toBeDefined();
        expect(found!.id).toBe(created.id);
        expect(found!.name).toBe('Test Writer');
    });

    it('returns undefined when agent does not exist', async () => {
        const found = await agentsService.get('does-not-exist');
        expect(found).toBeUndefined();
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// create
// ──────────────────────────────────────────────────────────────────────────────

describe('agentsService.create', () => {
    it('creates an agent with default values', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        expect(agent.name).toBe('Test Writer');
        expect(agent.status).toBe('active');
        expect(agent.prompt_version).toBe(1);
        expect(agent.kind_slug).toBe('custom');
        expect(agent.memory_cadence).toBe(1);
    });

    it('uses the provided id when specified', async () => {
        const agent = await agentsService.create({ ...BASE_AGENT, id: 'my-custom-id' });
        expect(agent.id).toBe('my-custom-id');
    });

    it('creates an initial agent_prompt_versions row', async () => {
        const agent = await agentsService.create({ ...BASE_AGENT, prompt_md: '# role' });
        const versions = await agentsService.listPromptVersions(agent.id);
        expect(versions).toHaveLength(1);
        expect(versions[0]!.version).toBe(1);
        expect(versions[0]!.body_md).toBe('# role');
    });

    it('seeds an agent_memory row', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        const mem = await testDb
            .selectFrom('agent_memory')
            .selectAll()
            .where('agent_id', '=', agent.id)
            .executeTakeFirst();
        expect(mem).toBeDefined();
        expect(mem!.body_md).toBe('');
    });

    it('throws ModelNotInRegistryError when model is not in cli_models', async () => {
        await expect(
            agentsService.create({ ...BASE_AGENT, model: 'totally-fake-model' }),
        ).rejects.toThrow(ModelNotInRegistryError);
    });

    it('creates agent with checklists when provided', async () => {
        const agent = await agentsService.create({
            ...BASE_AGENT,
            checklists: [
                { label: 'Tests pass', sort_order: 0, required: true },
                { label: 'Lint clean', sort_order: 1, required: false },
            ],
        });
        const checklists = await agentsService.getChecklists(agent.id);
        expect(checklists).toHaveLength(2);
        expect(checklists[0]!.label).toBe('Tests pass');
        expect(checklists[1]!.label).toBe('Lint clean');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// update
// ──────────────────────────────────────────────────────────────────────────────

describe('agentsService.update', () => {
    it('updates the agent name', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        const updated = await agentsService.update(agent.id, { name: 'Renamed Agent' });
        expect(updated.name).toBe('Renamed Agent');
    });

    it('bumps prompt_version when prompt_md changes', async () => {
        const agent = await agentsService.create({ ...BASE_AGENT, prompt_md: 'v1' });
        const updated = await agentsService.update(agent.id, { prompt_md: 'v2' });
        expect(updated.prompt_version).toBe(2);
        expect(updated.prompt_md).toBe('v2');
    });

    it('creates a new agent_prompt_versions row on prompt_md change', async () => {
        const agent = await agentsService.create({ ...BASE_AGENT, prompt_md: 'v1' });
        await agentsService.update(agent.id, { prompt_md: 'v2' });
        const versions = await agentsService.listPromptVersions(agent.id);
        expect(versions).toHaveLength(2);
        expect(versions[0]!.body_md).toBe('v2');
        expect(versions[1]!.body_md).toBe('v1');
    });

    it('replaces checklists when provided', async () => {
        const agent = await agentsService.create({
            ...BASE_AGENT,
            checklists: [{ label: 'Old item' }],
        });
        await agentsService.update(agent.id, {
            checklists: [{ label: 'New item 1' }, { label: 'New item 2' }],
        });
        const items = await agentsService.getChecklists(agent.id);
        expect(items).toHaveLength(2);
        expect(items[0]!.label).toBe('New item 1');
    });

    it('throws ModelNotInRegistryError when updating to unregistered model', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await expect(
            agentsService.update(agent.id, { model: 'fake-model' }),
        ).rejects.toThrow(ModelNotInRegistryError);
    });

    it('returns current row unchanged when no scalar changes are made', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        const result = await agentsService.update(agent.id, {});
        expect(result.id).toBe(agent.id);
        expect(result.name).toBe('Test Writer');
    });

    it('uses existing cli when only model is provided in update (line 422 branch)', async () => {
        // When update provides model but not cli, the code reads cli from the
        // existing row (data.cli ?? existing?.cli ?? null). This covers line 421-422.
        const agent = await agentsService.create({ ...BASE_AGENT, cli: 'claude', model: 'claude-opus-4-7' });
        // Patch only model — cli comes from existing row (still 'claude')
        const updated = await agentsService.update(agent.id, { model: 'claude-opus-4-7' });
        expect(updated.model).toBe('claude-opus-4-7');
        expect(updated.cli).toBe('claude');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// delete
// ──────────────────────────────────────────────────────────────────────────────

describe('agentsService.delete', () => {
    it('removes the agent from the database', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await agentsService.delete(agent.id);
        expect(await agentsService.get(agent.id)).toBeUndefined();
    });

    it('cascades: removes agent_memory on delete', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await agentsService.delete(agent.id);
        const mem = await testDb
            .selectFrom('agent_memory')
            .where('agent_id', '=', agent.id)
            .executeTakeFirst();
        expect(mem).toBeUndefined();
    });

    it('cascades: removes agent_prompt_versions on delete', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await agentsService.delete(agent.id);
        const versions = await testDb
            .selectFrom('agent_prompt_versions')
            .where('agent_id', '=', agent.id)
            .execute();
        expect(versions).toHaveLength(0);
    });

    it('refuses with a 409 ApiError while a workflow graph uses the agent', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await testDb
            .insertInto('workflows')
            .values({
                id: 'wf-1',
                name: 'Dev flow',
                input_kind: 'none',
                trigger: 'manual',
                use_worktree: false,
                graph: JSON.stringify({
                    nodes: [
                        { id: 'n1', type: 'agent', agent_id: agent.id, position: { x: 0, y: 0 } },
                    ],
                    edges: [],
                }),
            } as never)
            .execute();

        const err = await agentsService.delete(agent.id).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(409);
        expect((err as ApiError).kind).toBe('conflict');
        expect((err as ApiError).message).toContain('Dev flow');
        expect(await agentsService.get(agent.id)).toBeDefined();
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// getRuns
// ──────────────────────────────────────────────────────────────────────────────

describe('agentsService.getRuns', () => {
    it('returns empty list when agent has no runs', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        expect(await agentsService.getRuns(agent.id)).toEqual([]);
    });

    it('returns runs with item metadata', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'My Epic' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-1', agent_id: agent.id, item_id: 'ATL-1', status: 'completed' })
            .execute();

        const runs = await agentsService.getRuns(agent.id);
        expect(runs).toHaveLength(1);
        expect(runs[0]!.id).toBe('run-1');
        expect(runs[0]!.item_title).toBe('My Epic');
        expect(runs[0]!.status).toBe('completed');
    });

    it('returns runs newest first', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        await testDb.insertInto('agent_runs').values({ id: 'run-a', agent_id: agent.id, item_id: 'ATL-1', status: 'completed' }).execute();
        await testDb.insertInto('agent_runs').values({ id: 'run-b', agent_id: agent.id, item_id: 'ATL-1', status: 'error' }).execute();

        const runs = await agentsService.getRuns(agent.id);
        expect(runs).toHaveLength(2);
        // run-b was inserted last, so should be first (newest)
        expect(runs[0]!.id).toBe('run-b');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// getChecklists / setChecklists
// ──────────────────────────────────────────────────────────────────────────────

describe('agentsService.getChecklists / setChecklists', () => {
    it('returns empty list when no checklist items exist', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        expect(await agentsService.getChecklists(agent.id)).toEqual([]);
    });

    it('setChecklists replaces all items', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await agentsService.setChecklists(agent.id, [{ label: 'Alpha' }]);
        let items = await agentsService.getChecklists(agent.id);
        expect(items).toHaveLength(1);

        await agentsService.setChecklists(agent.id, [
            { label: 'Beta', sort_order: 0, required: true },
            { label: 'Gamma', sort_order: 1, required: false },
        ]);
        items = await agentsService.getChecklists(agent.id);
        expect(items).toHaveLength(2);
        expect(items[0]!.label).toBe('Beta');
        expect(items[1]!.label).toBe('Gamma');
        expect(items[1]!.required).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// listPromptVersions / revertPrompt
// ──────────────────────────────────────────────────────────────────────────────

describe('agentsService.listPromptVersions', () => {
    it('returns versions newest first', async () => {
        const agent = await agentsService.create({ ...BASE_AGENT, prompt_md: 'v1' });
        await agentsService.update(agent.id, { prompt_md: 'v2' });
        await agentsService.update(agent.id, { prompt_md: 'v3' });

        const versions = await agentsService.listPromptVersions(agent.id);
        expect(versions).toHaveLength(3);
        expect(versions[0]!.version).toBe(3);
        expect(versions[0]!.body_md).toBe('v3');
        expect(versions[2]!.version).toBe(1);
        expect(versions[2]!.body_md).toBe('v1');
    });
});

describe('agentsService.revertPrompt', () => {
    it('reverts the prompt to a previous version and bumps prompt_version', async () => {
        const agent = await agentsService.create({ ...BASE_AGENT, prompt_md: 'v1' });
        await agentsService.update(agent.id, { prompt_md: 'v2' });
        await agentsService.update(agent.id, { prompt_md: 'v3' });

        const reverted = await agentsService.revertPrompt(agent.id, 1);
        expect(reverted.prompt_md).toBe('v1');
        // Reverted to v1 which means prompt_version should now be 4
        expect(reverted.prompt_version).toBe(4);

        // A new version row should be created with reverted_from
        const versions = await agentsService.listPromptVersions(agent.id);
        const revertRow = versions.find((v) => v.reverted_from === 1);
        expect(revertRow).toBeDefined();
        expect(revertRow!.body_md).toBe('v1');
    });

    it('is a no-op (returns current agent) when reverting to the same content', async () => {
        const agent = await agentsService.create({ ...BASE_AGENT, prompt_md: 'same' });
        // Version 1 has 'same'; current is also 'same'
        const result = await agentsService.revertPrompt(agent.id, 1);
        expect(result.prompt_version).toBe(1); // unchanged
        // No extra version row created
        const versions = await agentsService.listPromptVersions(agent.id);
        expect(versions).toHaveLength(1);
    });

    it('throws when agent does not exist', async () => {
        await expect(agentsService.revertPrompt('missing-agent', 1)).rejects.toThrow(
            /Agent not found/,
        );
    });

    it('throws when version does not exist', async () => {
        const agent = await agentsService.create(BASE_AGENT);
        await expect(agentsService.revertPrompt(agent.id, 999)).rejects.toThrow(
            /Version not found/,
        );
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// SSE — 2026-09-12. Agent writes moved the sidenav `agents` badge and the
// dashboard `activeAgents` KPI and pushed nothing, so both sat stale until a
// hard reload. `architecture.md:348` has always required the broadcast; epics,
// stories and issues complied and agents did not. Marketplace install was
// patched at its own call site instead, which is why only that one path worked.
// ──────────────────────────────────────────────────────────────────────────────

describe('agentsService — SSE broadcast', () => {
    it('broadcasts counts_changed on create, update and delete', async () => {
        vi.mocked(broadcastSSE).mockClear();

        const agent = await agentsService.create(BASE_AGENT);
        expect(broadcastSSE).toHaveBeenCalledWith({ type: 'counts_changed' });

        vi.mocked(broadcastSSE).mockClear();
        await agentsService.update(agent.id, { status: 'inactive' });
        expect(broadcastSSE).toHaveBeenCalledWith({ type: 'counts_changed' });

        vi.mocked(broadcastSSE).mockClear();
        await agentsService.delete(agent.id);
        expect(broadcastSSE).toHaveBeenCalledWith({ type: 'counts_changed' });
    });

    it('does not broadcast when create fails — a rolled-back insert must not tell clients to refetch', async () => {
        vi.mocked(broadcastSSE).mockClear();
        await expect(
            agentsService.create({ ...BASE_AGENT, model: 'no-such-model' }),
        ).rejects.toThrow(ModelNotInRegistryError);
        expect(broadcastSSE).not.toHaveBeenCalled();
    });
});
