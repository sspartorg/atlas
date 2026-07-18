import { describe, expect, it, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { testDb, truncateAll } from '../../tests/_pg-db.js';
import { runSeed } from '../db/seed.js';
import { marketplaceService } from '../services/marketplace.js';

// 2026-06-09 — Migrations rebase. The 17 historical files (001_baseline +
// 16 deltas at 070-086) are collapsed into a single source-of-truth
// migration `001_baseline.{ts,sql}` produced from `pg_dump --schema-only`
// of the live `atlas` DB. Fresh installs run only one migration; future
// schema changes start at 002_*.ts as small real deltas.
//
// The migration test asserts the rebased baseline produces the canonical
// schema (table set, key indexes, FK constraints) in a single step.

describe('migrations (Knex, via globalSetup)', () => {
    it('history shows the rebased baseline + any post-rebase deltas', async () => {
        const rows = await testDb
            .selectFrom('_knex_migrations')
            .select('name')
            .orderBy('name')
            .execute();
        // After the rebase the canonical post-fresh-install state is the
        // baseline plus any small real deltas that landed on top
        // (002_perf_indexes.ts at the time of writing). The baseline must
        // always be first.
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.name).toBe('001_baseline.ts');
    });

    it('seeded the singleton settings row', async () => {
        const row = await testDb
            .selectFrom('settings')
            .select(['id', 'owner_name'])
            .where('id', '=', 1)
            .executeTakeFirst();
        expect(row?.id).toBe(1);
    });

    it('created the items table with the unified `type` discriminator', async () => {
        await testDb.selectFrom('items').select('id').limit(1).execute();
    });

    it('created the agent_templates table (formerly delta 086)', async () => {
        await testDb
            .selectFrom('agent_templates')
            .select(['id', 'filename', 'body_md', 'description'])
            .limit(1)
            .execute();
    });

    it('created the canonical 33 public tables (no orphan retired_prefixes)', async () => {
        const rows = await sql<{ tablename: string }>`
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename NOT LIKE '_knex_migrations%'
            ORDER BY tablename
        `.execute(testDb);
        const names = rows.rows.map((r) => r.tablename);
        // Sanity floor — the live schema has 33 application tables. If
        // this assertion fails after a future migration, update the
        // count + add a one-liner above naming what landed.
        expect(names.length).toBeGreaterThanOrEqual(33);
        // 074 dropped this orphan; the rebased baseline must NOT carry it.
        expect(names).not.toContain('retired_prefixes');
        // Critical tables a /commands runtime depends on:
        expect(names).toContain('agent_templates');
        expect(names).toContain('agent_runs');
        expect(names).toContain('agents');
        expect(names).toContain('items');
        expect(names).toContain('comments');
        expect(names).toContain('guardrail_scripts');
    });

    it('agent_runs.status CHECK allows `cancelled` (formerly delta 073)', async () => {
        // The check constraint was widened from
        // {queued,in_progress,completed,error} to include 'cancelled'
        // for the stop-a-run UI. Verify by introspecting the constraint
        // definition rather than INSERTing (which would require seeding
        // cli_models + agents to satisfy the composite FK first).
        const rows = await sql<{ check_clause: string }>`
            SELECT pg_get_constraintdef(oid) AS check_clause
            FROM pg_constraint
            WHERE conrelid = 'public.agent_runs'::regclass
              AND contype = 'c'
              AND conname LIKE '%status%'
        `.execute(testDb);
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]?.check_clause).toContain("'cancelled'");
    });

    it('idx_notifications_created_at exists (Phase 2 audited addition)', async () => {
        // The notifications service orders by `created_at DESC` without
        // an unfiltered index pre-rebase. Phase 2 of the rebase added
        // this index. Verify it materialized.
        const rows = await sql<{ indexname: string }>`
            SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'notifications'
              AND indexname = 'idx_notifications_created_at'
        `.execute(testDb);
        expect(rows.rows).toHaveLength(1);
    });

    it('agent_runs.status CHECK allows `setup_failed` (migration 005)', async () => {
        const rows = await sql<{ check_clause: string }>`
            SELECT pg_get_constraintdef(oid) AS check_clause
            FROM pg_constraint
            WHERE conrelid = 'public.agent_runs'::regclass
              AND contype = 'c'
              AND conname LIKE '%status%'
        `.execute(testDb);
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]?.check_clause).toContain("'setup_failed'");
    });

    it('agent_runs.setup_output_text column exists (migration 005)', async () => {
        const rows = await sql<{ data_type: string; is_nullable: string }>`
            SELECT data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'agent_runs'
              AND column_name = 'setup_output_text'
        `.execute(testDb);
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]?.data_type).toBe('text');
        expect(rows.rows[0]?.is_nullable).toBe('YES');
    });

    it('environment_secrets table exists with expected shape (migration 005)', async () => {
        const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'environment_secrets'
            ORDER BY ordinal_position
        `.execute(testDb);
        const names = cols.rows.map((c) => c.column_name).sort();
        expect(names).toEqual(['id', 'key', 'updated_at', 'value_encrypted'].sort());
        // `key` must be UNIQUE (or PK) so the service can rely on
        // `ON CONFLICT (key)` for replace-all PUT semantics.
        const uniq = await sql<{ indexdef: string }>`
            SELECT indexdef FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'environment_secrets'
              AND indexdef LIKE '%UNIQUE%(key)%'
        `.execute(testDb);
        expect(uniq.rows.length).toBeGreaterThanOrEqual(1);
    });
});

// The two pg trigger functions the baseline ships — assert they exist so a
// future refactor can't silently drop one.
describe('migrations — triggers + functions present', () => {
    it('items_check_parent function exists', async () => {
        const rows = await sql<{ proname: string }>`
            SELECT proname FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND proname = 'items_check_parent'
        `.execute(testDb);
        expect(rows.rows).toHaveLength(1);
    });
    it('agents_cleanup_handoff_target function exists', async () => {
        const rows = await sql<{ proname: string }>`
            SELECT proname FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND proname = 'agents_cleanup_handoff_target'
        `.execute(testDb);
        expect(rows.rows).toHaveLength(1);
    });
    it('atlas_set_updated_at function exists', async () => {
        const rows = await sql<{ proname: string }>`
            SELECT proname FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND proname = 'atlas_set_updated_at'
        `.execute(testDb);
        expect(rows.rows).toHaveLength(1);
    });
});

// Workstream #4 — composite FK on `agents (cli, model)` → `cli_models (cli,
// model_name)`. The rebase folds the original deltas (059/060/061) into
// `001_baseline.sql`; the behaviour assertions remain valid.
async function reseedCliModels(): Promise<void> {
    await testDb
        .insertInto('cli_models')
        .values([
            { id: 'seed-claude-opus-4-7', cli: 'claude', model_name: 'claude-opus-4-7', note: 'Strongest reasoning.', sort_order: 1 },
            { id: 'seed-claude-opus-4-7-1m', cli: 'claude', model_name: 'claude-opus-4-7[1m]', note: 'Opus 4.7 with 1M context.', sort_order: 2 },
            { id: 'seed-claude-opus-4-6', cli: 'claude', model_name: 'claude-opus-4-6', note: 'Previous-gen Opus.', sort_order: 3 },
            { id: 'seed-claude-sonnet-4-6', cli: 'claude', model_name: 'claude-sonnet-4-6', note: 'Default Sonnet.', sort_order: 4 },
            { id: 'seed-claude-haiku', cli: 'claude', model_name: 'haiku', note: 'Cheapest and fastest.', sort_order: 5 },
            { id: 'seed-copilot-sonnet-4-6', cli: 'copilot', model_name: 'claude-sonnet-4.6', note: 'Balanced.', sort_order: 1 },
            { id: 'seed-copilot-sonnet-4-5', cli: 'copilot', model_name: 'claude-sonnet-4.5', note: 'Older Sonnet.', sort_order: 2 },
            { id: 'seed-copilot-haiku-4-5', cli: 'copilot', model_name: 'claude-haiku-4.5', note: 'Lightweight Claude.', sort_order: 3 },
            { id: 'seed-copilot-opus-4-6', cli: 'copilot', model_name: 'claude-opus-4.6', note: 'High capability.', sort_order: 4 },
            { id: 'seed-copilot-opus-4-5', cli: 'copilot', model_name: 'claude-opus-4.5', note: 'Older Opus.', sort_order: 5 },
            { id: 'seed-copilot-gpt-5-4', cli: 'copilot', model_name: 'gpt-5.4', note: 'Strong general reasoning.', sort_order: 6 },
            { id: 'seed-copilot-gpt-5-3-codex', cli: 'copilot', model_name: 'gpt-5.3-codex', note: 'Code-tuned.', sort_order: 7 },
            { id: 'seed-copilot-gpt-5-4-mini', cli: 'copilot', model_name: 'gpt-5.4-mini', note: 'Cheap GPT-5.', sort_order: 8 },
            { id: 'seed-copilot-gpt-4-1', cli: 'copilot', model_name: 'gpt-4.1', note: 'Older GPT.', sort_order: 9 },
            { id: 'seed-copilot-opus-4-7', cli: 'copilot', model_name: 'claude-opus-4.7', note: 'Latest-gen Opus.', sort_order: 10 },
            { id: 'seed-copilot-gpt-5-2', cli: 'copilot', model_name: 'gpt-5.2', note: 'GPT-5 mid-tier.', sort_order: 11 },
        ])
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();
}

describe('Workstream #4 — model registry alignment', () => {
    beforeAll(async () => {
        await truncateAll();
        await reseedCliModels();
    });

    it('cli_models contains the two docs-surfaced Copilot models', async () => {
        const rows = await testDb
            .selectFrom('cli_models')
            .select(['cli', 'model_name'])
            .where('cli', '=', 'copilot')
            .where((eb) =>
                eb.or([
                    eb('model_name', '=', 'claude-opus-4.7'),
                    eb('model_name', '=', 'gpt-5.2'),
                ]),
            )
            .execute();
        const names = rows.map((r) => r.model_name).sort();
        expect(names).toEqual(['claude-opus-4.7', 'gpt-5.2']);
    });

    it('no agent row references a (cli, model) pair that is not in cli_models', async () => {
        const orphans = await testDb
            .selectFrom('agents as a')
            .leftJoin('cli_models as m', (join) =>
                join.onRef('m.cli', '=', 'a.cli').onRef('m.model_name', '=', 'a.model'),
            )
            .select(['a.id', 'a.cli', 'a.model'])
            .where('m.id', 'is', null)
            .execute();
        expect(orphans).toEqual([]);
    });

    it('refuses to insert an agent whose (cli, model) is not in cli_models (FK)', async () => {
        await expect(
            testDb
                .insertInto('agents')
                .values({
                    id: 'agent-test-fk-violation',
                    name: 'FK violation',
                    category: 'software-dev',
                    cli: 'copilot',
                    model: 'definitely-not-in-the-registry',
                    framework: '',
                    prompt_md: '',
                    prompt_version: 1,
                    handoff_prompt_md: '',
                    status: 'active',
                    accent_color: '#000000',
                    sort_order: 999,
                    description: '',
                    schedule_hours: 0,
                    concurrent_runs: 1,
                    glyph: '',
                })
                .execute(),
        ).rejects.toThrow(/agents_cli_model_fk|foreign key/i);
    });

    describe('after marketplace install of the four Copilot SDLC agents', () => {
        beforeAll(async () => {
            await truncateAll();
            await reseedCliModels();
            await runSeed();
            for (const id of [
                'agent-coder',
                'agent-automation',
                'agent-code-reviewer',
                'agent-automation-reviewer',
            ]) {
                await marketplaceService.install(id);
            }
        });

        it('the four copilot SDLC agents land on claude-sonnet-4.6 (dot form)', async () => {
            const rows = await testDb
                .selectFrom('agents')
                .select(['id', 'cli', 'model'])
                .where('id', 'in', [
                    'agent-coder',
                    'agent-automation',
                    'agent-code-reviewer',
                    'agent-automation-reviewer',
                ])
                .execute();
            expect(rows).toHaveLength(4);
            for (const row of rows) {
                expect(row.cli).toBe('copilot');
                expect(row.model).toBe('claude-sonnet-4.6');
            }
        });
    });
});
