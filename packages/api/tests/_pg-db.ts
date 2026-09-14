// Postgres test fixture. The whole api test suite shares ONE PG database
// (`atlas_test` by default) — Knex migrations are applied once in the
// vitest `globalSetup`, and each test calls `truncateAll()` in `beforeEach`
// to wipe data without paying schema-rebuild cost.
//
// Test files import `testDb` from here when they need direct Kysely access
// (factories, ad-hoc assertions, etc.). Services under test transparently
// pick up the same connection because `kysely-client.ts` reads
// `DATABASE_URL` from env, and vitest is configured to point that env at
// the test DB before any module loads.

import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { DB } from '../src/db/types.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let kysely: Kysely<DB> | null = null;

function url(): string {
    const u = process.env['DATABASE_URL'];
    if (!u) throw new Error('test DATABASE_URL not set — vitest.config should have provided it');
    return u;
}

function testPool(): pg.Pool {
    if (!pool) pool = new Pool({ connectionString: url(), max: 4 });
    return pool;
}

function getTestDb(): Kysely<DB> {
    if (!kysely) kysely = new Kysely<DB>({ dialect: new PostgresDialect({ pool: testPool() }) });
    return kysely;
}

export const testDb: Kysely<DB> = new Proxy({} as Kysely<DB>, {
    get(_t, prop) {
        const inst = getTestDb() as unknown as Record<string | symbol, unknown>;
        const v = inst[prop];
        return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(inst) : v;
    },
});

export async function closeTestDb(): Promise<void> {
    // Kysely.destroy() calls pool.end() internally, so just destroy and
    // forget — calling pool.end() afterward throws "Called end on pool
    // more than once".
    if (kysely) {
        await kysely.destroy();
        kysely = null;
    }
    pool = null;
}

// Order matters: child tables first so FK CASCADE doesn't surprise. The
// list is intentionally explicit (not "every table") so adding new tables
// makes you think about whether they need test cleanup.
const TRUNCATE_TABLES = [
    // ADR 0014 — listed explicitly for the same reason as cli_sessions.
    'workflow_runs',
    'workflows',
    // 2026-06-22 — Terminal v1. FK → projects.id with ON DELETE CASCADE,
    // but listed explicitly so tests that only touch cli_sessions still
    // clear it (CASCADE only fires when projects is truncated).
    'cli_sessions',
    'agent_runs',
    'issue_events',
    'item_links',
    'comments',
    'notifications',
    'push_subscriptions',
    'project_env_vars',
    'environment_secrets',
    'project_guardrails',
    'project_schedules',
    'project_issue_counters',
    'items',
    'projects',
    'credentials',
    'agent_handoff_rules',
    'agent_checklists',
    'agent_memory',
    'agent_prompt_versions',
    'agents',
    // Workstream #4 (2026-06-02) — `cli_models` is intentionally NOT
    // truncated. It's a registry table seeded by migrations 001 / 059
    // and stays static across the test session, matching production
    // behavior. The composite FK `agents (cli, model) →
    // cli_models (cli, model_name)` from migration 061 makes every
    // `insertAgent` call depend on this registry being populated.
    // The one test that needs an empty registry (`cli-models.test.ts`)
    // truncates it explicitly in its own setup.
    'tool_catalog',
    'guardrail_rules',
    // Phase 1.5b — scripts split. Truncated to keep tests deterministic;
    // migration 079 seeds these from prior scriptable rules, so re-inserts
    // in test bodies aren't drowned by leftover seed rows.
    'guardrail_scripts',
    'project_guardrail_scripts',
    // Theme 08 — memory regenerations audit.
    'memory_regenerations',
    // Theme 11 — SDLC commit discipline audit.
    'commit_verifications',
    // P12 — Scratch Pad tiles.
    'scratch_pad',
    // Marketplace catalog + cascades.
    'marketplace_agent_handoffs',
    'marketplace_agent_checklists',
    'marketplace_agents',
] as const;

/**
 * Wipes every test-mutable table in dependency order. Settings is kept
 * (single-row, schema-managed). Call from `beforeEach` to isolate tests.
 */
// `cli_models` is reference data inserted by `001_baseline.sql`, NOT part of
// TRUNCATE_TABLES — so nothing restores it once a test wipes it. Two files
// (`routes/cli-models.test.ts`, `services/cli-models.test.ts`) TRUNCATE it in
// their own beforeEach to assert on an empty registry, and every file that ran
// after them inherited the hole. That made the suite order-dependent: `agents`
// carries a composite FK on `(cli, model)` -> `cli_models`, so any later test
// installing a catalog agent whose model had been wiped failed with an FK
// violation (and, since the 2026-09-12 install guard, a ModelNotInRegistryError
// instead — same cause, clearer message).
//
// truncateAll() restores the registry so every file starts from the same
// reference state. The two files that WANT it empty truncate after calling
// truncateAll(), so they are unaffected.
async function reseedCliModels(): Promise<void> {
    const db = getTestDb();
    await db
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

interface TruncateOptions {
    lockTimeoutMs?: number;
    attempts?: number;
}

// TRUNCATE needs ACCESS EXCLUSIVE on every table, so one straggler (an
// un-awaited background query from the previous test, or another vitest
// process on the same DB) used to park it silently until the 60s hook
// timeout. Bound the wait, retry, and name the blocker when it never clears.
export async function truncateAll({ lockTimeoutMs = 10_000, attempts = 3 }: TruncateOptions = {}): Promise<void> {
    const db = getTestDb();
    // One statement, RESTART IDENTITY resets serial counters, CASCADE handles
    // any FK dependency we forgot.
    const list = sql.raw(TRUNCATE_TABLES.join(', '));
    for (let attempt = 1; ; attempt++) {
        try {
            await db.transaction().execute(async (trx) => {
                await sql.raw(`SET LOCAL lock_timeout = ${Math.max(1, Math.floor(lockTimeoutMs))}`).execute(trx);
                await sql`TRUNCATE ${list} RESTART IDENTITY CASCADE`.execute(trx);
            });
            break;
        } catch (err) {
            const lockTimedOut = (err as { code?: string }).code === '55P03';
            if (!lockTimedOut) throw err;
            if (attempt >= attempts) {
                const blockers = await sql<{ pid: number; state: string | null; query: string }>`
                    SELECT pid, state, left(query, 200) AS query
                    FROM pg_stat_activity
                    WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'
                `.execute(db);
                const detail = blockers.rows.map((b) => `pid ${b.pid} (${b.state}): ${b.query}`).join('; ');
                throw new Error(`truncateAll: TRUNCATE blocked by ${detail || 'an unknown lock holder'}`);
            }
        }
    }
    // Reset settings row to defaults so each test starts with
    // onboarding_complete=0 / empty workspace_path.
    await sql`
        UPDATE settings SET
            owner_name='Owner', workspace_path='', constitution_md='',
            external_notification_provider='telegram',
            external_notification_token=NULL, external_notification_chat_id=NULL,
            external_notification_webhook_url=NULL,
            onboarding_complete=0, accent_color='#2E2E2E',
            external_notification_event_toggles='{}',
            quiet_hours_from=NULL, quiet_hours_to=NULL, quiet_hours_timezone=NULL,
            quiet_hours_enabled=0,
            external_notification_last_test_ok=NULL, external_notification_endpoint_label=NULL
        WHERE id=1
    `.execute(db);
    // Reference data, not test data — see reseedCliModels above.
    await reseedCliModels();
}
