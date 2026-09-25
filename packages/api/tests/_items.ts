// Test helpers for the unified `items` schema.
//
// Use:
//   await insertProject('p1');
//   await insertAgent({ id: 'agent-coder' });
//   const taskId = await insertItem({ type: 'task', project_id: 'p1', title: 'T' });
//
// All helpers respect the test DB pool via `testDb` from `_pg-db.ts`.

import { testDb } from './_pg-db.js';
import type { ItemType } from '../src/db/types.js';
import type { IssueStatus, IssuePriority } from '@atlas/shared';

export async function insertProject(
    id: string = 'p1',
    prefix: string = 'ATL',
    overrides: Partial<{
        name: string;
        git_path: string;
        git_url: string;
        default_branch: string;
        credential_id: string;
        /** ADR 0018 — a project can exist with no repos at all. */
        no_repo: boolean;
    }> = {},
): Promise<string> {
    await testDb
        .insertInto('projects')
        .values({
            id,
            name: overrides.name ?? `Project ${id}`,
            issue_key_prefix: prefix,
            status: 'active',
        })
        .execute();
    await testDb
        .insertInto('project_issue_counters')
        .values({ project_id: id, last_seq: 0 })
        .execute();
    // ADR 0018 — the git fields live on a repo. Migration 045 gives the repo
    // the project's own id, and so does this fixture.
    if (!overrides.no_repo) {
        await insertProjectRepo(id, {
            id,
            name: 'repo',
            ...(overrides.git_path !== undefined ? { git_path: overrides.git_path } : {}),
            ...(overrides.git_url !== undefined ? { git_url: overrides.git_url } : {}),
            ...(overrides.default_branch !== undefined ? { default_branch: overrides.default_branch } : {}),
            ...(overrides.credential_id !== undefined ? { credential_id: overrides.credential_id } : {}),
        });
    }
    return id;
}

export async function insertProjectRepo(
    projectId: string,
    overrides: Partial<{
        id: string;
        name: string;
        git_path: string;
        git_url: string;
        default_branch: string;
        credential_id: string;
        clone_status: 'pending' | 'cloning' | 'ready' | 'error';
        position: number;
        /** ADR 0024 — what the pre-push gate runs. Set, so delivery tests reach the push. */
        verify_command: string;
    }> = {},
): Promise<string> {
    const id = overrides.id ?? `${projectId}-repo-${Math.random().toString(36).slice(2, 8)}`;
    const existing = await testDb
        .selectFrom('project_repos')
        .select('position')
        .where('project_id', '=', projectId)
        .execute();
    await testDb
        .insertInto('project_repos')
        .values({
            id,
            project_id: projectId,
            name: overrides.name ?? `repo-${existing.length + 1}`,
            git_path: overrides.git_path ?? '',
            git_url: overrides.git_url ?? '',
            default_branch: overrides.default_branch ?? 'main',
            clone_status: overrides.clone_status ?? 'ready',
            // Non-empty by default: an empty command parks the run before the
            // push (ADR 0024), which is a behaviour its own tests assert, not
            // one every delivery fixture should have to opt out of.
            verify_command: overrides.verify_command ?? 'echo verified',
            position:
                overrides.position ??
                existing.reduce((max, r) => Math.max(max, r.position), -1) + 1,
            ...(overrides.credential_id !== undefined ? { credential_id: overrides.credential_id } : {}),
        })
        .execute();
    return id;
}

export async function insertAgent(
    overrides: Partial<{
        id: string;
        name: string;
        category: 'software-dev' | 'marketing' | 'content' | 'design';
        cli: 'claude' | 'copilot';
        model: string;
        status: 'active' | 'inactive';
        accent_color: string;
        prompt_md: string;
        prompt_version: number;
    }> = {},
): Promise<string> {
    const id = overrides.id ?? 'agent-coder';
    const cli = overrides.cli ?? 'claude';
    const model = overrides.model ?? 'claude-opus-4-7';
    // Workstream #4 — ensure the (cli, model) row exists in cli_models
    // so the agents_cli_model_fk constraint (migration 061) doesn't
    // reject the insert. The test fixture's truncateAll wipes
    // cli_models per test for isolation; this restores the specific row
    // each test's agent needs. ON CONFLICT keeps it idempotent.
    await testDb
        .insertInto('cli_models')
        .values({
            id: `test-cli-${cli}-${model}`,
            cli,
            model_name: model,
            note: null,
            sort_order: 0,
        })
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();
    await testDb
        .insertInto('agents')
        .values({
            id,
            name: overrides.name ?? 'Coder',
            category: overrides.category ?? 'software-dev',
            cli,
            model,
            framework: 'tdd',
            prompt_md: overrides.prompt_md ?? '',
            prompt_version: overrides.prompt_version ?? 1,
            status: overrides.status ?? 'active',
            accent_color: overrides.accent_color ?? '#31AB46',
            sort_order: 1,
            description: '',
            glyph: '',
        })
        .execute();
    return id;
}

export interface InsertItemInput {
    id?: string;
    type: ItemType;
    project_id: string;
    parent_id?: string | null;
    parent_type?: ItemType | null;
    title?: string;
    description?: string;
    status?: IssueStatus;
    priority?: IssuePriority | null;
    assignee_agent_id?: string | null;
    reporter_agent_id?: string | null;
    spec_md?: string | null;
    pr_url?: string | null;
    points?: number | null;
    acceptance_criteria?: string | null;
    /** ADR 0018 — the repos this Task works on. */
    repo_ids?: string[];
}

let autoSeq = 1;
export async function insertItem(input: InsertItemInput): Promise<string> {
    const id = input.id ?? `ATL-${autoSeq++}`;
    await testDb
        .insertInto('items')
        .values({
            id,
            type: input.type,
            project_id: input.project_id,
            parent_id: input.parent_id ?? null,
            parent_type: input.parent_type ?? null,
            title: input.title ?? 'Item',
            // ADR 0018 — a Task always names at least one repo; the fixture's
            // repo carries the project's id, exactly as migration 045 leaves it.
            ...(input.repo_ids
                ? { repo_ids: JSON.stringify(input.repo_ids) }
                : input.type === 'task'
                  ? { repo_ids: JSON.stringify([input.project_id]) }
                  : {}),
            description: input.description ?? '',
            status: input.status ?? 'draft',
            priority: input.priority ?? 'normal',
            assignee_agent_id: input.assignee_agent_id ?? null,
            reporter_agent_id: input.reporter_agent_id ?? null,
            spec_md: input.spec_md ?? null,
            pr_url: input.pr_url ?? null,
            points: input.points ?? null,
            acceptance_criteria: input.acceptance_criteria ?? null,
        })
        .execute();
    return id;
}

export interface FullTreeIds {
    projectId: string;
    agentId: string;
    taskId: string;
    subTaskId: string;
    subTask2Id: string;
}

/**
 * Inserts: project + counter + agent + task + two sub-tasks with
 * deterministic IDs. Useful for E2E-style tests that need the whole graph.
 */
export async function seedFullTree(): Promise<FullTreeIds> {
    autoSeq = 1;
    await insertProject('p1', 'ATL');
    await insertAgent();
    const taskId = await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'Task One' });
    const subTaskId = await insertItem({
        id: 'ATL-2',
        type: 'sub_task',
        project_id: 'p1',
        parent_id: taskId,
        parent_type: 'task',
        title: 'Sub-task One',
        acceptance_criteria: '',
    });
    const subTask2Id = await insertItem({
        id: 'ATL-3',
        type: 'sub_task',
        project_id: 'p1',
        parent_id: taskId,
        parent_type: 'task',
        title: 'Sub-task Two',
        acceptance_criteria: '',
    });
    autoSeq = 4;
    return { projectId: 'p1', agentId: 'agent-coder', taskId, subTaskId, subTask2Id };
}
