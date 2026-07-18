// Test helpers for the unified `items` schema.
//
// Use:
//   await insertProject('p1');
//   await insertAgent({ id: 'agent-coder' });
//   const epicId = await insertItem({ type: 'epic', project_id: 'p1', title: 'E' });
//
// All helpers respect the test DB pool via `testDb` from `_pg-db.ts`.

import { testDb } from './_pg-db.js';
import type { ItemType } from '../src/db/types.js';
import type {
    IssueStatus,
    IssuePriority,
    BugFrequency,
    BugFailureScope,
} from '@atlas/shared';

export async function insertProject(
    id: string = 'p1',
    prefix: string = 'ATL',
    overrides: Partial<{ name: string; git_path: string; git_url: string; default_branch: string }> = {},
): Promise<string> {
    await testDb
        .insertInto('projects')
        .values({
            id,
            name: overrides.name ?? `Project ${id}`,
            issue_key_prefix: prefix,
            git_path: overrides.git_path ?? '',
            git_url: overrides.git_url ?? '',
            default_branch: overrides.default_branch ?? 'main',
            status: 'active',
            clone_status: 'ready',
        })
        .execute();
    await testDb
        .insertInto('project_issue_counters')
        .values({ project_id: id, last_seq: 0 })
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
        requires_item: boolean;
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
            schedule_hours: 6,
            concurrent_runs: 1,
            glyph: '',
            requires_item: overrides.requires_item ?? true,
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
    // story-only
    spec_md?: string | null;
    pr_url?: string | null;
    points?: number | null;
    // story / sub_task / sub_bug
    acceptance_criteria?: string | null;
    // bug / sub_bug
    steps_to_reproduce?: string | null;
    expected?: string | null;
    actual?: string | null;
    frequency?: BugFrequency | null;
    failure_scope?: BugFailureScope | null;
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
            description: input.description ?? '',
            status: input.status ?? 'draft',
            priority: input.priority ?? (input.type === 'epic' || input.type === 'story' || input.type === 'bug' || input.type === 'sub_task' || input.type === 'sub_bug' ? 'normal' : null),
            assignee_agent_id: input.assignee_agent_id ?? null,
            reporter_agent_id: input.reporter_agent_id ?? null,
            spec_md: input.spec_md ?? null,
            pr_url: input.pr_url ?? null,
            points: input.points ?? null,
            acceptance_criteria: input.acceptance_criteria ?? null,
            steps_to_reproduce: input.steps_to_reproduce ?? null,
            expected: input.expected ?? null,
            actual: input.actual ?? null,
            frequency: input.frequency ?? null,
            failure_scope: input.failure_scope ?? null,
            occurrence_count: input.type === 'bug' || input.type === 'sub_bug' ? 1 : null,
            occurrence_total: input.type === 'bug' || input.type === 'sub_bug' ? 1 : null,
        })
        .execute();
    return id;
}

export interface FullTreeIds {
    projectId: string;
    agentId: string;
    epicId: string;
    storyId: string;
    subTaskId: string;
    subBugId: string;
    bugId: string;
}

/**
 * Inserts: project + counter + agent + epic + story + sub-task + sub-bug + bug
 * with deterministic IDs. Useful for E2E-style tests that need the whole graph.
 */
export async function seedFullTree(): Promise<FullTreeIds> {
    autoSeq = 1;
    await insertProject('p1', 'ATL');
    await insertAgent();
    const epicId = await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic One' });
    const storyId = await insertItem({
        id: 'ATL-2',
        type: 'story',
        project_id: 'p1',
        parent_id: epicId,
        parent_type: 'epic',
        title: 'Story One',
    });
    const subTaskId = await insertItem({
        id: 'ATL-3',
        type: 'sub_task',
        project_id: 'p1',
        parent_id: storyId,
        parent_type: 'story',
        title: 'Sub-task One',
        acceptance_criteria: '',
    });
    const subBugId = await insertItem({
        id: 'ATL-4',
        type: 'sub_bug',
        project_id: 'p1',
        parent_id: storyId,
        parent_type: 'story',
        title: 'Sub-bug One',
        acceptance_criteria: '',
        steps_to_reproduce: '',
        expected: '',
        actual: '',
        frequency: 'sometimes',
        failure_scope: 'cosmetic',
    });
    const bugId = await insertItem({
        id: 'ATL-5',
        type: 'bug',
        project_id: 'p1',
        parent_id: epicId,
        parent_type: 'epic',
        title: 'Bug One',
        acceptance_criteria: '',
        steps_to_reproduce: '',
        expected: '',
        actual: '',
        frequency: 'sometimes',
        failure_scope: 'cosmetic',
    });
    autoSeq = 6;
    return {
        projectId: 'p1',
        agentId: 'agent-coder',
        epicId,
        storyId,
        subTaskId,
        subBugId,
        bugId,
    };
}
