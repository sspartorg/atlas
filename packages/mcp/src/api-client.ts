import type {
    AgentCategory,
    AgentKindSlug,
    BugFailureScope,
    BugFrequency,
    IAgent,
    IAgentChecklistItem,
    IAgentHandoffRule,
    IAgentRun,
    IBug,
    IComment,
    IEpic,
    IGuardrailRule,
    IIssueLinkRow,
    IItemExternalLink,
    IMarketplaceAgentFull,
    IMarketplaceAgentSummary,
    IProject,
    IProjectGuardrail,
    IProjectSchedule,
    IReminder,
    IReplyContext,
    IReplyResponse,
    IStory,
    ISubBug,
    ISubTask,
    IssuePriority,
    IssueStatus,
    IssueType,
    ReminderChannel,
    ReminderSchedule,
    ScheduleConflictPolicy,
    SchedulePreset,
    SubTaskStatus,
} from '@atlas/shared';
import type { IMcpConfig } from './config.js';

export class AtlasApiError extends Error {
    public override readonly name = 'AtlasApiError';
    constructor(
        public readonly status: number,
        public readonly url: string,
        public readonly bodySnippet: string
    ) {
        // Prefix 4xx messages with a parseable marker so the run-log viewer
        // can highlight them. Bare "API 400 on /api/...: ..." used to land
        // inside an MCP tool result and render as ordinary JSON, hiding what
        // were almost always validation regressions (missing agent_id,
        // wrong issue_type, etc.) inside long transcripts.
        const marker = status >= 400 && status < 500 ? `[atlas-api-${status}] ` : '';
        super(`${marker}Atlas API ${status} on ${url}: ${bodySnippet}`);
    }
}

/**
 * Composite agent payload returned by getAgent / createAgent / updateAgent.
 * Bundles the core record plus its child collections so a single MCP tool
 * call is enough for Claude to see the full agent.
 */
export interface IAgentComposite {
    agent: IAgent;
    handoff_rules: IAgentHandoffRule[];
    checklists: IAgentChecklistItem[];
}

/**
 * Nested write payload accepted by POST /api/agents and PATCH /api/agents/:id.
 * Every field is optional on update; the API treats `undefined` as "do not touch"
 * and a present (possibly empty) array as "replace transactionally".
 */
export interface IAgentWritePayload {
    name?: string;
    category?: IAgent['category'];
    cli?: IAgent['cli'];
    model?: string;
    framework?: string;
    prompt_md?: string;
    handoff_prompt_md?: string;
    status?: IAgent['status'];
    accent_color?: string;
    sort_order?: number;
    description?: string;
    designation?: string;
    // A08 — FK into the SDLC role catalog. null detaches the agent
    // from the catalog (autonomous-style).
    role_id?: IAgent['role_id'];
    schedule_hours?: number;
    concurrent_runs?: number;
    glyph?: string;
    handoff_rules?: Array<Pick<IAgentHandoffRule, 'target_agent_id' | 'kind' | 'status'>>;
    checklists?: Array<Pick<IAgentChecklistItem, 'label' | 'sort_order' | 'required'>>;
}

// Create-item payloads — match the shared Zod CreateStorySchema /
// CreateSubTaskSchema / CreateSubBugSchema / CreateBugSchema. Optional
// fields default server-side (description='', priority='normal',
// acceptance_criteria=''); the MCP tool only needs to pass the required
// parent + title.
// `field?: T | undefined` (not bare `field?: T`) because the project ships
// with `exactOptionalPropertyTypes: true`, and Zod's `.optional()` produces
// `T | undefined`. Aligning the two avoids a mismatch at the call site.
interface ICreateEpicPayload {
    project_id: string;
    title: string;
    description?: string | undefined;
    priority?: IssuePriority | undefined;
    reporter_agent_id?: string | null | undefined;
    assignee_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
}

interface ICreateStoryPayload {
    epic_id: string;
    title: string;
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    priority?: IssuePriority | undefined;
    status?: IssueStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
}

interface ICreateSubTaskPayload {
    story_id: string;
    title: string;
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    priority?: IssuePriority | undefined;
    status?: SubTaskStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
}

interface ICreateBugFields {
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    steps_to_reproduce?: string | undefined;
    expected?: string | undefined;
    actual?: string | undefined;
    frequency?: BugFrequency | undefined;
    failure_scope?: BugFailureScope | undefined;
    priority?: IssuePriority | undefined;
    status?: IssueStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
}

interface ICreateSubBugPayload extends ICreateBugFields {
    story_id: string;
    title: string;
}

interface ICreateBugPayload extends ICreateBugFields {
    epic_id: string;
    title: string;
}

// Comment payload for `addCommentToItem`. The MCP gateway has no agent-
// identity context today (`ATLAS_AGENT_ID` env vars are not yet set on CLI
// spawn — tracked separately), so the agent self-identifies by passing its
// own `agent_id` and `author: 'agent'` from the prompt. The API treats the
// pair as the comment's reporter chip.
interface IAddCommentPayload {
    issue_type: IssueType;
    issue_id: string;
    body: string;
    author?: 'owner' | 'agent' | undefined;
    agent_id?: string | null | undefined;
}

// A12 — `replyToItem` payload. When `body` is omitted the MCP tool calls
// `getReplyContext` (read-only); when present it calls `postReply` which
// loads the same envelope, posts the comment, and returns both. `author`
// defaults to 'owner' (Owner replying via Claude as proxy); pass
// `author: 'agent', agent_id: '...'` for runner-side / agent-initiated
// context-aware replies.
interface IPostReplyPayload {
    issue_type: IssueType;
    issue_id: string;
    body: string;
    author?: 'owner' | 'agent' | undefined;
    agent_id?: string | null | undefined;
}

// Theme 07 — reminder tool payloads. The MCP tool surface mirrors
// SetReminderSchema in shared.
interface ISetReminderPayload {
    label: string;
    body?: string | undefined;
    schedule: ReminderSchedule;
    channel?: ReminderChannel | undefined;
    created_by_agent_id?: string | null | undefined;
}

interface IUpdateReminderPayload {
    label?: string | undefined;
    body?: string | undefined;
    schedule?: ReminderSchedule | undefined;
    channel?: ReminderChannel | undefined;
}

// Theme 07 — agent memory payloads.
interface IAgentMemory {
    agent_id: string;
    body_md: string;
    version: number;
    source: 'ai-generated' | 'manual-edit';
    last_run_id: string | null;
    updated_at: string;
}

interface IUpdateAgentMemoryPayload {
    body_md: string;
    /**
     * Theme 08 — `'replace'` (default) overwrites the whole body;
     * `'append'` surgically appends a bullet under `## Course
     * corrections` and audits as `trigger='mcp_update'`.
     */
    mode?: 'replace' | 'append' | undefined;
    source?: 'ai-generated' | 'manual-edit' | undefined;
}

// Theme 07 — item-link tool payloads. The REST surface keys on the FROM
// item's (type, id) pair: GET/POST /api/issues/:type/:id/links and
// DELETE /api/issues/links/:linkId. The MCP tool flattens those into a
// single payload per action so prompts stay short.
interface ICreateItemLinkPayload {
    from_type: IssueType;
    from_id: string;
    to_id: string;
    relation_type: 'relates_to' | 'depends_on' | 'tested_by';
}

interface ICreateItemExternalLinkPayload {
    issue_type: IssueType;
    issue_id: string;
    link_kind: 'pull_request';
    url: string;
    title?: string | null;
}

// Task 12 — the `submit_review` / `performer_done` MCP tools and their
// HTTP equivalents (`PATCH /api/run/:id/review` + `/performer-done`)
// were removed. Every agent now emits a `atlas-outcome` fenced block
// at the end of its CLI output and the orchestrator parses it directly;
// agents no longer call back to the orchestrator with their identity.

// Theme 07 — guardrail-rule write payloads.
interface IUpsertGuardrailRulePayload {
    category: IGuardrailRule['category'];
    rule_text: string;
    detail?: string | null | undefined;
    severity: IGuardrailRule['severity'];
    sort_order?: number | undefined;
}

// C03 — project-scoped guardrail payloads. Shape mirrors
// CreateProjectGuardrailSchema in shared (title, body_md, icon,
// enabled 0|1, sort_order). Phase 1.5b — `applies_to` retired.
interface ICreateProjectGuardrailPayload {
    title: string;
    body_md: string;
    icon?: string | undefined;
    enabled?: number | undefined;
    sort_order?: number | undefined;
}
type IUpdateProjectGuardrailPayload = Partial<ICreateProjectGuardrailPayload>;

// C03 — project auto-fetch schedule upsert. Mirrors ProjectScheduleSchema
// in shared. The route accepts the full input even on update; partial
// patches aren't supported server-side (the materializer recomputes
// cron_expression from preset + time_of_day + weekday + cron_expression).
interface IUpsertProjectSchedulePayload {
    enabled: boolean;
    preset: SchedulePreset;
    time_of_day: string;
    weekday: number | null;
    cron_expression: string;
    skip_if_dirty: boolean;
    pause_while_agents_active: boolean;
    conflict_policy: ScheduleConflictPolicy;
}

export interface IApiClient {
    listAgents(): Promise<IAgent[]>;
    getAgent(id: string): Promise<IAgentComposite>;
    createAgent(payload: IAgentWritePayload & { id: string; name: string }): Promise<IAgentComposite>;
    updateAgent(id: string, payload: IAgentWritePayload): Promise<IAgentComposite>;
    deleteAgent(id: string): Promise<void>;
    getAgentMemory(id: string): Promise<IAgentMemory>;
    updateAgentMemory(id: string, payload: IUpdateAgentMemoryPayload): Promise<IAgentMemory>;
    listAgentRuns(id: string): Promise<IAgentRun[]>;
    // Marketplace catalog. Lightweight search + full-fetch pair, mirroring
    // searchItems / getItemFull. Used by `search_marketplace_agents` and
    // `get_full_marketplace_agent`; an autonomous agent can chain these
    // with the existing `updateAgent` to self-upgrade off a fresh catalog.
    searchMarketplaceAgents(query: {
        query?: string;
        category?: AgentCategory;
        kind_slug?: AgentKindSlug;
        limit?: number;
    }): Promise<IMarketplaceAgentSummary[]>;
    getMarketplaceAgent(id: string): Promise<IMarketplaceAgentFull>;
    getEpic(id: string): Promise<IEpic>;
    getItemFull(issueType: IssueType, issueId: string): Promise<unknown>;
    searchItems(
        query: string,
        topK?: number,
    ): Promise<
        Array<{ issue_type: string; issue_id: string; title: string; description: string; rank: number }>
    >;
    createEpic(payload: ICreateEpicPayload): Promise<IEpic>;
    createStory(payload: ICreateStoryPayload): Promise<IStory>;
    createSubTask(payload: ICreateSubTaskPayload): Promise<ISubTask>;
    createSubBug(payload: ICreateSubBugPayload): Promise<ISubBug>;
    createBug(payload: ICreateBugPayload): Promise<IBug>;
    addComment(payload: IAddCommentPayload): Promise<IComment>;
    listComments(issueType: IssueType, issueId: string): Promise<IComment[]>;
    getReplyContext(issueType: IssueType, issueId: string): Promise<IReplyContext>;
    postReply(payload: IPostReplyPayload): Promise<IReplyResponse>;
    listProjects(): Promise<IProject[]>;
    getProject(id: string): Promise<IProject>;
    listItemLinks(issueType: IssueType, issueId: string): Promise<IIssueLinkRow[]>;
    createItemLink(payload: ICreateItemLinkPayload): Promise<unknown>;
    deleteItemLink(linkId: number): Promise<void>;
    // Bulk history prune: hard-deletes every comment + issue_event on the
    // item with `created_at < before_time`. Backing route:
    // POST /api/issues/:type/:id/history/prune. Used by the MCP
    // `update_item` action `remove_history`.
    pruneItemHistory(
        issueType: IssueType,
        id: string,
        beforeTime: string,
        actorAgentId: string | null,
    ): Promise<{ comments_deleted: number; events_deleted: number; owner_comments_preserved: number }>;
    listItemExternalLinks(issueType: IssueType, issueId: string): Promise<IItemExternalLink[]>;
    createItemExternalLink(payload: ICreateItemExternalLinkPayload): Promise<IItemExternalLink>;
    deleteItemExternalLink(linkId: number): Promise<void>;
    listGuardrails(): Promise<IGuardrailRule[]>;
    createGuardrail(payload: IUpsertGuardrailRulePayload): Promise<IGuardrailRule>;
    updateGuardrail(id: string, payload: Partial<IUpsertGuardrailRulePayload>): Promise<IGuardrailRule>;
    deleteGuardrail(id: string): Promise<void>;
    setReminder(payload: ISetReminderPayload): Promise<IReminder>;
    updateReminder(id: number, payload: IUpdateReminderPayload): Promise<IReminder>;
    cancelReminder(id: number): Promise<IReminder>;
    listReminders(filter?: {
        status?: 'active' | 'paused' | 'cancelled' | 'completed';
        channel?: ReminderChannel;
        since?: string;
    }): Promise<IReminder[]>;
    sendExternalNotification(payload: { message: string; event_key?: string }): Promise<{ ok: true }>;
    // C03 — item mutation polymorphic surface. The server-side Update*Schemas
    // differ per issue type (story has spec_md + pr_url + points, bug has
    // steps_to_reproduce + frequency + failure_scope, etc.). The client passes
    // `patch` through verbatim; the per-type Zod schema on the route enforces
    // which fields are accepted, so a typo or wrong-type field gets a 400 with
    // the Zod error message.
    updateItem(issueType: IssueType, id: string, patch: Record<string, unknown>): Promise<unknown>;
    transitionItemStatus(
        issueType: IssueType,
        id: string,
        status: string,
        override?: boolean,
        requestedByAgentId?: string | null,
    ): Promise<unknown>;
    assignItem(
        issueType: IssueType,
        id: string,
        assignee_agent_id: string | null,
        requestedByAgentId?: string | null,
    ): Promise<unknown>;
    deleteItem(issueType: IssueType, id: string): Promise<void>;
    // C03 — project-scoped guardrails CRUD. Distinct from workspace
    // guardrails (`listGuardrails` etc.); each rule is bound to a project.
    listProjectGuardrails(projectId: string): Promise<IProjectGuardrail[]>;
    createProjectGuardrail(
        projectId: string,
        payload: ICreateProjectGuardrailPayload,
    ): Promise<IProjectGuardrail>;
    updateProjectGuardrail(
        projectId: string,
        id: string,
        payload: IUpdateProjectGuardrailPayload,
    ): Promise<IProjectGuardrail>;
    toggleProjectGuardrail(
        projectId: string,
        id: string,
        enabled: number,
    ): Promise<IProjectGuardrail>;
    deleteProjectGuardrail(projectId: string, id: string): Promise<void>;
    // C03 — auto-fetch schedules. Read returns every enabled schedule.
    // Upsert / delete / fire are per-project; the fire endpoint returns a
    // 202 with an `autofetch_id` correlation id for SSE consumers.
    listSchedules(): Promise<IProjectSchedule[]>;
    upsertProjectSchedule(
        projectId: string,
        payload: IUpsertProjectSchedulePayload,
    ): Promise<IProjectSchedule>;
    deleteProjectSchedule(projectId: string): Promise<void>;
    triggerProjectAutoFetch(projectId: string): Promise<{ autofetch_id: string }>;
    // Plan E (Owner request, 2026-06-01) — `execGitHub` removed. The
    // orchestrator now owns git push + `gh pr create` (gated on
    // `agents.raises_pr`); agents commit only. See
    // `services/worktree-orchestrator.ts: pushWorktree / openPullRequest`.
}

export function createApiClient(config: IMcpConfig): IApiClient {
    const buildUrl = (path: string) => config.apiBase + path;

    const request = async <T>(
        path: string,
        init?: { method?: string; body?: unknown; headers?: Record<string, string> }
    ): Promise<T> => {
        const url = buildUrl(path);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        const isWrite = init?.method && init.method !== 'GET';
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
        if (isWrite && config.mcpToken) headers['X-Atlas-Token'] = config.mcpToken;
        // Caller-supplied headers layer over the defaults so the MCP tool
        // can forward `x-atlas-agent-id` for audit-trail attribution on
        // destructive routes like history/prune.
        if (init?.headers) Object.assign(headers, init.headers);
        try {
            const fetchInit: RequestInit = {
                method: init?.method ?? 'GET',
                headers,
                signal: controller.signal,
            };
            if (init?.body !== undefined) {
                fetchInit.body = JSON.stringify(init.body);
            }
            const res = await fetch(url, fetchInit);
            if (!res.ok) {
                const snippet = (await res.text().catch(() => '')).slice(0, 200);
                throw new AtlasApiError(res.status, url, snippet);
            }
            // Some endpoints return 204; tolerate empty bodies.
            const text = await res.text();
            return (text ? JSON.parse(text) : undefined) as T;
        } finally {
            clearTimeout(timeout);
        }
    };

    const fetchComposite = async (id: string): Promise<IAgentComposite> => {
        const encoded = encodeURIComponent(id);
        const [agent, handoff_rules, checklists] = await Promise.all([
            request<IAgent>(`/api/agents/${encoded}`),
            request<IAgentHandoffRule[]>(`/api/agents/${encoded}/handoff-rules`),
            request<IAgentChecklistItem[]>(`/api/agents/${encoded}/checklists`),
        ]);
        return { agent, handoff_rules, checklists };
    };

    return {
        listAgents: () => request<IAgent[]>('/api/agents'),
        getAgent: (id) => fetchComposite(id),
        searchMarketplaceAgents: (query) => {
            const params = new URLSearchParams();
            if (query.query) params.set('q', query.query);
            if (query.category) params.set('category', query.category);
            if (query.kind_slug) params.set('kind', query.kind_slug);
            if (query.limit != null) params.set('limit', String(query.limit));
            const qs = params.toString();
            return request<IMarketplaceAgentSummary[]>(
                `/api/marketplace/agents${qs ? `?${qs}` : ''}`,
            );
        },
        getMarketplaceAgent: (id) =>
            request<IMarketplaceAgentFull>(`/api/marketplace/agents/${encodeURIComponent(id)}`),
        createAgent: async (payload) => {
            const created = await request<IAgent>('/api/agents', {
                method: 'POST',
                body: payload,
            });
            return fetchComposite(created.id);
        },
        updateAgent: async (id, payload) => {
            await request<IAgent>(`/api/agents/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: payload,
            });
            return fetchComposite(id);
        },
        getEpic: (id) => request<IEpic>(`/api/epics/${encodeURIComponent(id)}`),
        createEpic: (payload) =>
            request<IEpic>('/api/epics', { method: 'POST', body: payload }),
        createStory: (payload) =>
            request<IStory>('/api/stories', { method: 'POST', body: payload }),
        // Sub-tasks / sub-bugs live UNDER a story — the REST route is
        // `/api/stories/:id/sub-{tasks,bugs}` (see packages/api/src/routes/stories.ts).
        // The MCP payload carries `story_id` so we lift it into the URL.
        // The route's handler also re-injects `story_id` from the path
        // before zod-parsing, so leaving it in the body is harmless but
        // we strip it for clarity.
        createSubTask: (payload) => {
            const { story_id, ...rest } = payload;
            return request<ISubTask>(
                `/api/stories/${encodeURIComponent(story_id)}/sub-tasks`,
                { method: 'POST', body: rest },
            );
        },
        createSubBug: (payload) => {
            const { story_id, ...rest } = payload;
            return request<ISubBug>(
                `/api/stories/${encodeURIComponent(story_id)}/sub-bugs`,
                { method: 'POST', body: rest },
            );
        },
        createBug: (payload) =>
            request<IBug>('/api/bugs', { method: 'POST', body: payload }),
        addComment: (payload) =>
            request<IComment>('/api/comments', {
                method: 'POST',
                body: {
                    author: payload.author ?? 'agent',
                    agent_id: payload.agent_id ?? null,
                    issue_type: payload.issue_type,
                    issue_id: payload.issue_id,
                    body: payload.body,
                },
            }),
        listComments: (issueType, issueId) =>
            request<IComment[]>(
                `/api/comments?issue_type=${encodeURIComponent(issueType)}&issue_id=${encodeURIComponent(issueId)}`,
            ),

        // A12 — context-aware reply path.
        getReplyContext: (issueType, issueId) =>
            request<IReplyContext>(
                `/api/issues/${encodeURIComponent(issueType)}/${encodeURIComponent(issueId)}/reply-context`,
            ),
        postReply: (payload) =>
            request<IReplyResponse>(
                `/api/issues/${encodeURIComponent(payload.issue_type)}/${encodeURIComponent(payload.issue_id)}/reply`,
                {
                    method: 'POST',
                    body: {
                        body: payload.body,
                        author: payload.author ?? 'owner',
                        agent_id: payload.agent_id ?? null,
                    },
                },
            ),

        // Theme 07 — agent gaps.
        deleteAgent: async (id) => {
            await request<void>(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
        },
        getAgentMemory: (id) =>
            request<IAgentMemory>(`/api/agents/${encodeURIComponent(id)}/memory`),
        updateAgentMemory: (id, payload) =>
            request<IAgentMemory>(`/api/agents/${encodeURIComponent(id)}/memory`, {
                method: 'PUT',
                body: payload,
            }),
        listAgentRuns: (id) =>
            request<IAgentRun[]>(`/api/agents/${encodeURIComponent(id)}/runs`),

        // Tool consolidation 2026-07 — `get_item` envelope. The REST
        // `/api/{type}/{id}/full` route returns the item + parent + project +
        // children + item_links + external_links + activity + agents +
        // round_count. The comment thread is NOT in that response (UI fetches
        // it via /api/comments separately). To honor the new `get_item`'s
        // "always full payload" contract in a single MCP round-trip, the
        // client fans out the two reads in parallel and splices `comments`
        // into the envelope. No API-side schema change required.
        getItemFull: async (issueType, issueId) => {
            const seg = issueTypeToRouteSegment(issueType);
            const [full, comments] = await Promise.all([
                request<Record<string, unknown>>(
                    `/api/${seg}/${encodeURIComponent(issueId)}/full`,
                ),
                request<unknown>(
                    `/api/comments?issue_type=${encodeURIComponent(issueType)}&issue_id=${encodeURIComponent(issueId)}`,
                ),
            ]);
            return { ...full, comments };
        },

        // B16 — wraps /api/search (Postgres tsvector FTS). The endpoint caps
        // internally at 20 hits regardless of top_k. Passing top_k is forward-
        // looking — the API can honor it later without breaking the MCP shape.
        searchItems: (query, topK) => {
            const params = new URLSearchParams({ q: query });
            if (topK !== undefined) params.set('top_k', String(topK));
            return request<
                Array<{
                    issue_type: string;
                    issue_id: string;
                    title: string;
                    description: string;
                    rank: number;
                }>
            >(`/api/search?${params.toString()}`);
        },

        // Theme 07 — projects.
        listProjects: () => request<IProject[]>('/api/projects'),
        getProject: (id) => request<IProject>(`/api/projects/${encodeURIComponent(id)}`),

        // Item links route through /api/issues/:type/:id/links.
        listItemLinks: (issueType, issueId) =>
            request<IIssueLinkRow[]>(
                `/api/issues/${encodeURIComponent(issueType)}/${encodeURIComponent(issueId)}/links`,
            ),
        createItemLink: (payload) =>
            request<unknown>(
                `/api/issues/${encodeURIComponent(payload.from_type)}/${encodeURIComponent(payload.from_id)}/links`,
                {
                    method: 'POST',
                    body: {
                        to_type: payload.from_type, // server ignores; resolves the type from to_id
                        to_id: payload.to_id,
                        relation_type: payload.relation_type,
                    },
                },
            ),
        deleteItemLink: async (linkId) => {
            await request<void>(`/api/issues/links/${linkId}`, { method: 'DELETE' });
        },

        pruneItemHistory: (issueType, id, beforeTime, actorAgentId) =>
            request<{ comments_deleted: number; events_deleted: number; owner_comments_preserved: number }>(
                `/api/issues/${encodeURIComponent(issueType)}/${encodeURIComponent(id)}/history/prune`,
                {
                    method: 'POST',
                    body: { before_time: beforeTime },
                    // Forward the bound MCP identity so the audit event
                    // written by historyPruneService can attribute the
                    // deletion. Null becomes no header, and the server
                    // records actor_agent_id=null (unknown caller).
                    ...(actorAgentId
                        ? { headers: { 'x-atlas-agent-id': actorAgentId } }
                        : {}),
                },
            ),

        // External (off-platform) links route through
        // /api/issues/:type/:id/external-links + /api/issues/external-links/:linkId.
        listItemExternalLinks: (issueType, issueId) =>
            request<IItemExternalLink[]>(
                `/api/issues/${encodeURIComponent(issueType)}/${encodeURIComponent(issueId)}/external-links`,
            ),
        createItemExternalLink: (payload) =>
            request<IItemExternalLink>(
                `/api/issues/${encodeURIComponent(payload.issue_type)}/${encodeURIComponent(payload.issue_id)}/external-links`,
                {
                    method: 'POST',
                    body: {
                        link_kind: payload.link_kind,
                        url: payload.url,
                        title: payload.title ?? null,
                    },
                },
            ),
        deleteItemExternalLink: async (linkId) => {
            await request<void>(`/api/issues/external-links/${linkId}`, { method: 'DELETE' });
        },

        // Theme 07 — guardrails.
        listGuardrails: () => request<IGuardrailRule[]>('/api/guardrails'),
        createGuardrail: (payload) =>
            request<IGuardrailRule>('/api/guardrails', { method: 'POST', body: payload }),
        updateGuardrail: (id, payload) =>
            request<IGuardrailRule>(`/api/guardrails/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: payload,
            }),
        deleteGuardrail: async (id) => {
            await request<void>(`/api/guardrails/${encodeURIComponent(id)}`, { method: 'DELETE' });
        },

        // Theme 07 — reminders.
        setReminder: (payload) =>
            request<IReminder>('/api/reminders', { method: 'POST', body: payload }),
        updateReminder: (id, payload) =>
            request<IReminder>(`/api/reminders/${id}`, { method: 'PATCH', body: payload }),
        cancelReminder: (id) =>
            request<IReminder>(`/api/reminders/${id}`, { method: 'DELETE' }),
        listReminders: (filter) => {
            const params = new URLSearchParams();
            if (filter?.status) params.set('status', filter.status);
            if (filter?.channel) params.set('channel', filter.channel);
            if (filter?.since) params.set('since', filter.since);
            const qs = params.toString();
            return request<IReminder[]>(`/api/reminders${qs ? `?${qs}` : ''}`);
        },

        // A09 — one-shot external-notification passthrough bypassing the
        // notifications table.
        sendExternalNotification: (payload) =>
            request<{ ok: true }>('/api/notifications/send-external', { method: 'POST', body: payload }),

        // C03 — polymorphic item mutation. Dispatches via the existing
        // issueTypeToRouteSegment() helper so the same client.<method>() call
        // reaches the right per-type route. PATCH/DELETE pass through to the
        // server-side Zod schema for validation.
        updateItem: (issueType, id, patch) => {
            const seg = issueTypeToRouteSegment(issueType);
            return request<unknown>(`/api/${seg}/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: patch,
            });
        },
        transitionItemStatus: (issueType, id, status, override, requestedByAgentId) => {
            const seg = issueTypeToRouteSegment(issueType);
            const qs = override ? '?override=1' : '';
            const body: Record<string, unknown> = { status };
            if (requestedByAgentId) body['requested_by_agent_id'] = requestedByAgentId;
            return request<unknown>(`/api/${seg}/${encodeURIComponent(id)}/status${qs}`, {
                method: 'PATCH',
                body,
            });
        },
        assignItem: (issueType, id, assignee_agent_id, requestedByAgentId) => {
            const seg = issueTypeToRouteSegment(issueType);
            const body: Record<string, unknown> = { assignee_agent_id };
            if (requestedByAgentId) body['requested_by_agent_id'] = requestedByAgentId;
            return request<unknown>(`/api/${seg}/${encodeURIComponent(id)}/assign`, {
                method: 'PATCH',
                body,
            });
        },
        deleteItem: async (issueType, id) => {
            const seg = issueTypeToRouteSegment(issueType);
            await request<void>(`/api/${seg}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        },

        // C03 — project-scoped guardrails. The route nests under
        // /api/projects/:projectId/guardrails*; the id in the URL on update /
        // toggle / delete is the rule id (the server looks the rule up by id
        // directly, projectId in the path is namespacing for the Owner UI).
        listProjectGuardrails: (projectId) =>
            request<IProjectGuardrail[]>(
                `/api/projects/${encodeURIComponent(projectId)}/guardrails`,
            ),
        createProjectGuardrail: (projectId, payload) =>
            request<IProjectGuardrail>(
                `/api/projects/${encodeURIComponent(projectId)}/guardrails`,
                { method: 'POST', body: payload },
            ),
        updateProjectGuardrail: (projectId, id, payload) =>
            request<IProjectGuardrail>(
                `/api/projects/${encodeURIComponent(projectId)}/guardrails/${encodeURIComponent(id)}`,
                { method: 'PATCH', body: payload },
            ),
        toggleProjectGuardrail: (projectId, id, enabled) =>
            request<IProjectGuardrail>(
                `/api/projects/${encodeURIComponent(projectId)}/guardrails/${encodeURIComponent(id)}/toggle`,
                { method: 'PATCH', body: { enabled } },
            ),
        deleteProjectGuardrail: async (projectId, id) => {
            await request<void>(
                `/api/projects/${encodeURIComponent(projectId)}/guardrails/${encodeURIComponent(id)}`,
                { method: 'DELETE' },
            );
        },

        // C03 — auto-fetch schedules.
        listSchedules: () => request<IProjectSchedule[]>('/api/schedules'),
        upsertProjectSchedule: (projectId, payload) =>
            request<IProjectSchedule>(
                `/api/projects/${encodeURIComponent(projectId)}/schedule`,
                { method: 'PUT', body: payload },
            ),
        deleteProjectSchedule: async (projectId) => {
            await request<void>(
                `/api/projects/${encodeURIComponent(projectId)}/schedule`,
                { method: 'DELETE' },
            );
        },
        triggerProjectAutoFetch: (projectId) =>
            request<{ autofetch_id: string }>(
                `/api/projects/${encodeURIComponent(projectId)}/schedule/fire`,
                { method: 'POST' },
            ),
    };
}

// Map IssueType discriminator → REST route segment. The five entity types
// each have their own /api/{segment}/:id/* surface.
function issueTypeToRouteSegment(t: IssueType): string {
    switch (t) {
        case 'epic':
            return 'epics';
        case 'story':
            return 'stories';
        case 'sub_task':
            return 'sub-tasks';
        case 'sub_bug':
            return 'sub-bugs';
        case 'bug':
            return 'bugs';
    }
}
