import type {
    IssueStatus,
    SubTaskStatus,
    IssueType,
    AgentCategory,
    GuardrailCategory,
    GuardrailSeverity,
    NotificationKind,
    NotificationDeliveryStatus,
    PushDeliveryStatus,
    SdlcRole,
    AgentStatus,
} from '../types/index.js';

export const ISSUE_STATUSES: IssueStatus[] = [
    'draft',
    'ready',
    'in_progress',
    'waiting_for_info',
    'in_review',
    'done',
];

// Sub-tasks share the unified set; this alias is kept for back-compat.
export const SUB_TASK_STATUSES: SubTaskStatus[] = ISSUE_STATUSES;

export const ISSUE_TYPES: IssueType[] = ['epic', 'story', 'sub_task', 'sub_bug', 'bug'];

// Top-level issue types that a agent run can target. Sub-tasks and sub-bugs
// are always driven through their parent story, never run directly.
export const RUNNABLE_ISSUE_TYPES: IssueType[] = ISSUE_TYPES.filter(
    (t) => t !== 'sub_task' && t !== 'sub_bug'
);

export const AGENT_CATEGORIES: AgentCategory[] = [
    'software-dev',
    'marketing',
    'content',
    'design',
];

export const AGENT_CATEGORY_LABELS: Record<AgentCategory, string> = {
    'software-dev': 'Software Dev',
    marketing: 'Marketing',
    content: 'Content',
    design: 'Design',
};

// A08 — Canonical SDLC role labels for chips, filters, and AgentCard
// subtitles. Add a role here only after extending `SdlcRole` and seeding
// the row in migration 025 (roles table). The UI never derives a label
// from the slug — always read from this map.
export const SDLC_ROLE_LABELS: Record<SdlcRole, string> = {
    po: 'Product Owner',
    'spec-writer': 'Specification Writer',
    engineer: 'Engineer',
    qa: 'Quality Assurance',
    architect: 'Software Architect',
    tester: 'Exploratory Tester',
    automation: 'Automation Engineer',
    devops: 'DevOps Engineer',
    security: 'Security Review Lead',
    designer: 'UX/Visual Designer',
};

// A08 — Default activation policy. Engineer + the three engineering-
// adjacent roles (PO Writer, Spec Writer, QA Writer) ship `active` so
// the SDLC chain keeps running on fresh installs. Everything else ships
// `inactive`: the Owner must explicitly enable before the scheduler will
// dispatch. Mirrors `default_status` on the `roles` table — keep in sync.
export const SDLC_ROLE_DEFAULT_STATUS: Record<SdlcRole, AgentStatus> = {
    po: 'active',
    'spec-writer': 'active',
    engineer: 'active',
    qa: 'active',
    architect: 'inactive',
    tester: 'inactive',
    automation: 'inactive',
    devops: 'inactive',
    security: 'inactive',
    designer: 'inactive',
};

export const STATUS_LABELS: Record<IssueStatus, string> = {
    draft: 'Draft',
    ready: 'Ready',
    in_progress: 'In Progress',
    waiting_for_info: 'Waiting for Info',
    in_review: 'In Review',
    done: 'Done',
};

// Sub-tasks share the unified label map.
export const SUB_TASK_STATUS_LABELS: Record<SubTaskStatus, string> = STATUS_LABELS;

// Canonical accent-picker swatches (Atlas brand palette).
// The indigo primary (#4F46E5) and success green (#46A56A) are RESERVED for
// primary UI / success and must NOT appear in any accent picker. Use this
// constant everywhere a user picks an accent — owner accent, agent accent,
// anything else — so the swatch set can't drift.
export const BRAND_SECONDARY_ACCENTS: ReadonlyArray<{ hex: string; name: string }> = [
    { hex: '#7C3AED', name: 'Violet' },
    { hex: '#0EA5E9', name: 'Sky' },
    { hex: '#14B8A6', name: 'Teal' },
    { hex: '#F59E0B', name: 'Amber' },
    { hex: '#F43F5E', name: 'Rose' },
    { hex: '#D946EF', name: 'Fuchsia' },
    { hex: '#64748B', name: 'Slate' },
];

// ---- Guardrails ---------------------------------------------------------

export const GUARDRAIL_CATEGORIES: GuardrailCategory[] = [
    'file_system',
    'secrets_credentials',
    'git_branches',
    'side_effects_network',
    'escalation_scope',
];

export interface GuardrailCategoryMeta {
    label: string;
    icon: string; // Material symbols ligature
    sub: string;
}

// Display metadata for the 5 fixed categories. Order here is the order shown
// on the Guard-rails page (top-to-bottom).
export const GUARDRAIL_CATEGORY_META: Record<GuardrailCategory, GuardrailCategoryMeta> = {
    file_system: {
        label: 'File System',
        icon: 'folder',
        sub: 'What agents may read, write, and delete',
    },
    secrets_credentials: {
        label: 'Secrets & Credentials',
        icon: 'key',
        sub: 'Anything matching a secret or credential pattern',
    },
    git_branches: {
        label: 'Git & Branches',
        icon: 'fork_right',
        sub: 'Branching, history, and push behavior',
    },
    side_effects_network: {
        label: 'Side Effects & Network',
        icon: 'cloud',
        sub: 'Outbound calls, daemons, and external state',
    },
    escalation_scope: {
        label: 'Escalation & Scope',
        icon: 'flag',
        sub: 'When agents stop and ask the Owner',
    },
};

export const GUARDRAIL_SEVERITIES: GuardrailSeverity[] = ['block', 'ask_owner', 'warn'];

export interface GuardrailSeverityMeta {
    label: string;
    shortLabel: string;
    description: string;
}

export const GUARDRAIL_SEVERITY_META: Record<GuardrailSeverity, GuardrailSeverityMeta> = {
    block: { label: 'BLOCK', shortLabel: 'Block', description: 'Hard stop; routes to Owner.' },
    ask_owner: {
        label: 'ASK OWNER',
        shortLabel: 'Ask Owner',
        description: 'Agent pauses, awaits reply.',
    },
    warn: { label: 'WARN', shortLabel: 'Warn', description: 'Recorded on run; continues.' },
};

// ---- Notifications ------------------------------------------------------

export const NOTIFICATION_KINDS: NotificationKind[] = ['needs_you', 'update', 'system'];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
    needs_you: 'Needs You',
    update: 'Updates',
    system: 'System',
};

export const NOTIFICATION_DELIVERY_STATUSES: NotificationDeliveryStatus[] = [
    'none',
    'pending',
    'sent',
    'failed',
];

export const PUSH_DELIVERY_STATUSES: PushDeliveryStatus[] = [
    'none',
    'pending',
    'sent',
    'failed',
];

// ---- Terminal -----------------------------------------------------------

// The one terminal grid size, everywhere, forever. The PTY spawns at this
// size, the server-side headless mirror parses at this size, and every
// browser pane renders exactly this grid (scaling FONT SIZE to fit, never
// the grid). Pinning the geometry is the fix for the ConPTY "zombie
// character" corruption: any moment where the PTY's believed width and a
// viewer's rendered width differ strands unerased cells, and with one PTY
// and N viewers a dynamic geometry can never be mismatch-free. Do not add
// a resize path — see packages/api/src/services/cli-session-host.ts.
export const TERMINAL_COLS = 120;
export const TERMINAL_ROWS = 30;

// Agent accent colors from the Atlas design system
export const AGENT_ACCENT_COLORS = {
    PO_WRITER: '#007AC9',
    SPEC_WRITER: '#00B4D8',
    CODER: '#7C3AED',
    QA_WRITER: '#059669',
    DIGITAL_MARKETER: '#D97706',
    SEO_EXPERT: '#DC2626',
    TECH_WRITER: '#0891B2',
    API_DOCS_WRITER: '#6D28D9',
    UX_DESIGNER: '#DB2777',
    WIREFRAMER: '#B45309',
} as const;
