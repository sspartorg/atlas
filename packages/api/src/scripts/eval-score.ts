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
import {
    iso,
    scoreAgents,
    seconds,
    type AgentScore,
    type RoutedStep,
} from '../services/agent-scorecard.js';

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

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    // Steps 1-6 — scoping, routing replay and per-agent aggregation — now
    // live in `services/agent-scorecard.ts`, because the product's agent page
    // needs exactly the same numbers (ADR 0023 phase 2). Imported rather than
    // copied: there is no second implementation because there is no second
    // copy of the code.
    const card = await scoreAgents({
        since: args.since,
        project_id: args.project,
        run_ids: args.runs,
    });
    const { routed, rootOf, gateRows } = card;
    const roots = card.roots;
    if (roots.length === 0) {
        console.error('No workflow runs in scope. Widen --since, or run eval-run.ts first.');
        await db.destroy();
        process.exit(1);
    }

    // 7. Per-run rollup.
    const stepsByRun = new Map<string, RoutedStep[]>();
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

    const agents = card.agents;
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
