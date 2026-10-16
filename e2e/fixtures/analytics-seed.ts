import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../packages/api/src/db/kysely-client.js';
import { marketplaceService, MarketplaceSlugTakenError } from '../../packages/api/src/services/marketplace.js';

// Realistic analytics data for the e2e stack, so the REAL API computes every
// number the Analytics pages show (`e2e/pages/analytics-real.spec.ts`).
//
// About six months of work across three projects: Tasks with full status
// histories (waits, reviews, reopens), sub-tasks, workflow runs of every
// outcome with their agent steps, gate verdicts, parks of every kind, PRs,
// Jira-sourced Tasks, two agent-test Tasks and terminal sessions. Seeded
// relative to now with a fixed RNG, so the shape is the same every run.
//
//   DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_e2e pnpm exec tsx e2e/fixtures/analytics-seed.ts
//   … analytics-seed.ts --clean    # remove everything it wrote
//
// `pnpm e2e:seed:analytics` runs the first against atlas_e2e (add `-- --clean`
// to remove it) — e.g. on a stack brought up by `e2e/global-setup.ts`, to look
// at the pages by hand. The spec seeds
// in beforeAll and cleans in afterAll, so the rest of the suite still sees the
// small base seed.
//
// The engine runs alongside (the e2e API is live), so the seed avoids what
// its ticks would act on: no agent run is left queued / in progress (the
// orphan reaper would error it), a `running` workflow run's `updated_at` is
// set a day ahead (the reconcile tick parks a quiet one after 10 min), no
// Task carries `workflow_id` (the dispatch tick would start it), and PR links
// are not on github.com (the PR-state tick would try to fetch them).

const url = process.env['DATABASE_URL'] ?? '';
if (!/\/atlas_e2e(\?|$)/.test(url)) {
    throw new Error(`analytics-seed only writes to atlas_e2e, got ${url || '(unset)'}`);
}

const ROOT = new URL('../..', import.meta.url).pathname;
const INSTALLED_FILE = join(ROOT, 'e2e-logs', 'analytics-seed-agents.json');

const PROJECTS = [
    { id: 'an-store', name: 'Storefront', prefix: 'SHP', repo: 'storefront' },
    { id: 'an-billing', name: 'Billing', prefix: 'BIL', repo: 'billing' },
    { id: 'an-mobile', name: 'Mobile app', prefix: 'MOB', repo: 'mobile' },
] as const;
const PROJECT_IDS = PROJECTS.map((p) => p.id);

const AGENTS = ['agent-architect', 'agent-coder', 'agent-code-reviewer', 'agent-qa-writer', 'agent-doc-writer'] as const;
// Only the agent-test Tasks use the Doc Writer, so its row shows whether the
// Analytics agent table leaves agent tests out (it must) while the Fleet
// performance page keeps them.
const TEST_ONLY_AGENT = 'agent-doc-writer';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function clean(): Promise<void> {
    const items = db.selectFrom('items').select('id').where('project_id', 'in', PROJECT_IDS);
    const runs = db.selectFrom('workflow_runs').select('id').where('project_id', 'in', PROJECT_IDS);
    await db.deleteFrom('workflow_run_events').where('workflow_run_id', 'in', runs).execute();
    await db.deleteFrom('run_gate_results').where('workflow_run_id', 'in', runs).execute();
    await db.deleteFrom('agent_runs').where('project_id', 'in', PROJECT_IDS).execute();
    await db.deleteFrom('workflow_runs').where('project_id', 'in', PROJECT_IDS).where('parent_workflow_run_id', 'is not', null).execute();
    await db.deleteFrom('workflow_runs').where('project_id', 'in', PROJECT_IDS).execute();
    await db.deleteFrom('item_external_links').where('item_id', 'in', items).execute();
    await db.deleteFrom('issue_events').where('item_id', 'in', items).execute();
    await db.deleteFrom('cli_sessions').where('project_id', 'in', PROJECT_IDS).execute();
    await db.deleteFrom('items').where('project_id', 'in', PROJECT_IDS).where('type', '=', 'sub_task').execute();
    await db.deleteFrom('items').where('project_id', 'in', PROJECT_IDS).execute();
    await db.deleteFrom('workflows').where('project_id', 'in', PROJECT_IDS).execute();
    await db.deleteFrom('project_repos').where('project_id', 'in', PROJECT_IDS).execute();
    await db.deleteFrom('project_issue_counters').where('project_id', 'in', PROJECT_IDS).execute();
    await db.deleteFrom('projects').where('id', 'in', PROJECT_IDS).execute();
    if (existsSync(INSTALLED_FILE)) {
        const installed = JSON.parse(readFileSync(INSTALLED_FILE, 'utf8')) as string[];
        if (installed.length > 0) await db.deleteFrom('agents').where('id', 'in', installed).execute();
        writeFileSync(INSTALLED_FILE, '[]');
    }
}

// Deterministic generator (mulberry32).
function rng(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

async function seed(): Promise<void> {
    const r = rng(20261016);
    const between = (lo: number, hi: number) => lo + r() * (hi - lo);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    // Everything lands at least 5 minutes in the past, so no row is "future".
    const NOW = Date.now() - 5 * MIN;
    const iso = (t: number) => new Date(t).toISOString();

    const installed: string[] = [];
    for (const id of AGENTS) {
        try {
            await marketplaceService.install(id);
            installed.push(id);
        } catch (err) {
            if (!(err instanceof MarketplaceSlugTakenError)) throw err;
        }
    }
    writeFileSync(INSTALLED_FILE, JSON.stringify(installed));
    // A `done` names every required checklist row it ticked; without them the
    // scorecard replays each `done` as a send-back.
    const ticks = new Map<string, string>();
    for (const c of await db.selectFrom('agent_checklists').select(['agent_id', 'id']).where('required', '=', true).execute()) {
        const list = JSON.parse(ticks.get(c.agent_id) ?? '[]') as Array<{ id: number; passed: boolean }>;
        list.push({ id: Number(c.id), passed: true });
        ticks.set(c.agent_id, JSON.stringify(list));
    }

    const graph = JSON.stringify({
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            { id: 'architect', type: 'agent', agent_id: 'agent-architect', position: { x: 200, y: 0 } },
            { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: { x: 400, y: 0 } },
            { id: 'review', type: 'agent', agent_id: 'agent-code-reviewer', position: { x: 600, y: 0 } },
            { id: 'tests', type: 'script', command: 'pnpm test', position: { x: 800, y: 0 } },
            { id: 'end', type: 'end', position: { x: 1000, y: 0 } },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'architect', kind: 'pass' },
            { id: 'e2', source: 'architect', target: 'coder', kind: 'pass' },
            { id: 'e3', source: 'coder', target: 'review', kind: 'pass' },
            { id: 'e4', source: 'review', target: 'tests', kind: 'pass' },
            { id: 'e5', source: 'review', target: 'coder', kind: 'fail' },
            { id: 'e6', source: 'tests', target: 'end', kind: 'pass' },
            { id: 'e7', source: 'tests', target: 'coder', kind: 'fail' },
        ],
    });

    for (const p of PROJECTS) {
        await db.insertInto('projects').values({ id: p.id, name: p.name, issue_key_prefix: p.prefix, description: `${p.name} (analytics fixture)` }).execute();
        await db
            .insertInto('project_repos')
            .values({ id: p.id, project_id: p.id, name: p.repo, git_path: `/tmp/atlas-e2e-analytics/${p.repo}`, git_url: '', default_branch: 'main', clone_status: 'ready', position: 0 })
            .execute();
    }
    const WORKFLOWS = [
        { id: 'wf-an-delivery', name: 'Delivery', input_kind: 'item' },
        { id: 'wf-an-quick', name: 'Quick change', input_kind: 'item' },
        { id: 'wf-an-build', name: 'Build', input_kind: 'sub_task' },
    ];
    for (const w of WORKFLOWS) {
        await db
            .insertInto('workflows')
            .values({ id: w.id, project_id: 'an-store', name: w.name, graph, input_kind: w.input_kind, trigger: 'manual', created_at: iso(NOW - 110 * DAY) } as never)
            .execute();
    }

    const TITLES = [
        'Add saved carts for signed-in shoppers', 'Retry failed webhook deliveries', 'Paginate the order history API',
        'Show tax breakdown on invoices', 'Fix currency rounding on refunds', 'Dark-mode contrast on settings tabs',
        'Cache product images at the edge', 'Rate-limit the login endpoint', 'Export invoices as CSV',
        'Push notifications for shipped orders', 'Offline mode for the cart screen', 'Upgrade the payments SDK',
        'Search: rank exact title matches first', 'Migrate billing jobs to the queue worker', 'Fix timezone drift in the weekly digest',
        'Add coupon codes at checkout', 'Audit log for refunds', 'Speed up the catalogue import',
        'Accessible labels on the checkout form', 'Prorate plan changes mid-cycle', 'Biometric login on Android',
        'Deep links into order details', 'Dunning emails for failed renewals', 'Inventory sync with the warehouse API',
    ];

    type Ev = { item_id: string; from_value: string | null; to_value: string; at: number };
    const items: Record<string, unknown>[] = [];
    const events: Ev[] = [];
    const runs: Record<string, unknown>[] = [];
    const steps: Record<string, unknown>[] = [];
    const gates: Record<string, unknown>[] = [];
    const runEvents: Array<Record<string, unknown> & { at: number }> = [];
    const links: Record<string, unknown>[] = [];
    // Each wait: where to record the park, filled with a kind afterwards.
    const waits: Array<{ runId: string; itemId: string; childRunId: string | null; childItem: string | null; node: string; from: number; to: number | null; test: boolean }> = [];
    const seqs = new Map<string, number>(PROJECTS.map((p) => [p.id, 0]));
    let stepN = 0;
    let runN = 0;
    let prN = 100;

    const nextId = (projectId: string) => {
        const p = PROJECTS.find((x) => x.id === projectId);
        const n = (seqs.get(projectId) ?? 0) + 1;
        seqs.set(projectId, n);
        return `${p?.prefix}-${n}`;
    };

    /** One workflow run's agent steps between `from` and `to`, ending `open` (still going) or not. */
    function addSteps(runId: string, itemId: string, projectId: string, from: number, to: number, opts: { test?: boolean; loops?: number; light?: boolean }) {
        const seq: Array<{ node: string; agent: string; model: string; cli: string; cost: [number, number] }> = [];
        const coder = { node: 'coder', agent: 'agent-coder', model: 'claude-sonnet-5-5', cli: 'claude', cost: [0.35, 1.9] as [number, number] };
        if (opts.test) {
            seq.push({ node: 'docs', agent: TEST_ONLY_AGENT, model: 'claude-haiku-5-5', cli: 'claude', cost: [0.02, 0.09] });
        } else if (opts.light) {
            seq.push(coder);
        } else {
            seq.push({ node: 'architect', agent: 'agent-architect', model: 'claude-opus-5-5', cli: 'claude', cost: [0.9, 3.6] });
            seq.push(coder);
            for (let l = 0; l < (opts.loops ?? 0); l++) {
                seq.push({ node: 'review', agent: 'agent-code-reviewer', model: 'claude-sonnet-5', cli: 'claude', cost: [0.12, 0.5] });
                seq.push(coder);
            }
            seq.push({ node: 'review', agent: 'agent-code-reviewer', model: 'claude-sonnet-5', cli: 'claude', cost: [0.12, 0.5] });
            seq.push({ node: 'qa', agent: 'agent-qa-writer', model: r() < 0.3 ? 'gpt-5.4' : 'claude-sonnet-5-5', cli: r() < 0.3 ? 'copilot' : 'claude', cost: [0.08, 0.6] });
        }
        const span = Math.max(to - from, 10 * MIN);
        seq.forEach((s, i) => {
            const start = from + (span * i) / seq.length + 2 * MIN;
            const end = Math.min(from + (span * (i + 1)) / seq.length, to);
            const id = `an-step-${++stepN}`;
            // A few steps crash and are retried once (parent_run_id = the crash).
            const crashed = !opts.test && r() < 0.05;
            if (crashed) {
                steps.push({
                    id: `${id}-x`, agent_id: s.agent, item_id: itemId, project_id: projectId, workflow_run_id: runId, node_id: s.node,
                    status: 'error', cli: s.cli, model: s.model, effort: 'high', total_cost_usd: Number(between(0.01, 0.08).toFixed(4)),
                    input_tokens: 4000, output_tokens: 300, cache_read_tokens: 0, cache_creation_tokens: 0,
                    output_text: '[ERROR] CLI exited with code 1', created_at: iso(start), started_at: iso(start), completed_at: iso(start + 3 * MIN),
                });
            }
            const rejects = s.node === 'review' && i < seq.length - 2;
            const input = Math.round(between(20_000, 280_000));
            steps.push({
                id, agent_id: s.agent, item_id: itemId, project_id: projectId, workflow_run_id: runId, node_id: s.node,
                status: 'completed', outcome_kind: rejects ? 'rejected' : 'done', outcome_summary: rejects ? 'Sent back: missing tests' : 'Done',
                ...(rejects ? {} : { outcome_checklist: ticks.get(s.agent) ?? null }),
                ...(rejects ? { outcome_reason: 'missing tests for the empty-cart case' } : {}),
                cli: s.cli, model: s.model, effort: 'high', prompt_version: 1,
                total_cost_usd: Number(between(s.cost[0], s.cost[1]).toFixed(4)),
                input_tokens: input, output_tokens: Math.round(input * between(0.04, 0.12)),
                cache_read_tokens: Math.round(input * between(2, 9)), cache_creation_tokens: Math.round(input * between(0.1, 0.5)),
                parent_run_id: crashed ? `${id}-x` : null,
                created_at: iso(start), started_at: iso(start), completed_at: iso(Math.max(start + MIN, end)),
            });
        });
    }

    function addGates(runId: string, at: number, test = false) {
        const n = 1 + Math.floor(r() * 2);
        for (let g = 0; g < n; g++) {
            const x = r();
            const verdict = test ? 'fail' : g < n - 1 ? 'fail' : x < 0.04 ? 'unavailable' : x < 0.07 ? 'needs_review' : 'pass';
            // Red checks come from three scripts, so "Red checks by script" has rows to rank.
            // Picked by position, not the RNG, so every other seeded number stays put.
            const [script, command] = verdict === 'fail'
                ? ([['tests', 'pnpm test'], ['lint', 'pnpm lint'], ['typecheck', 'pnpm typecheck']] as const)[gates.length % 3] ?? ['tests', 'pnpm test']
                : (['tests', 'pnpm test'] as const);
            gates.push({
                id: `an-gate-${gates.length + 1}`, workflow_run_id: runId, node_id: 'tests', script_id: script, command, verdict,
                exit_code: verdict === 'pass' ? 0 : verdict === 'unavailable' ? null : 1,
                output_tail: verdict === 'pass' ? '212 passed' : verdict === 'fail' ? '3 failed, 209 passed' : null,
                created_at: iso(at - (n - g) * 20 * MIN),
            });
        }
    }

    function addPr(itemId: string, repo: string, at: number, state: 'merged' | 'open' | 'closed'): string {
        const prUrl = `https://git.acme.test/acme/${repo}/pull/${++prN}`;
        links.push({ item_id: itemId, link_kind: 'pull_request', url: prUrl, title: `PR #${prN}`, pr_state: state, pr_state_checked_at: iso(NOW - HOUR), created_at: iso(at) });
        return prUrl;
    }

    const TASKS = 150;
    for (let t = 0; t < TASKS; t++) {
        const project = PROJECTS[t % 3] ?? PROJECTS[0];
        const id = nextId(project.id);
        const isTest = t === 7 || t === 40;
        // The newest Tasks are still moving; one in ten never leaves draft/ready.
        const created = NOW - (isTest ? between(5, 25) : r() < 0.16 ? between(0.3, 9) : between(4, 185)) * DAY;
        const x = r();
        const priority = x < 0.1 ? 'urgent' : x < 0.35 ? 'high' : x < 0.75 ? 'normal' : 'low';
        const big = t === 3; // the drill-down Task: dozens of sub-tasks
        const stalls = !big && !isTest && r() < 0.1;
        // Urgent work moves faster, low priority slower.
        const pace = ({ urgent: 0.45, high: 0.75, normal: 1, low: 1.6 }[priority] ?? 1) * (r() < 0.25 ? 3.5 : 1);
        // Some work stalls where it is and ages: waiting on you, in review, mid-build.
        const stuck = !big && !isTest && r() < 0.13 ? pick(['waiting_for_info', 'in_review', 'in_review', 'in_progress'] as const) : null;

        // Build the status walk, stopping at now.
        const walk: Ev[] = [];
        let at = created;
        let status = 'draft';
        const move = (to: string, after: number): boolean => {
            if (stuck && status === stuck) return false;
            const next = at + after;
            if (next > NOW) return false;
            walk.push({ item_id: id, from_value: status, to_value: to, at: next });
            at = next;
            status = to;
            return true;
        };
        const workRuns: Array<{ start: number; end: number | null; waits: Array<[number, number | null]>; reviewAt: number | null; doneAt: number | null }> = [];
        if (move('ready', between(0.5, 30) * HOUR) && !stalls) {
            const life = () => {
                const run = { start: 0, end: null as number | null, waits: [] as Array<[number, number | null]>, reviewAt: null as number | null, doneAt: null as number | null };
                if (!move('in_progress', between(0.5, 40) * HOUR * pace)) return false;
                run.start = at;
                workRuns.push(run);
                const nWaits = r() < 0.55 ? 1 + (r() < 0.35 ? 1 : 0) : 0;
                for (let w = 0; w < nWaits; w++) {
                    if (!move('waiting_for_info', between(1, 14) * HOUR * pace)) return false;
                    const ws = at;
                    if (!move('in_progress', between(0.3, 36) * HOUR)) {
                        run.waits.push([ws, null]);
                        return false;
                    }
                    run.waits.push([ws, at]);
                }
                if (!move('in_review', between(1, 30) * HOUR * pace)) return false;
                run.reviewAt = at;
                run.end = at;
                if (!move('done', between(0.5, 26) * HOUR * pace)) return false;
                run.doneAt = at;
                return true;
            };
            const shipped = life();
            // Reopened: back to work a few days later, shipped again.
            if (shipped && r() < 0.14) {
                at += between(1, 6) * DAY;
                if (at < NOW) life();
            }
        }
        events.push(...walk);
        const firstIp = walk.find((e) => e.to_value === 'in_progress')?.at ?? null;
        items.push({
            id, project_id: project.id, type: 'task', title: `${TITLES[t % TITLES.length]}${t >= TITLES.length ? ` (${Math.floor(t / TITLES.length) + 1})` : ''}`,
            description: 'Analytics fixture Task.', status, priority, is_test: isTest,
            ...(isTest ? { title: `Agent test: fixture ${t}` } : {}),
            started_at: firstIp ? iso(firstIp) : null, created_at: iso(created), updated_at: iso(at),
        });
        if (!isTest && r() < 0.18) {
            links.push({ item_id: id, link_kind: 'jira_issue', url: `https://acme.atlassian.net/browse/${project.prefix}J-${t + 10}`, title: `${project.prefix}J-${t + 10}`, external_ref: `${project.prefix}J-${t + 10}`, created_at: iso(created) });
        }

        // Sub-tasks: each moves draft → in progress → done inside its Task's first life.
        const nSubs = big ? 32 : isTest ? 0 : Math.floor(r() * 4);
        const subs: Array<{ id: string; start: number; done: number | null }> = [];
        const life0 = workRuns[0];
        for (let s = 0; s < nSubs; s++) {
            const sid = nextId(project.id);
            let sStatus = 'draft';
            let sStart = 0;
            let sDone: number | null = null;
            if (life0) {
                const window = (life0.end ?? NOW) - life0.start;
                sStart = life0.start + (window * s) / Math.max(nSubs, 1) + 5 * MIN;
                if (sStart < NOW) {
                    events.push({ item_id: sid, from_value: 'draft', to_value: 'in_progress', at: sStart });
                    sStatus = 'in_progress';
                    // A Task only reaches review once its sub-tasks are done.
                    const d = Math.min(sStart + between(0.5, 6) * HOUR, (life0.end ?? Infinity) - MIN);
                    if (d < NOW && d > sStart) {
                        events.push({ item_id: sid, from_value: 'in_progress', to_value: 'done', at: d });
                        sStatus = 'done';
                        sDone = d;
                    }
                }
            }
            items.push({
                id: sid, project_id: project.id, type: 'sub_task', parent_id: id, parent_type: 'task',
                title: `Sub-task ${s + 1} of ${id}`, status: sStatus, priority: 'normal', sort_order: s,
                created_at: iso((life0?.start ?? created) - 10 * MIN), updated_at: iso(sDone ?? sStart ?? created),
            });
            if (life0 && sStart < NOW) subs.push({ id: sid, start: sStart, done: sDone });
        }

        // Workflow runs: one per life, plus now and then a failed attempt first.
        const wf = big || r() < 0.65 ? 'wf-an-delivery' : 'wf-an-quick';
        workRuns.forEach((life, li) => {
            let start = life.start;
            if (!isTest && li === 0 && r() < 0.14) {
                const failed = `an-run-${++runN}`;
                const end = Math.min(start + between(0.3, 2) * HOUR, NOW);
                const st = r() < 0.5 ? 'error' : 'cancelled';
                runs.push({ id: failed, workflow_id: wf, item_id: id, project_id: project.id, status: st, graph_snapshot: graph, loop_count: 0, gate_rounds: 0, started_at: iso(start), finished_at: iso(end), updated_at: iso(end) });
                addSteps(failed, id, project.id, start, end, { light: true });
                start = end + 2 * MIN;
            }
            const runId = `an-run-${++runN}`;
            const live = life.reviewAt === null;
            const waiting = live && status === 'waiting_for_info';
            const runStatus = !live ? 'completed' : waiting ? 'waiting_for_owner' : 'running';
            const loops = r() < 0.3 ? 1 + (r() < 0.25 ? 1 : 0) : 0;
            const end = life.reviewAt ?? NOW;
            const prUrls: string[] = [];
            if (!live) {
                const y = r();
                const state = status === 'in_review' && li === workRuns.length - 1 ? 'open' : y < 0.82 ? 'merged' : y < 0.9 ? 'closed' : 'open';
                prUrls.push(addPr(id, project.repo, end, state));
                if (r() < 0.12) prUrls.push(addPr(id, 'shared-ui', end, state));
            }
            runs.push({
                id: runId, workflow_id: wf, item_id: id, project_id: project.id, status: runStatus, graph_snapshot: graph,
                current_node_id: runStatus === 'completed' ? 'end' : waiting ? 'review' : 'coder', parked_node_id: waiting ? 'review' : null,
                park_reason: waiting ? 'Waiting for you' : null, loop_count: loops, gate_rounds: big ? 2 : r() < 0.15 ? 1 : 0,
                pr_url: prUrls[0] ?? null, pr_urls: JSON.stringify(prUrls),
                started_at: iso(start), finished_at: live ? null : iso(end),
                // Keep the reconcile tick off a live run (see the header).
                updated_at: iso(runStatus === 'running' ? Date.now() + DAY : end),
            });
            addSteps(runId, id, project.id, start, end, { test: isTest, loops, light: wf === 'wf-an-quick' });
            if (!live || r() < 0.5) addGates(runId, end, isTest);
            // Sub-task runs belong to the first life's run.
            const childRuns = new Map<string, string>();
            if (li === 0) {
                for (const s of subs) {
                    const cid = `an-run-${++runN}`;
                    childRuns.set(s.id, cid);
                    const cEnd = s.done ?? NOW;
                    runs.push({
                        id: cid, workflow_id: 'wf-an-build', item_id: s.id, project_id: project.id,
                        status: s.done ? 'completed' : waiting ? 'waiting_for_owner' : 'running', graph_snapshot: graph,
                        parent_workflow_run_id: runId, parent_node_id: 'build', loop_count: 0, gate_rounds: 0,
                        started_at: iso(s.start), finished_at: s.done ? iso(s.done) : null, updated_at: iso(s.done ?? Date.now() + DAY),
                    });
                    if (s.done) addSteps(cid, s.id, project.id, s.start, cEnd, { light: true });
                }
            }
            for (const [ws, we] of life.waits) {
                // One wait in four is a sub-task's question holding its Task.
                const sub = subs.find((s) => s.start <= ws && (s.done ?? NOW) >= ws);
                const viaChild = sub && r() < 0.5 ? sub : null;
                waits.push({ runId, itemId: id, childRunId: viaChild ? (childRuns.get(viaChild.id) ?? null) : null, childItem: viaChild?.id ?? null, node: 'review', from: ws, to: we, test: isTest });
            }
        });
    }

    // Park kinds: every kind the engine writes. Every other recent wait takes
    // one rare kind, so each lands in the last couple of months; the rest are
    // mostly questions, as in real use. 'other' only comes from the backfill.
    const KIND_REASON: Record<string, string> = {
        question: 'Should the empty-cart case keep the old copy?',
        no_outcome: 'agent_did_not_signal_outcome',
        review_requested: 'The workflow reached an Owner step — review and reply to continue',
        rejected: 'rejected: the Task asks for a schema change this repo does not own',
        checklist_failed: 'checklist_failed: At least one new unit test added',
        gate_failed: '3 failed, 209 passed',
        check_unavailable: 'The check `pnpm test` could not run (timeout), so nothing was checked. This is not a failure — resume the run to retry.',
        loop_limit: 'Loop limit reached (3): missing tests for the empty-cart case',
        step_error: 'The agent step errored again after an automatic retry: CLI exited with code 1',
        setup_failed: 'Could not refresh the worktree onto the latest default branch: rebase conflict',
        delivery_failed: 'Push failed: no credential. Resume the run to retry delivery.',
        lost_step: 'A step stopped reporting back (the API may have restarted)',
        missing_agent: 'Agent agent-perf-fixer is missing or inactive',
        dispatch_failed: 'Could not start Coder: no free slot',
        wiring_gap: 'No pass connection from this step',
    };
    const RARE = Object.keys(KIND_REASON).filter((k) => k !== 'question');
    const COMMON = ['question', 'question', 'question', 'question', 'review_requested', 'checklist_failed', 'gate_failed', 'loop_limit', 'no_outcome', 'step_error'];
    const real = waits.filter((w) => !w.test).sort((a, b) => b.from - a.from);
    real.forEach((w, i) => {
        const kind = i % 2 === 0 && i / 2 < RARE.length ? (RARE[i / 2] as string) : pick(COMMON);
                if (w.childRunId && w.childItem) {
            runEvents.push({ workflow_run_id: w.childRunId, item_id: w.childItem, kind: 'parked', node_id: 'coder', reason: KIND_REASON[kind], park_kind: kind, at: w.from });
            runEvents.push({ workflow_run_id: w.runId, item_id: w.itemId, kind: 'parked', node_id: 'build', reason: `Sub-task ${w.childItem} is waiting for you: ${KIND_REASON[kind]}`, park_kind: 'subtask_waiting', at: w.from + 1000 });
            if (w.to) runEvents.push({ workflow_run_id: w.childRunId, item_id: w.childItem, kind: 'resumed', node_id: 'coder', reason: null, park_kind: null, at: w.to });
        } else {
            runEvents.push({ workflow_run_id: w.runId, item_id: w.itemId, kind: 'parked', node_id: w.node, reason: KIND_REASON[kind], park_kind: kind, at: w.from });
        }
        if (w.to) runEvents.push({ workflow_run_id: w.runId, item_id: w.itemId, kind: 'resumed', node_id: w.childRunId ? 'build' : w.node, reason: null, park_kind: null, at: w.to + 1000 });
    });
    // Agent-test parks: excluded from analytics.
    for (const w of waits.filter((x) => x.test)) {
        runEvents.push({ workflow_run_id: w.runId, item_id: w.itemId, kind: 'parked', node_id: w.node, reason: 'test', park_kind: 'question', at: w.from });
    }

    // Terminal sessions: the Owner's own work, every few days.
    const sessions: Record<string, unknown>[] = [];
    for (let s = 0; s < 80; s++) {
        const project = PROJECTS[s % 3] ?? PROJECTS[0];
        const opened = NOW - between(0.2, 185) * DAY;
        const closed = Math.min(opened + between(0.2, 3) * HOUR, NOW);
        const input = Math.round(between(30_000, 400_000));
        const copilot = s % 5 === 4;
        sessions.push({
            id: `an-cli-${s + 1}`, project_id: project.id, title: pick(['Debug flaky checkout test', 'Spike: queue worker', 'Review billing PR', 'Tidy up the mobile nav', 'Investigate slow import']),
            status: 'closed', model: copilot ? 'gpt-5.4' : pick(['claude-opus-5-5', 'claude-sonnet-5-5']), cli: copilot ? 'copilot' : 'claude',
            total_cost_usd: Number(between(0.15, 4.2).toFixed(4)), input_tokens: input, output_tokens: Math.round(input * 0.08),
            cache_read_tokens: Math.round(input * between(1, 6)), cache_creation_tokens: Math.round(input * 0.2),
            created_at: iso(opened), updated_at: iso(closed), last_active_at: iso(closed), closed_at: iso(closed),
        });
    }

    const chunk = async <T>(rows: T[], insert: (c: T[]) => Promise<unknown>) => {
        for (let i = 0; i < rows.length; i += 400) await insert(rows.slice(i, i + 400));
    };
    await chunk(items.filter((i) => i['type'] === 'task'), (c) => db.insertInto('items').values(c as never).execute());
    await chunk(items.filter((i) => i['type'] === 'sub_task'), (c) => db.insertInto('items').values(c as never).execute());
    await db
        .insertInto('project_issue_counters')
        .values(PROJECTS.map((p) => ({ project_id: p.id, last_seq: seqs.get(p.id) ?? 0 })))
        .execute();
    await chunk(
        events.map((e) => ({ item_id: e.item_id, event_type: 'status_changed', field: 'status', from_value: e.from_value, to_value: e.to_value, created_at: iso(e.at) })),
        (c) => db.insertInto('issue_events').values(c as never).execute(),
    );
    await chunk(runs.filter((x) => !x['parent_workflow_run_id']), (c) => db.insertInto('workflow_runs').values(c as never).execute());
    await chunk(runs.filter((x) => x['parent_workflow_run_id']), (c) => db.insertInto('workflow_runs').values(c as never).execute());
    await chunk(steps, (c) => db.insertInto('agent_runs').values(c as never).execute());
    await chunk(gates, (c) => db.insertInto('run_gate_results').values(c as never).execute());
    await chunk(
        runEvents.map(({ at, ...e }, i) => ({ id: `an-ev-${i + 1}`, ...e, created_at: iso(at) })),
        (c) => db.insertInto('workflow_run_events').values(c as never).execute(),
    );
    await chunk(links, (c) => db.insertInto('item_external_links').values(c as never).execute());
    await chunk(sessions, (c) => db.insertInto('cli_sessions').values(c as never).execute());

    console.log(
        `analytics-seed: ${items.filter((i) => i['type'] === 'task').length} Tasks, ${items.filter((i) => i['type'] === 'sub_task').length} sub-tasks, ` +
            `${events.length} status events, ${runs.length} workflow runs, ${steps.length} agent runs, ${gates.length} gate results, ` +
            `${runEvents.filter((e) => e['kind'] === 'parked').length} parks, ${links.length} links, ${sessions.length} terminal sessions`,
    );
}

await clean();
if (!process.argv.includes('--clean')) await seed();
await db.destroy();
