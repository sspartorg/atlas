import type {
    AgentCategory,
    AgentKindSlug,
    ApiErrorBody,
    ApiErrorKind,
    IAgent,
    IMarketplaceAgentFull,
    IMarketplaceAgentSummary,
    IMarketplaceUpgradeDiff,
    MarketplaceUpgradeField,
    IRole,
    SdlcRole,
    IAgentMemory,
    IMemoryRegeneration,
    IAgentPromptVersion,
    IAgentChecklistItem,
    IProject,
    IProjectRepo,
    ITask,
    ITaskListItem,
    ISubTask,
    IIssueTreeResponse,
    ITaskFullResponse,
    ISubTaskFullResponse,
    IAgentRun,
    IJiraConfig,
    IJiraSource,
    IJiraSyncResult,
    IJiraTestResult,
    ISettings,
    IComment,
    INotification,
    IssueType,
    IActivityItem,
    IIssueLinkRow,
    IItemExternalLink,
    ICredential,
    IProjectSchedule,
    SchedulePreset,
    ScheduleConflictPolicy,
    ICliModel,
    ICliAvailability,
    IEnvVar,
    IToolCatalogGroup,
    AgentCli,
    IGuardrailRule,
    GuardrailCategory,
    GuardrailSeverity,
    IProjectGuardrail,
    IGuardrailScript,
    IProjectGuardrailScript,
    NotificationKind,
    NotificationDeliveryStatus,
    IReminder,
    SetReminderInput,
    UpdateReminderInput,
    IScratchPad,
    CreateScratchPadInput,
    UpdateScratchPadInput,
    ICliSession,
    CliSessionCreateInput,
    CliSessionStandaloneCreateInput,
    CliSessionPreflightStopResponse,
    CliSessionStopInput,
    CliSessionStopResponse,
    CliSessionDiffScopeName,
    CliSessionDiffSummaryResponse,
    CliSessionFilePatchResponse,
    ICliSessionTranscriptResponse,
} from '@atlas/shared';
import type {
    CreateWorkflowInput,
    IPublishedWorkflow,
    IPublishedWorkflowDetail,
    IWorkflow,
    IWorkflowImportResult,
    IWorkflowQueue,
    IWorkflowRunDetail,
    IWorkflowRunSummary,
    IWorkflowTemplate,
    UpdateWorkflowInput,
} from '@atlas/shared';
import type {
    SidenavCounts,
    DashboardResponse,
    ProjectCounts,
    AnalyticsResponse,
    AnalyticsProjectResponse,
    AnalyticsProjectTasksResponse,
    AnalyticsTaskResponse,
    AnalyticsTaskChildrenResponse,
    GateResultRow,
    AgentTest,
    AgentTestRun,
    AgentTestBatch,
    AgentPerformance,
    ParkedFixture,
    StarterTest,
    AgentCostEstimate,
    AgentTestItemTemplate,
    AgentTestExpectations,
} from './types.js';

const BASE = '/api';

/**
 * W4 — Typed throw for any non-2xx response from @atlas/api. Carries the
 * machine `kind` so callers can branch (e.g. `cli_not_installed` → render
 * "claude CLI not on PATH" alert) without sniffing the human `message`.
 * `kind` defaults to 'internal_error' when a legacy route still returns
 * `{ error: '…' }` without the envelope, keeping back-compat live.
 */
export class AtlasApiError extends Error {
    constructor(
        message: string,
        public readonly kind: ApiErrorKind,
        public readonly status: number,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'AtlasApiError';
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
    };
    // Only set Content-Type when there's a body — Fastify 5 rejects a JSON
    // content-type without a body (FST_ERR_CTP_EMPTY_JSON_BODY). FormData
    // is left untyped so the browser supplies the multipart boundary.
    const isForm =
        typeof FormData !== 'undefined' && init?.body instanceof FormData;
    if (init?.body !== undefined && !isForm && headers['Content-Type'] === undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE}${path}`, { ...init, headers });
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>;
        throw new AtlasApiError(
            body.error ?? `HTTP ${res.status}`,
            body.kind ?? 'internal_error',
            res.status,
            body.details,
        );
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
}

// requestRaw — does NOT throw on non-2xx. Returns the parsed body either way so
// the caller can branch on `ok` and inspect failure payloads (e.g. the connect
// verify route returns 400 with a structured `{ checks, error_kind }` body).
async function requestRaw<T>(
    path: string,
    init?: RequestInit
): Promise<{ ok: boolean; status: number; body: T }> {
    const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
    };
    if (init?.body !== undefined && headers['Content-Type'] === undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE}${path}`, { ...init, headers });
    const body = res.status === 204 ? (undefined as unknown as T) : ((await res.json()) as T);
    return { ok: res.ok, status: res.status, body };
}

/** PUT /integrations/jira body: any config field; `api_token` is write-only (omit or '' keeps the stored one). */
export type JiraConfigUpdate = Partial<
    Pick<IJiraConfig, 'enabled' | 'site_url' | 'email' | 'poll_interval_minutes' | 'extra_fields'>
> & { api_token?: string };

/** A source's editable fields; it belongs to a project, so `project_id` and `id` are the route. */
export type JiraSourceInput = Pick<IJiraSource, 'jql' | 'workflow_id' | 'repo_ids'>;

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = (path: string) => request<void>(path, { method: 'DELETE' });

// Multipart form-data POST (file uploads). Caller hands a FormData with the
// file in a `file` part; we do NOT set Content-Type so the browser supplies
// the boundary automatically.
const postForm = <T>(path: string, fd: FormData) =>
    request<T>(path, { method: 'POST', body: fd });

// Absolute URL builder for download links (anchor href = a backend endpoint).
const apiUrl = (path: string) => `${BASE}${path}`;

interface ConnectChecks {
    folder_exists: boolean;
    has_git: boolean;
    origin_matches: boolean;
    ls_remote_ok: boolean;
}

type ConnectErrorKind =
    | 'missing_folder'
    | 'not_git'
    | 'origin_mismatch'
    | 'credential_missing'
    | 'auth_failed'
    | 'already_registered';

export interface ConnectError {
    ok: false;
    checks: ConnectChecks;
    error_kind: ConnectErrorKind;
    folder_origin?: string | null;
    head_branch?: string | null;
    head_sha?: string | null;
    existing_project?: { id: string; name: string };
}

interface FsEntry {
    name: string;
    is_directory: boolean;
}

export interface FsListResponse {
    path: string;
    parent: string | null;
    entries: FsEntry[];
}

export const api = {
    health: () => get<{ status: string }>('/health'),

    fs: {
        list: (path: string) => get<FsListResponse>(`/fs/list?path=${encodeURIComponent(path)}`),
        stat: (path: string) =>
            get<{ path: string; exists: boolean; is_directory: boolean }>(
                `/fs/stat?path=${encodeURIComponent(path)}`
            ),
        join: (base: string, name: string) =>
            get<{ path: string }>(
                `/fs/join?base=${encodeURIComponent(base)}&name=${encodeURIComponent(name)}`
            ),
        home: () => get<{ path: string }>('/fs/home'),
    },

    counts: {
        sidenav: () => get<SidenavCounts>('/counts'),
        dashboard: () => get<DashboardResponse>('/dashboard'),
        project: (id: string) => get<ProjectCounts>(`/counts/project/${id}`),
    },

    analytics: {
        get: (tz?: string) => {
            const t = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
            return get<AnalyticsResponse>(`/analytics?tz=${encodeURIComponent(t)}`);
        },
        // Drill-down: project aggregate (totals + byKind + top 25 tasks).
        project: (projectId: string) =>
            get<AnalyticsProjectResponse>(
                `/analytics/project/${encodeURIComponent(projectId)}`,
            ),
        projectTasks: (
            projectId: string,
            params: { page?: number; limit?: number } = {},
        ) => {
            const q = new URLSearchParams();
            if (params.page) q.set('page', String(params.page));
            if (params.limit) q.set('limit', String(params.limit));
            const qs = q.toString();
            return get<AnalyticsProjectTasksResponse>(
                `/analytics/project/${encodeURIComponent(projectId)}/tasks${qs ? `?${qs}` : ''}`,
            );
        },
        task: (taskId: string) =>
            get<AnalyticsTaskResponse>(
                `/analytics/task/${encodeURIComponent(taskId)}`,
            ),
        taskChildren: (
            taskId: string,
            params: {
                page?: number;
                limit?: number;
                type?: IssueType;
            } = {},
        ) => {
            const q = new URLSearchParams();
            if (params.page) q.set('page', String(params.page));
            if (params.limit) q.set('limit', String(params.limit));
            if (params.type) q.set('type', params.type);
            const qs = q.toString();
            return get<AnalyticsTaskChildrenResponse>(
                `/analytics/task/${encodeURIComponent(taskId)}/children${qs ? `?${qs}` : ''}`,
            );
        },
    },

    jira: {
        get: () => get<IJiraConfig>('/integrations/jira'),
        update: (data: JiraConfigUpdate) => put<IJiraConfig>('/integrations/jira', data),
        test: (data: { site_url?: string; email?: string; api_token?: string } = {}) =>
            post<IJiraTestResult>('/integrations/jira/test', data),
        sync: () => post<IJiraSyncResult>('/integrations/jira/sync', {}),
        revealToken: () => post<{ value: string }>('/integrations/jira/reveal-token', {}),
    },
    // Migration 010 — sources are a project's query+workflow+repos combos.
    jiraSources: {
        list: (projectId: string) =>
            get<IJiraSource[]>(`/projects/${projectId}/jira-sources`),
        create: (projectId: string, data: JiraSourceInput) =>
            post<IJiraSource>(`/projects/${projectId}/jira-sources`, data),
        update: (projectId: string, id: number, data: Partial<JiraSourceInput>) =>
            patch<IJiraSource>(`/projects/${projectId}/jira-sources/${id}`, data),
        remove: (projectId: string, id: number) =>
            del(`/projects/${projectId}/jira-sources/${id}`),
    },

    /** Every repo of every project (ADR 0018). */
    repos: {
        listAll: () => get<IProjectRepo[]>('/repos'),
    },

    settings: {
        get: () => get<ISettings>('/settings'),
        onboard: (data: { owner_name: string; workspace_path: string }) =>
            post<ISettings>('/settings/onboard', data),
        updateProfile: (data: {
            owner_name?: string;
            accent_color?: string;
            workspace_path?: string;
        }) => patch<ISettings>('/settings/profile', data),
        updateConstitution: (constitution_md: string) =>
            patch<ISettings>('/settings/constitution', { constitution_md }),
        updateExternalNotification: (data: {
            external_notification_provider?: 'telegram' | 'teams';
            external_notification_token?: string | null;
            external_notification_chat_id?: string | null;
            external_notification_webhook_url?: string | null;
        }) => patch<ISettings>('/settings/external-notification', data),
        testExternalNotification: () =>
            post<{ ok: boolean; error?: string; endpoint_label?: string | null }>(
                '/settings/external-notification/test',
                {},
            ),
        // Batch-9 enterprise-secrets read model: on-demand reveal of the
        // token / webhook URL. The GET /api/settings response never
        // includes the plaintext value; the UI checks `_set` booleans
        // and only calls these when the Owner clicks Reveal.
        revealExternalNotificationToken: () =>
            post<{ value: string }>('/settings/external-notification/reveal-token', {}),
        revealExternalNotificationWebhookUrl: () =>
            post<{ value: string }>('/settings/external-notification/reveal-webhook-url', {}),
        updateNotifications: (data: {
            external_notification_event_toggles?: Record<string, boolean>;
            quiet_hours_from?: string | null;
            quiet_hours_to?: string | null;
            quiet_hours_timezone?: string | null;
            quiet_hours_enabled?: number;
            terminal_idle_notify_seconds?: number;
        }) => patch<ISettings>('/settings/notifications', data),
        getEnv: () => get<{ vars: IEnvVar[] }>('/settings/env'),
        updateEnv: (updates: Array<{ key: string; value: string }>) =>
            patch<{ vars: IEnvVar[] }>('/settings/env', { updates }),
        reset: () => post<{ ok: boolean }>('/settings/reset', {}),
    },

    server: {
        restart: () => post<{ ok: true; supervised: boolean }>('/server/restart', {}),
    },

    // Task 1 — project-scoped label suggestions for the LabelsRailRow /
    // LabelsFormField on item pages and the Labels filter chip on search.
    labels: {
        list: (projectId?: string) => {
            const params = new URLSearchParams();
            if (projectId) params.set('project_id', projectId);
            const qs = params.toString();
            return get<{ labels: string[] }>(`/labels${qs ? `?${qs}` : ''}`);
        },
    },

    cliModels: {
        list: () => get<ICliModel[]>('/cli-models'),
        create: (data: { cli: AgentCli; model_name: string; note?: string | null }) =>
            post<ICliModel>('/cli-models', data),
        update: (id: string, data: { note?: string | null; sort_order?: number }) =>
            patch<ICliModel>(`/cli-models/${id}`, data),
        remove: (id: string) => del(`/cli-models/${id}`),
    },

    toolCatalog: {
        get: () => get<{ groups: IToolCatalogGroup[] }>('/tool-catalog'),
    },

    roles: {
        // A08 — SDLC role catalog. Read-only list + per-role default-prompt
        // edits (Owner). The catalog shape itself is fixed in shared and
        // changes only via migration.
        list: () => get<IRole[]>('/roles'),
        get: (id: SdlcRole) => get<IRole>(`/roles/${id}`),
        update: (
            id: SdlcRole,
            data: Partial<Pick<IRole, 'label' | 'description' | 'default_prompt_md'>>,
        ) => patch<IRole>(`/roles/${id}`, data),
    },

    agents: {
        list: () => get<IAgent[]>('/agents'),
        get: (id: string) => get<IAgent>(`/agents/${id}`),
        create: (data: Partial<IAgent>) => post<IAgent>('/agents', data),
        update: (id: string, data: Partial<IAgent>) => patch<IAgent>(`/agents/${id}`, data),
        delete: (id: string) => del(`/agents/${id}`),
        getRuns: (id: string) => get<IAgentRun[]>(`/agents/${id}/runs`),
        getChecklists: (id: string) =>
            get<IAgentChecklistItem[]>(`/agents/${id}/checklists`),
        setChecklists: (
            id: string,
            items: Array<{ label: string; sort_order: number; required: boolean }>
        ) => put<IAgentChecklistItem[]>(`/agents/${id}/checklists`, { items }),
        getMemory: (id: string) => get<IAgentMemory>(`/agents/${id}/memory`),
        setMemory: (id: string, body_md: string) =>
            put<IAgentMemory>(`/agents/${id}/memory`, { body_md }),
        regenerateMemory: (id: string) =>
            post<IAgentMemory>(`/agents/${id}/memory/regenerate`, {}),
        // Theme 08 — regen audit history for the Memory tab.
        getMemoryHistory: (id: string, limit?: number) =>
            get<IMemoryRegeneration[]>(
                `/agents/${id}/memory/history${limit ? `?limit=${limit}` : ''}`,
            ),
        // Theme 08 — similar items via the RAG service.
        getSimilarItems: (itemId: string, topK?: number) =>
            get<Array<{ item_id: string; similarity: number; source_type: string }>>(
                `/items/${encodeURIComponent(itemId)}/similar${topK ? `?top_k=${topK}` : ''}`,
            ),
        // Theme 11 — commit-discipline verifications for the Agent
        // Detail tile.
        getCommitVerifications: (id: string, limit?: number) =>
            get<
                Array<{
                    id: number;
                    run_id: string;
                    item_id: string | null;
                    agent_id: string;
                    result: 'compliant' | 'partial' | 'silent' | 'clean';
                    commit_count: number;
                    problems: Array<{ commit_sha?: string; reason: string }>;
                    checked_at: string;
                }>
            >(`/agents/${id}/commit-verifications${limit ? `?limit=${limit}` : ''}`),
        getPromptVersions: (id: string) =>
            get<IAgentPromptVersion[]>(
                `/agents/${id}/prompt-versions`,
            ),
        revertPrompt: (id: string, version: number) =>
            post<IAgent>(`/agents/${id}/prompt-versions/${version}/revert`, {}),
        compilePrompt: (
            id: string,
            issue_type: IssueType | null,
            issue_id: string | null
        ) =>
            post<{
                prompt: string;
                filename: string;
                length: number;
                agent: { id: string; name: string; cli: string; model: string };
                issue: { type: IssueType; id: string; title: string } | null;
                guardrails_count: number;
                sections: string[];
            }>(`/agents/${id}/compile-prompt`, { issue_type, issue_id }),
        // Marketplace integration: local-agent side. Catalog browse / install
        // lives under `api.marketplace.*` below.
        acceptUpgrade: (id: string, fields: MarketplaceUpgradeField[]) =>
            post<IAgent>(`/agents/${id}/accept-upgrade`, { fields }),
        dismissUpgrade: (id: string) => post<IAgent>(`/agents/${id}/dismiss-upgrade`, {}),
        detachMarketplace: (id: string) => post<IAgent>(`/agents/${id}/detach`, {}),
        exportZipUrl: (id: string) => apiUrl(`/agents/${encodeURIComponent(id)}/export`),
        importZip: (file: File, opts: { agent_id?: string } = {}) => {
            const fd = new FormData();
            // The server only sees fields sent before the file part.
            if (opts.agent_id) fd.append('agent_id', opts.agent_id);
            fd.append('file', file);
            return postForm<IAgent>('/agents/import', fd);
        },
    },

    marketplace: {
        list: (params: {
            q?: string;
            category?: AgentCategory;
            kind?: AgentKindSlug;
            limit?: number;
        } = {}) => {
            const sp = new URLSearchParams();
            if (params.q) sp.set('q', params.q);
            if (params.category) sp.set('category', params.category);
            if (params.kind) sp.set('kind', params.kind);
            if (params.limit != null) sp.set('limit', String(params.limit));
            const qs = sp.toString();
            return get<IMarketplaceAgentSummary[]>(`/marketplace/agents${qs ? `?${qs}` : ''}`);
        },
        get: (id: string) =>
            get<IMarketplaceAgentFull>(`/marketplace/agents/${encodeURIComponent(id)}`),
        install: (id: string, opts: { agent_id?: string } = {}) =>
            post<IAgent>(`/marketplace/agents/${encodeURIComponent(id)}/install`, opts),
        diff: (catalogId: string, agentId: string) =>
            get<IMarketplaceUpgradeDiff>(
                `/marketplace/agents/${encodeURIComponent(catalogId)}/diff/${encodeURIComponent(agentId)}`,
            ),
        exportZipUrl: (id: string) =>
            apiUrl(`/marketplace/agents/${encodeURIComponent(id)}/export`),
    },

    projects: {
        list: () => get<IProject[]>('/projects'),
        listPaged: (params: { page: number; limit: number }) =>
            get<{ rows: IProject[]; total: number; page: number; limit: number }>(
                `/projects/paged?page=${params.page}&limit=${params.limit}`,
            ),
        get: (id: string) => get<IProject>(`/projects/${id}`),
        create: (data: Partial<IProject>) => post<IProject>('/projects', data),
        update: (id: string, data: Partial<IProject>) => patch<IProject>(`/projects/${id}`, data),
        delete: (id: string) => del(`/projects/${id}`),
        prefixAvailable: (prefix: string) =>
            get<{
                available: boolean;
                reason?: 'in_use' | 'invalid';
                conflict?: string | null;
            }>(`/projects/prefix-available?prefix=${encodeURIComponent(prefix)}`),
        deleteJob: (id: string, data: { mode: 'unregister' | 'purge'; confirm_name?: string }) =>
            post<{ delete_id: string }>(`/projects/${id}/delete`, data),
        // ADR 0018 — every git action names the repo it acts on.
        reclone: (id: string, repoId: string) =>
            post<{ reclone_id: string }>(`/projects/${id}/repos/${repoId}/reclone`, {}),
        status: (id: string, repoId: string) =>
            get<{ local_head: string; remote_head: string; behind: number; uncommitted: number }>(
                `/projects/${id}/repos/${repoId}/status`
            ),
        reveal: (id: string, repoId: string) =>
            post<{ ok: true; path: string }>(`/projects/${id}/repos/${repoId}/reveal`, {}),
        folderOrigin: (path: string) =>
            get<{ origin: string | null }>(
                `/projects/folder-origin?path=${encodeURIComponent(path)}`
            ),
        head: (id: string, repoId: string) =>
            get<{ short_sha: string | null; subject: string | null; relative_time: string | null }>(
                `/projects/${id}/repos/${repoId}/head`
            ),
        // Theme 09b — AI-Readiness Agent trigger + chip backing. The scaffold
        // reads a checkout, so it names the repo to analyse.
        generateAiScaffold: (id: string, repoId?: string) =>
            post<{ run_id: string; workflow_id: string }>(
                `/projects/${id}/generate-ai-scaffold`,
                repoId ? { repo_id: repoId } : {}
            ),
        // ADR 0018 — a project's repos, in order; they are all equal. Adding
        // one clones it (202 + clone_* SSE) or registers a local clone
        // (a 400 carries a ConnectError). This is the ONLY way a repo enters
        // a project — ADR 0018, and the project-level clone/connect endpoints
        // that used to duplicate it are gone.
        repos: (id: string) => get<IProjectRepo[]>(`/projects/${id}/repos`),
        cloneRepo: (
            id: string,
            data: { name: string; repo_url: string; credential_id: string; default_branch: string },
        ) =>
            post<{ clone_id: string; destination: string }>(`/projects/${id}/repos`, {
                mode: 'clone',
                ...data,
            }),
        connectRepo: (
            id: string,
            data: { name: string; folder_path: string; repo_url: string; credential_id: string },
        ) =>
            requestRaw<IProjectRepo | ConnectError | ApiErrorBody>(`/projects/${id}/repos`, {
                method: 'POST',
                body: JSON.stringify({ mode: 'connect', ...data }),
            }),
        updateRepo: (
            id: string,
            repoId: string,
            data: {
                default_branch?: string;
                setup_sh_body?: string;
                setup_ps1_body?: string;
                verify_command?: string;
            },
        ) => patch<IProjectRepo>(`/projects/${id}/repos/${repoId}`, data),
        removeRepo: (id: string, repoId: string) => del(`/projects/${id}/repos/${repoId}`),
        // Batch-9 enterprise-secrets read model: list returns metadata
        // only (`{key, updated_at, has_value}`); revealEnv fetches the
        // plaintext for a single key on demand. save() still accepts
        // the {key,value} write shape but the response is metadata.
        //
        // The `value?: string` field is retained as OPTIONAL on the
        // return type so existing UI code that reads `v.value` compiles;
        // it will always be `undefined` on the wire from the enterprise
        // read model. UI components should check `has_value` (or the
        // dedicated reveal endpoint) — the optional `value` slot is a
        // compile-safety cushion, not a data path.
        getEnv: (id: string) =>
            get<{
                vars: Array<{ key: string; updated_at?: string; has_value?: true; value?: string }>;
            }>(`/projects/${id}/env`),
        revealEnv: (id: string, key: string) =>
            get<{ key: string; value: string }>(
                `/projects/${id}/env/${encodeURIComponent(key)}/value`,
            ),
        saveEnv: (id: string, vars: Array<{ key: string; value: string }>) =>
            put<{
                vars: Array<{ key: string; updated_at?: string; has_value?: true; value?: string }>;
            }>(`/projects/${id}/env`, { vars }),
    },

    // 2026-06-10 — Global tier of the two-scope secrets model. Edited
    // in Settings > Shared Secrets; merged into the per-project map
    // (project wins) before the setup runner substitutes
    // ${variable.KEY} placeholders.
    //
    // Batch-9 enterprise-secrets read model: list is metadata-only,
    // reveal is per-key on demand.
    environmentSecrets: {
        list: () =>
            get<{
                vars: Array<{ key: string; updated_at?: string; has_value?: true; value?: string }>;
            }>('/environment-secrets'),
        reveal: (key: string) =>
            get<{ key: string; value: string }>(
                `/environment-secrets/${encodeURIComponent(key)}/value`,
            ),
        save: (vars: Array<{ key: string; value: string }>) =>
            put<{
                vars: Array<{ key: string; updated_at?: string; has_value?: true; value?: string }>;
            }>('/environment-secrets', { vars }),
    },

    schedules: {
        listEnabled: () => get<IProjectSchedule[]>('/schedules'),
        // ADR 0018 — auto-fetch is per repo.
        get: (projectId: string, repoId: string) =>
            get<IProjectSchedule>(`/projects/${projectId}/repos/${repoId}/schedule`),
        save: (
            projectId: string,
            repoId: string,
            data: {
                enabled: boolean;
                preset: SchedulePreset;
                time_of_day: string;
                weekday: number | null;
                cron_expression: string;
                skip_if_dirty: boolean;
                pause_while_agents_active: boolean;
                conflict_policy: ScheduleConflictPolicy;
            }
        ) => put<IProjectSchedule>(`/projects/${projectId}/repos/${repoId}/schedule`, data),
        delete: (projectId: string, repoId: string) =>
            del(`/projects/${projectId}/repos/${repoId}/schedule`),
        fire: (projectId: string, repoId: string) =>
            post<{ autofetch_id: string }>(`/projects/${projectId}/repos/${repoId}/schedule/fire`, {}),
    },

    credentials: {
        list: () => get<ICredential[]>('/credentials'),
        get: (id: string) => get<ICredential>(`/credentials/${id}`),
        create: (
            data:
                | {
                      label: string;
                      host?: 'github';
                      kind?: 'pat';
                      username?: string;
                      token: string;
                      scope?: string;
                      expires_at?: string | null;
                      // Commit author for sessions on this credential — a PAT
                      // has no bot identity, so unlike the github_app branch
                      // these are not a Co-Authored-By trailer.
                      human_name?: string | null;
                      human_email?: string | null;
                  }
                | {
                      label: string;
                      host?: 'github';
                      kind: 'github_app';
                      bot_info_path: string;
                      app_installation_owner: string;
                      scope?: string;
                      human_name?: string | null;
                      human_email?: string | null;
                      human_gh_login?: string | null;
                  },
        ) => post<ICredential>('/credentials', data),
        update: (
            id: string,
            data: Partial<{
                label: string;
                username: string;
                token: string;
                scope: string;
                expires_at: string | null;
                app_installation_owner: string;
                human_name: string | null;
                human_email: string | null;
                human_gh_login: string | null;
            }>
        ) => patch<ICredential>(`/credentials/${id}`, data),
        delete: (id: string) => del(`/credentials/${id}`),
        refresh: (id: string) => post<ICredential>(`/credentials/${id}/refresh`, {}),
        // On-demand plaintext for a stored PAT. Never cache the result —
        // same read model as environment-secrets / project env reveal.
        revealToken: (id: string) =>
            get<{ id: string; value: string }>(`/credentials/${id}/token`),
    },

    tasks: {
        list: (projectId?: string, includeArchived = false) => {
            const params = new URLSearchParams();
            if (projectId) params.set('project_id', projectId);
            if (includeArchived) params.set('include_archived', 'true');
            const qs = params.toString();
            return get<ITaskListItem[]>(`/tasks${qs ? `?${qs}` : ''}`);
        },
        stats: () => get<{ total: number; awaiting_pickup: number }>('/tasks/stats'),
        get: (id: string) => get<ITask>(`/tasks/${id}`),
        // Composite — task + project + sub_tasks + related_links + activity +
        // agents. Backs TaskDetail.
        full: (id: string) => get<ITaskFullResponse>(`/tasks/${id}/full`),
        create: (data: Partial<ITask>) => post<ITask>('/tasks', data),
        update: (id: string, data: Partial<ITask>) => patch<ITask>(`/tasks/${id}`, data),
        transition: (id: string, status: string, override = false, closeSubTasks = false) =>
            patch<ITask>(`/tasks/${id}/status${override ? '?override=1' : ''}`, {
                status,
                ...(closeSubTasks ? { close_sub_tasks: true } : {}),
            }),
        assign: (id: string, assignee_agent_id: string | null) =>
            patch<ITask>(`/tasks/${id}/assign`, { assignee_agent_id }),
        reorderSubTasks: (id: string, ids: string[]) => put<void>(`/tasks/${id}/sub-tasks/order`, { ids }),
        delete: (id: string) => del(`/tasks/${id}`),
    },

    subTasks: {
        list: () => get<ISubTask[]>('/sub-tasks'),
        listForTask: (taskId: string) => get<ISubTask[]>(`/tasks/${taskId}/sub-tasks`),
        create: (taskId: string, data: Partial<ISubTask>) =>
            post<ISubTask>(`/tasks/${taskId}/sub-tasks`, { ...data, task_id: taskId }),
        // Composite — sub_task + task + project + related_links + activity +
        // agents. Backs SubTaskDetail.
        full: (id: string) => get<ISubTaskFullResponse>(`/sub-tasks/${id}/full`),
        update: (id: string, data: Partial<ISubTask>) => patch<ISubTask>(`/sub-tasks/${id}`, data),
        transition: (id: string, status: string, override = false) =>
            patch<ISubTask>(`/sub-tasks/${id}/status${override ? '?override=1' : ''}`, { status }),
        assign: (id: string, assignee_agent_id: string | null) =>
            patch<ISubTask>(`/sub-tasks/${id}/assign`, { assignee_agent_id }),
        delete: (id: string) => del(`/sub-tasks/${id}`),
    },

    issues: {
        // One round-trip view of Tasks + their Sub-tasks, with project +
        // agent dictionaries inlined. Backs Project Detail.
        tree: (opts: { projectId?: string | undefined; includeArchived?: boolean | undefined } = {}) => {
            const params = new URLSearchParams();
            if (opts.projectId) params.set('project_id', opts.projectId);
            if (opts.includeArchived) params.set('include_archived', 'true');
            const qs = params.toString();
            return get<IIssueTreeResponse>(`/issues/tree${qs ? `?${qs}` : ''}`);
        },
    },

    comments: {
        list: (issueType: IssueType, issueId: string) =>
            get<IComment[]>(`/comments?issue_type=${issueType}&issue_id=${issueId}`),
        create: (data: Partial<IComment>) => post<IComment>('/comments', data),
        update: (id: number, body: string) =>
            patch<IComment>(`/comments/${id}`, { body }),
        delete: (id: number) => del(`/comments/${id}`),
    },

    activity: {
        get: (issueType: IssueType, issueId: string) =>
            get<IActivityItem[]>(`/issues/${issueType}/${issueId}/activity`),
    },

    issueLinks: {
        list: (issueType: IssueType, issueId: string) =>
            get<IIssueLinkRow[]>(`/issues/${issueType}/${issueId}/links`),
        create: (
            issueType: IssueType,
            issueId: string,
            toType: IssueType,
            toId: string,
            relationType: 'relates_to' | 'depends_on' | 'tested_by' = 'relates_to',
        ) =>
            post<unknown>(`/issues/${issueType}/${issueId}/links`, {
                to_type: toType,
                to_id: toId,
                relation_type: relationType,
            }),
        delete: (linkId: number) => del(`/issues/links/${linkId}`),
    },

    // External (off-platform) links — currently scoped to GitHub PR URLs.
    // Detail pages read these via the composite `*-full` payload's
    // `external_links` field; manual add/remove flows go through this client.
    issueExternalLinks: {
        list: (issueType: IssueType, issueId: string) =>
            get<IItemExternalLink[]>(`/issues/${issueType}/${issueId}/external-links`),
        create: (
            issueType: IssueType,
            issueId: string,
            input: { url: string; link_kind: 'pull_request'; title?: string | null },
        ) =>
            post<IItemExternalLink>(`/issues/${issueType}/${issueId}/external-links`, {
                link_kind: input.link_kind,
                url: input.url,
                title: input.title ?? null,
            }),
        delete: (linkId: number) => del(`/issues/external-links/${linkId}`),
        // Re-checks every PR link's GitHub state synchronously and returns
        // the updated list (the plain list only refreshes stale rows lazily).
        refresh: (issueType: IssueType, issueId: string) =>
            post<IItemExternalLink[]>(`/issues/${issueType}/${issueId}/external-links/refresh`, {}),
    },

    notifications: {
        list: (opts?: {
            kind?: NotificationKind;
            external_status?: NotificationDeliveryStatus;
            limit?: number;
        }) => {
            const qs = new URLSearchParams();
            if (opts?.kind) qs.set('kind', opts.kind);
            if (opts?.external_status) qs.set('external_status', opts.external_status);
            if (opts?.limit) qs.set('limit', String(opts.limit));
            const tail = qs.toString();
            return get<INotification[]>(`/notifications${tail ? `?${tail}` : ''}`);
        },
        markSent: (id: number) => patch<void>(`/notifications/${id}/sent`, {}),
        resend: (id: number) => post<INotification>(`/notifications/${id}/resend`, {}),
        cancel: (id: number) => post<INotification>(`/notifications/${id}/cancel`, {}),
        markAllRead: () => post<{ ok: true; changed: number }>('/notifications/mark-all-read', {}),
        markRead: (id: number) =>
            post<{ ok: true; changed: boolean }>(`/notifications/${id}/read`, {}),
    },

    push: {
        getVapidPublicKey: () =>
            get<{ publicKey: string | null }>('/push-subscriptions/vapid-public-key'),
        subscribe: (data: {
            endpoint: string;
            p256dh: string;
            auth: string;
            userAgent?: string;
        }) => post<{ ok: true }>('/push-subscriptions/subscribe', data),
        unsubscribe: (endpoint: string) =>
            post<void>('/push-subscriptions/unsubscribe', { endpoint }),
        test: () =>
            post<{ ok: boolean; subscriptions: number; delivered: number; error?: string }>(
                '/push-subscriptions/test',
                {},
            ),
    },

    reminders: {
        list: () => get<IReminder[]>('/reminders'),
        create: (input: SetReminderInput) => post<IReminder>('/reminders', input),
        update: (id: number, input: UpdateReminderInput) =>
            patch<IReminder>(`/reminders/${id}`, input),
        cancel: (id: number) =>
            request<IReminder>(`/reminders/${id}`, { method: 'DELETE' }),
    },

    scratchPad: {
        list: () => get<IScratchPad[]>('/scratch-pad'),
        get: (id: string) => get<IScratchPad>(`/scratch-pad/${id}`),
        create: (input: CreateScratchPadInput = {}) =>
            post<IScratchPad>('/scratch-pad', input),
        update: (id: string, input: UpdateScratchPadInput) =>
            patch<IScratchPad>(`/scratch-pad/${id}`, input),
        delete: (id: string) => del(`/scratch-pad/${id}`),
    },

    guardrails: {
        list: () => get<{ rules: IGuardrailRule[]; published_at: string | null }>('/guardrails'),
        create: (data: {
            category: GuardrailCategory;
            rule_text: string;
            detail: string | null;
            severity: GuardrailSeverity;
        }) => post<IGuardrailRule>('/guardrails', data),
        update: (
            id: string,
            data: Partial<{
                category: GuardrailCategory;
                rule_text: string;
                detail: string | null;
                severity: GuardrailSeverity;
            }>
        ) => patch<IGuardrailRule>(`/guardrails/${id}`, data),
        remove: (id: string) => del(`/guardrails/${id}`),
        save: () => post<{ ok: true; published_at: string }>('/guardrails/save', {}),
    },

    projectGuardrails: {
        list: (projectId: string) => get<IProjectGuardrail[]>(`/projects/${projectId}/guardrails`),
        create: (
            projectId: string,
            data: {
                title: string;
                body_md: string;
                icon?: string;
                enabled?: number;
                sort_order?: number;
            }
        ) => post<IProjectGuardrail>(`/projects/${projectId}/guardrails`, data),
        update: (
            projectId: string,
            id: string,
            data: Partial<{
                title: string;
                body_md: string;
                icon: string;
                enabled: number;
                sort_order: number;
            }>
        ) => patch<IProjectGuardrail>(`/projects/${projectId}/guardrails/${id}`, data),
        toggle: (projectId: string, id: string, enabled: number) =>
            patch<IProjectGuardrail>(`/projects/${projectId}/guardrails/${id}/toggle`, { enabled }),
        remove: (projectId: string, id: string) => del(`/projects/${projectId}/guardrails/${id}`),
    },

    // Phase 1.5b — Scripts as first-class entities, independent of rules.
    guardrailScripts: {
        list: () => get<IGuardrailScript[]>('/guardrail-scripts'),
        create: (data: {
            name: string;
            description?: string;
            body_sh: string;
            body_ps1: string;
            sort_order?: number;
        }) => post<IGuardrailScript>('/guardrail-scripts', data),
        update: (
            id: string,
            data: Partial<{
                name: string;
                description: string;
                body_sh: string;
                body_ps1: string;
                sort_order: number;
            }>
        ) => patch<IGuardrailScript>(`/guardrail-scripts/${id}`, data),
        remove: (id: string) => del(`/guardrail-scripts/${id}`),
    },

    projectGuardrailScripts: {
        list: (projectId: string) =>
            get<IProjectGuardrailScript[]>(`/projects/${projectId}/guardrail-scripts`),
        create: (
            projectId: string,
            data: {
                name: string;
                description?: string;
                body_sh: string;
                body_ps1: string;
                sort_order?: number;
            }
        ) => post<IProjectGuardrailScript>(`/projects/${projectId}/guardrail-scripts`, data),
        update: (
            projectId: string,
            id: string,
            data: Partial<{
                name: string;
                description: string;
                body_sh: string;
                body_ps1: string;
                sort_order: number;
            }>
        ) =>
            patch<IProjectGuardrailScript>(
                `/projects/${projectId}/guardrail-scripts/${id}`,
                data,
            ),
        remove: (projectId: string, id: string) =>
            del(`/projects/${projectId}/guardrail-scripts/${id}`),
    },

    search: {
        // P14 — server-side FTS + filter pushdown for the Search page. The
        // route returns the full per-row shape needed to render, so the
        // page no longer maintains a per-entity client corpus.
        query: (params: {
            q?: string;
            type?: string[];
            project_id?: string[];
            agent_id?: string[];
            status?: string;
            updated?: string;
            // Task 2 — required-labels containment filter.
            labels?: string[];
            limit?: number;
        }) => {
            const qs = new URLSearchParams();
            if (params.q && params.q.trim().length >= 2) qs.set('q', params.q.trim());
            if (params.type && params.type.length > 0) qs.set('type', params.type.join(','));
            if (params.project_id && params.project_id.length > 0)
                qs.set('project_id', params.project_id.join(','));
            if (params.agent_id && params.agent_id.length > 0)
                qs.set('agent_id', params.agent_id.join(','));
            if (params.status) qs.set('status', params.status);
            if (params.updated) qs.set('updated', params.updated);
            if (params.labels && params.labels.length > 0) qs.set('labels', params.labels.join(','));
            if (params.limit) qs.set('limit', String(params.limit));
            return get<
                Array<{
                    issue_type: string;
                    issue_id: string;
                    title: string;
                    description: string;
                    status: string;
                    project_id: string;
                    assignee_agent_id: string | null;
                    updated_at: string;
                    rank: number;
                }>
            >(`/search?${qs.toString()}`);
        },
    },

    run: {
        trigger: (
            agent_id: string,
            issue_type: IssueType | null,
            issue_id: string | null
        ) => post<{ runId: string }>('/run', { agent_id, issue_type, issue_id }),
        get: (id: string, opts?: { since?: number }) => {
            const qs =
                typeof opts?.since === 'number' && Number.isFinite(opts.since)
                    ? `?since=${opts.since}`
                    : '';
            return get<IAgentRun>(`/run/${id}${qs}`);
        },
        list: (opts?: {
            issue_type?: IssueType;
            issue_id?: string;
            project_id?: string;
            limit?: number;
        }) => {
            const params = new URLSearchParams();
            if (opts?.issue_type) params.set('issue_type', opts.issue_type);
            if (opts?.issue_id) params.set('issue_id', opts.issue_id);
            if (opts?.project_id) params.set('project_id', opts.project_id);
            if (opts?.limit) params.set('limit', String(opts.limit));
            const qs = params.toString();
            return get<IAgentRun[]>(`/run${qs ? `?${qs}` : ''}`);
        },
        // P9 — Delete a run row. Server cascades reviewer child runs
        // (parent_run_id FK) and resets the attached item back to
        // `ready` with assignee cleared so the dispatcher can pick it
        // up again on the next tick. Used by the Runs tab trash icon.
        delete: (id: string) => del(`/run/${id}`),
        // Workstream #6 — UI-driven stop-a-run. Flips status to
        // `cancelled`, kills the live subprocess (best-effort), and
        // skips the on-pass handoff so the chain doesn't auto-advance
        // on half-done work. The post-run hook still pushes committed
        // bytes + cleans up the worktree.
        stop: (id: string) =>
            post<{
                runId: string;
                // Usually `cancelled`. In a race where the runner
                // finalised the row between our SELECT and UPDATE,
                // the server re-reads the actual row and returns the
                // real terminal status — could be `completed` or
                // `error`. The UI just applies whatever lands.
                status: 'cancelled' | 'completed' | 'error';
                killedSubprocess: boolean;
                pidKilled: number | null;
            }>(`/run/${id}/stop`, {}),
    },

    // 2026-06-22 — Terminal v1. PTY-backed Claude Code sessions hosted in
    // the web app. Streaming PTY bytes go over a separate WebSocket; this
    // block only covers REST control. See useCliSessionStream for the WS
    // hook + the TerminalXterm component for the xterm.js wiring.
    cli: {
        // Whether each agent CLI's binary is runnable on the API host — backs
        // the "not installed" warnings on agent + marketplace surfaces.
        availability: () => get<ICliAvailability[]>('/cli/availability'),
        sessions: {
            list: (opts?: { project_id?: string; standalone?: boolean }) => {
                const params = new URLSearchParams();
                if (opts?.project_id) params.set('project_id', opts.project_id);
                if (opts?.standalone !== undefined) params.set('standalone', String(opts.standalone));
                const qs = params.toString();
                return get<ICliSession[]>(`/cli/sessions${qs ? `?${qs}` : ''}`);
            },
            get: (id: string) => get<ICliSession>(`/cli/sessions/${id}`),
            create: (input: CliSessionCreateInput) =>
                post<ICliSession>('/cli/sessions', input),
            // Standalone terminals — a PTY on a folder the Owner picked, with
            // no project and no worktree. Separate endpoint (not a flag on
            // `create`) because the server-side payloads are disjoint.
            createStandalone: (input: CliSessionStandaloneCreateInput) =>
                post<ICliSession>('/cli/sessions/standalone', input),
            pause: (id: string) =>
                post<ICliSession>(`/cli/sessions/${id}/pause`, {}),
            resume: (id: string) =>
                post<ICliSession>(`/cli/sessions/${id}/resume`, {}),
            preflightStop: (id: string) =>
                post<CliSessionPreflightStopResponse>(`/cli/sessions/${id}/preflight-stop`, {}),
            stop: (id: string, input: CliSessionStopInput) =>
                post<CliSessionStopResponse>(`/cli/sessions/${id}/stop`, input),
            // Diff review for the Stop modal. GET (not POST like
            // preflightStop) because both are pure reads, so React Query can
            // cache them — per-file patches especially, since a worktree
            // snapshot is immutable for the modal's lifetime.
            diff: (id: string) =>
                get<CliSessionDiffSummaryResponse>(`/cli/sessions/${id}/diff`),
            diffFile: (
                id: string,
                q: { scope: CliSessionDiffScopeName; path: string; context?: number },
            ) => {
                const params = new URLSearchParams({ scope: q.scope, path: q.path });
                if (q.context !== undefined) params.set('context', String(q.context));
                return get<CliSessionFilePatchResponse>(
                    `/cli/sessions/${id}/diff/file?${params.toString()}`,
                );
            },
            transcript: (id: string) =>
                get<ICliSessionTranscriptResponse>(`/cli/sessions/${id}/transcript`),
            delete: (id: string) => del(`/cli/sessions/${id}`),
        },
    },

    // ADR 0014 — workflows own orchestration: a graph of agents run back-to-back
    // in one workflow run. PATCH answers 400 with `details.graph_errors` when
    // the graph is invalid.
    workflows: {
        list: (projectId?: string) =>
            get<IWorkflow[]>(
                `/workflows${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`,
            ),
        templates: () => get<IWorkflowTemplate[]>('/workflows/templates'),
        // Bundles: the workflow + its sub-workflows + every agent they use.
        exportZipUrl: (id: string) => apiUrl(`/workflows/${encodeURIComponent(id)}/export`),
        templateExportZipUrl: (id: string) =>
            apiUrl(`/workflows/templates/${encodeURIComponent(id)}/export`),
        importZip: (file: File, projectId: string) => {
            const fd = new FormData();
            // The server only sees fields sent before the file part.
            fd.append('project_id', projectId);
            fd.append('file', file);
            return postForm<IWorkflowImportResult>('/workflows/import', fd);
        },
        get: (id: string) => get<IWorkflow>(`/workflows/${id}`),
        // Re-take the marketplace source. Replaces the graph, so it is always
        // the Owner's explicit call — never fired automatically from a read.
        upgrade: (id: string) => post<IWorkflow>(`/workflows/${encodeURIComponent(id)}/upgrade`, {}),
        create: (input: CreateWorkflowInput) => post<IWorkflow>('/workflows', input),
        createFromTemplate: (templateId: string, projectId: string) =>
            post<IWorkflow>('/workflows/from-template', {
                template_id: templateId,
                project_id: projectId,
            }),
        update: (id: string, input: UpdateWorkflowInput) =>
            patch<IWorkflow>(`/workflows/${id}`, input),
        delete: (id: string) => del(`/workflows/${id}`),
        runs: (id: string) => get<IWorkflowRunSummary[]>(`/workflows/${id}/runs`),
        startRun: (id: string, itemId?: string, opts: { fromSubtasks?: boolean } = {}) =>
            post<{ run_id: string }>(`/workflows/${id}/runs`, {
                ...(itemId ? { item_id: itemId } : {}),
                ...(opts.fromSubtasks ? { from_subtasks: true } : {}),
            }),
        itemRuns: (itemId: string) =>
            get<IWorkflowRunSummary[]>(`/items/${itemId}/workflow-runs`),
        setItemWorkflow: (itemId: string, workflowId: string | null) =>
            put<void>(`/items/${itemId}/workflow`, { workflow_id: workflowId }),
        // Stores the export bundle in the Marketplace; again replaces the entry.
        publish: (id: string) => post<IPublishedWorkflow>(`/workflows/${encodeURIComponent(id)}/publish`, {}),
    },

    // Workflows the Owner published to the Marketplace (each stores its bundle).
    publishedWorkflows: {
        list: () => get<IPublishedWorkflow[]>('/marketplace/workflows'),
        get: (id: string) => get<IPublishedWorkflowDetail>(`/marketplace/workflows/${encodeURIComponent(id)}`),
        exportZipUrl: (id: string) => apiUrl(`/marketplace/workflows/${encodeURIComponent(id)}/export`),
        use: (id: string, projectId: string) =>
            post<IWorkflowImportResult>(`/marketplace/workflows/${encodeURIComponent(id)}/use`, { project_id: projectId }),
        unpublish: (id: string) => del(`/marketplace/workflows/${encodeURIComponent(id)}`),
    },

    // Agent tests (ADR 0023) — what makes "does this agent work?" answerable
    // without a terminal.
    agentTests: {
        list: (agentId: string) => get<AgentTest[]>(`/agents/${agentId}/tests`),
        costEstimate: (agentId: string, nRuns = 1) =>
            get<AgentCostEstimate>(`/agents/${agentId}/cost-estimate?n=${nRuns}`),
        create: (
            agentId: string,
            body: {
                project_id: string;
                repo_id?: string | null;
                name: string;
                item_template: AgentTestItemTemplate;
                expectations?: AgentTestExpectations;
            },
        ) => post<AgentTest>(`/agents/${agentId}/tests`, body),
        remove: (testId: string) => del(`/agent-tests/${testId}`),
        run: (testId: string, body: { n_runs?: number; label?: string } = {}) =>
            post<AgentTestBatch>(`/agent-tests/${testId}/run`, body),
        runs: (testId: string) => get<AgentTestRun[]>(`/agent-tests/${testId}/runs`),
        /** The same runs, folded into the batches the Owner actually pressed. */
        batches: (testId: string) => get<AgentTestBatch[]>(`/agent-tests/${testId}/batches`),
        /** ATL-140 — what this agent's own runs already prove. */
        performance: (agentId: string) => get<AgentPerformance>(`/agents/${agentId}/performance`),
        /** ADR 0023 phase 4 — the tests this agent ships with. */
        starter: (agentId: string) => get<StarterTest[]>(`/agents/${agentId}/starter-tests`),
        /** ADR 0023 phase 3 — fixtures pointed at a whole workflow. */
        forWorkflow: (workflowId: string) => get<AgentTest[]>(`/workflows/${workflowId}/tests`),
        createForWorkflow: (
            workflowId: string,
            body: {
                project_id: string;
                repo_id?: string | null;
                suite?: string | null;
                name: string;
                item_template: AgentTestItemTemplate;
                expectations?: AgentTestExpectations;
            },
        ) => post<AgentTest>(`/workflows/${workflowId}/tests`, body),
        /** ATL-173 — fixtures of this workflow that are waiting on an answer. */
        parked: (workflowId: string) => get<ParkedFixture[]>(`/workflows/${workflowId}/evals/parked`),
    },

    workflowRuns: {
        get: (id: string) => get<IWorkflowRunDetail>(`/workflow-runs/${id}`),
        stop: (id: string) => post<IWorkflowRunDetail>(`/workflow-runs/${id}/stop`, {}),
        resume: (id: string) => post<IWorkflowRunDetail>(`/workflow-runs/${id}/resume`, {}),
        // Gate nodes spawn no agent, so they have no `agent_runs` row and no
        // place on the steps list. Their verdicts come from their own route.
        gateResults: (id: string) => get<GateResultRow[]>(`/workflow-runs/${id}/gate-results`),
    },

    // What each workflow is running and has queued (the /queue page).
    workflowQueue: {
        get: (projectId?: string) =>
            get<IWorkflowQueue>(
                `/workflow-queue${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`,
            ),
    },
};
