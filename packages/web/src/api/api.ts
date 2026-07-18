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
    IAgentHandoffRule,
    IAgentChecklistItem,
    AgentHandoffKind,
    IssueStatus,
    IProject,
    IEpic,
    IEpicListItem,
    IStory,
    ISubTask,
    ISubBug,
    IBug,
    IIssueTreeResponse,
    IStoryFullResponse,
    IBugFullResponse,
    ISubTaskFullResponse,
    ISubBugFullResponse,
    IEpicFullResponse,
    IAgentRun,
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
    CliSessionPreflightStopResponse,
    CliSessionStopInput,
    CliSessionStopResponse,
    ICliSessionTranscriptResponse,
} from '@atlas/shared';
import type {
    SidenavCounts,
    DashboardResponse,
    ProjectCounts,
    AnalyticsResponse,
    AnalyticsProjectResponse,
    AnalyticsProjectEpicsResponse,
    AnalyticsEpicResponse,
    AnalyticsEpicChildrenResponse,
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
        // Drill-down: project aggregate (totals + byKind + top 25 epics).
        project: (projectId: string) =>
            get<AnalyticsProjectResponse>(
                `/analytics/project/${encodeURIComponent(projectId)}`,
            ),
        projectEpics: (
            projectId: string,
            params: { page?: number; limit?: number } = {},
        ) => {
            const q = new URLSearchParams();
            if (params.page) q.set('page', String(params.page));
            if (params.limit) q.set('limit', String(params.limit));
            const qs = q.toString();
            return get<AnalyticsProjectEpicsResponse>(
                `/analytics/project/${encodeURIComponent(projectId)}/epics${qs ? `?${qs}` : ''}`,
            );
        },
        epic: (epicId: string) =>
            get<AnalyticsEpicResponse>(
                `/analytics/epic/${encodeURIComponent(epicId)}`,
            ),
        epicChildren: (
            epicId: string,
            params: {
                page?: number;
                limit?: number;
                type?: 'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug';
            } = {},
        ) => {
            const q = new URLSearchParams();
            if (params.page) q.set('page', String(params.page));
            if (params.limit) q.set('limit', String(params.limit));
            if (params.type) q.set('type', params.type);
            const qs = q.toString();
            return get<AnalyticsEpicChildrenResponse>(
                `/analytics/epic/${encodeURIComponent(epicId)}/children${qs ? `?${qs}` : ''}`,
            );
        },
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
        getHandoffRules: (id: string) => get<IAgentHandoffRule[]>(`/agents/${id}/handoff-rules`),
        setHandoffRules: (
            id: string,
            rules: Array<{
                target_agent_id: string;
                kind: AgentHandoffKind;
                status: IssueStatus;
            }>
        ) => put<IAgentHandoffRule[]>(`/agents/${id}/handoff-rules`, { rules }),
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
        startDryRun: (id: string, extra_prompt: string | null) =>
            post<{ dryRunId: string; model: string; cli: string; promptLen: number }>(
                `/agents/${id}/dry-run`,
                { extra_prompt }
            ),
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
            fd.append('file', file);
            if (opts.agent_id) fd.append('agent_id', opts.agent_id);
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
        clone: (data: {
            repo_url: string;
            credential_id: string;
            project_name: string;
            issue_key_prefix: string;
            default_branch: string;
        }) => post<{ clone_id: string; destination: string }>('/projects/clone', data),
        prefixAvailable: (prefix: string) =>
            get<{
                available: boolean;
                reason?: 'in_use' | 'invalid';
                conflict?: string | null;
            }>(`/projects/prefix-available?prefix=${encodeURIComponent(prefix)}`),
        deleteJob: (id: string, data: { mode: 'unregister' | 'purge'; confirm_name?: string }) =>
            post<{ delete_id: string }>(`/projects/${id}/delete`, data),
        reclone: (id: string) => post<{ reclone_id: string }>(`/projects/${id}/reclone`, {}),
        status: (id: string) =>
            get<{ local_head: string; remote_head: string; behind: number; uncommitted: number }>(
                `/projects/${id}/status`
            ),
        reveal: (id: string) => post<{ ok: true; path: string }>(`/projects/${id}/reveal`, {}),
        folderOrigin: (path: string) =>
            get<{ origin: string | null }>(
                `/projects/folder-origin?path=${encodeURIComponent(path)}`
            ),
        head: (id: string) =>
            get<{ short_sha: string | null; subject: string | null; relative_time: string | null }>(
                `/projects/${id}/head`
            ),
        // Theme 09b — AI-Readiness Agent trigger + chip backing.
        generateAiScaffold: (id: string) =>
            post<{ run_id: string }>(`/projects/${id}/generate-ai-scaffold`, {}),
        connect: (data: {
            folder_path: string;
            repo_url: string;
            credential_id: string;
            issue_key_prefix: string;
        }) =>
            requestRaw<IProject | ConnectError>('/projects/connect', {
                method: 'POST',
                body: JSON.stringify(data),
            }),
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
        get: (projectId: string) => get<IProjectSchedule>(`/projects/${projectId}/schedule`),
        save: (
            projectId: string,
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
        ) => put<IProjectSchedule>(`/projects/${projectId}/schedule`, data),
        delete: (projectId: string) => del(`/projects/${projectId}/schedule`),
        fire: (projectId: string) =>
            post<{ autofetch_id: string }>(`/projects/${projectId}/schedule/fire`, {}),
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
    },

    epics: {
        list: (projectId?: string, includeArchived = false) => {
            const params = new URLSearchParams();
            if (projectId) params.set('project_id', projectId);
            if (includeArchived) params.set('include_archived', 'true');
            const qs = params.toString();
            return get<IEpicListItem[]>(`/epics${qs ? `?${qs}` : ''}`);
        },
        stats: () => get<{ total: number; awaiting_pickup: number }>('/epics/stats'),
        get: (id: string) => get<IEpic>(`/epics/${id}`),
        // Composite — epic + project + stories + bugs + related_links +
        // activity + agents. Backs EpicDetail.
        full: (id: string) => get<IEpicFullResponse>(`/epics/${id}/full`),
        create: (data: Partial<IEpic>) => post<IEpic>('/epics', data),
        update: (id: string, data: Partial<IEpic>) => patch<IEpic>(`/epics/${id}`, data),
        transition: (id: string, status: string, override = false) =>
            patch<IEpic>(`/epics/${id}/status${override ? '?override=1' : ''}`, { status }),
        assign: (id: string, assignee_agent_id: string | null) =>
            patch<IEpic>(`/epics/${id}/assign`, { assignee_agent_id }),
        resetRounds: (id: string) => post<void>(`/epics/${id}/reset-rounds`, {}),
        delete: (id: string) => del(`/epics/${id}`),
    },

    stories: {
        list: (opts: { epicId?: string | undefined; projectId?: string | undefined } = {}) => {
            const params = new URLSearchParams();
            if (opts.epicId) params.set('epic_id', opts.epicId);
            if (opts.projectId) params.set('project_id', opts.projectId);
            const qs = params.toString();
            return get<IStory[]>(`/stories${qs ? `?${qs}` : ''}`);
        },
        get: (id: string) => get<IStory>(`/stories/${id}`),
        // Composite — story + epic + project + sub_tasks + sub_bugs +
        // related_links + activity + agents. Backs StoryDetail.
        full: (id: string) => get<IStoryFullResponse>(`/stories/${id}/full`),
        create: (data: Partial<IStory>) => post<IStory>('/stories', data),
        update: (id: string, data: Partial<IStory>) => patch<IStory>(`/stories/${id}`, data),
        transition: (id: string, status: string, override = false) =>
            patch<IStory>(`/stories/${id}/status${override ? '?override=1' : ''}`, { status }),
        assign: (id: string, assignee_agent_id: string | null) =>
            patch<IStory>(`/stories/${id}/assign`, { assignee_agent_id }),
        resetRounds: (id: string) => post<void>(`/stories/${id}/reset-rounds`, {}),
        delete: (id: string) => del(`/stories/${id}`),
        getSubTasks: (id: string) => get<ISubTask[]>(`/stories/${id}/sub-tasks`),
        createSubTask: (storyId: string, data: Partial<ISubTask>) =>
            post<ISubTask>(`/stories/${storyId}/sub-tasks`, data),
        getSubBugs: (id: string) => get<ISubBug[]>(`/stories/${id}/sub-bugs`),
        createSubBug: (storyId: string, data: Partial<ISubBug>) =>
            post<ISubBug>(`/stories/${storyId}/sub-bugs`, data),
    },

    subTasks: {
        list: () => get<ISubTask[]>('/sub-tasks'),
        // Composite — sub_task + parent_story + epic + project +
        // related_links + activity + agents. Backs SubTaskDetail.
        full: (id: string) => get<ISubTaskFullResponse>(`/sub-tasks/${id}/full`),
        update: (id: string, data: Partial<ISubTask>) => patch<ISubTask>(`/sub-tasks/${id}`, data),
        transition: (id: string, status: string, override = false) =>
            patch<ISubTask>(`/sub-tasks/${id}/status${override ? '?override=1' : ''}`, { status }),
        assign: (id: string, assignee_agent_id: string | null) =>
            patch<ISubTask>(`/sub-tasks/${id}/assign`, { assignee_agent_id }),
        resetRounds: (id: string) => post<void>(`/sub-tasks/${id}/reset-rounds`, {}),
        delete: (id: string) => del(`/sub-tasks/${id}`),
    },

    subBugs: {
        list: () => get<ISubBug[]>('/sub-bugs'),
        // Composite — sub_bug + parent_story + epic + project +
        // related_links + activity + agents. Backs SubBugDetail.
        full: (id: string) => get<ISubBugFullResponse>(`/sub-bugs/${id}/full`),
        update: (id: string, data: Partial<ISubBug>) => patch<ISubBug>(`/sub-bugs/${id}`, data),
        transition: (id: string, status: string, override = false) =>
            patch<ISubBug>(`/sub-bugs/${id}/status${override ? '?override=1' : ''}`, { status }),
        assign: (id: string, assignee_agent_id: string | null) =>
            patch<ISubBug>(`/sub-bugs/${id}/assign`, { assignee_agent_id }),
        resetRounds: (id: string) => post<void>(`/sub-bugs/${id}/reset-rounds`, {}),
        delete: (id: string) => del(`/sub-bugs/${id}`),
    },

    bugs: {
        list: (opts: { epicId?: string | undefined; projectId?: string | undefined } = {}) => {
            const params = new URLSearchParams();
            if (opts.epicId) params.set('epic_id', opts.epicId);
            if (opts.projectId) params.set('project_id', opts.projectId);
            const qs = params.toString();
            return get<IBug[]>(`/bugs${qs ? `?${qs}` : ''}`);
        },
        get: (id: string) => get<IBug>(`/bugs/${id}`),
        // Composite — bug + epic + project + related_links + activity +
        // agents. Backs BugDetail.
        full: (id: string) => get<IBugFullResponse>(`/bugs/${id}/full`),
        create: (data: Partial<IBug>) => post<IBug>('/bugs', data),
        update: (id: string, data: Partial<IBug>) => patch<IBug>(`/bugs/${id}`, data),
        transition: (id: string, status: string, override = false) =>
            patch<IBug>(`/bugs/${id}/status${override ? '?override=1' : ''}`, { status }),
        assign: (id: string, assignee_agent_id: string | null) =>
            patch<IBug>(`/bugs/${id}/assign`, { assignee_agent_id }),
        resetRounds: (id: string) => post<void>(`/bugs/${id}/reset-rounds`, {}),
        delete: (id: string) => del(`/bugs/${id}`),
    },

    issues: {
        // One round-trip view of stories/bugs + their sub-tasks/sub-bugs,
        // with project + agent dictionaries inlined. Backs the Issues page.
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
        sessions: {
            list: (opts?: { project_id?: string }) => {
                const qs = opts?.project_id ? `?project_id=${encodeURIComponent(opts.project_id)}` : '';
                return get<ICliSession[]>(`/cli/sessions${qs}`);
            },
            get: (id: string) => get<ICliSession>(`/cli/sessions/${id}`),
            create: (input: CliSessionCreateInput) =>
                post<ICliSession>('/cli/sessions', input),
            pause: (id: string) =>
                post<ICliSession>(`/cli/sessions/${id}/pause`, {}),
            resume: (id: string) =>
                post<ICliSession>(`/cli/sessions/${id}/resume`, {}),
            preflightStop: (id: string) =>
                post<CliSessionPreflightStopResponse>(`/cli/sessions/${id}/preflight-stop`, {}),
            stop: (id: string, input: CliSessionStopInput) =>
                post<CliSessionStopResponse>(`/cli/sessions/${id}/stop`, input),
            transcript: (id: string) =>
                get<ICliSessionTranscriptResponse>(`/cli/sessions/${id}/transcript`),
            delete: (id: string) => del(`/cli/sessions/${id}`),
        },
    },
};
