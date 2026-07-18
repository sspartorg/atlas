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
export async function truncateAll(): Promise<void> {
    const db = getTestDb();
    // One statement, RESTART IDENTITY resets serial counters, CASCADE handles
    // any FK dependency we forgot.
    const list = sql.raw(TRUNCATE_TABLES.join(', '));
    await sql`TRUNCATE ${list} RESTART IDENTITY CASCADE`.execute(db);
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
}
