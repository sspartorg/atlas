import { Cron } from 'croner';
import type { IAgent, IAgentRun, AgentCategory, AgentSchedulePreset } from '@atlas/shared';
import { SDLC_ROLE_LABELS } from '@atlas/shared';

// 'cron' is a UI-only preset id; the persisted column stays `cron_expr`,
// and `schedule_preset` keeps its four canonical values. The picker uses
// the wider union internally to model the fifth card without touching
// shared types.
export type ScheduleDraftPreset = AgentSchedulePreset | 'cron';

export interface ScheduleDraft {
    preset: ScheduleDraftPreset;
    hours: number;
    timeOfDay: string; // HH:MM
    weekdays: number[]; // ISO 1..7
    dayOfMonth: number; // 1..31
    cronExpr: string;
}

/**
 * Public version of `computeNextSlotForAgent` for live UI previews —
 * accepts the picker's draft state directly so the "Next pass" line
 * updates as the user types, before saving.
 */
export function previewNextSlot(now: Date, draft: ScheduleDraft): Date {
    if (draft.preset === 'cron') {
        return computeNextSlotForAgent(
            now,
            { cron_expr: draft.cronExpr } as IAgent,
            draft.hours,
        );
    }
    return computeNextSlotForAgent(
        now,
        {
            schedule_preset: draft.preset,
            schedule_hours: draft.hours,
            schedule_time_of_day: draft.timeOfDay,
            schedule_weekdays: draft.weekdays,
            schedule_day_of_month: draft.dayOfMonth,
        } as IAgent,
        draft.hours,
    );
}

// True iff the string parses as a croner-compatible expression with at
// least one future fire. Used by the cron card to gate Save and by the
// next-slot fallback below to stay quiet on partial input as the user
// types.
export function isCronExpressionValid(expr: string): boolean {
    const trimmed = expr.trim();
    if (trimmed === '') return false;
    try {
        const cron = new Cron(trimmed, { paused: true });
        return cron.nextRun() !== null;
    } catch {
        return false;
    }
}


export interface AgentView {
    slug: string;
    glyph: string;
    description: string;
    cadenceHours: number;
    cadenceLabel: string;
    nextPassLabel: string;
    nextPassDelta: string;
    concurrentRuns: number;
    concurrentMax: number;
}

const CATEGORY_GLYPH: Record<AgentCategory, string> = {
    'software-dev': 'developer_board',
    marketing: 'campaign',
    content: 'edit_note',
    design: 'palette',
};

export const CATEGORY_LABEL: Record<AgentCategory, string> = {
    'software-dev': 'Software dev',
    marketing: 'Marketing',
    content: 'Content',
    design: 'Design',
};

// Subtitle rendered beneath an agent's name on cards / hero / popovers /
// queue headers. Resolution order: explicit `designation` (per-agent
// override) → `role_id` lookup against the SDLC role catalog (A08) →
// category label alone. The override-first order means the Owner can
// always rename an agent's role-display ("Senior Backend Engineer") via
// `designation` without re-pointing it at a different `role_id`.
export function agentSubtitle(agent: Pick<IAgent, 'designation' | 'category' | 'role_id'>): string {
    const category = CATEGORY_LABEL[agent.category];
    if (agent.designation) return `${agent.designation} · ${category}`;
    if (agent.role_id) return `${SDLC_ROLE_LABELS[agent.role_id]} · ${category}`;
    return category;
}

interface SeedView {
    glyph: string;
    description: string;
    cadenceHours: number;
    concurrentRuns: number;
    concurrentMax: number;
}

const SEED_VIEW: Record<string, SeedView> = {
    'agent-po-writer': {
        glyph: 'developer_board',
        description:
            'Reads an Epic and produces structured Stories with optional Sub-tasks. Runs the 7-check rubric. Escalates to the Owner when grounding is insufficient.',
        cadenceHours: 3,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-spec-writer': {
        glyph: 'task_alt',
        description:
            'Drafts implementation specs on a feature branch. Surfaces open questions before code starts.',
        cadenceHours: 2,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-coder': {
        glyph: 'terminal',
        description:
            'Implements specs end-to-end. Opens PRs, runs tests, follows handoff rules into review.',
        cadenceHours: 0.5,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-qa-writer': {
        glyph: 'verified',
        description:
            'Writes acceptance and regression tests. Reports gaps back to Coder before shipping.',
        cadenceHours: 1,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-digital-marketer': {
        glyph: 'campaign',
        description:
            'Drafts launch posts, threads, and newsletter copy. Lands files in marketing/.',
        cadenceHours: 6,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-seo-expert': {
        glyph: 'travel_explore',
        description:
            'Audits content for keyword density, schema, and link health. Outputs a delta report.',
        cadenceHours: 12,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-tech-writer': {
        glyph: 'edit_note',
        description:
            'Turns shipped features into developer-facing docs. Cross-links to API reference.',
        cadenceHours: 8,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-api-docs-writer': {
        glyph: 'api',
        description:
            'Keeps the OpenAPI spec in sync with implementation. Generates changelog entries.',
        cadenceHours: 8,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-ux-designer': {
        glyph: 'palette',
        description:
            'Designs UI states and component specs. Flags accessibility gaps before handoff.',
        cadenceHours: 24,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
    'agent-wireframer': {
        glyph: 'dashboard_customize',
        description:
            'Sketches low-fidelity layouts before full design. Surfaces unclear flows early.',
        cadenceHours: 24,
        concurrentRuns: 1,
        concurrentMax: 3,
    },
};

function formatCadence(hours: number): string {
    if (hours < 1) return `Every ${Math.round(hours * 60)}m`;
    if (hours < 24) return `Every ${hours}h`;
    const days = Math.round(hours / 24);
    return `Every ${days}d`;
}

// 24h HH:MM → 12h clock label (e.g. '09:00' → '9:00 AM', '17:30' → '5:30 PM').
function formatTimeOfDay12h(hhmm: string): string {
    const [hStr, mStr] = hhmm.split(':');
    const h = Number(hStr);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mStr} ${suffix}`;
}

const SHORT_WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // ISO 1..7

function formatWeekdays(iso: number[]): string {
    const sorted = [...iso].sort((a, b) => a - b);
    if (sorted.length === 7) return 'every day';
    if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return 'weekdays';
    if (sorted.length === 2 && sorted[0] === 6 && sorted[1] === 7) return 'weekends';
    return sorted.map((d) => SHORT_WEEKDAY[d]).join(', ');
}

function formatCadenceForAgent(agent: IAgent, fallbackHours: number): string {
    // cron_expr is an override: when non-empty it wins over the preset in
    // the scheduler (see agent-schedule-registry.ts). Mirror that here so
    // every card / hero / queue surface that reads `cadenceLabel` shows the
    // active cron instead of the dormant preset.
    const cronExpr = agent.cron_expr?.trim();
    if (cronExpr) return `Cron: ${cronExpr}`;
    const preset = agent.schedule_preset ?? 'every_n_hours';
    if (preset === 'every_n_hours') {
        return formatCadence(
            agent.schedule_hours && agent.schedule_hours > 0
                ? agent.schedule_hours
                : fallbackHours,
        );
    }
    const time = agent.schedule_time_of_day
        ? formatTimeOfDay12h(agent.schedule_time_of_day)
        : '—';
    if (preset === 'daily') return `Daily at ${time}`;
    if (preset === 'weekly') {
        const days = agent.schedule_weekdays?.length
            ? formatWeekdays(agent.schedule_weekdays)
            : '—';
        return `${time} on ${days}`;
    }
    // monthly
    const dom = agent.schedule_day_of_month ?? null;
    return dom ? `Monthly at ${time} on day ${dom}` : `Monthly at ${time}`;
}

function lastDayOfMonth(year: number, monthIdx: number): number {
    return new Date(year, monthIdx + 1, 0).getDate();
}

// Mirror of the server's `computeNextAgentSlot`. Returns the next strictly
// future fire in the browser's local timezone.
function computeNextSlotForAgent(now: Date, agent: IAgent, fallbackHours: number): Date {
    // cron_expr override — matches server precedence at
    // agent-schedule-registry.ts:212. We don't pull `settings.quiet_hours_timezone`
    // here (the browser doesn't have it); croner falls back to the local
    // zone which is what the rest of the UI shows anyway. If the
    // expression is unparseable or has no future fire, fall through to the
    // preset branch so the live preview stays quiet while the user types.
    const cronExpr = agent.cron_expr?.trim();
    if (cronExpr) {
        try {
            const cron = new Cron(cronExpr, { paused: true });
            const next = cron.nextRun(now);
            if (next) return next;
        } catch {
            // fall through
        }
    }
    const preset = agent.schedule_preset ?? 'every_n_hours';

    if (preset === 'every_n_hours') {
        const hours =
            agent.schedule_hours && agent.schedule_hours > 0
                ? agent.schedule_hours
                : fallbackHours;
        const cadenceMs = hours * 3_600_000;
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const elapsed = now.getTime() - startOfDay.getTime();
        let nextMs = startOfDay.getTime() + (Math.floor(elapsed / cadenceMs) + 1) * cadenceMs;
        if (nextMs <= now.getTime()) nextMs += cadenceMs;
        return new Date(nextMs);
    }

    const hhmm = agent.schedule_time_of_day ?? '09:00';
    const [hStr, mStr] = hhmm.split(':');
    const h = Number(hStr);
    const m = Number(mStr);

    if (preset === 'daily') {
        const c = new Date(now);
        c.setHours(h, m, 0, 0);
        if (c.getTime() <= now.getTime()) c.setDate(c.getDate() + 1);
        return c;
    }

    if (preset === 'weekly') {
        const days = agent.schedule_weekdays && agent.schedule_weekdays.length > 0
            ? new Set(agent.schedule_weekdays)
            : new Set<number>([1, 2, 3, 4, 5, 6, 7]);
        for (let offset = 0; offset < 8; offset++) {
            const c = new Date(now);
            c.setDate(c.getDate() + offset);
            c.setHours(h, m, 0, 0);
            const dow = c.getDay();
            const iso = dow === 0 ? 7 : dow;
            if (days.has(iso) && c.getTime() > now.getTime()) return c;
        }
        return new Date(now.getTime() + 7 * 86_400_000);
    }

    // monthly
    const dom = agent.schedule_day_of_month ?? 1;
    for (let off = 0; off < 13; off++) {
        const c = new Date(now.getFullYear(), now.getMonth() + off, 1, h, m, 0, 0);
        const last = lastDayOfMonth(c.getFullYear(), c.getMonth());
        c.setDate(Math.min(dom, last));
        if (c.getTime() > now.getTime()) return c;
    }
    return new Date(now.getTime() + 30 * 86_400_000);
}

export function formatNextPassDelta(ms: number): string {
    if (ms <= 0) return 'now';
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h < 24) return rem > 0 ? `in ${h}h ${rem}m` : `in ${h}h`;
    return `in ${Math.floor(h / 24)}d`;
}

function formatNextPassClock(when: Date): string {
    const hh = when.getHours().toString().padStart(2, '0');
    const mm = when.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
}

export function getAgentView(agent: IAgent, now: Date = new Date()): AgentView {
    const seed = SEED_VIEW[agent.id];
    const fallbackDescription =
        agent.prompt_md
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('```')) ??
        'Custom agent.';
    const glyph = agent.glyph?.trim()
        ? agent.glyph
        : (seed?.glyph ?? CATEGORY_GLYPH[agent.category]);
    // Persisted fields win; seed values are the migration-time defaults and
    // only stand in if the agent row is somehow missing them.
    const cadenceHours =
        agent.schedule_hours && agent.schedule_hours > 0
            ? agent.schedule_hours
            : (seed?.cadenceHours ?? 6);
    const description = agent.description?.trim()
        ? agent.description
        : (seed?.description ?? fallbackDescription);
    const concurrentRunsValue =
        agent.concurrent_runs && agent.concurrent_runs > 0
            ? agent.concurrent_runs
            : (seed?.concurrentRuns ?? 1);

    // Next strictly-future slot from now — anchored in the browser's
    // local timezone, dispatched on the agent's preset (every_n_hours,
    // daily, weekly, monthly). Matches the server's `computeNextAgentSlot`.
    //
    // We intentionally do NOT read `agent.next_run_at`: the server holds
    // that value in the past while an agent's queue is empty (the agent
    // is "due as soon as items arrive"). That's the right scheduling
    // primitive but the wrong thing to display — it would render as "now"
    // for every idle agent. The user-facing value is always the next
    // natural slot, which is also the latest the agent could conceivably
    // wait before checking.
    const nextPass = computeNextSlotForAgent(now, agent, cadenceHours);

    return {
        slug: agent.id.replace(/^agent-/, ''),
        glyph,
        description,
        cadenceHours,
        cadenceLabel: formatCadenceForAgent(agent, cadenceHours),
        nextPassLabel: formatNextPassClock(nextPass),
        nextPassDelta: formatNextPassDelta(nextPass.getTime() - now.getTime()),
        concurrentRuns: concurrentRunsValue,
        concurrentMax: seed?.concurrentMax ?? 3,
    };
}

export { relativeTime } from '../../utils/time.js';

export interface AgentRuntimeStats {
    queueDepth: number;
    lastRunAt: string | null;
    totalRunsThisMonth: number;
    p50DurationSec: number | null;
    totalCostThisMonthUsd: number | null;
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    totalCacheReadTokens: number | null;
}

export function getRuntimeStats(runs: readonly IAgentRun[] | undefined): AgentRuntimeStats {
    if (!runs || runs.length === 0) {
        return { queueDepth: 0, lastRunAt: null, totalRunsThisMonth: 0, p50DurationSec: null, totalCostThisMonthUsd: null, totalInputTokens: null, totalOutputTokens: null, totalCacheReadTokens: null };
    }
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let queueDepth = 0;
    let lastRunAt: string | null = null;
    let lastRunMs = -Infinity;
    const durations: number[] = [];
    let countMonth = 0;
    let costMonth = 0;
    let hasCostMonth = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let hasTokens = false;
    for (const r of runs) {
        if (r.status === 'queued' || r.status === 'in_progress') queueDepth += 1;
        const createdMs = new Date(r.created_at).getTime();
        if (createdMs > lastRunMs) {
            lastRunMs = createdMs;
            lastRunAt = r.created_at;
        }
        if (createdMs >= cutoff) {
            countMonth += 1;
            if (r.total_cost_usd != null) {
                costMonth += r.total_cost_usd;
                hasCostMonth = true;
            }
            if (r.input_tokens != null) { inputTokens += r.input_tokens; hasTokens = true; }
            if (r.output_tokens != null) { outputTokens += r.output_tokens; hasTokens = true; }
            if (r.cache_read_tokens != null) { cacheReadTokens += r.cache_read_tokens; hasTokens = true; }
        }
        if (r.started_at && r.completed_at) {
            const dur = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
            if (dur > 0) durations.push(dur);
        }
    }
    durations.sort((a, b) => a - b);
    const midDur = durations[Math.floor(durations.length / 2)];
    const p50 = midDur != null ? midDur / 1000 : null;
    return {
        queueDepth,
        lastRunAt,
        totalRunsThisMonth: countMonth,
        p50DurationSec: p50,
        totalCostThisMonthUsd: hasCostMonth ? costMonth : null,
        totalInputTokens: hasTokens ? inputTokens : null,
        totalOutputTokens: hasTokens ? outputTokens : null,
        totalCacheReadTokens: hasTokens ? cacheReadTokens : null,
    };
}
