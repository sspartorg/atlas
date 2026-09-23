// Golden-set runner — files fixture Tasks and waits for the workflow to finish.
//
// This is the paid half of the eval harness. `eval-score.ts` reads whatever is
// already in the database; this script is what puts comparable work there:
// the same Tasks, on the same repos, against whatever agent fleet is installed,
// so a before/after scorecard compares like with like.
//
// It does NOT execute agents itself. It creates each Task and queues it, and the
// API process's own dispatch tick (`tickWorkflowDispatch`, once a minute) picks
// it up and runs it. That means the dev API must be running, and — because any
// edit under `packages/api/src` restarts it and cancels a run mid-resume — no
// API edits may land while a golden set is in flight.
//
// SPENDS REAL MONEY. A Delivery run over two capabilities is roughly 25-30 agent
// dispatches. `--dry-run` validates the fixtures and prints the plan without
// creating anything; that is the default for CI and the safe first invocation.
//
// Usage (from the repo root):
//   pnpm eval:run                                   # dry run: validate + plan
//   pnpm eval:run -- --project ATL --execute        # the real thing
//   pnpm eval:run -- --project ATL --execute --only greenfield-feature

import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/kysely-client.js';
import { tasksService } from '../services/tasks.js';
import { workflowsService } from '../services/workflows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const GOLDEN_DIR = join(REPO_ROOT, 'evals', 'golden');
const RESULTS_DIR = join(REPO_ROOT, 'evals', 'results');

/** A run that has not moved in this long is treated as stuck and abandoned. */
const DEFAULT_TIMEOUT_MIN = 120;
const POLL_MS = 30_000;

interface GoldenFixture {
    id: string;
    title: string;
    description: string;
    /** What this fixture is probing. Prose, for the scorecard. */
    probes: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    /** Repo NAMES within the target project; empty means every repo it has. */
    repos?: string[];
    labels?: string[];
    /** Workflow name to queue on. Defaults to the project's Delivery workflow. */
    workflow?: string;
    expect?: {
        /** `waiting_for_owner` is a legitimate expectation for an ambiguous Task. */
        terminal_status?: Array<'completed' | 'waiting_for_owner' | 'error' | 'cancelled'>;
        min_sub_tasks?: number;
        requires_pr?: boolean;
    };
}

function loadFixtures(only: string[]): GoldenFixture[] {
    if (!existsSync(GOLDEN_DIR)) {
        throw new Error(`No fixtures at ${GOLDEN_DIR}`);
    }
    const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')).sort();
    const all = files.map((f) => {
        const fixture = JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf8')) as GoldenFixture;
        for (const key of ['id', 'title', 'description', 'probes'] as const) {
            if (!fixture[key] || typeof fixture[key] !== 'string') {
                throw new Error(`${f}: missing required string field '${key}'`);
            }
        }
        if (fixture.id !== f.replace(/\.json$/, '')) {
            throw new Error(`${f}: id '${fixture.id}' does not match its filename`);
        }
        return fixture;
    });
    const ids = all.map((f) => f.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) throw new Error(`duplicate fixture ids: ${dupes.join(', ')}`);
    return only.length > 0 ? all.filter((f) => only.includes(f.id)) : all;
}

interface Args {
    project: string | null;
    only: string[];
    execute: boolean;
    timeoutMin: number;
    label: string;
}

function parseArgs(argv: string[]): Args {
    const args: Args = { project: null, only: [], execute: false, timeoutMin: DEFAULT_TIMEOUT_MIN, label: '' };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === '--project' && value) { args.project = value; i++; }
        else if (flag === '--only' && value) { args.only.push(value); i++; }
        else if (flag === '--label' && value) { args.label = value; i++; }
        else if (flag === '--timeout-min' && value) { args.timeoutMin = Number(value); i++; }
        else if (flag === '--execute') args.execute = true;
        else if (flag === '--help' || flag === '-h') {
            console.log('usage: eval-run [--project ID|PREFIX] [--only FIXTURE]... [--execute] [--timeout-min N] [--label NAME]');
            process.exit(0);
        }
    }
    return args;
}

async function resolveProject(ref: string | null): Promise<{ id: string; name: string }> {
    const projects = await db.selectFrom('projects').select(['id', 'name', 'issue_key_prefix']).execute();
    if (projects.length === 0) throw new Error('no projects exist');
    if (!ref) {
        if (projects.length > 1) {
            throw new Error(
                `--project is required; candidates: ${projects.map((p) => `${p.issue_key_prefix} (${p.name})`).join(', ')}`,
            );
        }
        const only = projects[0];
        if (!only) throw new Error('no projects exist');
        return { id: only.id, name: only.name };
    }
    const hit = projects.find((p) => p.id === ref || p.issue_key_prefix === ref || p.name === ref);
    if (!hit) throw new Error(`no project matches '${ref}'`);
    return { id: hit.id, name: hit.name };
}

async function resolveRepoIds(projectId: string, names: string[] | undefined): Promise<string[]> {
    const repos = await db
        .selectFrom('project_repos')
        .select(['id', 'name'])
        .where('project_id', '=', projectId)
        .execute();
    if (repos.length === 0) throw new Error('the target project has no repos');
    if (!names || names.length === 0) return repos.map((r) => r.id);
    const ids: string[] = [];
    for (const name of names) {
        const hit = repos.find((r) => r.name === name);
        if (!hit) {
            throw new Error(`repo '${name}' is not in the project (have: ${repos.map((r) => r.name).join(', ')})`);
        }
        ids.push(hit.id);
    }
    return ids;
}

async function resolveWorkflow(projectId: string, name: string | undefined): Promise<{ id: string; name: string }> {
    const rows = await db
        .selectFrom('workflows')
        .select(['id', 'name', 'input_kind', 'status', 'trigger'])
        .where('project_id', '=', projectId)
        .execute();
    const itemWorkflows = rows.filter((w) => w.input_kind === 'item');
    if (name) {
        const hit = itemWorkflows.find((w) => w.name === name || w.id === name);
        if (!hit) {
            throw new Error(
                `no Task workflow named '${name}' in the project ` +
                    `(have: ${itemWorkflows.map((w) => w.name).join(', ') || 'none'})`,
            );
        }
        if (hit.status !== 'active') throw new Error(`workflow '${hit.name}' is ${hit.status}, not active`);
        return { id: hit.id, name: hit.name };
    }
    // No name given: take an active Task workflow, preferring the one that
    // dispatches on its own (`item_ready`). A project can hold several, and
    // picking whichever row came back first is how this landed on an inactive
    // scheduled workflow the first time it ran.
    const active = itemWorkflows.filter((w) => w.status === 'active');
    const hit = active.find((w) => w.trigger === 'item_ready') ?? active[0];
    if (!hit) {
        throw new Error(
            `no ACTIVE Task workflow in the project ` +
                `(have: ${itemWorkflows.map((w) => `${w.name} [${w.status}]`).join(', ') || 'none'}). ` +
                `Create one from the Delivery template first, or name one with --workflow.`,
        );
    }
    return { id: hit.id, name: hit.name };
}

const TERMINAL = new Set(['completed', 'waiting_for_owner', 'error', 'cancelled']);

async function waitForRun(itemId: string, timeoutMin: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMin * 60_000;
    let runId: string | null = null;
    while (Date.now() < deadline) {
        const run = await db
            .selectFrom('workflow_runs')
            .select(['id', 'status', 'current_node_id'])
            .where('item_id', '=', itemId)
            .where('parent_workflow_run_id', 'is', null)
            .orderBy('started_at', 'desc')
            .executeTakeFirst();
        if (run) {
            if (run.id !== runId) {
                runId = run.id;
                console.log(`    run ${run.id} started`);
            }
            if (TERMINAL.has(run.status)) {
                console.log(`    -> ${run.status}`);
                return run.id;
            }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    console.log(`    -> timed out after ${timeoutMin} min`);
    return runId;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const fixtures = loadFixtures(args.only);
    if (fixtures.length === 0) throw new Error('no fixtures selected');

    const project = await resolveProject(args.project);
    const workflowCache = new Map<string, { id: string; name: string }>();

    console.log(`Project: ${project.name} (${project.id})`);
    console.log(`Fixtures: ${fixtures.length}\n`);

    // Validate every fixture against the live project BEFORE creating anything,
    // so a typo in the tenth fixture does not leave nine Tasks queued.
    const planned: Array<{ fixture: GoldenFixture; repoIds: string[]; workflow: { id: string; name: string } }> = [];
    for (const fixture of fixtures) {
        const repoIds = await resolveRepoIds(project.id, fixture.repos);
        const key = fixture.workflow ?? '';
        let workflow = workflowCache.get(key);
        if (!workflow) {
            workflow = await resolveWorkflow(project.id, fixture.workflow);
            workflowCache.set(key, workflow);
        }
        planned.push({ fixture, repoIds, workflow });
        console.log(`  ${fixture.id}`);
        console.log(`    ${fixture.probes}`);
        console.log(`    ${repoIds.length} repo(s) -> ${workflow.name}`);
    }

    if (!args.execute) {
        console.log(`\nDry run — nothing created. Re-run with --execute to file these Tasks.`);
        console.log(`This will dispatch real agents and spend real money.`);
        await db.destroy();
        return;
    }

    const created: Array<{ fixture_id: string; item_id: string; run_id: string | null }> = [];
    for (const { fixture, repoIds, workflow } of planned) {
        console.log(`\n${fixture.id}`);
        const task = await tasksService.create({
            project_id: project.id,
            title: fixture.title,
            description: fixture.description,
            priority: fixture.priority ?? 'normal',
            labels: [...(fixture.labels ?? []), 'eval'],
            repo_ids: repoIds,
        });
        console.log(`    ${task.id} created`);
        // Queuing a draft Task also flips it to Ready — dispatch only picks up
        // Ready Tasks (`workflowsService.setItemWorkflow`).
        await workflowsService.setItemWorkflow(task.id, workflow.id);
        console.log(`    queued on ${workflow.name}; waiting (poll ${POLL_MS / 1000}s)`);
        const runId = await waitForRun(task.id, args.timeoutMin);
        created.push({ fixture_id: fixture.id, item_id: task.id, run_id: runId });
    }

    mkdirSync(RESULTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = args.label ? `${stamp}-${args.label}-runs` : `${stamp}-runs`;
    const manifest = join(RESULTS_DIR, `${name}.json`);
    writeFileSync(manifest, JSON.stringify({ project, created }, null, 2));

    const runFlags = created
        .filter((c) => c.run_id)
        .map((c) => `--run ${c.run_id}`)
        .join(' ');
    console.log(`\nManifest: ${manifest}`);
    console.log(`Score this set:\n  pnpm eval:score -- ${runFlags}`);
    await db.destroy();
}

main().catch(async (err) => {
    console.error(String(err instanceof Error ? err.message : err));
    await db.destroy().catch(() => undefined);
    process.exit(1);
});
