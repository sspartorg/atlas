import { db } from '../db/kysely-client.js';
import { toBatches, type AgentTestBatch } from './agent-test-batches.js';
import { isOwnerEdited } from './agent-starter-tests.js';
import type { AgentTestRunRow } from './agent-tests-evaluate-run.js';

// "How do we know ABC Agent does what it is supposed to?"
//
// Every number below already existed. `agent_tests` holds the fixtures,
// `agent_test_runs` the samples, `agent-test-batches.ts` the pass@1 / pass@k /
// consistency fold, and `agent_runs` has snapshotted cli, model, effort and
// prompt_version per dispatch since ADR 0014. What did not exist was a sentence
// that puts them together — so the Owner could see a green test and still not
// know whether it was green on the prompt the agent is running right now.
//
// Two rules the fold exists to enforce:
//
//   **A suite that has never run is not a passing suite.** `never_run` is its
//   own state, ahead of everything except "there are no tests at all".
//
//   **A suite whose samples all errored is `blocked`, not `failing`.** The same
//   distinction ADR 0020 draws for a gate that could not run, kept at the suite
//   level rather than averaged away.
//
// **This is not a leaderboard.** ADR 0023 is explicit that pass@1 must not rank
// agents: `agent-release-reviewer` scored 64% on the v4 set BECAUSE it rejected
// four times, and those rejections were the run's most valuable output. A
// qualification verdict is safe where that number was not, for a structural
// reason — a fixture declares what a pass is, so a reviewer's fixture expects
// `rejected` and rejecting correctly passes. The payload therefore carries
// per-agent counts and no fleet percentage, and the fleet view groups by state
// rather than sorting by score.

export type QualificationVerdict =
    | 'no_tests'
    | 'never_run'
    | 'failing'
    | 'blocked'
    | 'stale'
    | 'qualified';

interface QualificationFixture {
    agent_test_id: string;
    name: string;
    /** Adopted from the bundle and untouched, adopted and edited, or the Owner's own. */
    provenance: 'catalog' | 'edited' | 'owner';
    pass_at_1: boolean | null;
    pass_at_k: boolean | null;
    consistency: number | null;
    flaky: boolean;
    n_runs: number;
    last_run_at: string | null;
    failures: string[];
}

export interface AgentQualification {
    agent_id: string;
    verdict: QualificationVerdict;
    fixtures: number;
    never_run: number;
    passed_at_1: number;
    passed_at_k: number;
    failed: number;
    flaky: number;
    /** Latest batch judged nothing at all — a broken environment, not a wrong answer. */
    blocked: number;
    last_run_at: string | null;
    /** Agent + judge, over the latest batch of each fixture. */
    cost_usd: number;
    stale: boolean;
    /** Names the field that changed, so the badge is actionable rather than decorative. */
    stale_reason: string | null;
    /** What the newest judged run ran against. Null when nothing has run. */
    ran_at_config: { model: string | null; effort: string | null; prompt_version: number | null } | null;
    per_fixture: QualificationFixture[];
}

/**
 * The fold, as a pure function so the honesty rules can be tested without a DB.
 *
 * Order is most-honest-first: a suite is only `qualified` when there is
 * something to run, it has run, nothing failed, nothing was blocked, and it ran
 * against the configuration the agent has now.
 */
export function suiteVerdict(input: {
    fixtures: number;
    never_run: number;
    failed: number;
    blocked: number;
    stale: boolean;
}): QualificationVerdict {
    if (input.fixtures === 0) return 'no_tests';
    if (input.never_run === input.fixtures) return 'never_run';
    if (input.failed > 0) return 'failing';
    if (input.blocked > 0) return 'blocked';
    // A partially-run suite is not qualified either: `never_run > 0` here means
    // some fixture has never been proven, which `stale` covers in spirit and
    // the count makes explicit in the UI.
    if (input.stale || input.never_run > 0) return 'stale';
    return 'qualified';
}

interface ConfigSnapshot {
    model: string | null;
    effort: string | null;
    prompt_version: number | null;
}

/**
 * Whether the newest judged run was taken against the agent as it is now.
 *
 * Compared on the four fields `agent_runs` snapshots at dispatch, NOT on
 * `agents.updated_at`: every PATCH moves that, including an accent colour, and
 * a badge that cries stale over a colour change is a badge the Owner learns to
 * ignore.
 *
 * ponytail: a checklist-only or settings_json-only upgrade moves none of these,
 * so it will not read as stale. Snapshot a config hash on `agent_runs` at
 * dispatch if that ever matters.
 */
function staleness(now: ConfigSnapshot & { cli: string | null }, then: (ConfigSnapshot & { cli: string | null }) | null): string | null {
    if (!then) return null;
    if (then.model !== now.model) return `the model changed from ${then.model ?? 'unrecorded'} to ${now.model ?? 'unrecorded'} since the last run`;
    if (then.effort !== now.effort) return `the effort changed from ${then.effort ?? 'unrecorded'} to ${now.effort ?? 'unrecorded'} since the last run`;
    if (then.cli !== now.cli) return `the CLI changed from ${then.cli ?? 'unrecorded'} to ${now.cli ?? 'unrecorded'} since the last run`;
    if (then.prompt_version !== null && now.prompt_version !== null && then.prompt_version < now.prompt_version) {
        return `the prompt changed (v${then.prompt_version} → v${now.prompt_version}) since the last run`;
    }
    return null;
}

/** One agent's suite, or every installed agent's when `agentId` is omitted. */
export async function agentQualification(agentId?: string): Promise<AgentQualification[]> {
    let agentsQ = db.selectFrom('agents').select(['id', 'cli', 'model', 'effort', 'prompt_version']);
    if (agentId) agentsQ = agentsQ.where('id', '=', agentId);
    const agents = await agentsQ.execute();
    if (agents.length === 0) return [];

    const ids = agents.map((a) => a.id);
    const tests = await db
        .selectFrom('agent_tests')
        .select(['id', 'agent_id', 'name', 'item_template', 'expectations', 'source_test_id', 'source_hash'])
        .where('agent_id', 'in', ids)
        .orderBy('created_at', 'asc')
        .execute();

    const testIds = tests.map((t) => t.id);
    // Deliberately NOT `listRuns`, which judges anything that finished since it
    // was last read. A fleet read must not fire 72 judge passes and 72 writes;
    // the per-test route still self-heals, and a sample genuinely still running
    // renders as running, which is honest.
    const runs = testIds.length
        ? await db
              .selectFrom('agent_test_runs as r')
              .leftJoin('agent_runs as ar', 'ar.id', 'r.agent_run_id')
              .select([
                  'r.id',
                  'r.agent_test_id',
                  'r.agent_run_id',
                  'r.item_id',
                  'r.verdict',
                  'r.failures',
                  'r.cost_usd',
                  'r.duration_s',
                  'r.created_at',
                  'r.batch_id',
                  'r.sample_index',
                  'r.label',
                  'r.judge_verdict',
                  'r.judge_reason',
                  'r.judge_cost_usd',
                  'r.workflow_run_id',
                  'ar.cli as ran_cli',
                  'ar.model as ran_model',
                  'ar.effort as ran_effort',
                  'ar.prompt_version as ran_prompt_version',
              ])
              .where('r.agent_test_id', 'in', testIds)
              .orderBy('r.created_at', 'desc')
              .orderBy('r.sample_index', 'asc')
              .execute()
        : [];

    const runsByTest = new Map<string, typeof runs>();
    for (const r of runs) {
        const list = runsByTest.get(r.agent_test_id) ?? [];
        list.push(r);
        runsByTest.set(r.agent_test_id, list);
    }

    return agents.map((agent) => {
        const mine = tests.filter((t) => t.agent_id === agent.id);
        const per: QualificationFixture[] = [];
        let never_run = 0;
        let passed_at_1 = 0;
        let passed_at_k = 0;
        let failed = 0;
        let flaky = 0;
        let blocked = 0;
        let cost = 0;
        let last_run_at: string | null = null;
        let ranAt: (ConfigSnapshot & { cli: string | null }) | null = null;
        let ranAtWhen = '';

        for (const t of mine) {
            const rows = runsByTest.get(t.id) ?? [];
            const latest: AgentTestBatch | undefined = toBatches(rows as unknown as AgentTestRunRow[])[0];
            const provenance: QualificationFixture['provenance'] = !t.source_test_id
                ? 'owner'
                : isOwnerEdited({
                        name: t.name,
                        item_template: t.item_template,
                        expectations: t.expectations,
                        source_test_id: t.source_test_id,
                        source_hash: t.source_hash,
                    })
                  ? 'edited'
                  : 'catalog';

            if (!latest) {
                never_run += 1;
                per.push({
                    agent_test_id: t.id,
                    name: t.name,
                    provenance,
                    pass_at_1: null,
                    pass_at_k: null,
                    consistency: null,
                    flaky: false,
                    n_runs: 0,
                    last_run_at: null,
                    failures: [],
                });
                continue;
            }

            const judged = latest.n_runs - latest.errored;
            if (judged === 0) blocked += 1;
            else if (latest.pass_at_1) passed_at_1 += 1;
            if (latest.pass_at_k) passed_at_k += 1;
            if (judged > 0 && !latest.pass_at_k) failed += 1;
            if (latest.flaky) flaky += 1;
            cost += latest.cost_usd + latest.judge_cost_usd;
            if (!last_run_at || latest.created_at > last_run_at) last_run_at = latest.created_at;

            // The configuration to compare against is the newest JUDGED sample
            // in the whole suite — a still-running one has proven nothing yet.
            for (const r of rows) {
                if (r.verdict === 'running') continue;
                if (r.created_at <= ranAtWhen) continue;
                ranAtWhen = r.created_at as unknown as string;
                ranAt = {
                    cli: (r.ran_cli as string | null) ?? null,
                    model: (r.ran_model as string | null) ?? null,
                    effort: (r.ran_effort as string | null) ?? null,
                    prompt_version: (r.ran_prompt_version as number | null) ?? null,
                };
            }

            per.push({
                agent_test_id: t.id,
                name: t.name,
                provenance,
                pass_at_1: latest.pass_at_1,
                pass_at_k: latest.pass_at_k,
                consistency: latest.consistency,
                flaky: latest.flaky,
                n_runs: latest.n_runs,
                last_run_at: latest.created_at,
                failures: latest.failure_histogram.map((f) => f.failure),
            });
        }

        const stale_reason = staleness(
            { cli: agent.cli, model: agent.model, effort: agent.effort, prompt_version: agent.prompt_version },
            ranAt,
        );
        const verdict = suiteVerdict({
            fixtures: mine.length,
            never_run,
            failed,
            blocked,
            stale: stale_reason !== null,
        });

        return {
            agent_id: agent.id,
            verdict,
            fixtures: mine.length,
            never_run,
            passed_at_1,
            passed_at_k,
            failed,
            flaky,
            blocked,
            last_run_at,
            cost_usd: Number(cost.toFixed(4)),
            stale: stale_reason !== null,
            stale_reason,
            ran_at_config: ranAt
                ? { model: ranAt.model, effort: ranAt.effort, prompt_version: ranAt.prompt_version }
                : null,
            per_fixture: per,
        };
    });
}
