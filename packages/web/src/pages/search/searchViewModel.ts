import type {
    IBug,
    IEpic,
    IStory,
    ISubBug,
    ISubTask,
    IAgent,
    IProject,
    IssueStatus,
} from '@atlas/shared';
import type { SearchHitRow } from '../../hooks/useSearch.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export type SearchType = 'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug' | 'prompt';

export const TYPE_LABEL: Record<SearchType, string> = {
    epic: 'Epic',
    story: 'Story',
    bug: 'Bug',
    sub_task: 'Sub-task',
    sub_bug: 'Sub-bug',
    prompt: 'Prompt',
};

export const TYPE_ICON: Record<SearchType, string> = {
    epic: 'flag',
    story: 'layers',
    bug: 'bug_report',
    sub_task: 'check_box',
    sub_bug: 'pest_control',
    prompt: 'menu_book',
};

export const TYPE_COLOR: Record<SearchType, string> = {
    epic: ATLAS_PALETTE.purple,
    story: ATLAS_PALETTE.brandBlue,
    bug: ATLAS_PALETTE.error,
    sub_task: ATLAS_PALETTE.emerald,
    sub_bug: ATLAS_PALETTE.gold,
    prompt: ATLAS_PALETTE.slate,
};

export interface SearchHit {
    type: SearchType;
    id: string;
    displayId: string;
    title: string;
    description: string;
    status: string;
    assignee_agent_id: string | null;
    project_id: string | null;
    updated_at: string;
    // agent prompt-specific field
    prompt_version?: number;
}

export type UpdatedRange = 'today' | 'last_7_days' | 'last_30_days' | 'older' | 'any';
// StatusFilter matches the canonical 6-status set 1:1, plus 'any'.
export type StatusFilter =
    | 'any'
    | 'draft'
    | 'ready'
    | 'in_progress'
    | 'waiting_for_info'
    | 'in_review'
    | 'done';

export interface FilterState {
    types: SearchType[]; // empty = all
    projectIds: string[]; // empty = all
    agentIds: string[]; // empty = all
    status: StatusFilter;
    updated: UpdatedRange;
    // Task 2 — items must carry ALL selected labels. Empty array = no filter.
    labels: string[];
    text: string; // free text contains
}

export const EMPTY_FILTERS: FilterState = {
    types: [],
    projectIds: [],
    agentIds: [],
    status: 'any',
    updated: 'any',
    labels: [],
    text: '',
};

export function buildSearchCorpus(args: {
    epics: IEpic[];
    stories: IStory[];
    bugs: IBug[];
    subTasks: ISubTask[];
    subBugs: ISubBug[];
    agents: IAgent[];
    projectIdByEpic: Map<string, string | null>;
    projectIdByStory: Map<string, string | null>;
}): SearchHit[] {
    const out: SearchHit[] = [];
    // Issue ids are already Jira-style human keys (CER-1, CER-2 …) — the
    // displayId is the id itself; no synthesis needed.
    for (const e of args.epics) {
        out.push({
            type: 'epic',
            id: e.id,
            displayId: e.id,
            title: e.title,
            description: e.description ?? '',
            status: e.status,
            assignee_agent_id: e.assignee_agent_id ?? null,
            project_id: e.project_id ?? null,
            updated_at: e.updated_at,
        });
    }
    for (const s of args.stories) {
        out.push({
            type: 'story',
            id: s.id,
            displayId: s.id,
            title: s.title,
            description: s.description ?? '',
            status: s.status,
            assignee_agent_id: s.assignee_agent_id ?? null,
            project_id: args.projectIdByEpic.get(s.epic_id) ?? null,
            updated_at: s.updated_at,
        });
    }
    for (const b of args.bugs) {
        out.push({
            type: 'bug',
            id: b.id,
            displayId: b.id,
            title: b.title,
            description: b.description ?? '',
            status: b.status,
            assignee_agent_id: b.assignee_agent_id ?? null,
            project_id: args.projectIdByEpic.get(b.epic_id) ?? null,
            updated_at: b.updated_at,
        });
    }
    for (const t of args.subTasks) {
        out.push({
            type: 'sub_task',
            id: t.id,
            displayId: t.id,
            title: t.title,
            description: t.description ?? '',
            status: t.status,
            assignee_agent_id: t.assignee_agent_id ?? null,
            project_id: args.projectIdByStory.get(t.story_id) ?? null,
            updated_at: t.updated_at,
        });
    }
    for (const t of args.subBugs) {
        out.push({
            type: 'sub_bug',
            id: t.id,
            displayId: t.id,
            title: t.title,
            description: t.description ?? '',
            status: t.status,
            assignee_agent_id: t.assignee_agent_id ?? null,
            project_id: args.projectIdByStory.get(t.story_id) ?? null,
            updated_at: t.updated_at,
        });
    }
    for (const w of args.agents) {
        const slug = w.id
            .replace(/^agent-/, '')
            .replace(/-/g, '_')
            .slice(0, 3)
            .toUpperCase();
        out.push({
            type: 'prompt',
            id: w.id,
            displayId: `PRM-${slug}-v${w.prompt_version}`,
            title: `${w.name} · v${w.prompt_version}`,
            description: (w.prompt_md ?? '')
                .split('\n')
                .filter(Boolean)
                .slice(0, 2)
                .join(' ')
                .slice(0, 200),
            status: w.status === 'active' ? 'draft' : 'inactive',
            assignee_agent_id: w.id,
            project_id: null,
            updated_at: w.updated_at,
            prompt_version: w.prompt_version,
        });
    }
    return out;
}

function inRange(iso: string, range: UpdatedRange): boolean {
    if (range === 'any') return true;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    const diff = Date.now() - t;
    const day = 24 * 3_600_000;
    if (range === 'today') return diff <= day;
    if (range === 'last_7_days') return diff <= 7 * day;
    if (range === 'last_30_days') return diff <= 30 * day;
    if (range === 'older') return diff > 30 * day;
    return true;
}

function matchesStatus(status: string, filter: StatusFilter): boolean {
    if (filter === 'any') return true;
    return status === filter;
}

export function applyFilters(corpus: SearchHit[], f: FilterState): SearchHit[] {
    const text = f.text.trim().toLowerCase();
    return corpus.filter((h) => {
        if (f.types.length > 0 && !f.types.includes(h.type)) return false;
        if (f.projectIds.length > 0) {
            if (!h.project_id) return false;
            if (!f.projectIds.includes(h.project_id)) return false;
        }
        if (f.agentIds.length > 0) {
            if (!h.assignee_agent_id) return false;
            if (!f.agentIds.includes(h.assignee_agent_id)) return false;
        }
        if (!matchesStatus(h.status, f.status)) return false;
        if (!inRange(h.updated_at, f.updated)) return false;
        if (text) {
            const hay = `${h.title} ${h.description} ${h.displayId}`.toLowerCase();
            if (!hay.includes(text)) return false;
        }
        return true;
    });
}

export function groupByType(hits: SearchHit[]): Map<SearchType, SearchHit[]> {
    const m = new Map<SearchType, SearchHit[]>();
    for (const h of hits) {
        const arr = m.get(h.type) ?? [];
        arr.push(h);
        m.set(h.type, arr);
    }
    return m;
}

export interface ParsedQuery {
    ok: boolean;
    errorMessage: string | null;
    filters: FilterState;
}

const QUERY_FIELDS = ['type', 'project', 'status', 'owner', 'updated'] as const;
type QueryField = (typeof QUERY_FIELDS)[number];

const TOKEN_RE = /\s*("[^"]*"|'[^']*'|[^\s"'()<>=!]+|[<>!]=?|=)\s*/g;

interface Token {
    value: string;
    quoted: boolean;
}

function tokenize(input: string): Token[] {
    const out: Token[] = [];
    let m: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(input)) !== null) {
        const raw = m[1] ?? '';
        if (!raw) continue;
        const quoted =
            (raw.startsWith('"') && raw.endsWith('"')) ||
            (raw.startsWith("'") && raw.endsWith("'"));
        out.push({ value: quoted ? raw.slice(1, -1) : raw, quoted });
    }
    return out;
}

export function parseQuery(
    input: string,
    ctx: { projects: IProject[]; agents: IAgent[]; ownerName: string }
): ParsedQuery {
    if (!input.trim()) return { ok: true, errorMessage: null, filters: EMPTY_FILTERS };
    const tokens = tokenize(input);
    const filters: FilterState = {
        types: [],
        projectIds: [],
        agentIds: [],
        status: 'any',
        updated: 'any',
        labels: [],
        text: '',
    };

    let i = 0;
    while (i < tokens.length) {
        const fieldTok = tokens[i];
        if (!fieldTok) break;
        const field = fieldTok.value.toLowerCase() as QueryField;
        if (!QUERY_FIELDS.includes(field)) {
            // Treat unknown bare token as text search.
            filters.text = (filters.text ? `${filters.text} ` : '') + fieldTok.value;
            i += 1;
            continue;
        }
        const opTok = tokens[i + 1];
        const valTok = tokens[i + 2];
        if (!opTok || !valTok) {
            return { ok: false, errorMessage: `expected value after "${fieldTok.value}"`, filters };
        }
        const op = opTok.value;
        const value = valTok.value;
        if (op !== '=' && op !== '!=') {
            return {
                ok: false,
                errorMessage: `unsupported operator "${op}" for ${field}`,
                filters,
            };
        }

        switch (field) {
            case 'type': {
                const types = value.split(',').map((s) => s.trim().toLowerCase()) as SearchType[];
                for (const t of types) {
                    if (!(t in TYPE_LABEL)) {
                        return { ok: false, errorMessage: `unknown type "${t}"`, filters };
                    }
                }
                filters.types = types;
                break;
            }
            case 'project': {
                const match = ctx.projects.find(
                    (p) => p.name.toLowerCase() === value.toLowerCase() || p.id === value
                );
                if (!match)
                    return { ok: false, errorMessage: `unknown project "${value}"`, filters };
                filters.projectIds = [match.id];
                break;
            }
            case 'owner': {
                if (
                    value.toLowerCase() === 'me' ||
                    value.toLowerCase() === ctx.ownerName.toLowerCase()
                ) {
                    // Owner = no agent assigned (escalated to human).
                    filters.agentIds = [];
                    // Owner-bound items are those waiting on the owner — map
                    // to the canonical waiting_for_info status.
                    filters.status = 'waiting_for_info';
                } else {
                    const w = ctx.agents.find(
                        (x) => x.name.toLowerCase() === value.toLowerCase() || x.id === value
                    );
                    if (!w)
                        return { ok: false, errorMessage: `unknown agent "${value}"`, filters };
                    filters.agentIds = [w.id];
                }
                break;
            }
            case 'status': {
                // Accept canonical 6 values plus a few legacy aliases users
                // may still type ("ready for X" → ready, "in dev" → in_progress,
                // "in code review" → in_review, "waiting"/"waiting for owner"
                // → waiting_for_info).
                const v = value.toLowerCase().replace(/\s+/g, '_');
                if (v === 'draft') filters.status = 'draft';
                else if (
                    v === 'ready' ||
                    v === 'ready_for_po' ||
                    v === 'ready_for_spec' ||
                    v === 'ready_for_dev'
                )
                    filters.status = 'ready';
                else if (v === 'in_progress' || v === 'in_dev' || v === 'in_spec')
                    filters.status = 'in_progress';
                else if (v === 'in_review' || v === 'in_code_review')
                    filters.status = 'in_review';
                else if (
                    v === 'waiting_for_info' ||
                    v === 'waiting' ||
                    v === 'waiting_for_owner' ||
                    v === 'blocked'
                )
                    filters.status = 'waiting_for_info';
                else if (v === 'done') filters.status = 'done';
                else filters.status = 'any';
                break;
            }
            case 'updated': {
                const v = value.toLowerCase().replace(/\s+/g, '_');
                if (v.includes('today')) filters.updated = 'today';
                else if (v.includes('7')) filters.updated = 'last_7_days';
                else if (v.includes('30')) filters.updated = 'last_30_days';
                else if (v.includes('older')) filters.updated = 'older';
                break;
            }
        }

        i += 3;
        // Optional connector AND/OR
        const next = tokens[i];
        if (next && (next.value.toUpperCase() === 'AND' || next.value.toUpperCase() === 'OR')) {
            i += 1;
        }
    }

    return { ok: true, errorMessage: null, filters };
}

export interface SyntaxToken {
    text: string;
    kind: 'field' | 'op' | 'value' | 'value-string' | 'connector' | 'unknown' | 'space';
}

const CONNECTORS = new Set(['AND', 'OR']);

export function highlightQuery(input: string): SyntaxToken[] {
    const out: SyntaxToken[] = [];
    const re = /("[^"]*"|'[^']*'|[A-Za-z_]+|\d+|[<>!=]=?|,|\s+|\S)/g;
    let m: RegExpExecArray | null;
    let expectValue = false;
    while ((m = re.exec(input)) !== null) {
        const t = m[1] ?? '';
        if (!t) continue;
        if (/^\s+$/.test(t)) {
            out.push({ text: t, kind: 'space' });
            continue;
        }
        if (
            t === '=' ||
            t === '!=' ||
            t === '>' ||
            t === '<' ||
            t === '>=' ||
            t === '<=' ||
            t === ','
        ) {
            out.push({ text: t, kind: 'op' });
            if (t === '=' || t === '!=' || t === '>' || t === '<' || t === '>=' || t === '<=')
                expectValue = true;
            continue;
        }
        if (CONNECTORS.has(t.toUpperCase())) {
            out.push({ text: t, kind: 'connector' });
            expectValue = false;
            continue;
        }
        if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
            out.push({ text: t, kind: 'value-string' });
            expectValue = false;
            continue;
        }
        if (expectValue) {
            out.push({ text: t, kind: 'value' });
            expectValue = false;
            continue;
        }
        if (QUERY_FIELDS.includes(t.toLowerCase() as QueryField)) {
            out.push({ text: t, kind: 'field' });
            continue;
        }
        out.push({ text: t, kind: 'unknown' });
    }
    return out;
}

export function autocompleteSuggestions(
    query: string,
    ctx: { projects: IProject[]; agents: IAgent[] }
): Array<{ kind: 'value' | 'field' | 'op'; text: string; note?: string }> {
    const trimmed = query.trim();
    if (!trimmed) {
        return QUERY_FIELDS.map((f) => ({ kind: 'field', text: f, note: '' }));
    }
    // Look at last few chars to guess context.
    const lastEq = /=\s*"?([^"]*)$/.exec(query);
    const fieldMatch = /([A-Za-z_]+)\s*=\s*"?([^"]*)$/.exec(query);
    if (fieldMatch) {
        const field = fieldMatch[1]?.toLowerCase();
        const partial = (fieldMatch[2] ?? '').toLowerCase();
        if (field === 'status') {
            const opts = ['Draft', 'Ready', 'In Progress', 'Waiting for Info', 'In Review', 'Done'];
            return opts
                .filter((o) => o.toLowerCase().includes(partial))
                .map((o) => ({ kind: 'value', text: `"${o}"`, note: statusNote(o) }));
        }
        if (field === 'project') {
            return ctx.projects
                .filter((p) => p.name.toLowerCase().includes(partial))
                .slice(0, 6)
                .map((p) => ({
                    kind: 'value',
                    text: `"${p.name}"`,
                    note: p.description?.slice(0, 60) ?? '',
                }));
        }
        if (field === 'owner') {
            const w = ctx.agents
                .filter((x) => x.name.toLowerCase().includes(partial))
                .slice(0, 6)
                .map((x) => ({
                    kind: 'value' as const,
                    text: `"${x.name}"`,
                    note: '',
                }));
            if ('me'.includes(partial)) w.unshift({ kind: 'value', text: 'me', note: 'the owner' });
            return w;
        }
        if (field === 'type') {
            return Object.keys(TYPE_LABEL)
                .filter((t) => t.includes(partial))
                .map((t) => ({ kind: 'value', text: `"${t}"`, note: TYPE_LABEL[t as SearchType] }));
        }
        if (field === 'updated') {
            return ['today', 'last 7 days', 'last 30 days', 'older']
                .filter((o) => o.includes(partial))
                .map((o) => ({ kind: 'value', text: `"${o}"`, note: '' }));
        }
    }
    if (lastEq) {
        return [];
    }
    // Suggest fields whose prefix matches the current word.
    const lastWord = /([A-Za-z_]+)$/.exec(trimmed);
    const prefix = lastWord?.[1]?.toLowerCase() ?? '';
    return QUERY_FIELDS.filter((f) => f.startsWith(prefix)).map((f) => ({
        kind: 'field',
        text: f,
        note: '',
    }));
}

function statusNote(label: string): string {
    if (/Draft/i.test(label)) return 'created, requirements not yet shaped';
    if (/^Ready$/i.test(label)) return 'shaped and queued, awaiting pickup';
    if (/In Progress/i.test(label)) return 'a agent is actively on it';
    if (/Waiting for Info/i.test(label)) return 'owner needs to reply';
    if (/In Review/i.test(label)) return 'agent finished, owner reviewing';
    if (/Done/i.test(label)) return 'approved and complete';
    return '';
}

export interface ExampleQuery {
    query: string;
    description: string;
}

// ----------------------------------------------------------------------------
// P14 — server-side FTS bridge.
// ----------------------------------------------------------------------------

// Item types the server FTS index covers (everything except `prompt`,
// which lives on the agents table and is filtered client-side).
const SERVER_ITEM_TYPES: ReadonlyArray<SearchType> = [
    'epic',
    'story',
    'sub_task',
    'sub_bug',
    'bug',
];

export interface ServerSearchArgs {
    q?: string;
    type?: Array<'epic' | 'story' | 'sub_task' | 'sub_bug' | 'bug'>;
    project_id?: string[];
    agent_id?: string[];
    status?: IssueStatus;
    updated?: 'today' | 'last_7_days' | 'last_30_days' | 'older';
    /** Task 2 — list of required labels. */
    labels?: string[];
}

/**
 * Translate the in-page FilterState into the args that `useSearch` expects.
 * The conversion drops the `prompt` type from the server payload because
 * prompts aren't indexed in the items FTS — the page recombines them from
 * the local agents list.
 */
export function filtersToServerArgs(f: FilterState): ServerSearchArgs {
    const args: ServerSearchArgs = {};
    if (f.text.trim().length >= 2) args.q = f.text.trim();
    const serverTypes = f.types.filter(
        (t): t is 'epic' | 'story' | 'sub_task' | 'sub_bug' | 'bug' =>
            t !== 'prompt' && SERVER_ITEM_TYPES.includes(t),
    );
    if (serverTypes.length > 0) args.type = serverTypes;
    if (f.projectIds.length > 0) args.project_id = f.projectIds;
    if (f.agentIds.length > 0) args.agent_id = f.agentIds;
    if (f.status !== 'any') args.status = f.status;
    if (f.updated !== 'any') args.updated = f.updated;
    if (f.labels.length > 0) args.labels = f.labels;
    return args;
}

/**
 * True when the current filters request prompts (either explicitly via
 * `types: ['prompt', ...]` or implicitly via "all types"). Used by the
 * page to decide whether to mix the local prompt corpus into the
 * server results.
 */
export function filtersIncludePrompts(f: FilterState): boolean {
    if (f.types.length === 0) return true;
    return f.types.includes('prompt');
}

/** Project a server `/api/search` row to the renderer's `SearchHit`. */
export function serverRowToHit(row: SearchHitRow): SearchHit {
    return {
        type: row.issue_type as SearchType,
        id: row.issue_id,
        displayId: row.issue_id,
        title: row.title,
        description: row.description,
        status: row.status,
        assignee_agent_id: row.assignee_agent_id,
        project_id: row.project_id,
        updated_at: row.updated_at,
    };
}

/**
 * Build prompt hits from the agents list and apply the in-page filters
 * to them. Agents aren't part of the items FTS so this stays
 * client-side, but we use the same filter knobs so the UX is uniform.
 */
export function promptHits(agents: IAgent[], f: FilterState): SearchHit[] {
    if (!filtersIncludePrompts(f)) return [];
    // Prompts have no project / status pillars in the same shape as items;
    // applying a project filter or non-`any` status removes them.
    if (f.projectIds.length > 0) return [];
    if (f.status !== 'any') return [];

    const text = f.text.trim().toLowerCase();
    const out: SearchHit[] = [];
    for (const w of agents) {
        if (f.agentIds.length > 0 && !f.agentIds.includes(w.id)) continue;
        const slug = w.id
            .replace(/^agent-/, '')
            .replace(/-/g, '_')
            .slice(0, 3)
            .toUpperCase();
        const description = (w.prompt_md ?? '')
            .split('\n')
            .filter(Boolean)
            .slice(0, 2)
            .join(' ')
            .slice(0, 200);
        const hit: SearchHit = {
            type: 'prompt',
            id: w.id,
            displayId: `PRM-${slug}-v${w.prompt_version}`,
            title: `${w.name} · v${w.prompt_version}`,
            description,
            status: w.status === 'active' ? 'draft' : 'inactive',
            assignee_agent_id: w.id,
            project_id: null,
            updated_at: w.updated_at,
            prompt_version: w.prompt_version,
        };
        if (!inRange(hit.updated_at, f.updated)) continue;
        if (text) {
            const hay = `${hit.title} ${hit.description} ${hit.displayId}`.toLowerCase();
            if (!hay.includes(text)) continue;
        }
        out.push(hit);
    }
    return out;
}

export const EXAMPLE_QUERIES: ExampleQuery[] = [
    {
        query: 'status = "Ready"',
        description: 'items shaped and waiting for a agent to pick them up',
    },
    { query: 'owner = me', description: 'items assigned to you (the Owner)' },
    {
        query: 'owner = "Coder" AND project = acme-billing AND status = "In Progress"',
        description: 'what Coder is shipping in acme-billing',
    },
];
