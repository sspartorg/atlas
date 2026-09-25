import type {
    IAgent,
    IComment,
    INotification,
    IProject,
    IProjectRepo,
    ISubTask,
    ITask,
    ITaskListItem,
} from '@atlas/shared';

// Hand-rolled factories with deterministic defaults. Mirrors the api-side
// `packages/api/tests/_factories.ts` shape so a fixture authored on one side
// reads naturally on the other.

const ISO = '2026-05-16T00:00:00.000Z';

export function makeProject(overrides: Partial<IProject> = {}): IProject {
    return {
        id: 'p1',
        name: 'Atlas',
        issue_key_prefix: 'ATL',
        description: '',
        status: 'active',
        guardrails_md: '',
        created_at: ISO,
        updated_at: ISO,
        last_activity_at: ISO,
        ...overrides,
    };
}

/** Defaults to project p1's first repo (which carries the project's id, as migration 045 leaves it). */
export function makeProjectRepo(overrides: Partial<IProjectRepo> = {}): IProjectRepo {
    return {
        id: 'p1',
        project_id: 'p1',
        name: 'atlas',
        git_url: 'https://github.com/example/atlas',
        git_path: '/tmp/atlas',
        verify_command: '',
        credential_id: null,
        default_branch: 'main',
        clone_status: 'ready',
        setup_sh_body: '',
        setup_ps1_body: '',
        ...overrides,
    };
}

export function makeAgent(overrides: Partial<IAgent> = {}): IAgent {
    return {
        id: 'agent-coder',
        name: 'Coder',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-opus-4-7',
        effort: 'medium',
        framework: 'tdd',
        prompt_md: '',
        prompt_version: 1,
        status: 'active',
        accent_color: '#31AB46',
        sort_order: 1,
        description: '',
        designation: '',
        role_id: null,
        glyph: '',
        memory_cadence: 1,
        kind_slug: 'custom',
        settings_json: {},
        marketplace_source_id: null,
        marketplace_pulled_version: null,
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeTask(overrides: Partial<ITask> = {}): ITask {
    return {
        id: 'ATL-1',
        project_id: 'p1',
        title: 'Task One',
        description: '',
        status: 'draft',
        assignee_agent_id: null,
        workflow_id: null,
        reporter_agent_id: null,
        priority: 'normal',
        acceptance_criteria: '',
        spec_md: null,
        pr_url: null,
        labels: [],
        repo_ids: [],
        worktree_branch: null,
        worktree_path: null,
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeTaskListItem(overrides: Partial<ITaskListItem> = {}): ITaskListItem {
    return { ...makeTask(), sub_task_count: 0, ...overrides };
}

export function makeSubTask(overrides: Partial<ISubTask> = {}): ISubTask {
    return {
        id: 'ATL-3',
        task_id: 'ATL-1',
        title: 'Sub-task One',
        description: '',
        status: 'draft',
        assignee_agent_id: null,
        reporter_agent_id: null,
        priority: 'normal',
        acceptance_criteria: '',
        labels: [],
        started_at: null,
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeComment(overrides: Partial<IComment> = {}): IComment {
    return {
        id: 1,
        author: 'owner',
        agent_id: null,
        issue_type: 'task',
        issue_id: 'ATL-1',
        body: 'looks good',
        edited_at: null,
        created_at: ISO,
        ...overrides,
    };
}

export function makeNotification(overrides: Partial<INotification> = {}): INotification {
    return {
        id: 1,
        event_type: 'item.status_changed:in_review',
        message: 'Task ATL-1 moved to In Review',
        issue_type: 'task',
        issue_id: 'ATL-1',
        project_id: 'p1',
        sent_external: 0,
        kind: 'needs_you',
        agent_id: null,
        external_status: 'none',
        failure_reason: null,
        push_status: 'none',
        push_failure_reason: null,
        read_at: null,
        link_url: null,
        created_at: ISO,
        ...overrides,
    };
}
