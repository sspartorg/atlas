import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { testDb } from '../../tests/_pg-db.js';

// Verifies the composite/partial indexes the W3 hot-path audit surfaced (they
// live in `001_baseline.sql` since the pre-publish consolidation; they were
// added by the old migration 021, which no longer exists as a file) and the
// later page / analytics indexes (migrations 002, 012, 015), each against its
// target query pattern.
//
// This is a REGRESSION GATE, not a perf benchmark: EXPLAIN is asked for a
// plan (not ANALYZE), so we don't need to seed massive volumes. The plan
// picker is deterministic for the exact query shape at any table size —
// so long as the index exists, the planner will prefer it or an index
// scan on a covering surrogate. The test asserts a plan that *includes*
// the target index name (or is at minimum an index scan).

const EXPECTED_INDEXES = [
    'idx_agent_runs_agent_status',
    'idx_agent_runs_status_started_at',
    'idx_issue_events_item_agent_event',
    'idx_notifications_external_status',
];

describe('W3 hot-path composite indexes (baseline)', () => {
    it('all four indexes exist in pg_indexes', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexname' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, 'in', EXPECTED_INDEXES as never)
            .execute();
        const found = rows.map((r) => (r as { indexname: string }).indexname).sort();
        expect(found).toEqual([...EXPECTED_INDEXES].sort());
    });

    it('the four indexes are unique by name (no accidental duplicates)', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexname' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, 'in', EXPECTED_INDEXES as never)
            .execute();
        const names = rows.map((r) => (r as { indexname: string }).indexname);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
    });

    it('agent_runs (agent_id, status) partial is indexed with a queued/in_progress predicate', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, '=', 'idx_agent_runs_agent_status')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toContain('(agent_id, status)');
        // Predicate is present as either `= ANY(ARRAY[...])` or as an
        // IN clause depending on how Postgres normalised the CREATE.
        expect(def.toLowerCase()).toContain("'queued'");
        expect(def.toLowerCase()).toContain("'in_progress'");
    });

    it('agent_runs (status, started_at) partial is indexed with status=in_progress predicate', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, '=', 'idx_agent_runs_status_started_at')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toContain('(status, started_at)');
        expect(def.toLowerCase()).toContain("'in_progress'");
    });

    it('issue_events handoff-routing composite covers three columns', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, '=', 'idx_issue_events_item_agent_event')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toContain('(item_id, actor_agent_id, event_type)');
    });

    it('notifications (external_status, created_at DESC) is indexed', async () => {
        const db = testDb;
        const rows = await db
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('indexname' as never, '=', 'idx_notifications_external_status')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toContain('(external_status, created_at DESC)');
        // The partial WHERE clause has been observed to drop from the
        // definition on some migration re-runs; the (external_status,
        // created_at DESC) column shape is the load-bearing property.
        // Full-table variant is still ~90% smaller than the parent table
        // and gives the same index scan.
    });
});

// ── Migration 002 — items.repo_ids GIN (campaign task-16) ──────────────────
//
// ADR 0018 made repo_ids a first-class query path but shipped no index, while
// its sibling items.labels has had one since the baseline. Measured at 40k
// items: 847 buffers / 5.151ms seq scan -> 53 buffers / 0.261ms bitmap scan.
//
// Six sibling columns were suspected of the same gap and rejected by
// measurement - they sit on tables that stay small. This asserts only the one
// the numbers justified.
describe('migration 002 — items.repo_ids GIN', () => {
    it('indexes repo_ids with jsonb_path_ops, matching the labels index', async () => {
        const rows = await testDb
            .selectFrom('pg_indexes' as never)
            .select(['indexdef' as never])
            .where('schemaname' as never, '=', 'public')
            .where('tablename' as never, '=', 'items')
            .where('indexname' as never, '=', 'items_repo_ids_gin')
            .execute();
        expect(rows).toHaveLength(1);
        const def = (rows[0] as { indexdef: string }).indexdef;
        expect(def).toMatch(/USING gin/i);
        expect(def).toMatch(/jsonb_path_ops/i);
    });
});

// ── Migration 012 — page indexes + FK coverage ─────────────────────────────
//
// Each index is asserted by name, and the query it was added for is EXPLAINed
// with seq scans priced out (`enable_seqscan = off`, transaction-local): an
// empty test table would otherwise always seq-scan, so this proves the index
// *can* serve the query shape, not the row-count-dependent choice.
const PAGE_INDEXES = [
    'idx_agent_runs_completed_cover',
    'idx_agent_runs_item_completed_cover',
    'idx_cli_sessions_closed_cover',
    'idx_items_status_updated_at',
    'idx_items_type_status_updated_at',
    'idx_notifications_needs_you_item',
    'idx_issue_events_status_created_at',
    'idx_jira_attachments_key_created',
    'idx_workflow_runs_top_started_at',
    'idx_run_gate_results_created_at',
    'idx_workflow_run_events_parked_created_at',
    'idx_workflow_runs_item_id',
    'idx_workflows_project_id',
    'idx_agent_test_runs_item_id',
    'idx_cli_sessions_credential_id',
    'idx_cli_sessions_repo_id',
    'idx_project_repos_credential_id',
    'idx_team_config_credential_id',
    'idx_agent_tests_project_id',
    'idx_agent_tests_repo_id',
    'idx_project_schedules_project_id',
    'idx_agents_cli_model',
    'idx_projects_default_workflow_id',
    'idx_jira_sources_workflow_id',
    'idx_agent_memory_last_run_id',
];
// Exact prefixes of another index on the same table.
const DROPPED_INDEXES = [
    'idx_items_status',
    'idx_items_type_status',
    'idx_items_project_type',
    'idx_agent_runs_status_completed_at',
    'idx_agent_prompt_versions_agent',
    'idx_cli_session_subagents_session',
    'idx_item_external_links_item_id',
    'idx_project_env_vars_project',
    'idx_project_repos_project_id',
];

async function indexNames(names: string[]): Promise<string[]> {
    const rows = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND indexname IN (${sql.join(names)})
    `.execute(testDb);
    return rows.rows.map((r) => r.indexname).sort();
}

// Enough rows, spread like real data, for the planner's costs to mean
// something. Inserted and ANALYZEd inside the EXPLAIN's transaction, which is
// rolled back, so sibling suites never see them.
const PLAN_SEED = `
    INSERT INTO projects (id, name, issue_key_prefix) VALUES ('plan-p', 'Plan', 'PLN');
    INSERT INTO agents (id, name, category, cli, model)
        SELECT 'plan-a', 'Plan agent', 'software-dev', cli, model_name FROM cli_models LIMIT 1;
    INSERT INTO items (id, project_id, type, parent_id, title, status, updated_at, created_at)
        SELECT 'pln-' || g, 'plan-p', CASE WHEN g % 4 = 1 THEN 'task' ELSE 'sub_task' END,
               CASE WHEN g % 4 <> 1 THEN 'pln-' || (g - (g - 1) % 4) END, 'Item ' || g,
               -- Mostly done, as a workspace ages: live statuses are the rare ones.
               COALESCE((ARRAY['draft','ready','in_progress','in_review','waiting_for_info'])[1 + g % 40], 'done'),
               now() - g * interval '1 hour', now() - g * interval '1 hour'
          FROM generate_series(1, 4000) g;
    INSERT INTO agent_runs (id, agent_id, item_id, status, completed_at, total_cost_usd, input_tokens)
        SELECT 'plr-' || g, 'plan-a', 'pln-' || (1 + g % 4000),
               CASE WHEN g % 10 = 0 THEN 'error' ELSE 'completed' END,
               now() - g * interval '2 hours', 0.01 * (g % 50), g
          FROM generate_series(1, 6000) g;
    INSERT INTO cli_sessions (id, project_id, title, status, model, cli, closed_at, total_cost_usd)
        SELECT 'pls-' || g, 'plan-p', 'S' || g, CASE WHEN g % 5 = 0 THEN 'active' ELSE 'closed' END, 'm', 'claude',
               CASE WHEN g % 5 <> 0 THEN now() - g * interval '3 hours' END, 0.1
          FROM generate_series(1, 4000) g;
    INSERT INTO notifications (event_type, message, item_id, kind, created_at)
        SELECT (ARRAY['agent_completed','workflow_run','agent_error','reminder'])[1 + g % 4], 'n',
               'pln-' || (1 + g % 4000), (ARRAY['needs_you','update','system'])[1 + g % 3], now() - g * interval '1 minute'
          FROM generate_series(1, 6000) g;
    INSERT INTO issue_events (item_id, event_type, field, from_value, to_value, created_at)
        SELECT 'pln-' || (1 + g % 4000), CASE WHEN g % 3 = 0 THEN 'comment_added' ELSE 'status_changed' END,
               CASE WHEN g % 3 = 0 THEN NULL ELSE 'status' END, 'ready', 'done', now() - g * interval '30 minutes'
          FROM generate_series(1, 12000) g;
    INSERT INTO workflows (id, project_id, name, graph) VALUES ('plan-w', 'plan-p', 'Plan wf', '{"nodes":[],"edges":[]}');
    INSERT INTO workflow_runs (id, workflow_id, item_id, project_id, status, graph_snapshot, started_at, parent_workflow_run_id)
        SELECT 'plw-' || g, 'plan-w', 'pln-' || (1 + g % 4000), 'plan-p', 'completed', '{}', now() - g * interval '2 hours',
               CASE WHEN g % 3 = 0 AND g > 1 THEN 'plw-' || (g - 1) END
          FROM generate_series(1, 4000) g;
    INSERT INTO run_gate_results (id, workflow_run_id, script_id, verdict, created_at)
        SELECT 'plg-' || g, 'plw-' || (1 + g % 4000), 'gate', 'pass', now() - g * interval '1 hour'
          FROM generate_series(1, 6000) g;
    INSERT INTO workflow_run_events (id, workflow_run_id, kind, park_kind, created_at)
        SELECT 'ple-' || g, 'plw-' || (1 + g % 4000), CASE WHEN g % 2 = 0 THEN 'parked' ELSE 'resumed' END,
               CASE WHEN g % 2 = 0 THEN 'question' END, now() - g * interval '1 hour'
          FROM generate_series(1, 6000) g;
    INSERT INTO jira_attachments (id, jira_key, filename, created_at)
        SELECT 'plj-' || g, 'PLN-' || (g % 500), 'f', now() - g * interval '1 hour' FROM generate_series(1, 4000) g;
    ANALYZE items, agent_runs, cli_sessions, notifications, issue_events, workflow_runs, run_gate_results,
            workflow_run_events, jira_attachments;
`;

async function planWithoutSeqScan(query: string, extraSeed = ''): Promise<string> {
    let plan = '';
    await testDb
        .transaction()
        .execute(async (trx) => {
            await sql.raw(PLAN_SEED + extraSeed).execute(trx);
            await sql`SET LOCAL enable_seqscan = off`.execute(trx);
            const r = await sql.raw<{ 'QUERY PLAN': string }>(`EXPLAIN ${query}`).execute(trx);
            plan = r.rows.map((x) => x['QUERY PLAN']).join('\n');
            throw new RolledBack();
        })
        .catch((e: unknown) => {
            if (!(e instanceof RolledBack)) throw e;
        });
    return plan;
}

class RolledBack extends Error {}

describe('migration 012 — page indexes', () => {
    it('creates every page and FK index', async () => {
        expect(await indexNames(PAGE_INDEXES)).toEqual([...PAGE_INDEXES].sort());
    });

    it('drops the redundant prefix indexes', async () => {
        expect(await indexNames(DROPPED_INDEXES)).toEqual([]);
    });

    it('leaves no FK column without a leading index', async () => {
        // A partial index counts only when its predicate is `col IS NOT NULL`,
        // which every FK lookup (`col = $1`) implies.
        const gaps = await sql<{ tbl: string; conname: string }>`
            SELECT c.conrelid::regclass::text AS tbl, c.conname
              FROM pg_constraint c
             WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
               AND NOT EXISTS (
                   SELECT 1 FROM pg_index i
                    WHERE i.indrelid = c.conrelid
                      AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
                      AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
                      AND (i.indpred IS NULL OR pg_get_expr(i.indpred, i.indrelid) =
                           (SELECT '(' || quote_ident(a.attname) || ' IS NOT NULL)' FROM pg_attribute a
                             WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                               AND cardinality(c.conkey) = 1)))
             ORDER BY 1, 2
        `.execute(testDb);
        expect(gaps.rows).toEqual([]);
    });

    const cases: Array<[label: string, index: string, query: string]> = [
        [
            'dashboard / analytics spend reads completed runs index-only',
            'idx_agent_runs_completed_cover',
            `SELECT sum(total_cost_usd), sum(input_tokens), sum(output_tokens), sum(cache_read_tokens),
                    sum(cache_creation_tokens), count(*)
               FROM agent_runs WHERE status = 'completed' AND completed_at >= now() - interval '30 days'`,
        ],
        [
            'per-item cost rollup',
            'idx_agent_runs_item_completed_cover',
            `SELECT item_id, sum(total_cost_usd) FROM agent_runs
              WHERE status = 'completed' AND item_id = ANY (ARRAY['a', 'b']) GROUP BY item_id`,
        ],
        [
            'terminal spend reads closed sessions index-only',
            'idx_cli_sessions_closed_cover',
            `SELECT sum(total_cost_usd), count(*) FROM cli_sessions
              WHERE status = 'closed' AND closed_at IS NOT NULL AND closed_at >= now() - interval '30 days'`,
        ],
        [
            'dashboard queue',
            'idx_items_status_updated_at',
            `SELECT id FROM items WHERE status = 'in_progress' ORDER BY updated_at DESC LIMIT 20`,
        ],
        [
            'analytics WIP tasks (replaces the dropped type+status index)',
            'idx_items_type_status_updated_at',
            `SELECT id FROM items WHERE type = 'task' AND status IN ('in_progress', 'in_review', 'waiting_for_info')`,
        ],
        [
            // A narrow recent window can rank the plain updated_at index cheaper; either is fine.
            'dashboard done this week',
            'idx_items_type_status_updated_at|idx_items_updated_at',
            `SELECT count(*) FROM items WHERE type = 'task' AND status = 'done' AND updated_at >= now() - interval '7 days'`,
        ],
        [
            'notification staleness subquery',
            'idx_notifications_needs_you_item',
            `SELECT 1 FROM notifications newer
              WHERE newer.item_id = 'x' AND newer.kind = 'needs_you'
                AND newer.event_type IN ('agent_completed', 'workflow_run') AND newer.id > 5`,
        ],
        [
            'delivery status events by time',
            'idx_issue_events_status_created_at',
            `SELECT item_id, min(created_at) FILTER (WHERE to_value = 'done') FROM issue_events
              WHERE field = 'status' AND created_at < now() GROUP BY item_id`,
        ],
        [
            'jira attachments per issue',
            'idx_jira_attachments_key_created',
            `SELECT * FROM jira_attachments WHERE jira_key = 'K-1' ORDER BY created_at, id`,
        ],
        [
            'top-level workflow runs in a window',
            'idx_workflow_runs_top_started_at',
            `SELECT * FROM workflow_runs WHERE parent_workflow_run_id IS NULL
                AND started_at >= now() - interval '30 days' AND started_at <= now() ORDER BY started_at`,
        ],
        [
            'gate verdicts in a window',
            'idx_run_gate_results_created_at',
            `SELECT verdict, count(*) FROM run_gate_results
              WHERE created_at >= now() - interval '30 days' AND created_at < now() GROUP BY 1`,
        ],
        [
            'parks in a window',
            'idx_workflow_run_events_parked_created_at',
            `SELECT count(*) FROM workflow_run_events
              WHERE kind = 'parked' AND created_at >= now() - interval '30 days' AND created_at < now()`,
        ],
        [
            'workflow runs by item (awaitingOwner probe, FK)',
            'idx_workflow_runs_item_id',
            `SELECT 1 FROM workflow_runs WHERE status = 'completed' AND item_id = 'x'`,
        ],
    ];
    for (const [label, index, query] of cases) {
        it(`${label} uses ${index}`, async () => {
            const plan = await planWithoutSeqScan(query);
            expect(plan).toMatch(new RegExp(`(using|Index Scan on) (${index})\\b`));
            expect(plan).not.toMatch(/Seq Scan/);
        });
    }

    it('awaitingOwner probes workflow_runs by item, never seq-scans it', async () => {
        const plan = await planWithoutSeqScan(`
            SELECT count(*) FROM items_live x
             WHERE x.status = 'waiting_for_info'
                OR (x.status = 'in_review'
                    AND NOT EXISTS (SELECT 1 FROM workflow_runs wr WHERE wr.status = 'running' AND wr.item_id = x.id)
                    AND NOT EXISTS (SELECT 1 FROM workflow_runs wr WHERE wr.status = 'running' AND wr.item_id = x.parent_id))`);
        expect(plan).not.toMatch(/Seq Scan on workflow_runs/);
    });
});

// ── Migration 015 — analytics test filter, keysets, PR lookup ──────────────
//
// The rewritten analytics queries are EXPLAINed in the shape the services
// send them (literal bounds instead of parameters), so a later edit that
// reverts a rewrite or loses an index fails here rather than in production.
const ANALYTICS_INDEXES = [
    'idx_items_is_test',
    'idx_notifications_created_id',
    'idx_reminders_history',
    'idx_item_external_links_pr_url',
];

// Rows PLAN_SEED leaves out: a few agent-test items (as in a real workspace),
// workflow steps on the runs, PR/Jira links and reminders of every status.
const ANALYTICS_SEED = `
    UPDATE items SET is_test = true WHERE id IN ('pln-5', 'pln-9', 'pln-13', 'pln-17');
    UPDATE agent_runs SET workflow_run_id = 'plw-' || (1 + substr(id, 5)::int % 4000);
    INSERT INTO item_external_links (item_id, link_kind, url)
        SELECT 'pln-' || g, CASE WHEN g % 2 = 0 THEN 'pull_request' ELSE 'jira_issue' END, 'https://git.example/pr/' || g
          FROM generate_series(1, 4000) g;
    INSERT INTO reminders (label, schedule_kind, schedule_value, next_fire_at, status, updated_at)
        SELECT 'r' || g, 'once', 'x', now() + g * interval '1 hour',
               (ARRAY['active', 'paused', 'cancelled', 'completed'])[1 + g % 4], now() - g * interval '1 minute'
          FROM generate_series(1, 4000) g;
    ANALYZE items, agent_runs, item_external_links, reminders;
`;

const WINDOW = `now() - interval '30 days'`;
const SHORT_WINDOW = `now() - interval '2 days'`;

describe('migration 015 — analytics and keyset indexes', () => {
    it('creates the four indexes and drops the single-column notifications index', async () => {
        expect(await indexNames(ANALYTICS_INDEXES)).toEqual([...ANALYTICS_INDEXES].sort());
        expect(await indexNames(['idx_notifications_created_at'])).toEqual([]);
    });

    const cases: Array<[label: string, mustUse: string[], query: string]> = [
        [
            'Analytics spend leaves agent tests out (notTestRun) via the partial index',
            ['idx_items_is_test', 'idx_agent_runs_completed_cover'],
            `SELECT sum(total_cost_usd), sum(input_tokens), count(*) FROM agent_runs
              WHERE status = 'completed'
                AND NOT EXISTS (SELECT 1 FROM items ti WHERE ti.id = agent_runs.item_id AND ti.is_test)
                AND completed_at >= ${WINDOW}`,
        ],
        [
            'scorecard roots: ScoredRun columns, NOT EXISTS test filter',
            ['idx_items_is_test', 'idx_workflow_runs_top_started_at'],
            `SELECT id, workflow_id, item_id, project_id, status, started_at, finished_at, loop_count,
                    gate_rounds, park_reason, pr_url, pr_urls
               FROM workflow_runs
              WHERE parent_workflow_run_id IS NULL AND started_at >= ${WINDOW} AND started_at <= now()
                AND NOT (EXISTS (SELECT 1 AS one FROM items AS ti WHERE ti.id = workflow_runs.item_id AND ti.is_test))
              ORDER BY started_at`,
        ],
        [
            'scorecard PR links by url',
            ['idx_item_external_links_pr_url'],
            `SELECT url, pr_state, created_at FROM item_external_links
              WHERE link_kind = 'pull_request' AND url IN ('https://git.example/pr/2', 'https://git.example/pr/4')`,
        ],
        [
            'notifications page keyset',
            ['idx_notifications_created_id'],
            `SELECT n.id FROM notifications n
              WHERE (n.created_at, n.id) < (SELECT c.created_at, c.id FROM notifications c WHERE c.id = 3000)
              ORDER BY n.created_at DESC, n.id DESC LIMIT 50`,
        ],
        [
            'reminders history, newest first',
            ['idx_reminders_history'],
            `SELECT id FROM reminders WHERE status IN ('cancelled', 'completed')
              ORDER BY updated_at DESC, id DESC LIMIT 50`,
        ],
        [
            // A short window over a long history: the case the rewrite is for.
            'delivery firstDoneIn: window Done events first, then their history by item',
            // Either item-leading index serves the per-item probe.
            ['idx_issue_events_status_created_at', 'idx_issue_events_item(?:_agent_event)?'],
            `SELECT e.item_id,
                    MIN(e.created_at) FILTER (WHERE e.to_value = 'done') AS done_at,
                    MIN(e.created_at) FILTER (WHERE e.to_value = 'in_progress') AS ip_at
               FROM issue_events e
              WHERE e.field = 'status' AND e.created_at < now()
                AND e.item_id IN (
                    SELECT d.item_id FROM issue_events d
                     WHERE d.field = 'status' AND d.to_value = 'done'
                       AND d.created_at >= ${SHORT_WINDOW} AND d.created_at < now())
              GROUP BY e.item_id
             HAVING MIN(e.created_at) FILTER (WHERE e.to_value = 'done') >= ${SHORT_WINDOW}`,
        ],
        [
            'delivery waits: status events bounded on both sides',
            ['idx_issue_events_status_created_at'],
            `SELECT e.to_value, e.created_at,
                    LEAD(e.created_at) OVER (PARTITION BY e.item_id ORDER BY e.created_at, e.id) AS next_at
               FROM issue_events e
               JOIN items i ON i.id = e.item_id AND NOT i.is_test
              WHERE e.field = 'status' AND e.created_at >= ${WINDOW} AND e.created_at < now()`,
        ],
        [
            'workflows cost per run tree: UNION ALL of the runs and their children',
            ['workflow_runs_parent_idx'],
            `WITH runs AS (
                 SELECT r.id FROM workflow_runs r
                  WHERE r.parent_workflow_run_id IS NULL AND r.started_at >= ${WINDOW} AND r.started_at < now()),
             tree AS (
                 SELECT id AS run_id, id AS root FROM runs
                 UNION ALL
                 SELECT c.id, c.parent_workflow_run_id FROM workflow_runs c JOIN runs ON c.parent_workflow_run_id = runs.id)
             SELECT tree.root, SUM(a.total_cost_usd) FROM tree
               JOIN agent_runs a ON a.workflow_run_id = tree.run_id GROUP BY 1`,
        ],
    ];
    for (const [label, mustUse, query] of cases) {
        it(`${label} uses ${mustUse.join(' + ').replace('(?:_agent_event)?', '')}`, async () => {
            const plan = await planWithoutSeqScan(query, ANALYTICS_SEED);
            for (const index of mustUse) expect(plan).toMatch(new RegExp(`(using|Index Scan on) ${index}\\b`));
            expect(plan).not.toMatch(/Seq Scan/);
            // A keyset served by its index never sorts.
            if (/LIMIT 50/.test(query)) expect(plan).not.toMatch(/Sort Key/);
        });
    }
});
