import { db } from '../db/kysely-client.js';
import { decideRunRouting } from './agent-runner-outcome-routing.js';
import type { IRunOutcome } from '@atlas/shared';

// The agent scorecard, as a service rather than a script.
//
// ADR 0023 phase 2 says the agent page "needs a route and a view, not new
// maths" — so this is the maths, moved verbatim out of `scripts/eval-score.ts`
// and imported back by it. There is no second implementation because there is
// no second copy of the code, which is the only way that promise stays true
// once two callers want it.
//
// What it reads has never been read analytically before: `agent_runs` has
// snapshotted `cli`, `model`, `effort`, `prompt_version`, token counts and
// `total_cost_usd` on every dispatch since ADR 0014, explicitly so agent
// configurations could be compared, and nothing ever compared them.
//
// **Routing is recomputed, not trusted.** `decideRunRouting` is the same pure
// function the workflow engine routes on, replayed over each run's
// `outcome_kind` and `outcome_checklist` — including the F-012 hole where an
// empty required checklist makes `done` an automatic pass. A number derived
// from what the agent said about itself would be worth nothing.

export interface AgentScore {
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
export function iso(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

export function seconds(from: string | null, to: string | null): number {
    if (!from || !to) return 0;
    const ms = new Date(to).getTime() - new Date(from).getTime();
    return ms > 0 ? ms / 1000 : 0;
}

function bump(counter: Record<string, number>, key: string | null): void {
    const k = key ?? '(unset)';
    counter[k] = (counter[k] ?? 0) + 1;
}


/** What to score over. Empty means "the default window". */
export interface ScorecardScope {
    since?: string | null;
    until?: string | null;
    project_id?: string | null;
    run_ids?: string[];
}

export type RoutedStep = {
    id: string;
    agent_id: string;
    node_id: string | null;
    workflow_run_id: string | null;
    status: string;
    model: string | null;
    effort: string | null;
    total_cost_usd: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    routing: ReturnType<typeof decideRunRouting>['kind'];
};

/** The columns of a root `workflow_runs` row that scoring and the CLI read. */
interface ScoredRun {
    id: string;
    workflow_id: string | null;
    item_id: string | null;
    project_id: string | null;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    loop_count: number | null;
    gate_rounds: number | null;
    park_reason: string | null;
    pr_urls: unknown;
}

interface ScoredGate {
    workflow_run_id: string;
    node_id: string | null;
    script_id: string;
    verdict: string;
    created_at: string;
}

export interface Scorecard {
    agents: AgentScore[];
    /** Every dispatch in scope, with its routing replayed. */
    routed: RoutedStep[];
    /** Child run id → the root run it belongs to (ADR 0015 sub-task runs). */
    rootOf: Map<string, string>;
    roots: ScoredRun[];
    gateRows: ScoredGate[];
}

/**
 * Score every agent that took a step in the runs in scope.
 *
 * Runs with no `workflow_run_id` — ad-hoc dispatches and agent tests — are out
 * of scope by construction: a "step" is a position in a graph, and neither has
 * one. Test quality is reported separately, from the batches.
 */
export async function scoreAgents(scope: ScorecardScope = {}): Promise<Scorecard> {
    const args = {
        since: scope.since ?? null,
        until: scope.until ?? null,
        project: scope.project_id ?? null,
        runs: scope.run_ids ?? [],
    };

    // 1. Root runs in scope. A Task's sub-task runs are children (ADR 0015) and
    //    are pulled in via the tree below, never selected directly — otherwise
    //    a sub-task run would be counted as its own delivery.
    let q = db
        .selectFrom('workflow_runs')
        .selectAll()
        .where('parent_workflow_run_id', 'is', null);
    if (args.runs.length > 0) q = q.where('id', 'in', args.runs);
    if (args.since) q = q.where('started_at', '>=', args.since);
    if (args.until) q = q.where('started_at', '<=', args.until);
    if (args.project) q = q.where('project_id', '=', args.project);
    const roots = await q.orderBy('started_at', 'asc').execute();

    // Nothing in scope is an answer, not an error: a brand-new agent has no
    // runs, and the page has to render that rather than 500.
    if (roots.length === 0) {
        return { agents: [], routed: [], rootOf: new Map(), roots: [], gateRows: [] };
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
            // ADR 0024 — a gate's own checker reports `done` immediately before
            // the command it named runs, so without this it would always be the
            // most recent "the work is fine" and would catch itself. The gate
            // row names its checker in `script_id`, which is how we know.
            if (r.agent_id === gate.script_id) continue;
            culprit = r;
        }
        if (culprit) {
            const score = byAgent.get(culprit.agent_id);
            if (score) score.gate_catch += 1;
        }
    }


    return {
        agents: [...byAgent.values()].sort((a, b) => b.dispatches - a.dispatches),
        routed,
        rootOf,
        roots: roots as unknown as ScoredRun[],
        gateRows: gateRows as unknown as ScoredGate[],
    };
}

// ── One agent's page (ADR 0023 phase 2, ATL-140) ─────────────────────────

/**
 * How a step's FIRST dispatch went, split three ways instead of summed.
 *
 * ADR 0023 is explicit that `pass@1` must not be shown as a bare ranking: on
 * the v4 golden set `agent-release-reviewer` scored 64% **because it rejected
 * four times**, and those four rejections were the most valuable thing in the
 * run — including an unescaped value reaching rendered HTML that the
 * Architect's spec had ruled out of scope. A page that ranks agents by pass@1
 * would recommend culling the best reviewer in the fleet.
 *
 * So the route does not return a percentage. It returns the three components,
 * and the view labels `rejected` from the agent's role: a reviewer's
 * rejections are its product, not its failures. The warning is satisfied by
 * the shape of the payload rather than by a caveat string nobody reads.
 */
interface FirstPass {
    /** Routed pass first time. */
    applied: number;
    /** Sent the work back first time. For a reviewer this is the job. */
    rejected: number;
    /** Asked the Owner, or produced no readable outcome at all. */
    parked: number;
}

interface ConfigSlice {
    model: string | null;
    effort: string | null;
    steps: number;
    first_pass: FirstPass;
    cost_usd: number;
}

interface TrendBucket {
    /** ISO date of the bucket start. */
    bucket: string;
    steps: number;
    first_pass: FirstPass;
    cost_usd: number;
    p95_s: number | null;
}

export interface AgentPerformance {
    agent_id: string;
    role_id: string | null;
    window: { since: string | null; until: string | null };
    quality: {
        steps: number;
        dispatches: number;
        first_pass: FirstPass;
        /** Dispatches beyond the first on the same step — the price of getting it wrong. */
        loops: number;
        /**
         * Times a deterministic gate went red after this agent last said the
         * work was done. The one quality signal an agent cannot author about
         * itself (ADR 0020, campaign finding F-012).
         */
        gate_catch: number;
    };
    cost: {
        total_usd: number;
        per_step_usd: number | null;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_creation_tokens: number;
        /** Share of input served from cache. Null when nothing was read at all. */
        cache_hit_pct: number | null;
    };
    latency: { p50_s: number | null; p95_s: number | null; max_s: number | null; ttft_p50_ms: number | null };
    tools: {
        /**
         * The denominator. Traces exist only from migration 017 on, and a
         * percentage over an unstated denominator is the dishonest kind of
         * number.
         */
        runs_with_trace: number;
        runs_total: number;
        top: Array<{ name: string; calls: number; runs: number }>;
        avg_turns: number | null;
        avg_tool_calls: number | null;
    };
    /** ATL-140: numbers attributable to the configuration that produced them. */
    by_config: ConfigSlice[];
    trend: TrendBucket[];
}

function emptyFirstPass(): FirstPass {
    return { applied: 0, rejected: 0, parked: 0 };
}

function addFirstPass(into: FirstPass, routing: RoutedStep['routing'], detail: string | undefined): void {
    if (routing === 'apply_on_pass') into.applied += 1;
    else if (routing === 'park_waiting_for_info') into.parked += 1;
    else into.rejected += 1;
    void detail;
}

function percentile(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? null;
}

/** Monday of the week a timestamp falls in, as an ISO date. */
function weekOf(iso8601: string): string {
    const d = new Date(iso8601);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
}

function round(n: number, places = 4): number {
    return Number(n.toFixed(places));
}

/**
 * Everything one agent's own runs already prove.
 *
 * "A route and a view, not new maths" — the aggregation above does the work;
 * this reshapes one agent's slice of it for a page, and adds the three things
 * a scorecard markdown file never had to care about: latency percentiles, the
 * tool profile from migration 017, and a trend over time.
 */
export async function agentPerformance(
    agentId: string,
    scope: ScorecardScope = {},
): Promise<AgentPerformance> {
    const card = await scoreAgents(scope);
    const score = card.agents.find((a) => a.agent_id === agentId) ?? emptyScore(agentId);
    const mine = card.routed.filter((r) => r.agent_id === agentId);

    const roleRow = await db
        .selectFrom('agents')
        .select('role_id')
        .where('id', '=', agentId)
        .executeTakeFirst();

    // First dispatches only: a step's retries are `loops`, not fresh attempts.
    const firstByStep = new Map<string, RoutedStep>();
    for (const r of mine) {
        const key = `${r.workflow_run_id ?? 'none'}::${r.node_id ?? r.agent_id}`;
        if (!firstByStep.has(key)) firstByStep.set(key, r);
    }
    const firsts = [...firstByStep.values()];
    const first_pass = emptyFirstPass();
    for (const r of firsts) addFirstPass(first_pass, r.routing, undefined);

    const durations = mine
        .map((r) => seconds(r.started_at, r.completed_at))
        .filter((n) => n > 0)
        .sort((a, b) => a - b);

    // The tool profile comes from the traces, which exist only from migration
    // 017 on — hence the explicit denominator rather than a bare percentage.
    const runIds = mine.map((r) => r.id);
    const traceRows = runIds.length
        ? await db
              .selectFrom('agent_runs')
              .select(['trace_summary'])
              .where('id', 'in', runIds)
              .where('trace_summary', 'is not', null)
              .execute()
        : [];
    const traces = traceRows
        .map((t) => t.trace_summary)
        .filter((t): t is NonNullable<typeof t> => t !== null);
    const toolCalls = new Map<string, { calls: number; runs: number }>();
    for (const t of traces) {
        for (const [name, n] of Object.entries(t.tools ?? {})) {
            const e = toolCalls.get(name) ?? { calls: 0, runs: 0 };
            e.calls += n;
            e.runs += 1;
            toolCalls.set(name, e);
        }
    }
    const ttfts = traces
        .map((t) => t.ttft_ms)
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b);

    // Attribution (ATL-140): a model or prompt change reads as a break in the
    // series rather than a smear across it.
    const configs = new Map<string, ConfigSlice>();
    for (const r of firsts) {
        const key = `${r.model ?? '?'}::${r.effort ?? '?'}`;
        const slice = configs.get(key) ?? {
            model: r.model,
            effort: r.effort,
            steps: 0,
            first_pass: emptyFirstPass(),
            cost_usd: 0,
        };
        slice.steps += 1;
        addFirstPass(slice.first_pass, r.routing, undefined);
        configs.set(key, slice);
    }
    for (const r of mine) {
        const slice = configs.get(`${r.model ?? '?'}::${r.effort ?? '?'}`);
        if (slice) slice.cost_usd = round(slice.cost_usd + (r.total_cost_usd ?? 0));
    }

    const buckets = new Map<string, { steps: number; first_pass: FirstPass; cost_usd: number; durations: number[] }>();
    for (const r of firsts) {
        const at = r.completed_at ?? r.created_at;
        if (!at) continue;
        const key = weekOf(at);
        const b = buckets.get(key) ?? { steps: 0, first_pass: emptyFirstPass(), cost_usd: 0, durations: [] };
        b.steps += 1;
        addFirstPass(b.first_pass, r.routing, undefined);
        b.cost_usd = round(b.cost_usd + (r.total_cost_usd ?? 0));
        const d = seconds(r.started_at, r.completed_at);
        if (d > 0) b.durations.push(d);
        buckets.set(key, b);
    }

    const cacheable = score.input_tokens + score.cache_read_tokens;
    return {
        agent_id: agentId,
        role_id: roleRow?.role_id ?? null,
        window: { since: scope.since ?? null, until: scope.until ?? null },
        quality: {
            steps: score.steps,
            dispatches: score.dispatches,
            first_pass,
            loops: score.loops,
            gate_catch: score.gate_catch,
        },
        cost: {
            total_usd: round(score.cost_usd),
            per_step_usd: score.steps === 0 ? null : round(score.cost_usd / score.steps),
            input_tokens: score.input_tokens,
            output_tokens: score.output_tokens,
            cache_read_tokens: score.cache_read_tokens,
            cache_creation_tokens: score.cache_creation_tokens,
            cache_hit_pct: cacheable === 0 ? null : round(score.cache_read_tokens / cacheable, 3),
        },
        latency: {
            p50_s: percentile(durations, 0.5),
            p95_s: percentile(durations, 0.95),
            max_s: durations.at(-1) ?? null,
            ttft_p50_ms: percentile(ttfts, 0.5),
        },
        tools: {
            runs_with_trace: traces.length,
            runs_total: mine.length,
            top: [...toolCalls.entries()]
                .map(([name, e]) => ({ name, calls: e.calls, runs: e.runs }))
                .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
                .slice(0, 8),
            avg_turns: traces.length === 0 ? null : round(traces.reduce((n, t) => n + t.turns, 0) / traces.length, 1),
            avg_tool_calls:
                traces.length === 0 ? null : round(traces.reduce((n, t) => n + t.tool_calls, 0) / traces.length, 1),
        },
        by_config: [...configs.values()].sort((a, b) => b.steps - a.steps),
        trend: [...buckets.entries()]
            .map(([bucket, b]) => ({
                bucket,
                steps: b.steps,
                first_pass: b.first_pass,
                cost_usd: b.cost_usd,
                p95_s: percentile([...b.durations].sort((x, y) => x - y), 0.95),
            }))
            .sort((a, b) => a.bucket.localeCompare(b.bucket)),
    };
}
