import type {
    IAgent,
    IBug,
    IComment,
    IEpic,
    IEpicListItem,
    INotification,
    IProject,
    IStory,
    ISubBug,
    ISubTask,
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
        git_path: '/tmp/atlas',
        git_url: 'https://github.com/example/atlas',
        credential_id: null,
        default_branch: 'main',
        clone_status: 'ready',
        description: '',
        status: 'active',
        guardrails_md: '',
        setup_sh_body: '',
        setup_ps1_body: '',
        created_at: ISO,
        updated_at: ISO,
        last_activity_at: ISO,
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
        handoff_prompt_md: '',
        status: 'active',
        accent_color: '#31AB46',
        sort_order: 1,
        description: '',
        designation: '',
        role_id: null,
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 6,
        schedule_preset: 'every_n_hours',
        schedule_time_of_day: null,
        schedule_weekdays: null,
        schedule_day_of_month: null,
        concurrent_runs: 1,
        glyph: '',
        last_run_at: null,
        next_run_at: null,
        memory_cadence: 1,
        kind_slug: 'custom',
        settings_json: {},
        cron_expr: null,
        raises_pr: false,
        push_code: false,
        requires_worktree: false,
        marketplace_source_id: null,
        marketplace_pulled_version: null,
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeEpic(overrides: Partial<IEpic> = {}): IEpic {
    return {
        id: 'ATL-1',
        project_id: 'p1',
        title: 'Epic One',
        description: '',
        status: 'draft',
        assignee_agent_id: null,
        reporter_agent_id: null,
        priority: 'normal',
        labels: [],
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeEpicListItem(overrides: Partial<IEpicListItem> = {}): IEpicListItem {
    return { ...makeEpic(), story_count: 0, ...overrides };
}

export function makeStory(overrides: Partial<IStory> = {}): IStory {
    return {
        id: 'ATL-2',
        epic_id: 'ATL-1',
        title: 'Story One',
        description: '',
        status: 'draft',
        assignee_agent_id: null,
        reporter_agent_id: null,
        priority: 'normal',
        spec_md: null,
        pr_url: null,
        points: 0,
        acceptance_criteria: '',
        labels: [],
        worktree_branch: null,
        worktree_path: null,
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeSubTask(overrides: Partial<ISubTask> = {}): ISubTask {
    return {
        id: 'ATL-3',
        story_id: 'ATL-2',
        title: 'Sub-task One',
        description: '',
        status: 'draft',
        assignee_agent_id: null,
        reporter_agent_id: null,
        priority: 'normal',
        acceptance_criteria: '',
        labels: [],
        started_at: null,
        worktree_branch: null,
        worktree_path: null,
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeSubBug(overrides: Partial<ISubBug> = {}): ISubBug {
    return {
        id: 'ATL-4',
        story_id: 'ATL-2',
        title: 'Sub-bug One',
        description: '',
        status: 'draft',
        assignee_agent_id: null,
        reporter_agent_id: null,
        priority: 'normal',
        acceptance_criteria: '',
        labels: [],
        steps_to_reproduce: '',
        expected: '',
        actual: '',
        frequency: 'sometimes',
        failure_scope: 'cosmetic',
        detected_at: null,
        occurrence_count: 1,
        occurrence_total: 1,
        worktree_branch: null,
        worktree_path: null,
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeBug(overrides: Partial<IBug> = {}): IBug {
    return {
        id: 'ATL-5',
        epic_id: 'ATL-1',
        title: 'Bug One',
        description: '',
        status: 'draft',
        assignee_agent_id: null,
        reporter_agent_id: null,
        priority: 'normal',
        acceptance_criteria: '',
        labels: [],
        steps_to_reproduce: '',
        expected: '',
        actual: '',
        frequency: 'sometimes',
        failure_scope: 'cosmetic',
        detected_at: null,
        occurrence_count: 1,
        occurrence_total: 1,
        worktree_branch: null,
        worktree_path: null,
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
        issue_type: 'story',
        issue_id: 'ATL-2',
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
        message: 'Story ATL-2 moved to In Review',
        issue_type: 'story',
        issue_id: 'ATL-2',
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
