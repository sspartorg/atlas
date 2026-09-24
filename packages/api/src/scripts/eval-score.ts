// Agent scorecard — turns workflow-run telemetry into a per-agent table.
//
// `agent_runs` has snapshotted `cli`, `model`, `effort`, `prompt_version`,
// token counts and `total_cost_usd` on every step since ADR 0014, explicitly so
// agent configurations could be compared (`agent-runner.ts` calls it the
// "run-config snapshot"). Nothing has ever read it analytically, so every
// prompt and model change to date has shipped on judgement rather than
// measurement. This script is the reader.
//
// It is deliberately a *scorer*, not a runner: it works on whatever runs are
// already in the database, so it can baseline today's fleet before anything
// changes, and re-score after. `eval-run.ts` is what puts golden Tasks in.
//
// Routing is recomputed, not guessed. `decideRunRouting` is the same pure
// function the engine routes on, so replaying it over
// (`outcome_kind`, `outcome_checklist`, the agent's required checklist) gives
// exactly the pass/fail/park the run actually took — including the F-012 hole
// where an empty required checklist makes `done` an automatic pass.
//
// Usage (from the repo root):
//   pnpm eval:score
//   pnpm eval:score -- --since 2026-09-01 --label before-prompt-diet
//   pnpm eval:score -- --run <workflowRunId> --run <workflowRunId>

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/kysely-client.js';
import { decideRunRouting } from '../services/agent-runner-outcome-routing.js';
import type { IRunOutcome } from '@atlas/shared';

// Anchor output at the repo root, not at packages/api/ — pnpm --filter changes
// CWD into the package, which would otherwise write evals/ under packages/api/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_OUT = join(REPO_ROOT, 'evals', 'results');
const GOLDEN_DIR = join(REPO_ROOT, 'evals', 'golden');

const DEFAULT_WINDOW_DAYS = 30;

interface Args {
    since: string | null;
    project: string | null;
    runs: string[];
    out: string;
    label: string;
}

function parseArgs(argv: string[]): Args {
    const args: Args = { since: null, project: null, runs: [], out: DEFAULT_OUT, label: '' };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === '--since' && value) { args.since = value; i++; }
        else if (flag === '--project' && value) { args.project = value; i++; }
        else if (flag === '--run' && value) { args.runs.push(value); i++; }
        else if (flag === '--out' && value) { args.out = resolve(value); i++; }
        else if (flag === '--label' && value) { args.label = value; i++; }
        else if (flag === '--help' || flag === '-h') {
            console.log('usage: eval-score [--since ISO] [--project ID] [--run ID]... [--out DIR] [--label NAME]');
            process.exit(0);
        }
    }
    if (!args.since && args.runs.length === 0) {
        const d = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000);
        args.since = d.toISOString();
    }
    return args;
}


/**
 * A fixture's `expect` block, checked.
 *
 * `eval-run.ts` has declared `terminal_status`, `min_sub_tasks` and
 * `requires_pr` since the harness shipped and never read any of them, so
 * "the fixture passed" meant a human comparing a status column to a JSON file
 * by eye — the self-reported verdict ADR 0020 exists to remove, reintroduced
 * one layer up in the tooling.
 *
 * Fixtures are matched to runs by the Task title, because `eval-run.ts` creates
 * each Task with `title: fixture.title` verbatim. A run whose title matches no
 * fixture is not scored — it is somebody else's run, not a failure.
 */
export interface FixtureExpectation {
    terminal_status?: string[];
    min_sub_tasks?: number;
    requires_pr?: boolean;
}

export interface Fixture {
    id: string;
    title: string;
    expect?: FixtureExpectation;
}

function loadFixtures(): Map<string, Fixture> {
    const byTitle = new Map<string, Fixture>();
    if (!existsSync(GOLDEN_DIR)) return byTitle;
    for (const file of readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'))) {
        try {
            const fx = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as Fixture;
            if (fx.title) byTitle.set(fx.title, fx);
        } catch {
            // A malformed fixture is eval-run's problem to report, not ours.
        }
    }
    return byTitle;
}

export interface FixtureVerdict {
    fixture_id: string;
    passed: boolean;
    failures: string[];
}

export function checkExpectation(
    fx: Fixture,
    run: { status: string; pr_urls: unknown },
    subTaskCount: number,
): FixtureVerdict {
    const exp = fx.expect ?? {};
    const failures: string[] = [];
    if (exp.terminal_status && !exp.terminal_status.includes(run.status)) {
        failures.push(`terminal_status: expected ${exp.terminal_status.join(' or ')}, got ${run.status}`);
    }
    if (exp.min_sub_tasks != null && subTaskCount < exp.min_sub_tasks) {
        failures.push(`min_sub_tasks: expected at least ${exp.min_sub_tasks}, got ${subTaskCount}`);
    }
    const prCount = Array.isArray(run.pr_urls) ? run.pr_urls.length : 0;
    if (exp.requires_pr === true && prCount === 0) {
        failures.push('requires_pr: expected a pull request, none was opened');
    }
    // A fixture that must NOT produce a PR fails just as hard when it does —
    // `ambiguous-must-escalate` inventing a feature is the failure it exists
    // to catch.
    if (exp.requires_pr === false && prCount > 0) {
        failures.push(`requires_pr is false but ${prCount} pull request(s) were opened`);
    }
    return { fixture_id: fx.id, passed: failures.length === 0, failures };
}

interface AgentScore {
    agent_id: string;
    /** Distinct (run, node) positions this agent occupied. */
    steps: number;
    /** Individual dispatches, including retries after a fail edge. */
    dispatches: number;
    /** Steps whose FIRST dispatch routed pass. The headline quality number. */
    pass_at_1: number;
    /** Dispatches beyond the first on the same step — the cost of getting it wrong. */
    loops: number;
    /** Dispatches that parked the run with the Owner (asked a question, or went silent). */
    escalations: number;
    /**
     * Times a deterministic gate went red after this agent was the last to
     * report done. The only quality signal in the system that the agent cannot
     * author itself — see ADR 0020 and campaign finding F-012.
     */
    gate_catch: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    wall_clock_s: number;
    models: Record<string, number>;
    efforts: Record<string, number>;
}

function emptyScore(agent_id: string): AgentScore {
    return {
        agent_id, steps: 0, dispatches: 0, pass_at_1: 0, loops: 0, escalations: 0,
        gate_catch: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0,
        cache_read_tokens: 0, cache_creation_tokens: 0, wall_clock_s: 0,
        models: {}, efforts: {},
    };
}

/**
 * Normalise a timestamp column to an ISO string.
 *
 * The Kysely column types declare `string`, but node-postgres parses
 * `timestamptz` into a `Date` before Kysely ever sees it — so these values
 * arrive as Dates at runtime and string operations on them throw. Everything
 * below sorts and compares timestamps, so they are normalised once, here.
 */
function iso(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function seconds(from: string | null, to: string | null): number {
    if (!from || !to) return 0;
    const ms = new Date(to).getTime() - new Date(from).getTime();
    return ms > 0 ? ms / 1000 : 0;
}

function bump(counter: Record<string, number>, key: string | null): void {
    const k = key ?? '(unset)';
    counter[k] = (counter[k] ?? 0) + 1;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    // 1. Root runs in scope. A Task's sub-task runs are children (ADR 0015) and
    //    are pulled in via the tree below, never selected directly — otherwise
    //    a sub-task run would be counted as its own delivery.
    let q = db
        .selectFrom('workflow_runs')
        .selectAll()
        .where('parent_workflow_run_id', 'is', null);
    if (args.runs.length > 0) q = q.where('id', 'in', args.runs);
    if (args.since) q = q.where('started_at', '>=', args.since);
    if (args.project) q = q.where('project_id', '=', args.project);
    const roots = await q.orderBy('started_at', 'asc').execute();

    if (roots.length === 0) {
        console.error('No workflow runs in scope. Widen --since, or run eval-run.ts first.');
        await db.destroy();
        process.exit(1);
    }

    // 2. Children, one level deep — `validateWorkflowGraph` forbids a
    //    sub-workflow from carrying its own Sub-tasks step, so there is no
    //    deeper level to walk.
    const rootIds = roots.map((r) => r.id);
    const children = await db
        .selectFrom('workflow_runs')
        .selectAll()
        .where('parent_workflow_run_id', 'in', rootIds)
        .execute();

    const allRunIds = [...rootIds, ...children.map((c) => c.id)];
    const rootOf = new Map<string, string>();
    for (const id of rootIds) rootOf.set(id, id);
    for (const c of children) rootOf.set(c.id, c.parent_workflow_run_id ?? c.id);

    // 3. Every dispatch, and the required checklists needed to replay routing.
    const rawSteps = await db
        .selectFrom('agent_runs')
        .select([
            'id', 'agent_id', 'node_id', 'workflow_run_id', 'status',
            'outcome_kind', 'outcome_checklist', 'cli', 'model', 'effort',
            'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens',
            'total_cost_usd', 'started_at', 'completed_at', 'created_at',
        ])
        .where('workflow_run_id', 'in', allRunIds)
        .orderBy('created_at', 'asc')
        .execute();
    const steps = rawSteps.map((s) => ({
        ...s,
        started_at: iso(s.started_at),
        completed_at: iso(s.completed_at),
        created_at: iso(s.created_at) ?? '',
    }));

    const checklistRows = await db
        .selectFrom('agent_checklists')
        .select(['agent_id', 'id', 'label'])
        .where('required', '=', true)
        .execute();
    const requiredByAgent = new Map<string, Array<{ id: number; label: string }>>();
    for (const row of checklistRows) {
        const list = requiredByAgent.get(row.agent_id) ?? [];
        // `agent_checklists.id` is bigint, so pg hands it back as a string.
        // `decideRunRouting` matches it against the numeric ids the agent
        // reports in its outcome block, so the coercion is load-bearing —
        // without it every required row reads as failed and every `done`
        // scores as a fail. `workflow-engine.ts` does the same Number() cast.
        list.push({ id: Number(row.id), label: row.label });
        requiredByAgent.set(row.agent_id, list);
    }

    const rawGates = await db
        .selectFrom('run_gate_results')
        .selectAll()
        .where('workflow_run_id', 'in', allRunIds)
        .orderBy('created_at', 'asc')
        .execute();
    const gateRows = rawGates.map((g) => ({ ...g, created_at: iso(g.created_at) ?? '' }));

    // 4. Replay routing for every dispatch.
    type Routed = (typeof steps)[number] & { routing: ReturnType<typeof decideRunRouting>['kind'] };
    const routed: Routed[] = steps.map((s) => {
        // A run that never completed produced no block at all; that is the same
        // information the engine had, and it parks on it.
        // Only `kind` and `checklist` steer the decision; `summary` / `reason`
        // feed the detail string, which is not scored. `exactOptionalPropertyTypes`
        // is on, so an absent checklist is omitted rather than set to null.
        const outcome: IRunOutcome | null = s.outcome_kind
            ? { kind: s.outcome_kind, ...(s.outcome_checklist ? { checklist: s.outcome_checklist } : {}) }
            : null;
        const decision = decideRunRouting({
            outcome,
            requiredChecklist: requiredByAgent.get(s.agent_id) ?? [],
        });
        return { ...s, routing: decision.kind };
    });

    // 5. Per-agent aggregation. A "step" is one (run, node) position; repeat
    //    dispatches against the same position are the fail-edge loop.
    const byAgent = new Map<string, AgentScore>();
    const stepGroups = new Map<string, Routed[]>();
    for (const r of routed) {
        const key = `${r.workflow_run_id ?? 'none'}::${r.node_id ?? r.agent_id}`;
        const list = stepGroups.get(key) ?? [];
        list.push(r);
        stepGroups.set(key, list);

        const score = byAgent.get(r.agent_id) ?? emptyScore(r.agent_id);
        score.dispatches += 1;
        score.cost_usd += r.total_cost_usd ?? 0;
        score.input_tokens += r.input_tokens ?? 0;
        score.output_tokens += r.output_tokens ?? 0;
        score.cache_read_tokens += r.cache_read_tokens ?? 0;
        score.cache_creation_tokens += r.cache_creation_tokens ?? 0;
        score.wall_clock_s += seconds(r.started_at, r.completed_at);
        if (r.routing === 'park_waiting_for_info') score.escalations += 1;
        bump(score.models, r.model);
        bump(score.efforts, r.effort);
        byAgent.set(r.agent_id, score);
    }

    for (const group of stepGroups.values()) {
        const first = group[0];
        if (!first) continue;
        const score = byAgent.get(first.agent_id);
        if (!score) continue;
        score.steps += 1;
        score.loops += group.length - 1;
        if (first.routing === 'apply_on_pass') score.pass_at_1 += 1;
    }

    // 6. Attribute each red gate to whoever last said the work was fine. That
    //    agent is the one whose `done` the gate just contradicted.
    const completedPasses = routed
        .filter((r) => r.routing === 'apply_on_pass' && r.completed_at)
        .sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? ''));
    for (const gate of gateRows) {
        if (gate.verdict !== 'fail') continue;
        const tree = rootOf.get(gate.workflow_run_id) ?? gate.workflow_run_id;
        let culprit: Routed | null = null;
        for (const r of completedPasses) {
            const rTree = rootOf.get(r.workflow_run_id ?? '') ?? r.workflow_run_id;
            if (rTree !== tree) continue;
            if ((r.completed_at ?? '') > gate.created_at) break;
            culprit = r;
        }
        if (culprit) {
            const score = byAgent.get(culprit.agent_id);
            if (score) score.gate_catch += 1;
        }
    }

    // 7. Per-run rollup.
    const stepsByRun = new Map<string, Routed[]>();
    for (const r of routed) {
        const tree = rootOf.get(r.workflow_run_id ?? '') ?? r.workflow_run_id ?? 'none';
        const list = stepsByRun.get(tree) ?? [];
        list.push(r);
        stepsByRun.set(tree, list);
    }
    // Fixture assertions (ATL-138). Titles and sub-task counts come from the
    // same DB the rest of the scorecard reads; nothing is taken on trust.
    const fixturesByTitle = loadFixtures();
    const itemIds = roots.map((r) => r.item_id).filter((v): v is string => typeof v === 'string');
    const items = itemIds.length
        ? await db.selectFrom('items').select(['id', 'title']).where('id', 'in', itemIds).execute()
        : [];
    const titleById = new Map(items.map((i) => [i.id, i.title as string]));
    const subCounts = itemIds.length
        ? await db
              .selectFrom('items')
              .select(['parent_id', (eb) => eb.fn.countAll().as('n')])
              .where('parent_id', 'in', itemIds)
              .groupBy('parent_id')
              .execute()
        : [];
    const subCountById = new Map(subCounts.map((r) => [r.parent_id as string, Number(r.n)]));

    const runReport = roots.map((run) => {
        const mine = stepsByRun.get(run.id) ?? [];
        const title = run.item_id ? titleById.get(run.item_id) : undefined;
        const fixture = title ? fixturesByTitle.get(title) : undefined;
        const fixtureVerdict = fixture
            ? checkExpectation(fixture, run as never, run.item_id ? (subCountById.get(run.item_id) ?? 0) : 0)
            : null;
        return {
            fixture: fixtureVerdict,
            id: run.id,
            workflow_id: run.workflow_id,
            item_id: run.item_id,
            project_id: run.project_id,
            status: run.status,
            started_at: iso(run.started_at),
            finished_at: iso(run.finished_at),
            wall_clock_s: seconds(iso(run.started_at), iso(run.finished_at)),
            dispatches: mine.length,
            cost_usd: Number(mine.reduce((n, s) => n + (s.total_cost_usd ?? 0), 0).toFixed(4)),
            loop_count: run.loop_count,
            gate_rounds: run.gate_rounds,
            park_reason: run.park_reason,
            pr_urls: run.pr_urls,
            gates: gateRows
                .filter((g) => (rootOf.get(g.workflow_run_id) ?? g.workflow_run_id) === run.id)
                .map((g) => ({ script_id: g.script_id, verdict: g.verdict, node_id: g.node_id })),
        };
    });

    const agents = [...byAgent.values()].sort((a, b) => b.dispatches - a.dispatches);
    const totals = {
        runs: roots.length,
        dispatches: routed.length,
        cost_usd: Number(agents.reduce((n, a) => n + a.cost_usd, 0).toFixed(4)),
        wall_clock_s: Math.round(agents.reduce((n, a) => n + a.wall_clock_s, 0)),
        gate_results: gateRows.length,
        gate_failures: gateRows.filter((g) => g.verdict === 'fail').length,
        // A skip is not a pass (migration 013). Counting them separately is the
        // difference between "91 gates were green" and "91 gates exited 0, and
        // this many of them could not run".
        gate_skipped: gateRows.filter((g) => g.verdict === 'skipped').length,
        fixtures_checked: runReport.filter((r) => r.fixture).length,
        fixtures_failed: runReport.filter((r) => r.fixture && !r.fixture.passed).length,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = args.label ? `${stamp}-${args.label}` : stamp;
    mkdirSync(args.out, { recursive: true });

    const jsonPath = join(args.out, `${name}.json`);
    writeFileSync(
        jsonPath,
        JSON.stringify({ generated_at: new Date().toISOString(), scope: args, totals, agents, runs: runReport }, null, 2),
    );

    const mdPath = join(args.out, `${name}.md`);
    writeFileSync(mdPath, renderScorecard(name, totals, agents, runReport));

    console.log(`Scored ${totals.runs} run(s), ${totals.dispatches} dispatch(es).`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${mdPath}`);
    await db.destroy();
}

function pct(n: number, d: number): string {
    return d === 0 ? '—' : `${((n / d) * 100).toFixed(0)}%`;
}

function renderScorecard(
    name: string,
    totals: Record<string, number>,
    agents: AgentScore[],
    runs: Array<Record<string, unknown>>,
): string {
    const lines: string[] = [];
    lines.push(`# Agent scorecard — ${name}`, '');
    lines.push(
        `${totals['runs']} workflow run(s) · ${totals['dispatches']} agent dispatch(es) · ` +
            `$${totals['cost_usd']} · ${Math.round((totals['wall_clock_s'] ?? 0) / 60)} min of agent time · ` +
            `${totals['gate_failures']}/${totals['gate_results']} gate verdicts red` +
            (totals['gate_skipped'] ? `, ${totals['gate_skipped']} skipped` : ''),
        '',
    );

    if (totals['fixtures_checked']) {
        const failed = totals['fixtures_failed'] ?? 0;
        lines.push(
            `**Fixtures: ${(totals['fixtures_checked'] ?? 0) - failed} passed, ${failed} failed.** ` +
                'Checked against each fixture\'s `expect` block.',
            '',
        );
        const bad = runs.filter((r) => {
            const f = r['fixture'] as { passed: boolean } | null;
            return f && !f.passed;
        });
        if (bad.length) {
            lines.push('| Fixture | Item | What did not hold |', '|---|---|---|');
            for (const r of bad) {
                const f = r['fixture'] as { fixture_id: string; failures: string[] };
                lines.push(`| \`${f.fixture_id}\` | ${r['item_id'] ?? '—'} | ${f.failures.join('; ')} |`);
            }
            lines.push('');
        }
    }

    if (totals['gate_skipped']) {
        lines.push(
            `> **${totals['gate_skipped']} of ${totals['gate_results']} gate verdicts were \`skipped\`** — the script ` +
                'exited 0 having found nothing it could check (no coverage script, no browser, no UI files in the ' +
                'diff). A skip takes the pass edge and is **not** a pass: read the red count alongside how many ' +
                'gates could run at all.',
            '',
        );
    }

    lines.push('## Per agent', '');
    lines.push('| Agent | Steps | pass@1 | Loops | Escalations | Gate catches | $ | $/step | Cache read | Model(s) | Effort(s) |');
    lines.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|---|---|');
    for (const a of agents) {
        const cacheTotal = a.input_tokens + a.cache_read_tokens;
        lines.push(
            `| \`${a.agent_id}\` | ${a.steps} | ${pct(a.pass_at_1, a.steps)} | ${a.loops} | ` +
                `${a.escalations} | ${a.gate_catch} | ${a.cost_usd.toFixed(2)} | ` +
                `${a.steps ? (a.cost_usd / a.steps).toFixed(2) : '—'} | ${pct(a.cache_read_tokens, cacheTotal)} | ` +
                `${Object.keys(a.models).join(', ')} | ${Object.keys(a.efforts).join(', ')} |`,
        );
    }
    lines.push('');
    lines.push(
        '`pass@1` is the share of step positions whose **first** dispatch routed pass. ' +
            '`Gate catches` counts deterministic gate failures that landed after this agent ' +
            'was the last to report `done` — the one quality signal an agent cannot author itself.',
        '',
        '**Read `agent-po-writer` differently.** Its prompt makes run 1 a brainstorm pass ' +
            'that always ends `asked_question`, so a low pass@1 and a high escalation count are ' +
            'the design working, not the agent failing. Judge it on whether the Owner had to ' +
            'answer more than once, i.e. escalations above one per run.',
        '',
    );

    lines.push('## Per run', '');
    lines.push('| Run | Item | Fixture | Status | Dispatches | $ | Wall clock | Loops | Gates |');
    lines.push('|---|---|---|---|--:|--:|--:|--:|---|');
    for (const r of runs) {
        const secs = Number(r['wall_clock_s'] ?? 0);
        const gates = (r['gates'] as Array<{ script_id: string; verdict: string }>) ?? [];
        const f = r['fixture'] as { fixture_id: string; passed: boolean } | null;
        const fixtureCell = f ? `${f.passed ? 'pass' : '**FAIL**'} \`${f.fixture_id}\`` : '—';
        lines.push(
            `| \`${String(r['id']).slice(0, 8)}\` | ${r['item_id'] ?? '—'} | ${fixtureCell} | ${r['status']} | ` +
                `${r['dispatches']} | ${r['cost_usd']} | ${Math.round(secs / 60)}m | ${r['loop_count']} | ` +
                `${gates.map((g) => `${g.script_id}:${g.verdict}`).join(', ') || '—'} |`,
        );
    }
    lines.push('');
    return lines.join('\n');
}

main().catch(async (err) => {
    console.error(err);
    await db.destroy().catch(() => undefined);
    process.exit(1);
});
