import type { IAgent, IAgentRun, AgentCategory } from '@atlas/shared';
import { SDLC_ROLE_LABELS } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { AgentStatusLabel } from '../queue/queueViewModel.js';

export interface AgentView {
    slug: string;
    glyph: string;
    description: string;
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
}

const SEED_VIEW: Record<string, SeedView> = {
    'agent-po-writer': {
        glyph: 'developer_board',
        description:
            'Reads an Epic and produces structured Stories with optional Sub-tasks. Runs the 7-check rubric. Escalates to the Owner when grounding is insufficient.',
    },
    'agent-spec-writer': {
        glyph: 'task_alt',
        description:
            'Drafts implementation specs on a feature branch. Surfaces open questions before code starts.',
    },
    'agent-coder': {
        glyph: 'terminal',
        description:
            'Implements specs end-to-end. Opens PRs, runs tests, follows handoff rules into review.',
    },
    'agent-qa-writer': {
        glyph: 'verified',
        description:
            'Writes acceptance and regression tests. Reports gaps back to Coder before shipping.',
    },
    'agent-digital-marketer': {
        glyph: 'campaign',
        description:
            'Drafts launch posts, threads, and newsletter copy. Lands files in marketing/.',
    },
    'agent-seo-expert': {
        glyph: 'travel_explore',
        description:
            'Audits content for keyword density, schema, and link health. Outputs a delta report.',
    },
    'agent-tech-writer': {
        glyph: 'edit_note',
        description:
            'Turns shipped features into developer-facing docs. Cross-links to API reference.',
    },
    'agent-api-docs-writer': {
        glyph: 'api',
        description:
            'Keeps the OpenAPI spec in sync with implementation. Generates changelog entries.',
    },
    'agent-ux-designer': {
        glyph: 'palette',
        description:
            'Designs UI states and component specs. Flags accessibility gaps before handoff.',
    },
    'agent-wireframer': {
        glyph: 'dashboard_customize',
        description:
            'Sketches low-fidelity layouts before full design. Surfaces unclear flows early.',
    },
};

export function getAgentView(agent: IAgent): AgentView {
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
    const description = agent.description?.trim()
        ? agent.description
        : (seed?.description ?? fallbackDescription);

    return {
        slug: agent.id.replace(/^agent-/, ''),
        glyph,
        description,
    };
}

export { relativeTime } from '../../utils/time.js';

export interface AgentRuntimeStats {
    /** Runs actually in flight. Split out from queued runs so the status
     *  label can tell "running" from "waiting to run"; conflating them is
     *  what made AgentCard / AgentHero report the two states inverted. */
    runningCount: number;
    /** Runs waiting to start. */
    queuedCount: number;
    /** True when the most recent TERMINAL run ended in `error`. Distinct from
     *  the `runtimeError` prop on AgentCard, which means "the runs query
     *  failed to load" — feeding that into the status label made the Agents
     *  grid disagree with the Queue page for the same agent. */
    lastRunErrored: boolean;
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
        return {
            runningCount: 0,
            queuedCount: 0,
            lastRunErrored: false,
            lastRunAt: null,
            totalRunsThisMonth: 0,
            p50DurationSec: null,
            totalCostThisMonthUsd: null,
            totalInputTokens: null,
            totalOutputTokens: null,
            totalCacheReadTokens: null,
        };
    }
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let runningCount = 0;
    let queuedCount = 0;
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
        if (r.status === 'in_progress') runningCount += 1;
        if (r.status === 'queued') queuedCount += 1;
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
            if (r.input_tokens != null) {
                inputTokens += r.input_tokens;
                hasTokens = true;
            }
            if (r.output_tokens != null) {
                outputTokens += r.output_tokens;
                hasTokens = true;
            }
            if (r.cache_read_tokens != null) {
                cacheReadTokens += r.cache_read_tokens;
                hasTokens = true;
            }
        }
        if (r.started_at && r.completed_at) {
            const dur = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
            if (dur > 0) durations.push(dur);
        }
    }
    durations.sort((a, b) => a - b);
    const midDur = durations[Math.floor(durations.length / 2)];
    const p50 = midDur != null ? midDur / 1000 : null;
    // Most recent terminal run decides the Failed state — same rule as
    // queueViewModel's `lastRunErrored(summary.lastRun)`.
    const terminal = runs
        .filter((r) => r.status === 'completed' || r.status === 'error')
        .sort((a, b) =>
            (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at)
        );
    const lastRunErrored = terminal[0]?.status === 'error';

    return {
        runningCount,
        queuedCount,
        lastRunErrored,
        lastRunAt,
        totalRunsThisMonth: countMonth,
        p50DurationSec: p50,
        totalCostThisMonthUsd: hasCostMonth ? costMonth : null,
        totalInputTokens: hasTokens ? inputTokens : null,
        totalOutputTokens: hasTokens ? outputTokens : null,
        totalCacheReadTokens: hasTokens ? cacheReadTokens : null,
    };
}

// Mercury collapses brand-hue slots (`green`, `gold`) to neutral accent, so
// the live-state indicator uses the functional success/warning/error slots.
export function agentStatusColor(label: AgentStatusLabel): string {
    if (label === 'Paused') return ATLAS_PALETTE.slate60;
    if (label === 'Failed') return ATLAS_PALETTE.error;
    if (label === 'Queued') return ATLAS_PALETTE.warning;
    return ATLAS_PALETTE.success;
}
