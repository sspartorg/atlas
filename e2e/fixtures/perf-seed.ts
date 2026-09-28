import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSeed } from '../../packages/api/src/db/seed.js';
import { db } from '../../packages/api/src/db/kysely-client.js';
import {
    marketplaceService,
    MarketplaceSlugTakenError,
} from '../../packages/api/src/services/marketplace.js';

// Large-dataset seed for the perf + visual harness (`e2e/perf-harness/scroll-and-load.spec.ts`).
//
// The dev DB is usually near-empty, and every endpoint answers in <20ms there,
// so "the Tests page is slow with lots of data" cannot be seen on it. This
// fills a DEDICATED database (never `atlas` or `atlas_e2e`) with roughly what a
// month of golden-set runs leaves behind. Deterministic: same counts, same ids,
// every run, so a before/after comparison measures the code and not the seed.
//
// Usage: DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_perf tsx e2e/fixtures/perf-seed.ts
// (after migrating that DB). `scripts/perf-stack.sh` does all of it.

const url = process.env['DATABASE_URL'] ?? '';
if (!/\/atlas_perf(\?|$)/.test(url)) {
    throw new Error(`perf-seed only writes to a database named atlas_perf, got ${url || '(unset)'}`);
}

const TASKS_PER_PROJECT = 700;
const SUB_TASKS_PER_TASK = 3;
const AGENT_RUNS = 3000;
const TESTS_PER_AGENT = 10;
const BATCHES_PER_TEST = 20;
const SAMPLES_PER_BATCH = 3;
const ACTIVITY_ON_HOT_TASK = 300;
const NOTIFICATIONS = 200;
const BIG_LOG_LINES = 20_000;

const STATUSES = ['draft', 'ready', 'in_progress', 'waiting_for_info', 'in_review', 'done'] as const;
const at = (minutesAgo: number) => new Date(Date.UTC(2026, 8, 20) - minutesAgo * 60_000).toISOString();

async function chunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 500): Promise<void> {
    for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

// A ~4KB unified diff: enough that `evidence` dominates a row, as it does live.
const DIFF = Array.from({ length: 80 }, (_, i) => `+    const line${i} = compute(${i}); // added by the agent under test`).join('\n');

await runSeed();
for (const entry of await marketplaceService.search()) {
    try {
        await marketplaceService.install(entry.id);
    } catch (err) {
        if (!(err instanceof MarketplaceSlugTakenError)) throw err;
    }
}
const workspace = join(tmpdir(), 'atlas-perf-workspace');
mkdirSync(workspace, { recursive: true });
await db.updateTable('settings').set({ onboarding_complete: 1, workspace_path: workspace }).where('id', '=', 1).execute();

const agents = (await db.selectFrom('agents').select(['id']).orderBy('id').execute()).map((a) => a.id);
if (agents.length === 0) throw new Error('perf-seed: no agents installed');

// ── Projects, Tasks, sub-tasks ────────────────────────────────────────────
const projects = [
    { id: 'perf-alpha', prefix: 'PFA', name: 'Perf Alpha' },
    { id: 'perf-beta', prefix: 'PFB', name: 'Perf Beta' },
    { id: 'perf-gamma', prefix: 'PFG', name: 'Perf Gamma' },
];
const taskIds: string[] = [];
for (const p of projects) {
    await db.insertInto('projects').values({ id: p.id, name: p.name, issue_key_prefix: p.prefix, description: `${p.name} perf fixture` }).execute();
    const repoPath = join(workspace, p.id);
    mkdirSync(repoPath, { recursive: true });
    await db
        .insertInto('project_repos')
        .values({ id: p.id, project_id: p.id, name: p.id, git_path: repoPath, git_url: '', default_branch: 'main', clone_status: 'ready', position: 0 })
        .execute();

    let seq = 0;
    const items: Record<string, unknown>[] = [];
    for (let t = 0; t < TASKS_PER_PROJECT; t++) {
        const taskId = `${p.prefix}-${++seq}`;
        taskIds.push(taskId);
        const status = STATUSES[t % STATUSES.length];
        items.push({
            id: taskId,
            project_id: p.id,
            type: 'task',
            title: `Task ${t + 1}: improve the ${['parser', 'importer', 'scheduler', 'renderer', 'exporter'][t % 5]} for case ${t}`,
            description: `Perf fixture task ${t + 1}.`,
            status,
            priority: (['low', 'normal', 'high', 'urgent'] as const)[t % 4],
            assignee_agent_id: agents[t % agents.length],
            labels: JSON.stringify(t % 3 === 0 ? ['perf', 'fe'] : ['perf']),
            // `done` older than a week drops out of the default list; keep them recent.
            created_at: at(t * 3),
            updated_at: at(t * 2),
        } as never);
        for (let s = 0; s < SUB_TASKS_PER_TASK; s++) {
            items.push({
                id: `${p.prefix}-${++seq}`,
                project_id: p.id,
                type: 'sub_task',
                parent_id: taskId,
                parent_type: 'task',
                title: `Sub-task ${s + 1} of ${taskId}`,
                status: STATUSES[(t + s) % STATUSES.length],
                assignee_agent_id: agents[(t + s) % agents.length],
                labels: JSON.stringify(['dev', s === 0 ? 'be' : 'fe']),
                sort_order: s,
                created_at: at(t * 3 - s),
                updated_at: at(t * 2 - s),
            } as never);
        }
    }
    await chunked(items, (c) => db.insertInto('items').values(c as never).execute());
    await db.insertInto('project_issue_counters').values({ project_id: p.id, last_seq: seq }).execute();
}

// ── Agent runs, one with a very long log ──────────────────────────────────
const runs = Array.from({ length: AGENT_RUNS }, (_, i) => ({
    id: `perf-run-${i}`,
    agent_id: agents[i % agents.length],
    item_id: taskIds[i % taskIds.length],
    status: (i % 17 === 0 ? 'error' : 'completed') as 'error' | 'completed',
    output_text: `run ${i}\nok\n`,
    outcome_kind: (i % 5 === 0 ? 'rejected' : 'done') as 'rejected' | 'done',
    outcome_summary: `Perf fixture run ${i}`,
    total_cost_usd: 0.05 + (i % 40) / 100,
    input_tokens: 1000,
    output_tokens: 400,
    cli: 'claude' as const,
    model: 'claude-sonnet-5',
    effort: 'high',
    prompt_version: 1,
    started_at: at(i * 7 + 5),
    completed_at: at(i * 7),
    created_at: at(i * 7 + 5),
}));
await chunked(runs, (c) => db.insertInto('agent_runs').values(c as never).execute());
await db
    .updateTable('agent_runs')
    .set({ output_text: Array.from({ length: BIG_LOG_LINES }, (_, i) => `[${i}] step ${i}: reading src/module-${i % 50}.ts`).join('\n') })
    .where('id', '=', 'perf-run-0')
    .execute();

// ── Agent tests: every agent, a long history, evidence diffs ──────────────
// The newest batch of the first agent's first two tests is left `running` over
// a terminal agent run — exactly the rows the Tests tab judges on read today.
const tests: Record<string, unknown>[] = [];
const testRuns: Record<string, unknown>[] = [];
for (const [a, agentId] of agents.entries()) {
    for (let t = 0; t < TESTS_PER_AGENT; t++) {
        const testId = randomUUIDFrom(`${agentId}-${t}`);
        tests.push({
            id: testId,
            agent_id: agentId,
            name: `${['Implements', 'Rejects', 'Asks about', 'Documents', 'Tests'][t % 5]} case ${t + 1} for ${agentId}`,
            item_template: JSON.stringify({ issue_type: t % 2 ? 'task' : 'sub_task', title: `Fixture ${t + 1}`, description: 'Perf fixture' }),
            expectations: JSON.stringify({ outcome: 'done', max_cost_usd: 2, must_not_touch: ['.github/', 'package.json'] }),
            created_at: at(a * 100 + t),
            updated_at: at(a * 100 + t),
        });
        for (let b = 0; b < BATCHES_PER_TEST; b++) {
            const batchId = randomUUIDFrom(`${testId}-b${b}`);
            for (let s = 0; s < SAMPLES_PER_BATCH; s++) {
                const pending = a === 0 && t < 2 && b === 0;
                const passed = (b + s + t) % 4 !== 0;
                testRuns.push({
                    id: randomUUIDFrom(`${batchId}-s${s}`),
                    agent_test_id: testId,
                    agent_run_id: `perf-run-${(a * 1000 + t * 50 + b * 3 + s) % runs.length}`,
                    verdict: pending ? 'running' : passed ? 'passed' : 'failed',
                    failures: JSON.stringify(pending || passed ? [] : ['ends `done` expected, got `rejected`']),
                    cost_usd: 0.1 + s / 10,
                    duration_s: 60 + s * 10,
                    batch_id: batchId,
                    sample_index: s,
                    label: `suite-${b}`,
                    evidence: JSON.stringify({ base_sha: 'abc123', files_changed: ['src/a.ts', 'src/b.ts'], diff: DIFF }),
                    created_at: at(b * 60 + a),
                    evaluated_at: pending ? null : at(b * 60 + a - 1),
                });
            }
        }
    }
}
await chunked(tests, (c) => db.insertInto('agent_tests').values(c as never).execute());
await chunked(testRuns, (c) => db.insertInto('agent_test_runs').values(c as never).execute());

// ── Activity + comments on one hot Task, notifications ────────────────────
const hot = taskIds[0] ?? '';
await chunked(
    Array.from({ length: ACTIVITY_ON_HOT_TASK }, (_, i) => ({
        item_id: hot,
        event_type: 'status_changed' as const,
        field: 'status',
        from_value: STATUSES[i % 6],
        to_value: STATUSES[(i + 1) % 6],
        created_at: at(i * 11),
    })),
    (c) => db.insertInto('issue_events').values(c as never).execute(),
);
await chunked(
    Array.from({ length: ACTIVITY_ON_HOT_TASK }, (_, i) => ({
        author: (i % 2 ? 'agent' : 'owner') as 'agent' | 'owner',
        agent_id: i % 2 ? agents[i % agents.length] : null,
        item_id: hot,
        body: `Comment ${i}: **looked at** the \`parser\` change.\n\n- point one\n- point two`,
        created_at: at(i * 11 + 5),
    })),
    (c) => db.insertInto('comments').values(c as never).execute(),
);
await chunked(
    Array.from({ length: NOTIFICATIONS }, (_, i) => ({
        event_type: 'run_completed',
        message: `Run ${i} finished on ${taskIds[i]}`,
        item_id: taskIds[i],
        sent_external: 0 as const,
        kind: (i % 4 === 0 ? 'needs_you' : 'update') as 'needs_you' | 'update',
        external_status: 'none' as const,
        created_at: at(i * 13),
    })),
    (c) => db.insertInto('notifications').values(c).execute(),
);

console.log(
    `perf-seed: ${projects.length} projects, ${taskIds.length} tasks, ${taskIds.length * SUB_TASKS_PER_TASK} sub-tasks, ` +
        `${runs.length} runs, ${tests.length} tests, ${testRuns.length} test runs, hot task ${hot}`,
);
await db.destroy();

/** A UUID-shaped id derived from a seed string, so ids are stable across seeds. */
function randomUUIDFrom(seed: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < seed.length; i++) {
        h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
        h2 = Math.imul(h2 + seed.charCodeAt(i), 2246822519) >>> 0;
    }
    const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
