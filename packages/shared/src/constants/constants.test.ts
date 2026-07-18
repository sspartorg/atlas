import { describe, it, expect } from 'vitest';
import {
    AGENT_ACCENT_COLORS,
    AGENT_CATEGORIES,
    AGENT_CATEGORY_LABELS,
    BRAND_SECONDARY_ACCENTS,
    GUARDRAIL_CATEGORIES,
    GUARDRAIL_CATEGORY_META,
    GUARDRAIL_SEVERITIES,
    GUARDRAIL_SEVERITY_META,
    ISSUE_STATUSES,
    ISSUE_TYPES,
    NOTIFICATION_KIND_LABELS,
    NOTIFICATION_KINDS,
    RUNNABLE_ISSUE_TYPES,
    STATUS_LABELS,
    SDLC_ROLE_DEFAULT_STATUS,
    SDLC_ROLE_LABELS,
    SUB_TASK_STATUSES,
    SUB_TASK_STATUS_LABELS,
    NOTIFICATION_DELIVERY_STATUSES,
} from './index.js';
import { SDLC_ROLES } from '../types/index.js';

// These tests are intentionally light: the constants file has no branching
// logic beyond the RUNNABLE_ISSUE_TYPES filter, so the assertions below are
// shape contracts other packages can rely on (e.g. iterating `ISSUE_STATUSES`
// to render a status picker). They also drive the import that makes v8
// count the file's top-level declarations as executed.

describe('issue status enums', () => {
    it('ISSUE_STATUSES is the canonical 6-status order', () => {
        expect(ISSUE_STATUSES).toEqual([
            'draft',
            'ready',
            'in_progress',
            'waiting_for_info',
            'in_review',
            'done',
        ]);
    });

    it('SUB_TASK_STATUSES is an alias of ISSUE_STATUSES', () => {
        expect(SUB_TASK_STATUSES).toBe(ISSUE_STATUSES);
    });

    it('STATUS_LABELS keys cover every status', () => {
        expect(Object.keys(STATUS_LABELS).sort()).toEqual([...ISSUE_STATUSES].sort());
    });

    it('SUB_TASK_STATUS_LABELS aliases STATUS_LABELS', () => {
        expect(SUB_TASK_STATUS_LABELS).toBe(STATUS_LABELS);
    });
});

describe('issue type enums', () => {
    it('ISSUE_TYPES enumerates all five entity kinds', () => {
        expect(ISSUE_TYPES).toEqual(['epic', 'story', 'sub_task', 'sub_bug', 'bug']);
    });

    it('RUNNABLE_ISSUE_TYPES excludes sub_task and sub_bug', () => {
        expect(RUNNABLE_ISSUE_TYPES).toEqual(['epic', 'story', 'bug']);
    });

    it('RUNNABLE_ISSUE_TYPES is a subset of ISSUE_TYPES', () => {
        for (const t of RUNNABLE_ISSUE_TYPES) {
            expect(ISSUE_TYPES).toContain(t);
        }
    });
});

describe('agent enums', () => {
    it('AGENT_CATEGORIES has 4 entries in display order', () => {
        expect(AGENT_CATEGORIES).toEqual(['software-dev', 'marketing', 'content', 'design']);
    });

    it('AGENT_CATEGORY_LABELS has a label for every category', () => {
        for (const cat of AGENT_CATEGORIES) {
            expect(typeof AGENT_CATEGORY_LABELS[cat]).toBe('string');
            expect(AGENT_CATEGORY_LABELS[cat]).not.toBe('');
        }
    });

    it('AGENT_ACCENT_COLORS values are 7-char hex strings', () => {
        const hexRe = /^#[0-9A-Fa-f]{6}$/;
        for (const hex of Object.values(AGENT_ACCENT_COLORS)) {
            expect(hex).toMatch(hexRe);
        }
    });

    it('AGENT_ACCENT_COLORS has one entry per default-seeded agent role', () => {
        expect(Object.keys(AGENT_ACCENT_COLORS)).toEqual([
            'PO_WRITER',
            'SPEC_WRITER',
            'CODER',
            'QA_WRITER',
            'DIGITAL_MARKETER',
            'SEO_EXPERT',
            'TECH_WRITER',
            'API_DOCS_WRITER',
            'UX_DESIGNER',
            'WIREFRAMER',
        ]);
    });
});

describe('brand accent palette', () => {
    it('BRAND_SECONDARY_ACCENTS are 7 valid hex swatches', () => {
        expect(BRAND_SECONDARY_ACCENTS).toHaveLength(7);
        const hexRe = /^#[0-9A-Fa-f]{6}$/;
        for (const swatch of BRAND_SECONDARY_ACCENTS) {
            expect(swatch.hex).toMatch(hexRe);
            expect(swatch.name).not.toBe('');
        }
    });

    it('BRAND_SECONDARY_ACCENTS excludes the indigo primary (#4F46E5) and success green (#46A56A)', () => {
        // The constants file's comment reserves these two for primary UI / success.
        // Any accent-picker UI iterates this array, so the exclusion must hold.
        const reserved = ['#4F46E5', '#46A56A'];
        for (const swatch of BRAND_SECONDARY_ACCENTS) {
            expect(reserved).not.toContain(swatch.hex);
        }
    });
});

describe('guardrails', () => {
    it('GUARDRAIL_CATEGORIES has the 5 fixed categories', () => {
        expect(GUARDRAIL_CATEGORIES).toEqual([
            'file_system',
            'secrets_credentials',
            'git_branches',
            'side_effects_network',
            'escalation_scope',
        ]);
    });

    it('GUARDRAIL_CATEGORY_META has shape entry for every category', () => {
        for (const cat of GUARDRAIL_CATEGORIES) {
            const meta = GUARDRAIL_CATEGORY_META[cat];
            expect(meta.label).not.toBe('');
            expect(meta.icon).not.toBe('');
            expect(meta.sub).not.toBe('');
        }
    });

    it('GUARDRAIL_SEVERITIES has the 3 enforcement levels', () => {
        expect(GUARDRAIL_SEVERITIES).toEqual(['block', 'ask_owner', 'warn']);
    });

    it('GUARDRAIL_SEVERITY_META has shape entry for every severity', () => {
        for (const sev of GUARDRAIL_SEVERITIES) {
            const meta = GUARDRAIL_SEVERITY_META[sev];
            expect(meta.label).not.toBe('');
            expect(meta.shortLabel).not.toBe('');
            expect(meta.description).not.toBe('');
        }
    });
});

describe('A08 — SDLC role catalog', () => {
    it('SDLC_ROLES has the 10 canonical roles in catalog order', () => {
        expect(SDLC_ROLES).toEqual([
            'po',
            'spec-writer',
            'engineer',
            'qa',
            'architect',
            'tester',
            'automation',
            'devops',
            'security',
            'designer',
        ]);
    });

    it('SDLC_ROLE_LABELS has a non-empty label for every role', () => {
        for (const role of SDLC_ROLES) {
            expect(typeof SDLC_ROLE_LABELS[role]).toBe('string');
            expect(SDLC_ROLE_LABELS[role]).not.toBe('');
        }
    });

    it('SDLC_ROLE_DEFAULT_STATUS marks only po/spec-writer/engineer/qa as active', () => {
        const active = SDLC_ROLES.filter((r) => SDLC_ROLE_DEFAULT_STATUS[r] === 'active');
        // Mirror of `roles.default_status` seeded in migration 025 — these are
        // the SDLC chain roles that ship enabled on a fresh install.
        expect(active.sort()).toEqual(['engineer', 'po', 'qa', 'spec-writer']);
    });

    it('SDLC_ROLE_DEFAULT_STATUS has an entry for every role', () => {
        expect(Object.keys(SDLC_ROLE_DEFAULT_STATUS).sort()).toEqual([...SDLC_ROLES].sort());
    });
});

describe('notifications', () => {
    it('NOTIFICATION_KINDS enumerates the 3 inbox buckets', () => {
        expect(NOTIFICATION_KINDS).toEqual(['needs_you', 'update', 'system']);
    });

    it('NOTIFICATION_KIND_LABELS has a label per kind', () => {
        for (const kind of NOTIFICATION_KINDS) {
            expect(NOTIFICATION_KIND_LABELS[kind]).not.toBe('');
        }
    });

    it('NOTIFICATION_DELIVERY_STATUSES enumerates the 4 delivery states', () => {
        expect(NOTIFICATION_DELIVERY_STATUSES).toEqual(['none', 'pending', 'sent', 'failed']);
    });
});
