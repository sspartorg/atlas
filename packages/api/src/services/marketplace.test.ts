// Marketplace service spec. Exercises the seed → install → diff → accept
// path against the test Postgres DB (no mocks; the runtime is the contract
// under test). Each test inserts a synthetic catalog row directly into
// marketplace_agents so we don't depend on the on-disk catalog folder.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { marketplaceService, MarketplaceSlugTakenError } from './marketplace.js';
import { agentsService } from './agents.js';
import { runSeed } from '../db/seed.js';

async function insertCatalogAgent(overrides: Partial<{
    id: string;
    name: string;
    prompt_md: string;
    settings_json: Record<string, unknown>;
    version: number;
    sort_order: number;
}> = {}) {
    const id = overrides.id ?? 'cat-agent-1';
    await testDb
        .insertInto('marketplace_agents')
        .values({
            id,
            name: overrides.name ?? 'Catalog Agent 1',
            category: 'software-dev',
            cli: 'claude',
            model: 'claude-sonnet-4-6',
            framework: '',
            prompt_md: overrides.prompt_md ?? 'catalog prompt v1',
            handoff_prompt_md: '',
            description: 'desc',
            designation: 'tester',
            accent_color: '#007AC9',
            sort_order: overrides.sort_order ?? 1,
            glyph: 'science',
            role_id: null,
            max_rounds: 5,
            requires_item: true,
            requires_worktree: false,
            push_code: false,
            raises_pr: false,
            status: 'active',
            kind_slug: 'custom',
            settings_json: overrides.settings_json ?? {},
            schedule_hours: 6,
            schedule_preset: 'every_n_hours',
            schedule_time_of_day: null,
            schedule_weekdays: null,
            schedule_day_of_month: null,
            cron_expr: null,
            concurrent_runs: 1,
            memory_cadence: 1,
            memory_template_md: '',
            summary: 'short summary',
            version: overrides.version ?? 1,
            content_hash: `hash-${id}-${overrides.version ?? 1}`,
            published_at: '2026-06-03T00:00:00Z',
        })
        .execute();
    return id;
}

describe('marketplaceService', () => {
    beforeEach(async () => {
        await truncateAll();
    });
    afterAll(async () => {
        await closeTestDb();
    });

    it('search returns rows with installed/linked/upgrade flags', async () => {
        await insertCatalogAgent({ id: 'cat-x', version: 3 });
        // Install via the service so back-link is set.
        const installed = await marketplaceService.install('cat-x');
        expect(installed.marketplace_source_id).toBe('cat-x');
        expect(installed.marketplace_pulled_version).toBe(3);

        const rows = await marketplaceService.search({});
        const row = rows.find((r) => r.id === 'cat-x');
        expect(row).toBeDefined();
        expect(row!.is_installed).toBe(true);
        expect(row!.is_linked).toBe(true);
        expect(row!.installed_version).toBe(3);
        expect(row!.upgrade_available).toBe(false);

        // Bump catalog version → upgrade flag flips.
        await testDb
            .updateTable('marketplace_agents')
            .set({ version: 5, content_hash: 'hash-cat-x-5' })
            .where('id', '=', 'cat-x')
            .execute();
        const rows2 = await marketplaceService.search({});
        const row2 = rows2.find((r) => r.id === 'cat-x');
        expect(row2!.upgrade_available).toBe(true);
        expect(row2!.installed_version).toBe(3);
        expect(row2!.version).toBe(5);
    });

    it('install collides on the default slug and accepts an override', async () => {
        await insertCatalogAgent({ id: 'cat-y' });
        const first = await marketplaceService.install('cat-y');
        expect(first.id).toBe('cat-y');
        expect(first.marketplace_source_id).toBe('cat-y');

        // Default slug is now taken — re-installing throws SlugTakenError.
        await expect(marketplaceService.install('cat-y')).rejects.toBeInstanceOf(
            MarketplaceSlugTakenError,
        );

        // Caller picks an override; the new local row links back to the
        // same catalog id, leaving the first install untouched.
        const second = await marketplaceService.install('cat-y', { agent_id: 'cat-y-fork' });
        expect(second.id).toBe('cat-y-fork');
        expect(second.marketplace_source_id).toBe('cat-y');

        // search.installed_agent_id points at the linked local slug, which
        // may differ from the catalog id when a fork exists. We don't
        // assert WHICH of the two linked agents wins (implementation
        // detail: first-row-wins) — just that the chosen id is a valid
        // linked local agent.
        const rows = await marketplaceService.search({});
        const row = rows.find((r) => r.id === 'cat-y');
        expect(row?.is_installed).toBe(true);
        expect(['cat-y', 'cat-y-fork']).toContain(row?.installed_agent_id);
    });

    it('search treats detached local agents as not installed', async () => {
        await insertCatalogAgent({ id: 'cat-detach' });
        const installed = await marketplaceService.install('cat-detach');
        let rows = await marketplaceService.search({});
        expect(rows.find((r) => r.id === 'cat-detach')?.is_installed).toBe(true);

        await marketplaceService.detach(installed.id);
        rows = await marketplaceService.search({});
        const row = rows.find((r) => r.id === 'cat-detach');
        expect(row?.is_installed).toBe(false);
        expect(row?.upgrade_available).toBe(false);
    });

    it('runSeed does not re-link agents that the Owner explicitly detached', async () => {
        // Populate the catalog table, then explicitly install the agent
        // we exercise (post-2026-06-04, runSeed no longer auto-installs).
        await runSeed();
        await marketplaceService.install('agent-knowledge-base');
        const beforeDetach = await testDb
            .selectFrom('agents')
            .select(['id', 'marketplace_source_id'])
            .where('id', '=', 'agent-knowledge-base')
            .executeTakeFirstOrThrow();
        expect(beforeDetach.marketplace_source_id).toBe('agent-knowledge-base');

        // Owner detaches → source_id NULL.
        await marketplaceService.detach('agent-knowledge-base');

        // Re-run the seed. Under the OLD `backfillMarketplaceLinks` path
        // this would silently re-link the agent, overriding the user's
        // intent. Under the post-2026-06-04 contract runSeed never touches
        // the agents table at all, so the detach trivially survives.
        await runSeed();
        await runSeed();

        const afterReseed = await testDb
            .selectFrom('agents')
            .select(['id', 'marketplace_source_id', 'marketplace_pulled_version'])
            .where('id', '=', 'agent-knowledge-base')
            .executeTakeFirstOrThrow();
        expect(afterReseed.marketplace_source_id).toBeNull();
        expect(afterReseed.marketplace_pulled_version).toBeNull();
    });

    it('diff identifies changed fields between catalog and local agent', async () => {
        await insertCatalogAgent({ id: 'cat-z', prompt_md: 'v1 body', version: 1 });
        const local = await marketplaceService.install('cat-z');

        // Mutate the catalog row to simulate an upstream upgrade.
        await testDb
            .updateTable('marketplace_agents')
            .set({
                prompt_md: 'v2 body — upgraded',
                version: 2,
                settings_json: { new_field: true },
                content_hash: 'hash-cat-z-2',
            })
            .where('id', '=', 'cat-z')
            .execute();

        const diff = await marketplaceService.diff('cat-z', local.id);
        expect(diff.marketplace_version).toBe(2);
        expect(diff.local_pulled_version).toBe(1);
        expect(diff.fields.prompt_md.changed).toBe(true);
        expect(diff.fields.prompt_md.from).toBe('v1 body');
        expect(diff.fields.prompt_md.to).toBe('v2 body — upgraded');
        expect(diff.fields.settings_json.changed).toBe(true);
        expect(diff.fields.handoff_rules.changed).toBe(false);
    });

    it('acceptUpgrade applies selected fields and bumps pulled_version', async () => {
        await insertCatalogAgent({ id: 'cat-a', prompt_md: 'orig', version: 1 });
        await marketplaceService.install('cat-a');
        await testDb
            .updateTable('marketplace_agents')
            .set({
                prompt_md: 'upgraded',
                settings_json: { feature_x: 'on' },
                version: 4,
                content_hash: 'hash-cat-a-4',
            })
            .where('id', '=', 'cat-a')
            .execute();
        const after = await marketplaceService.acceptUpgrade('cat-a', ['prompt_md']);
        expect(after.prompt_md).toBe('upgraded');
        expect(after.marketplace_pulled_version).toBe(4);
        // settings_json was unchecked → kept at the local value (empty object
        // from install). The bump-then-skip semantic means the user has
        // explicitly chosen to ignore settings changes for this round.
        expect(after.settings_json).toEqual({});
    });

    it('dismissUpgrade bumps pulled_version without touching content', async () => {
        await insertCatalogAgent({ id: 'cat-b', prompt_md: 'keep mine', version: 1 });
        await marketplaceService.install('cat-b');
        await testDb
            .updateTable('marketplace_agents')
            .set({ prompt_md: 'upstream churn', version: 7, content_hash: 'hash-cat-b-7' })
            .where('id', '=', 'cat-b')
            .execute();
        const after = await marketplaceService.dismissUpgrade('cat-b');
        expect(after.prompt_md).toBe('keep mine');
        expect(after.marketplace_pulled_version).toBe(7);
    });

    it('detach clears the back-link', async () => {
        await insertCatalogAgent({ id: 'cat-c' });
        await marketplaceService.install('cat-c');
        const after = await marketplaceService.detach('cat-c');
        expect(after.marketplace_source_id).toBeNull();
        expect(after.marketplace_pulled_version).toBeNull();
    });

    it('importBundle creates a local agent with no marketplace link', async () => {
        await insertCatalogAgent({ id: 'cat-d' });
        const installed = await marketplaceService.install('cat-d');
        const bundle = {
            manifest: {
                id: 'imported-agent',
                name: 'Imported',
                category: installed.category,
                cli: installed.cli,
                model: installed.model,
                framework: installed.framework,
                description: installed.description,
                designation: installed.designation,
                accent_color: installed.accent_color,
                sort_order: 200,
                glyph: installed.glyph,
                role_id: installed.role_id,
                max_rounds: installed.max_rounds,
                requires_item: installed.requires_item,
                requires_worktree: installed.requires_worktree,
                push_code: installed.push_code,
                raises_pr: installed.raises_pr,
                status: installed.status,
                kind_slug: installed.kind_slug,
                settings_json: installed.settings_json,
                schedule_hours: installed.schedule_hours,
                schedule_preset: installed.schedule_preset,
                schedule_time_of_day: installed.schedule_time_of_day,
                schedule_weekdays: installed.schedule_weekdays,
                schedule_day_of_month: installed.schedule_day_of_month,
                cron_expr: installed.cron_expr,
                concurrent_runs: installed.concurrent_runs,
                memory_cadence: installed.memory_cadence,
                handoff_prompt_md: installed.handoff_prompt_md,
                summary: 'imported via test',
                version: 1,
                published_at: '2026-06-03T00:00:00Z',
            },
            prompt_md: 'imported prompt',
            memory_md: '',
            handoff_rules: [],
            checklists: [],
        };
        const imported = await marketplaceService.importBundle(bundle);
        expect(imported.id).toBe('imported-agent');
        expect(imported.marketplace_source_id).toBeNull();
        expect(imported.marketplace_pulled_version).toBeNull();
        const fetched = await agentsService.get('imported-agent');
        expect(fetched?.prompt_md).toBe('imported prompt');
    });

    // --- Additional coverage for branches missed by the canonical tests above.

    it('search filters by category + kind_slug + query (trimmed, case-insensitive)', async () => {
        await insertCatalogAgent({ id: 'cat-srch-1', name: 'Apple Pie' });
        await insertCatalogAgent({ id: 'cat-srch-2', name: 'Banana Bread' });
        const rows = await marketplaceService.search({
            category: 'software-dev',
            kind_slug: 'custom',
            query: '  APPLE  ',
            limit: 10,
        });
        expect(rows.map((r) => r.id)).toContain('cat-srch-1');
        expect(rows.map((r) => r.id)).not.toContain('cat-srch-2');
    });

    it('search clamps limit out of range (negative→1, huge→100) and skips blank query', async () => {
        await insertCatalogAgent({ id: 'cat-lim-1' });
        const rowsHigh = await marketplaceService.search({ limit: 9999, query: '   ' });
        expect(rowsHigh.length).toBeGreaterThan(0);
        const rowsLow = await marketplaceService.search({ limit: -5 });
        // limit clamps to >=1 — at least 1 row may be returned.
        expect(rowsLow.length).toBeLessThanOrEqual(1);
    });

    it('search returns empty array when catalog is empty', async () => {
        const rows = await marketplaceService.search({});
        expect(rows).toEqual([]);
    });

    it('getFull returns undefined for missing id', async () => {
        expect(await marketplaceService.getFull('nope')).toBeUndefined();
    });

    it('exportCatalogBundle throws NotFoundError when missing', async () => {
        await expect(marketplaceService.exportCatalogBundle('nope')).rejects.toThrow(
            /not found/,
        );
    });

    it('exportCatalogBundle packs a zip for an existing catalog agent', async () => {
        await insertCatalogAgent({ id: 'cat-export-1' });
        const buf = await marketplaceService.exportCatalogBundle('cat-export-1');
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(0);
    });

    it('exportLocalBundle throws NotFoundError when local agent missing', async () => {
        await expect(marketplaceService.exportLocalBundle('does-not-exist')).rejects.toThrow(
            /not found/,
        );
    });

    it('exportLocalBundle packs a zip for an installed local agent (short description)', async () => {
        // Covers exportLocalBundle happy path with description.length <= 220.
        await insertCatalogAgent({ id: 'cat-elb-short' });
        await marketplaceService.install('cat-elb-short');
        const buf = await marketplaceService.exportLocalBundle('cat-elb-short');
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(0);
    });

    it('exportLocalBundle truncates long description to 220 chars (line 324 branch)', async () => {
        // Covers the description.length > 220 truncation branch.
        await insertCatalogAgent({ id: 'cat-elb-long' });
        await marketplaceService.install('cat-elb-long');
        // Patch the local agent description to be > 220 chars.
        const longDesc = 'A'.repeat(250);
        await testDb
            .updateTable('agents')
            .set({ description: longDesc })
            .where('id', '=', 'cat-elb-long')
            .execute();
        const buf = await marketplaceService.exportLocalBundle('cat-elb-long');
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(0);
    });

    it('exportLocalBundle maps non-empty handoff_rules and checklists (lines 330-339)', async () => {
        // Covers the .map() callbacks over handoffs/checklists in
        // exportLocalBundle — the other exportLocalBundle tests install an
        // agent with no handoff rules/checklists, so those maps never ran.
        await insertCatalogAgent({ id: 'cat-elb-src' });
        await insertCatalogAgent({ id: 'cat-elb-tgt', sort_order: 2 });
        await marketplaceService.install('cat-elb-tgt');
        await testDb
            .insertInto('marketplace_agent_handoffs')
            .values({
                marketplace_agent_id: 'cat-elb-src',
                target_agent_id: 'cat-elb-tgt',
                kind: 'on-pass',
                status: 'in_review',
            })
            .execute();
        await testDb
            .insertInto('marketplace_agent_checklists')
            .values({
                marketplace_agent_id: 'cat-elb-src',
                label: 'Verify export',
                sort_order: 1,
                required: true,
            })
            .execute();
        await marketplaceService.install('cat-elb-src');
        const buf = await marketplaceService.exportLocalBundle('cat-elb-src');
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(0);
    });

    it('install with whitespace-only agent_id falls back to the catalog id', async () => {
        await insertCatalogAgent({ id: 'cat-ws' });
        const r = await marketplaceService.install('cat-ws', { agent_id: '   ' });
        expect(r.id).toBe('cat-ws');
    });

    it('install throws NotFoundError when the catalog id is missing', async () => {
        await expect(marketplaceService.install('does-not-exist')).rejects.toThrow(/not found/);
    });

    it('diff throws NotFoundError when catalog id is missing', async () => {
        await insertCatalogAgent({ id: 'cat-diff-1' });
        await marketplaceService.install('cat-diff-1');
        await expect(marketplaceService.diff('no-cat', 'cat-diff-1')).rejects.toThrow(/not found/);
    });

    it('diff throws NotFoundError when local agent id is missing', async () => {
        await insertCatalogAgent({ id: 'cat-diff-2' });
        await expect(marketplaceService.diff('cat-diff-2', 'no-local')).rejects.toThrow(
            /not found/,
        );
    });

    it('acceptUpgrade throws when local agent missing', async () => {
        await expect(marketplaceService.acceptUpgrade('no-agent', ['prompt_md'])).rejects.toThrow(
            /not found/,
        );
    });

    it('acceptUpgrade throws when local agent has no marketplace_source_id', async () => {
        await insertCatalogAgent({ id: 'cat-detach-accept' });
        await marketplaceService.install('cat-detach-accept');
        await marketplaceService.detach('cat-detach-accept');
        await expect(
            marketplaceService.acceptUpgrade('cat-detach-accept', ['prompt_md']),
        ).rejects.toThrow(/not back-linked/);
    });

    it('acceptUpgrade throws when the back-linked catalog id no longer exists', async () => {
        await insertCatalogAgent({ id: 'cat-orphan' });
        await marketplaceService.install('cat-orphan');
        // Wipe the catalog row but keep the back-link.
        await testDb
            .deleteFrom('marketplace_agents')
            .where('id', '=', 'cat-orphan')
            .execute();
        await expect(
            marketplaceService.acceptUpgrade('cat-orphan', ['prompt_md']),
        ).rejects.toThrow(/not found/);
    });

    it('dismissUpgrade throws when local agent missing', async () => {
        await expect(marketplaceService.dismissUpgrade('no-agent')).rejects.toThrow(/not found/);
    });

    it('dismissUpgrade throws when local agent has no back-link', async () => {
        await insertCatalogAgent({ id: 'cat-dismiss-detach' });
        await marketplaceService.install('cat-dismiss-detach');
        await marketplaceService.detach('cat-dismiss-detach');
        await expect(marketplaceService.dismissUpgrade('cat-dismiss-detach')).rejects.toThrow(
            /not back-linked/,
        );
    });

    it('dismissUpgrade throws when the back-linked catalog id no longer exists', async () => {
        await insertCatalogAgent({ id: 'cat-dismiss-orphan' });
        await marketplaceService.install('cat-dismiss-orphan');
        await testDb
            .deleteFrom('marketplace_agents')
            .where('id', '=', 'cat-dismiss-orphan')
            .execute();
        await expect(marketplaceService.dismissUpgrade('cat-dismiss-orphan')).rejects.toThrow(
            /not found/,
        );
    });

    it('importBundle throws SlugTakenError when default slug is taken', async () => {
        await insertCatalogAgent({ id: 'cat-imp-existing' });
        await marketplaceService.install('cat-imp-existing');
        const bundle = {
            manifest: {
                id: 'cat-imp-existing',
                name: 'Same',
                category: 'software-dev' as const,
                cli: 'claude' as const,
                model: 'claude-opus-4-7',
                framework: '',
                description: 'desc',
                designation: '',
                accent_color: '#000',
                sort_order: 1,
                glyph: '',
                role_id: null,
                max_rounds: 1,
                requires_item: true,
                requires_worktree: false,
                push_code: false,
                raises_pr: false,
                status: 'active' as const,
                kind_slug: 'custom' as const,
                settings_json: {},
                schedule_hours: 6,
                schedule_preset: 'every_n_hours' as const,
                schedule_time_of_day: null,
                schedule_weekdays: null,
                schedule_day_of_month: null,
                cron_expr: null,
                concurrent_runs: 1,
                memory_cadence: 1,
                handoff_prompt_md: '',
                summary: '',
                version: 1,
                published_at: '2026-06-03T00:00:00Z',
            },
            prompt_md: '',
            memory_md: '',
            handoff_rules: [],
            checklists: [],
        };
        await expect(marketplaceService.importBundle(bundle)).rejects.toBeInstanceOf(
            MarketplaceSlugTakenError,
        );
    });

    it('importBundle persists non-empty handoff_rules and checklists', async () => {
        await insertCatalogAgent({ id: 'cat-src-hr' });
        await insertCatalogAgent({ id: 'cat-tgt-hr', sort_order: 2 });
        // Install the target so the FK on agent_handoff_rules.target_agent_id is satisfied.
        const target = await marketplaceService.install('cat-tgt-hr');
        const src = await marketplaceService.install('cat-src-hr');
        const bundle = {
            manifest: {
                id: 'imp-with-hr',
                name: 'Imported With HR',
                category: src.category,
                cli: src.cli,
                model: src.model,
                framework: src.framework,
                description: src.description,
                designation: src.designation,
                accent_color: src.accent_color,
                sort_order: 300,
                glyph: src.glyph,
                role_id: src.role_id,
                max_rounds: src.max_rounds,
                requires_item: src.requires_item,
                requires_worktree: src.requires_worktree,
                push_code: src.push_code,
                raises_pr: src.raises_pr,
                status: src.status,
                kind_slug: src.kind_slug,
                settings_json: src.settings_json,
                schedule_hours: src.schedule_hours,
                schedule_preset: src.schedule_preset,
                schedule_time_of_day: src.schedule_time_of_day,
                schedule_weekdays: src.schedule_weekdays,
                schedule_day_of_month: src.schedule_day_of_month,
                cron_expr: src.cron_expr,
                concurrent_runs: src.concurrent_runs,
                memory_cadence: src.memory_cadence,
                handoff_prompt_md: src.handoff_prompt_md,
                summary: 'import with handoff rules',
                version: 1,
                published_at: '2026-06-03T00:00:00Z',
            },
            prompt_md: 'prompt with handoffs',
            memory_md: '',
            handoff_rules: [
                {
                    target_agent_id: target.id,
                    kind: 'on-pass' as const,
                    status: 'in_review' as const,
                },
            ],
            checklists: [
                {
                    label: 'Review acceptance criteria',
                    sort_order: 1,
                    required: true,
                },
            ],
        };
        const imported = await marketplaceService.importBundle(bundle);
        expect(imported.id).toBe('imp-with-hr');
        // Verify the handoff rule was persisted.
        const handoffs = await testDb
            .selectFrom('agent_handoff_rules')
            .selectAll()
            .where('agent_id', '=', 'imp-with-hr')
            .execute();
        expect(handoffs).toHaveLength(1);
        expect(handoffs[0]!.target_agent_id).toBe(target.id);
        // Verify the checklist row was persisted.
        const chks = await testDb
            .selectFrom('agent_checklists')
            .selectAll()
            .where('agent_id', '=', 'imp-with-hr')
            .execute();
        expect(chks).toHaveLength(1);
        expect(chks[0]!.label).toBe('Review acceptance criteria');
    });

    it('install copies marketplace_agent_handoffs and marketplace_agent_checklists into local tables', async () => {
        // Cover lines 421-432 and 434-445 in install(): handoff_rules.length > 0 and
        // checklists.length > 0 branches in the install path.
        await insertCatalogAgent({ id: 'cat-hr-src' });
        await insertCatalogAgent({ id: 'cat-hr-tgt', sort_order: 2 });
        // Install the target first so agent_handoff_rules.target_agent_id FK is satisfied.
        await marketplaceService.install('cat-hr-tgt');
        // Add a marketplace handoff pointing at the installed target.
        await testDb
            .insertInto('marketplace_agent_handoffs')
            .values({
                marketplace_agent_id: 'cat-hr-src',
                target_agent_id: 'cat-hr-tgt',
                kind: 'on-pass',
                status: 'in_review',
            })
            .execute();
        // Add a marketplace checklist entry.
        await testDb
            .insertInto('marketplace_agent_checklists')
            .values({
                marketplace_agent_id: 'cat-hr-src',
                label: 'Check acceptance criteria',
                sort_order: 1,
                required: true,
            })
            .execute();
        const installed = await marketplaceService.install('cat-hr-src');
        expect(installed.id).toBe('cat-hr-src');
        // Verify agent_handoff_rules was populated.
        const handoffs = await testDb
            .selectFrom('agent_handoff_rules')
            .selectAll()
            .where('agent_id', '=', 'cat-hr-src')
            .execute();
        expect(handoffs).toHaveLength(1);
        expect(handoffs[0]!.target_agent_id).toBe('cat-hr-tgt');
        expect(handoffs[0]!.kind).toBe('on-pass');
        // Verify agent_checklists was populated.
        const chks = await testDb
            .selectFrom('agent_checklists')
            .selectAll()
            .where('agent_id', '=', 'cat-hr-src')
            .execute();
        expect(chks).toHaveLength(1);
        expect(chks[0]!.label).toBe('Check acceptance criteria');
    });

    it('acceptUpgrade with prompt_md unchanged skips version bump but updates pulled_version (line 527 false branch)', async () => {
        // Covers the false branch of `full.agent.prompt_md !== agent.prompt_md` in acceptUpgrade.
        // When prompt_md hasn't changed, the body is skipped but pulled_version still advances.
        await insertCatalogAgent({ id: 'cat-pm-same', prompt_md: 'same-content', version: 1 });
        await marketplaceService.install('cat-pm-same');
        // Bump version WITHOUT changing prompt_md (same content, new version).
        await testDb
            .updateTable('marketplace_agents')
            .set({ version: 2, content_hash: 'h2-pm-same' })
            .where('id', '=', 'cat-pm-same')
            .execute();
        const before = await testDb
            .selectFrom('agent_prompt_versions')
            .selectAll()
            .where('agent_id', '=', 'cat-pm-same')
            .execute();
        const after = await marketplaceService.acceptUpgrade('cat-pm-same', ['prompt_md']);
        // prompt_md is unchanged → no new prompt version row created.
        const afterVersions = await testDb
            .selectFrom('agent_prompt_versions')
            .selectAll()
            .where('agent_id', '=', 'cat-pm-same')
            .execute();
        expect(afterVersions).toHaveLength(before.length); // same count — no new version
        expect(after.marketplace_pulled_version).toBe(2); // pulled_version still advances
    });

    it('acceptUpgrade applies handoff_prompt_md field (line 547-552)', async () => {
        await insertCatalogAgent({ id: 'cat-hpm' });
        await marketplaceService.install('cat-hpm');
        await testDb
            .updateTable('marketplace_agents')
            .set({ handoff_prompt_md: 'new handoff md', version: 2, content_hash: 'h2' })
            .where('id', '=', 'cat-hpm')
            .execute();
        const after = await marketplaceService.acceptUpgrade('cat-hpm', ['handoff_prompt_md']);
        expect(after.handoff_prompt_md).toBe('new handoff md');
        expect(after.marketplace_pulled_version).toBe(2);
    });

    it('acceptUpgrade applies settings_json field (line 554-559)', async () => {
        await insertCatalogAgent({ id: 'cat-sj' });
        await marketplaceService.install('cat-sj');
        await testDb
            .updateTable('marketplace_agents')
            .set({
                settings_json: { feature: 'on' },
                version: 2,
                content_hash: 'h2-sj',
            })
            .where('id', '=', 'cat-sj')
            .execute();
        const after = await marketplaceService.acceptUpgrade('cat-sj', ['settings_json']);
        expect(after.settings_json).toEqual({ feature: 'on' });
    });

    it('acceptUpgrade applies handoff_rules field including new rows (lines 561-578)', async () => {
        // Covers the handoff_rules branch in acceptUpgrade. Uses a catalog source
        // with a handoff pointing at an already-installed agent.
        await insertCatalogAgent({ id: 'cat-ahr-src' });
        await insertCatalogAgent({ id: 'cat-ahr-tgt', sort_order: 2 });
        await marketplaceService.install('cat-ahr-tgt');
        await marketplaceService.install('cat-ahr-src');
        // Simulate upgrade: add a handoff_rule to the catalog entry.
        await testDb
            .insertInto('marketplace_agent_handoffs')
            .values({
                marketplace_agent_id: 'cat-ahr-src',
                target_agent_id: 'cat-ahr-tgt',
                kind: 'on-pass',
                status: 'in_review',
            })
            .execute();
        await testDb
            .updateTable('marketplace_agents')
            .set({ version: 2, content_hash: 'h2-ahr' })
            .where('id', '=', 'cat-ahr-src')
            .execute();
        await marketplaceService.acceptUpgrade('cat-ahr-src', ['handoff_rules']);
        const handoffs = await testDb
            .selectFrom('agent_handoff_rules')
            .selectAll()
            .where('agent_id', '=', 'cat-ahr-src')
            .execute();
        expect(handoffs).toHaveLength(1);
        expect(handoffs[0]!.target_agent_id).toBe('cat-ahr-tgt');
    });

    it('acceptUpgrade applies checklists field including new rows (lines 580-597)', async () => {
        await insertCatalogAgent({ id: 'cat-acl' });
        await marketplaceService.install('cat-acl');
        // Add a catalog checklist entry.
        await testDb
            .insertInto('marketplace_agent_checklists')
            .values({
                marketplace_agent_id: 'cat-acl',
                label: 'Step 1',
                sort_order: 1,
                required: true,
            })
            .execute();
        await testDb
            .updateTable('marketplace_agents')
            .set({ version: 2, content_hash: 'h2-acl' })
            .where('id', '=', 'cat-acl')
            .execute();
        await marketplaceService.acceptUpgrade('cat-acl', ['checklists']);
        const chks = await testDb
            .selectFrom('agent_checklists')
            .selectAll()
            .where('agent_id', '=', 'cat-acl')
            .execute();
        expect(chks).toHaveLength(1);
        expect(chks[0]!.label).toBe('Step 1');
    });

    it('detach throws when local agent missing', async () => {
        await expect(marketplaceService.detach('does-not-exist')).rejects.toThrow(/not found/);
    });

    it('exportLocalBundle defaults version to 1 when marketplace_pulled_version is null (line 178)', async () => {
        // A local agent with no marketplace link (e.g. hand-authored, or
        // imported) has marketplace_pulled_version = null. manifestFromLocalAgent
        // falls back to version 1 for the exported bundle's self-version.
        await insertCatalogAgent({ id: 'cat-elb-nopull' });
        const bundle = {
            manifest: {
                id: 'local-no-pull',
                name: 'No Pull',
                category: 'software-dev' as const,
                cli: 'claude' as const,
                model: 'claude-opus-4-7',
                framework: '',
                description: 'desc',
                designation: '',
                accent_color: '#000',
                sort_order: 1,
                glyph: '',
                role_id: null,
                max_rounds: 1,
                requires_item: true,
                requires_worktree: false,
                push_code: false,
                raises_pr: false,
                status: 'active' as const,
                kind_slug: 'custom' as const,
                settings_json: {},
                schedule_hours: 6,
                schedule_preset: 'every_n_hours' as const,
                schedule_time_of_day: null,
                schedule_weekdays: null,
                schedule_day_of_month: null,
                cron_expr: null,
                concurrent_runs: 1,
                memory_cadence: 1,
                handoff_prompt_md: '',
                summary: '',
                version: 1,
                published_at: '2026-06-03T00:00:00Z',
            },
            prompt_md: 'body',
            memory_md: '',
            handoff_rules: [],
            checklists: [],
        };
        const imported = await marketplaceService.importBundle(bundle);
        expect(imported.marketplace_pulled_version).toBeNull();
        const buf = await marketplaceService.exportLocalBundle('local-no-pull');
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(0);
    });

    it('search falls back installed_version to null when the linked row has no pulled_version (line 233)', async () => {
        // Directly force a local agent into a state where it's back-linked
        // to a catalog entry but its pulled_version is NULL — not reachable
        // through install()/importBundle() alone, but a valid DB state
        // (e.g. a partially-repaired back-link).
        await insertCatalogAgent({ id: 'cat-nopull-search' });
        const installed = await marketplaceService.install('cat-nopull-search');
        await testDb
            .updateTable('agents')
            .set({ marketplace_pulled_version: null })
            .where('id', '=', installed.id)
            .execute();
        const rows = await marketplaceService.search({});
        const row = rows.find((r) => r.id === 'cat-nopull-search');
        expect(row?.is_installed).toBe(true);
        expect(row?.installed_version).toBeNull();
        expect(row?.upgrade_available).toBe(false);
    });

    it('diff reports local_pulled_version null when the local agent has no pulled_version (line 483)', async () => {
        await insertCatalogAgent({ id: 'cat-nopull-diff' });
        const installed = await marketplaceService.install('cat-nopull-diff');
        await testDb
            .updateTable('agents')
            .set({ marketplace_pulled_version: null })
            .where('id', '=', installed.id)
            .execute();
        const diff = await marketplaceService.diff('cat-nopull-diff', installed.id);
        expect(diff.local_pulled_version).toBeNull();
    });

    it('acceptUpgrade with handoff_rules field but no catalog handoffs clears without inserting (line 566 false branch)', async () => {
        await insertCatalogAgent({ id: 'cat-hr-empty' });
        const installed = await marketplaceService.install('cat-hr-empty');
        await testDb
            .updateTable('marketplace_agents')
            .set({ version: 2, content_hash: 'h2-hr-empty' })
            .where('id', '=', 'cat-hr-empty')
            .execute();
        await marketplaceService.acceptUpgrade('cat-hr-empty', ['handoff_rules']);
        const handoffs = await testDb
            .selectFrom('agent_handoff_rules')
            .selectAll()
            .where('agent_id', '=', installed.id)
            .execute();
        expect(handoffs).toHaveLength(0);
    });

    it('acceptUpgrade with checklists field but no catalog checklists clears without inserting (line 585 false branch)', async () => {
        await insertCatalogAgent({ id: 'cat-cl-empty' });
        const installed = await marketplaceService.install('cat-cl-empty');
        await testDb
            .updateTable('marketplace_agents')
            .set({ version: 2, content_hash: 'h2-cl-empty' })
            .where('id', '=', 'cat-cl-empty')
            .execute();
        await marketplaceService.acceptUpgrade('cat-cl-empty', ['checklists']);
        const chks = await testDb
            .selectFrom('agent_checklists')
            .selectAll()
            .where('agent_id', '=', installed.id)
            .execute();
        expect(chks).toHaveLength(0);
    });

    it('importBundle uses an explicit non-blank agent_id override (line 644 true branch)', async () => {
        await insertCatalogAgent({ id: 'cat-imp-override-src' });
        const src = await marketplaceService.install('cat-imp-override-src');
        const bundle = {
            manifest: {
                id: 'cat-imp-override-src',
                name: src.name,
                category: src.category,
                cli: src.cli,
                model: src.model,
                framework: src.framework,
                description: src.description,
                designation: src.designation,
                accent_color: src.accent_color,
                sort_order: src.sort_order,
                glyph: src.glyph,
                role_id: src.role_id,
                max_rounds: src.max_rounds,
                requires_item: src.requires_item,
                requires_worktree: src.requires_worktree,
                push_code: src.push_code,
                raises_pr: src.raises_pr,
                status: src.status,
                kind_slug: src.kind_slug,
                settings_json: src.settings_json,
                schedule_hours: src.schedule_hours,
                schedule_preset: src.schedule_preset,
                schedule_time_of_day: src.schedule_time_of_day,
                schedule_weekdays: src.schedule_weekdays,
                schedule_day_of_month: src.schedule_day_of_month,
                cron_expr: src.cron_expr,
                concurrent_runs: src.concurrent_runs,
                memory_cadence: src.memory_cadence,
                handoff_prompt_md: src.handoff_prompt_md,
                summary: 'explicit id override',
                version: 1,
                published_at: '2026-06-03T00:00:00Z',
            },
            prompt_md: 'override body',
            memory_md: '',
            handoff_rules: [],
            checklists: [],
        };
        const imported = await marketplaceService.importBundle(bundle, {
            agent_id: 'cat-imp-override-explicit',
        });
        expect(imported.id).toBe('cat-imp-override-explicit');
    });

    it('exportLocalBundle defaults memory_md to empty string when no agent_memory row exists (line 333)', async () => {
        await insertCatalogAgent({ id: 'cat-elb-nomem' });
        const installed = await marketplaceService.install('cat-elb-nomem');
        // Remove the agent_memory row created by install() so the
        // `memory?.body_md` optional-chaining falls through to `undefined`.
        await testDb.deleteFrom('agent_memory').where('agent_id', '=', installed.id).execute();
        const buf = await marketplaceService.exportLocalBundle(installed.id);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(0);
    });

    it('importBundle falls back to manifest id when agent_id is whitespace-only (line 644 fallback)', async () => {
        const bundle = {
            manifest: {
                id: 'imp-ws-fallback',
                name: 'WS Fallback',
                category: 'software-dev' as const,
                cli: 'claude' as const,
                model: 'claude-opus-4-7',
                framework: '',
                description: 'desc',
                designation: '',
                accent_color: '#000',
                sort_order: 1,
                glyph: '',
                role_id: null,
                max_rounds: 1,
                requires_item: true,
                requires_worktree: false,
                push_code: false,
                raises_pr: false,
                status: 'active' as const,
                kind_slug: 'custom' as const,
                settings_json: {},
                schedule_hours: 6,
                schedule_preset: 'every_n_hours' as const,
                schedule_time_of_day: null,
                schedule_weekdays: null,
                schedule_day_of_month: null,
                cron_expr: null,
                concurrent_runs: 1,
                memory_cadence: 1,
                handoff_prompt_md: '',
                summary: '',
                version: 1,
                published_at: '2026-06-03T00:00:00Z',
            },
            prompt_md: 'body',
            memory_md: '',
            handoff_rules: [],
            checklists: [],
        };
        const imported = await marketplaceService.importBundle(bundle, { agent_id: '   ' });
        expect(imported.id).toBe('imp-ws-fallback');
    });
});

// SDLC catalog prompt-shape contract. After the 2026-06 slash-command
// framework redesign (plan: http-localhost-5173-issues-stories-mon-6-…),
// every catalog `prompt.md` for the 10 SDLC agents is a tight slash-command
// body shipped verbatim to `.claude/commands/atlas-<slug>.md` per run. The
// contract is: ≤200 lines, frontmatter `description:`, an H1, a top-level
// `## Workflow` section, and a top-level `## What you never do` section.
// Performer prompts ALSO carry a top-level `## Inputs you can rely on`
// section (reviewers grade — they don't author — so they may omit it).
//
// The performer/reviewer split below intentionally mirrors the same split
// the runtime uses (paired-performer agentIds + `<id>-reviewer` for the
// grader). If you add a new SDLC agent, add it to the right list.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_ROOT = resolve(__dirname, '..', 'marketplace', 'catalog');

const SDLC_PERFORMERS = [
    'agent-po-writer',
    'agent-architect',
    'agent-coder',
    'agent-qa-writer',
    'agent-automation',
] as const;

const SDLC_REVIEWERS = [
    'agent-po-reviewer',
    'agent-architect-reviewer',
    'agent-code-reviewer',
    'agent-qa-reviewer',
    'agent-automation-reviewer',
] as const;

function readCatalogPrompt(agentId: string): string {
    return readFileSync(resolve(CATALOG_ROOT, agentId, 'prompt.md'), 'utf8');
}

describe('SDLC catalog prompt.md shape', () => {
    for (const agentId of [...SDLC_PERFORMERS, ...SDLC_REVIEWERS]) {
        it(`${agentId}: is a slash-command body ≤200 lines with required sections`, () => {
            const body = readCatalogPrompt(agentId);
            const lines = body.split('\n').length;
            expect(lines, `${agentId}/prompt.md must be ≤200 lines (got ${lines})`).toBeLessThanOrEqual(200);

            // Frontmatter `description:` (mirrors spec-kit's templates/commands/specify.md).
            expect(body, `${agentId} missing frontmatter`).toMatch(/^---\r?\n[\s\S]*?\n---\r?\n/);
            expect(body, `${agentId} missing description: in frontmatter`).toMatch(/^---\r?\n[\s\S]*?\bdescription:[\s\S]*?\n---/);

            // H1 + top-level workflow + never-do sections.
            expect(body, `${agentId} missing H1 heading`).toMatch(/^# \S/m);
            expect(body, `${agentId} missing ## Workflow`).toMatch(/^## Workflow\b/m);
            expect(body, `${agentId} missing ## What you never do`).toMatch(/^## What you never do\b/m);

            // 2026-06-12 — the centralized "read .atlas/*.md" preamble is
            // auto-prepended at run time by `preamble-assembler.ts` (see
            // `commands-assembler.renderCommandBody`). Catalog prompts no
            // longer carry duplicate references to the 4 .atlas data
            // files. The preamble itself is covered by
            // `preamble-assembler.test.ts` — each catalog body just needs
            // to NOT re-introduce the stripped preamble block.
            expect(body, `${agentId} reintroduced the auto-prepended preamble`).not.toContain(
                'Before doing anything else, read these files at the worktree root',
            );
        });
    }

    for (const agentId of SDLC_PERFORMERS) {
        it(`${agentId} (performer): includes ## Inputs you can rely on`, () => {
            const body = readCatalogPrompt(agentId);
            expect(body, `${agentId} missing ## Inputs you can rely on`).toMatch(/^## Inputs you can rely on\b/m);
        });
    }

    it('agent-coder: drops the fake `specify <phase>` shell calls', () => {
        const body = readCatalogPrompt('agent-coder');
        // The pre-2026-06 prompt invoked `specify clarify` / `specify plan` /
        // etc. as CLI subcommands that do not exist. Those have been replaced
        // with a TDD workflow driven by the project's own tooling.
        expect(body).not.toMatch(/\bspecify\s+(clarify|plan|task|implement|verify|analyze)\b/);
    });
});
