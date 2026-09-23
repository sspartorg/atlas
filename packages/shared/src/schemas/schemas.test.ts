import { describe, it, expect } from 'vitest';
import {
    CreateJiraSourceSchema,
    UpdateExternalNotificationSchema,
    UpdateJiraConfigSchema,
    UpdateJiraSourceSchema,
    AgentCategorySchema,
    AgentCliSchema,
    AgentMemoryUpdateSchema,
    AgentStatusSchema,
    AssignSchema,
    SdlcRoleSchema,
    UpdateRoleSchema,
    MemoryRegenerationTriggerSchema,
    UpdateAgentSchema,
    CreateAgentSchema,
    CreateCliModelSchema,
    CreateCommentSchema,
    CreateCredentialSchema,
    CreateGuardrailRuleSchema,
    CreateGuardrailScriptSchema,
    CreateIssueLinkSchema,
    CreateProjectGuardrailSchema,
    CreateProjectRepoSchema,
    CreateProjectSchema,
    CreateSubTaskSchema,
    CreateTaskSchema,
    CredentialHostSchema,
    CredentialKindSchema,
    DeleteProjectSchema,
    GuardrailCategorySchema,
    GuardrailSeveritySchema,
    IssueKeyPrefixSchema,
    IssuePrioritySchema,
    IssueStatusSchema,
    IssueTypeSchema,
    NotificationFilterSchema,
    NotificationKindSchema,
    OnboardingSchema,
    ProjectScheduleSchema,
    RecloneProjectSchema,
    RunStatusSchema,
    ScheduleConflictPolicySchema,
    SchedulePresetSchema,
    SubTaskStatusSchema,
    NotificationDeliveryStatusSchema,
    ToggleProjectGuardrailSchema,
    TransitionStatusSchema,
    UpdateCliModelSchema,
    UpdateCredentialSchema,
    UpdateEnvSchema,
    UpdateGuardrailRuleSchema,
    UpdateGuardrailScriptSchema,
    UpdateNotificationsSchema,
    UpdateProfileSchema,
    UpdateProjectGuardrailSchema,
    UpdateProjectSchema,
    UpdateSubTaskSchema,
    UpdateTaskSchema,
    UpdateReminderSchema,
    UpdateScratchPadSchema,
    ReplyToItemSchema,
} from './index.js';

// Each schema gets at least one happy-path parse + one sad-path rejection.
// Happy paths drive the .refine() bodies and z.coerce conversions; sad paths
// touch each schema's distinctive validation (regex, min/max, enum membership).
// Sad cases use `safeParse` so we don't have to .catch Zod errors.

describe('enum schemas', () => {
    const cases: Array<[string, { parse: (v: unknown) => unknown }, unknown, unknown]> = [
        ['AgentCliSchema', AgentCliSchema, 'claude', 'gpt'],
        ['AgentStatusSchema', AgentStatusSchema, 'active', 'paused'],
        ['AgentCategorySchema', AgentCategorySchema, 'software-dev', 'finance'],
        ['IssueTypeSchema', IssueTypeSchema, 'task', 'story'],
        ['RunStatusSchema', RunStatusSchema, 'queued', 'pending'],
        ['IssueStatusSchema', IssueStatusSchema, 'draft', 'archived'],
        ['SubTaskStatusSchema', SubTaskStatusSchema, 'ready', 'archived'],
        ['IssuePrioritySchema', IssuePrioritySchema, 'normal', 'p0'],
        ['CredentialHostSchema', CredentialHostSchema, 'github', 'gitlab'],
        ['CredentialKindSchema', CredentialKindSchema, 'pat', 'ssh'],
        ['GuardrailCategorySchema', GuardrailCategorySchema, 'file_system', 'auth'],
        ['GuardrailSeveritySchema', GuardrailSeveritySchema, 'block', 'fatal'],
        ['NotificationKindSchema', NotificationKindSchema, 'needs_you', 'info'],
        ['NotificationDeliveryStatusSchema', NotificationDeliveryStatusSchema, 'sent', 'delivered'],
        ['SchedulePresetSchema', SchedulePresetSchema, 'daily', 'monthly'],
        ['ScheduleConflictPolicySchema', ScheduleConflictPolicySchema, 'skip', 'queue'],
        // A08 — SDLC role catalog enum. 'unknown-role' isn't one of the 10
        // canonical slugs.
        ['SdlcRoleSchema', SdlcRoleSchema, 'engineer', 'unknown-role'],
    ];

    for (const [name, schema, good, bad] of cases) {
        it(`${name} accepts canonical value and rejects unknown`, () => {
            expect(schema.parse(good)).toBe(good);
            expect(() => schema.parse(bad)).toThrow();
        });
    }
});

describe('A08 — UpdateRoleSchema', () => {
    it('accepts edits to the curated default prompt', () => {
        const parsed = UpdateRoleSchema.parse({
            default_prompt_md: '# Architect\n\nUpdated body',
        });
        expect(parsed.default_prompt_md).toContain('Architect');
    });

    it('accepts an empty body (no-op update)', () => {
        // The service returns the existing row on no-op so the body is
        // allowed to be empty.
        expect(UpdateRoleSchema.parse({}).default_prompt_md).toBeUndefined();
    });

    it('rejects unknown fields (.strict)', () => {
        // `id`, `default_status`, and `sort_order` are catalog-shape fields,
        // not Owner-tunable knobs — they only change via migration.
        expect(
            UpdateRoleSchema.safeParse({ default_status: 'active' }).success,
        ).toBe(false);
        expect(UpdateRoleSchema.safeParse({ id: 'engineer' }).success).toBe(false);
    });

    it('rejects oversized prompt bodies', () => {
        expect(
            UpdateRoleSchema.safeParse({ default_prompt_md: 'x'.repeat(100_001) }).success,
        ).toBe(false);
    });
});

describe('A08 — role_id on agent schemas', () => {
    it('CreateAgentSchema accepts a canonical role_id', () => {
        const parsed = CreateAgentSchema.parse({
            name: 'Demo',
            category: 'software-dev',
            cli: 'claude',
            model: 'claude-opus-4-7',
            accent_color: '#007AC9',
            role_id: 'engineer',
        });
        expect(parsed.role_id).toBe('engineer');
    });

    it('CreateAgentSchema accepts null (autonomous agent)', () => {
        const parsed = CreateAgentSchema.parse({
            name: 'Demo',
            category: 'content',
            cli: 'claude',
            model: 'claude-opus-4-7',
            accent_color: '#007AC9',
            role_id: null,
        });
        expect(parsed.role_id).toBeNull();
    });

    it('CreateAgentSchema rejects an unknown role_id', () => {
        const result = CreateAgentSchema.safeParse({
            name: 'Demo',
            category: 'software-dev',
            cli: 'claude',
            model: 'claude-opus-4-7',
            accent_color: '#007AC9',
            role_id: 'not-a-real-role',
        });
        expect(result.success).toBe(false);
    });

    it('UpdateAgentSchema accepts re-pointing role_id to null', () => {
        const parsed = UpdateAgentSchema.parse({ role_id: null });
        expect(parsed.role_id).toBeNull();
    });

    it('UpdateAgentSchema stays strict — unknown keys still rejected', () => {
        const result = UpdateAgentSchema.safeParse({ totally_made_up_field: 'nope' });
        expect(result.success).toBe(false);
    });

});

describe('IssueKeyPrefixSchema', () => {
    it('accepts 3 uppercase letters', () => {
        expect(IssueKeyPrefixSchema.parse('ATL')).toBe('ATL');
    });
    it('rejects lowercase', () => {
        expect(IssueKeyPrefixSchema.safeParse('atl').success).toBe(false);
    });
    it('rejects wrong length', () => {
        expect(IssueKeyPrefixSchema.safeParse('CE').success).toBe(false);
        expect(IssueKeyPrefixSchema.safeParse('CERT').success).toBe(false);
    });
    it('rejects non-letters', () => {
        expect(IssueKeyPrefixSchema.safeParse('CE1').success).toBe(false);
    });
});

describe('CreateAgentSchema', () => {
    it('accepts a minimal valid agent', () => {
        const out = CreateAgentSchema.parse({
            name: 'Coder',
            category: 'software-dev',
            cli: 'claude',
            model: 'claude-opus-4-7',
            accent_color: '#007AC9',
        });
        expect(out.name).toBe('Coder');
        expect(out.framework).toBe(''); // defaults
        expect(out.prompt_md).toBe('');
        expect(out.sort_order).toBe(0);
    });

    it('rejects empty name', () => {
        expect(
            CreateAgentSchema.safeParse({
                name: '',
                category: 'software-dev',
                cli: 'claude',
                model: 'claude-opus-4-7',
                accent_color: '#007AC9',
            }).success
        ).toBe(false);
    });

    it('rejects non-hex accent color', () => {
        expect(
            CreateAgentSchema.safeParse({
                name: 'Coder',
                category: 'software-dev',
                cli: 'claude',
                model: 'claude-opus-4-7',
                accent_color: 'blue',
            }).success
        ).toBe(false);
    });
});

describe('CreateProjectSchema / UpdateProjectSchema', () => {
    it('CreateProjectSchema accepts a valid project', () => {
        const out = CreateProjectSchema.parse({ name: 'Atlas', issue_key_prefix: 'ATL' });
        expect(out.name).toBe('Atlas');
        expect(out.issue_key_prefix).toBe('ATL');
        expect(out.status).toBe('active');
    });

    it('CreateProjectSchema rejects missing prefix', () => {
        expect(
            CreateProjectSchema.safeParse({ name: 'Atlas' }).success
        ).toBe(false);
    });

    it('UpdateProjectSchema is strict — unknown fields rejected', () => {
        expect(
            UpdateProjectSchema.safeParse({ name: 'X', injected: 'y' }).success
        ).toBe(false);
    });
});

describe('Create* issue schemas', () => {
    it('CreateTaskSchema applies defaults', () => {
        const out = CreateTaskSchema.parse({ project_id: 'p1', title: 'T1' });
        expect(out.priority).toBe('normal');
        expect(out.reporter_agent_id).toBeNull();
        expect(out.assignee_agent_id).toBeNull();
        expect(out.description).toBe('');
        expect(out.acceptance_criteria).toBe('');
    });

    it('CreateTaskSchema rejects empty title', () => {
        expect(
            CreateTaskSchema.safeParse({ project_id: 'p1', title: '' }).success
        ).toBe(false);
    });

    it('CreateSubTaskSchema accepts minimal input', () => {
        const out = CreateSubTaskSchema.parse({ task_id: 't1', title: 'S1' });
        expect(out.description).toBe('');
        expect(out.labels).toEqual([]);
    });

    it('CreateSubTaskSchema requires task_id', () => {
        expect(CreateSubTaskSchema.safeParse({ title: 'S1' }).success).toBe(false);
    });
});

describe('Update* issue schemas (strict + partial)', () => {
    it('UpdateTaskSchema accepts partial input', () => {
        expect(UpdateTaskSchema.parse({ title: 'changed' }).title).toBe('changed');
    });

    it('UpdateTaskSchema rejects unknown fields', () => {
        expect(
            UpdateTaskSchema.safeParse({ injected: 'no' }).success
        ).toBe(false);
    });

    it('UpdateTaskSchema accepts a valid worktree_branch', () => {
        const out = UpdateTaskSchema.parse({ worktree_branch: 'atlas/wf/ATL-12' });
        expect(out.worktree_branch).toBe('atlas/wf/ATL-12');
    });

    it('UpdateTaskSchema rejects a non-conforming worktree_branch', () => {
        expect(
            UpdateTaskSchema.safeParse({ worktree_branch: 'feature/foo' }).success,
        ).toBe(false);
    });

    it('UpdateSubTaskSchema accepts empty object (all fields optional)', () => {
        expect(UpdateSubTaskSchema.parse({})).toEqual({});
    });

    it('UpdateSubTaskSchema rejects unknown fields', () => {
        expect(UpdateSubTaskSchema.safeParse({ frequency: 'always' }).success).toBe(false);
    });
});

describe('comment / link / onboarding / assign / transition', () => {
    it('CreateIssueLinkSchema requires to_type and to_id', () => {
        const out = CreateIssueLinkSchema.parse({ to_type: 'sub_task', to_id: 's1' });
        expect(out.to_id).toBe('s1');
        expect(
            CreateIssueLinkSchema.safeParse({ to_type: 'sub_task', to_id: '' }).success
        ).toBe(false);
    });

    it('CreateCommentSchema accepts owner author with no agent_id', () => {
        const out = CreateCommentSchema.parse({
            author: 'owner',
            issue_type: 'sub_task',
            issue_id: 's1',
            body: 'looks good',
        });
        expect(out.author).toBe('owner');
        expect(out.agent_id).toBeNull();
    });

    it('CreateCommentSchema rejects empty body', () => {
        expect(
            CreateCommentSchema.safeParse({
                author: 'owner',
                issue_type: 'sub_task',
                issue_id: 's1',
                body: '',
            }).success
        ).toBe(false);
    });

    it('OnboardingSchema requires both fields', () => {
        const out = OnboardingSchema.parse({ owner_name: 'A', workspace_path: '/tmp' });
        expect(out.owner_name).toBe('A');
        expect(
            OnboardingSchema.safeParse({ owner_name: '', workspace_path: '/tmp' }).success
        ).toBe(false);
    });

    it('AssignSchema accepts null assignee', () => {
        expect(AssignSchema.parse({ assignee_agent_id: null }).assignee_agent_id).toBeNull();
    });

    it('TransitionStatusSchema rejects empty status', () => {
        expect(TransitionStatusSchema.safeParse({ status: '' }).success).toBe(false);
    });

    it('TransitionStatusSchema normalizes the human label "Ready" to enum "ready"', () => {
        const out = TransitionStatusSchema.parse({ status: 'Ready' });
        expect(out.status).toBe('ready');
    });

    it('TransitionStatusSchema normalizes the human label "In Review" to enum "in_review"', () => {
        const out = TransitionStatusSchema.parse({ status: 'In Review' });
        expect(out.status).toBe('in_review');
    });

    it('TransitionStatusSchema accepts canonical enum form unchanged', () => {
        expect(TransitionStatusSchema.parse({ status: 'ready' }).status).toBe('ready');
        expect(TransitionStatusSchema.parse({ status: 'in_review' }).status).toBe('in_review');
    });

    it('TransitionStatusSchema rejects unknown status with a clear message', () => {
        const result = TransitionStatusSchema.safeParse({ status: 'bogus' });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toMatch(/Unknown status "bogus"/);
        }
    });

});

describe('credential schemas', () => {
    it('CreateCredentialSchema applies host/kind/username defaults (implicit pat branch)', () => {
        const out = CreateCredentialSchema.parse({
            label: 'gh-pat',
            token: 'ghp_aaaaaaaa',
        });
        expect(out.host).toBe('github');
        expect(out.kind).toBe('pat');
        if (out.kind !== 'pat') throw new Error('expected pat branch');
        expect(out.username).toBe('x-access-token');
        expect(out.expires_at).toBeNull();
    });

    it('CreateCredentialSchema rejects short token', () => {
        expect(
            CreateCredentialSchema.safeParse({ label: 'x', token: 'short' }).success
        ).toBe(false);
    });

    it('CreateCredentialSchema accepts a github_app branch', () => {
        const out = CreateCredentialSchema.parse({
            label: 'atlas-app-bot',
            kind: 'github_app',
            bot_info_path: 'C:/tmp/bot',
            app_installation_owner: 'sspartorg',
        });
        expect(out.kind).toBe('github_app');
        if (out.kind !== 'github_app') throw new Error('expected github_app branch');
        expect(out.bot_info_path).toBe('C:/tmp/bot');
        expect(out.app_installation_owner).toBe('sspartorg');
        expect(out.host).toBe('github');
    });

    it('CreateCredentialSchema rejects a github_app payload without required fields', () => {
        expect(
            CreateCredentialSchema.safeParse({
                label: 'x',
                kind: 'github_app',
            }).success,
        ).toBe(false);
    });

    it('UpdateCredentialSchema accepts partial input', () => {
        expect(UpdateCredentialSchema.parse({ label: 'renamed' }).label).toBe('renamed');
    });

    it('UpdateCredentialSchema accepts app_installation_owner', () => {
        expect(
            UpdateCredentialSchema.parse({ app_installation_owner: 'acme-org' })
                .app_installation_owner,
        ).toBe('acme-org');
    });

    it('UpdateCredentialSchema strips unknown keys (back-compat for round-tripped rows)', () => {
        // ICredential rows carry `host`/`kind`/`id`/`created_at` that clients
        // sometimes echo back on PATCH — those must be stripped, not rejected.
        const out = UpdateCredentialSchema.parse({
            label: 'X',
            host: 'github',
            kind: 'pat',
            id: 'ignored-id',
            created_at: '2026-01-01T00:00:00Z',
        } as Record<string, unknown>);
        expect(out.label).toBe('X');
        expect((out as Record<string, unknown>)['host']).toBeUndefined();
        expect((out as Record<string, unknown>)['kind']).toBeUndefined();
    });

    it('CreateCredentialSchema rejects newlines / control chars in human_name', () => {
        const result = CreateCredentialSchema.safeParse({
            label: 'x',
            kind: 'github_app',
            bot_info_path: 'C:/tmp/bot',
            app_installation_owner: 'sspartorg',
            human_name: 'Bob\n$(malicious)',
        });
        expect(result.success).toBe(false);
    });

    it('CreateCredentialSchema rejects Unicode line separators + C1 controls in human_name (2026-07-03 audit round 1)', () => {
        // Before the round-1 audit, NO_CONTROL_CHARS only rejected the
        // C0 range + DEL (0x00-0x1F + 0x7F). U+2028 / U+2029 and the C1
        // range slipped through, so a `human_name` like
        // `Bob<U+2028>Attacker <evil@x>` could inject a second Co-Authored-By
        // trailer on any parser that treats U+2028 as a line terminator
        // (GitHub PR body rendering, some activity-log viewers). The regex
        // now rejects C0 + DEL + C1 (0x80-0x9F) + U+2028 + U+2029.
        const badCodepoints = [0x2028, 0x2029, 0x0080, 0x009f];
        for (const cp of badCodepoints) {
            const name = 'Bob' + String.fromCodePoint(cp) + 'Attacker';
            const r = CreateCredentialSchema.safeParse({
                label: 'x',
                kind: 'github_app',
                bot_info_path: 'C:/tmp/bot',
                app_installation_owner: 'sspartorg',
                human_name: name,
            });
            expect(r.success, `should reject U+${cp.toString(16).padStart(4, '0')} in human_name`).toBe(false);
        }
    });

    it('CreateCredentialSchema still accepts printable non-ASCII names (unicode letters, spaces, emoji)', () => {
        // The tightened regex must not regress on names that legitimately
        // carry non-ASCII characters — Björn, José, first names with an
        // emoji, etc.
        const good = ['Björn Nilsson', 'José García', 'Bob \u{1F44B} Smith'];
        for (const name of good) {
            const r = CreateCredentialSchema.safeParse({
                label: 'x',
                kind: 'github_app',
                bot_info_path: 'C:/tmp/bot',
                app_installation_owner: 'sspartorg',
                human_name: name,
            });
            expect(r.success, `should accept "${name}"`).toBe(true);
        }
    });

    it('CreateCredentialSchema still accepts printable non-ASCII names (unicode letters, spaces, emoji)', () => {
        // The tightened regex must not regress on names that legitimately
        // carry non-ASCII characters — Björn, José, first names with a
        // regional flag emoji, etc.
        const good = ['Björn Nilsson', 'José García', 'Bob \u{1F44B} Smith'];
        for (const name of good) {
            const r = CreateCredentialSchema.safeParse({
                label: 'x',
                kind: 'github_app',
                bot_info_path: 'C:/tmp/bot',
                app_installation_owner: 'sspartorg',
                human_name: name,
            });
            expect(r.success, `should accept "${name}"`).toBe(true);
        }
    });

    it('CreateCredentialSchema rejects invalid github logins in human_gh_login', () => {
        // GitHub usernames: alphanumeric + hyphen, no leading/trailing hyphen,
        // <= 39 chars. Newlines, spaces, underscores, `@` prefix — all invalid.
        const badLogins = ['foo bar', 'sspartorg\n', '-foo', 'foo-', 'a'.repeat(40)];
        for (const login of badLogins) {
            const r = CreateCredentialSchema.safeParse({
                label: 'x',
                kind: 'github_app',
                bot_info_path: 'C:/tmp/bot',
                app_installation_owner: 'sspartorg',
                human_gh_login: login,
            });
            expect(r.success, `should reject "${login}"`).toBe(false);
        }
    });

    it('CreateCredentialSchema accepts a valid github login', () => {
        const r = CreateCredentialSchema.safeParse({
            label: 'x',
            kind: 'github_app',
            bot_info_path: 'C:/tmp/bot',
            app_installation_owner: 'sspartorg',
            human_gh_login: 'sspartorg',
        });
        expect(r.success).toBe(true);
    });
});

describe('project lifecycle schemas (delete / reclone)', () => {
    it('DeleteProjectSchema requires a valid mode', () => {
        expect(DeleteProjectSchema.parse({ mode: 'purge' }).mode).toBe('purge');
        expect(DeleteProjectSchema.safeParse({ mode: 'wipe' }).success).toBe(false);
    });

    it('RecloneProjectSchema accepts empty input (optional .default)', () => {
        expect(RecloneProjectSchema.parse(undefined)).toEqual({});
        expect(RecloneProjectSchema.parse({})).toEqual({});
    });
});

describe('settings schemas', () => {
    it('UpdateProfileSchema validates the hex regex on accent_color', () => {
        const out = UpdateProfileSchema.parse({ accent_color: '#2E2E2E' });
        expect(out.accent_color).toBe('#2E2E2E');
        expect(UpdateProfileSchema.safeParse({ accent_color: '2E2E2E' }).success).toBe(false);
    });

    it('UpdateEnvSchema requires non-empty UPPER_SNAKE keys', () => {
        const out = UpdateEnvSchema.parse({ updates: [{ key: 'API_KEY', value: 'x' }] });
        expect(out.updates).toHaveLength(1);
        expect(
            UpdateEnvSchema.safeParse({ updates: [{ key: 'api_key', value: 'x' }] }).success
        ).toBe(false);
    });

    it('UpdateEnvSchema rejects empty updates array', () => {
        expect(UpdateEnvSchema.safeParse({ updates: [] }).success).toBe(false);
    });

    it('UpdateNotificationsSchema validates HH:MM quiet hours', () => {
        const out = UpdateNotificationsSchema.parse({
            quiet_hours_from: '22:00',
            quiet_hours_to: '08:00',
        });
        expect(out.quiet_hours_from).toBe('22:00');
        expect(
            UpdateNotificationsSchema.safeParse({ quiet_hours_from: '7am' }).success
        ).toBe(false);
    });
});

describe('cli-model schemas', () => {
    it('CreateCliModelSchema accepts a minimal entry', () => {
        const out = CreateCliModelSchema.parse({ cli: 'claude', model_name: 'claude-opus-4-7' });
        expect(out.note).toBeNull();
    });

    it('UpdateCliModelSchema is strict', () => {
        expect(UpdateCliModelSchema.safeParse({ note: 'n', sort_order: 1 }).success).toBe(true);
        expect(UpdateCliModelSchema.safeParse({ injected: 1 }).success).toBe(false);
    });
});

describe('guardrail schemas', () => {
    it('CreateGuardrailRuleSchema accepts a complete rule', () => {
        const out = CreateGuardrailRuleSchema.parse({
            category: 'file_system',
            rule_text: 'no rm -rf /',
            severity: 'block',
        });
        expect(out.detail).toBeNull();
    });

    it('UpdateGuardrailRuleSchema is partial', () => {
        expect(UpdateGuardrailRuleSchema.parse({ severity: 'warn' }).severity).toBe('warn');
    });

    it('CreateProjectGuardrailSchema applies defaults', () => {
        const out = CreateProjectGuardrailSchema.parse({ title: 'No prod pushes', body_md: 'No' });
        expect(out.icon).toBe('shield');
        expect(out.enabled).toBe(1);
        expect(out.sort_order).toBe(0);
    });

    it('UpdateProjectGuardrailSchema is partial', () => {
        expect(UpdateProjectGuardrailSchema.parse({ title: 'X' }).title).toBe('X');
    });

    describe('Phase 1.5b script entity schemas', () => {
        it('CreateGuardrailScriptSchema requires id + name + both bodies', () => {
            const out = CreateGuardrailScriptSchema.parse({
                id: 'no-delete-guard',
                name: 'No-delete guard',
                description: 'Fails on tracked deletions.',
                body_sh: '#!/usr/bin/env bash\nexit 0\n',
                body_ps1: 'exit 0\n',
            });
            expect(out.id).toBe('no-delete-guard');
            expect(out.name).toBe('No-delete guard');
            expect(out.body_sh).toMatch(/bash/);
        });

        it('CreateGuardrailScriptSchema REJECTS empty body_sh', () => {
            const result = CreateGuardrailScriptSchema.safeParse({
                id: 'x',
                name: 'X',
                body_sh: '',
                body_ps1: 'exit 0',
            });
            expect(result.success).toBe(false);
        });

        it('CreateGuardrailScriptSchema REJECTS missing body_ps1', () => {
            const result = CreateGuardrailScriptSchema.safeParse({
                id: 'x',
                name: 'X',
                body_sh: 'exit 0',
            });
            expect(result.success).toBe(false);
        });

        it('CreateGuardrailScriptSchema REJECTS missing id', () => {
            const result = CreateGuardrailScriptSchema.safeParse({
                name: 'X',
                body_sh: 'exit 0',
                body_ps1: 'exit 0',
            });
            expect(result.success).toBe(false);
        });

        it.each([
            ['check-foo', true],
            ['check-foo-bar', true],
            ['a1', true],
            ['no-delete-guard', true],
            ['x', true],
            ['9-leading-digit-ok', true],
            ['Check-Foo', false], // uppercase
            ['check_foo', false], // underscore
            ['check foo', false], // space
            ['check-foo!', false], // special char
            ['-leading-hyphen', false],
            ['trailing-hyphen-', false],
            ['', false], // empty
        ])('CreateGuardrailScriptSchema slug %p valid=%p', (slug, expectValid) => {
            const result = CreateGuardrailScriptSchema.safeParse({
                id: slug,
                name: 'X',
                body_sh: 'exit 0',
                body_ps1: 'exit 0',
            });
            expect(result.success).toBe(expectValid);
        });

        it('UpdateGuardrailScriptSchema accepts a name-only patch', () => {
            const out = UpdateGuardrailScriptSchema.parse({ name: 'Renamed' });
            expect(out.name).toBe('Renamed');
        });

        it('UpdateGuardrailScriptSchema REJECTS patching only one body', () => {
            expect(
                UpdateGuardrailScriptSchema.safeParse({ body_sh: 'exit 0' }).success,
            ).toBe(false);
            expect(
                UpdateGuardrailScriptSchema.safeParse({ body_ps1: 'exit 0' }).success,
            ).toBe(false);
        });

        it('UpdateGuardrailScriptSchema accepts BOTH bodies non-empty', () => {
            const out = UpdateGuardrailScriptSchema.parse({
                body_sh: '#!/usr/bin/env bash\nexit 0\n',
                body_ps1: 'exit 0\n',
            });
            expect(out.body_sh).toMatch(/bash/);
        });

        it('UpdateGuardrailScriptSchema does NOT accept id (slug is immutable)', () => {
            const out = UpdateGuardrailScriptSchema.parse({
                id: 'attempt-to-change-slug',
                name: 'Renamed',
            } as Record<string, unknown>);
            // Zod's .omit() strips disallowed keys silently — verify id was dropped.
            expect((out as Record<string, unknown>)['id']).toBeUndefined();
            expect(out.name).toBe('Renamed');
        });
    });

    it('ToggleProjectGuardrailSchema coerces stringy enabled values', () => {
        expect(ToggleProjectGuardrailSchema.parse({ enabled: '1' }).enabled).toBe(1);
        expect(ToggleProjectGuardrailSchema.safeParse({ enabled: 2 }).success).toBe(false);
    });
});

describe('notification filter', () => {
    it('NotificationFilterSchema accepts every field', () => {
        const out = NotificationFilterSchema.parse({
            kind: 'needs_you',
            external_status: 'sent',
            limit: 50,
        });
        expect(out.limit).toBe(50);
    });

    it('NotificationFilterSchema rejects out-of-range limit', () => {
        expect(NotificationFilterSchema.safeParse({ limit: 0 }).success).toBe(false);
        expect(NotificationFilterSchema.safeParse({ limit: 501 }).success).toBe(false);
    });

    it('NotificationFilterSchema accepts string limit (coerced)', () => {
        expect(NotificationFilterSchema.parse({ limit: '42' }).limit).toBe(42);
    });
});

describe('ProjectScheduleSchema', () => {
    it('accepts a daily-preset schedule', () => {
        const out = ProjectScheduleSchema.parse({
            enabled: true,
            preset: 'daily',
            time_of_day: '06:00',
            weekday: null,
            cron_expression: '0 6 * * *',
            skip_if_dirty: true,
            pause_while_agents_active: false,
            conflict_policy: 'skip',
        });
        expect(out.preset).toBe('daily');
    });

    it('rejects malformed time_of_day', () => {
        expect(
            ProjectScheduleSchema.safeParse({
                enabled: true,
                preset: 'daily',
                time_of_day: '6am',
                weekday: null,
                cron_expression: '0 6 * * *',
                skip_if_dirty: true,
                pause_while_agents_active: false,
                conflict_policy: 'skip',
            }).success
        ).toBe(false);
    });

    it('rejects weekday out of 0-6', () => {
        expect(
            ProjectScheduleSchema.safeParse({
                enabled: true,
                preset: 'weekly',
                time_of_day: '06:00',
                weekday: 9,
                cron_expression: '0 6 * * 1',
                skip_if_dirty: true,
                pause_while_agents_active: false,
                conflict_policy: 'skip',
            }).success
        ).toBe(false);
    });
});

// Theme 08 — memory + RAG schemas.
describe('AgentMemoryUpdateSchema (Theme 08 mode field)', () => {
    it("defaults mode to 'replace' when omitted", () => {
        const parsed = AgentMemoryUpdateSchema.parse({ body_md: 'hi' });
        expect(parsed.mode).toBe('replace');
    });
    it("accepts mode='append'", () => {
        const parsed = AgentMemoryUpdateSchema.parse({ body_md: 'hi', mode: 'append' });
        expect(parsed.mode).toBe('append');
    });
    it('rejects an unknown mode', () => {
        expect(
            AgentMemoryUpdateSchema.safeParse({ body_md: 'hi', mode: 'merge' }).success,
        ).toBe(false);
    });
    it('rejects body_md over 100_000 chars', () => {
        const big = 'x'.repeat(100_001);
        expect(AgentMemoryUpdateSchema.safeParse({ body_md: big }).success).toBe(false);
    });
});

describe('Theme 08 enum schemas', () => {
    it('MemoryRegenerationTriggerSchema accepts the four triggers', () => {
        for (const t of ['manual', 'cadence', 'high_signal', 'mcp_update']) {
            expect(MemoryRegenerationTriggerSchema.safeParse(t).success).toBe(true);
        }
        expect(MemoryRegenerationTriggerSchema.safeParse('nope').success).toBe(false);
    });
});

// Schedule refinement branches — each preset has its own validation
// path; previous tests covered the happy paths via Create/UpdateAgent
// shapes but not every refinement branch.

// items/types.ts — ITEM_RELATIONS export. Touching it in a test
// guarantees the module is loaded with full statement coverage and
// pins the runtime list to the constraint enforced by DB migration 049
// + the MCP createItemLink schema. If you add/remove a relation type,
// you change three things together: this list, the migration, the
// MCP enum.
describe('ITEM_RELATIONS', () => {
    it('exports relates_to, depends_on, tested_by', () => {
        // Async import keeps this test independent of the schema import block above.
        return import('../items/types.js').then((m) => {
            expect(m.ITEM_RELATIONS).toEqual(['relates_to', 'depends_on', 'tested_by']);
        });
    });
});

describe('CreateIssueLinkSchema relation_type', () => {
    it('accepts tested_by alongside relates_to and depends_on', () => {
        for (const rel of ['relates_to', 'depends_on', 'tested_by'] as const) {
            const out = CreateIssueLinkSchema.parse({
                to_type: 'sub_task',
                to_id: 's1',
                relation_type: rel,
            });
            expect(out.relation_type).toBe(rel);
        }
    });

    it('rejects unknown relation_type values', () => {
        expect(
            CreateIssueLinkSchema.safeParse({
                to_type: 'sub_task',
                to_id: 's1',
                relation_type: 'mentions',
            }).success,
        ).toBe(false);
    });
});

describe('refine-callback coverage', () => {

    it("ReplyToItemSchema rejects author='agent' without agent_id", () => {
        const bad = ReplyToItemSchema.safeParse({ body: 'hi', author: 'agent' });
        expect(bad.success).toBe(false);
        const good = ReplyToItemSchema.safeParse({ body: 'hi', author: 'agent', agent_id: 'a1' });
        expect(good.success).toBe(true);
    });

    it('UpdateReminderSchema rejects an empty patch', () => {
        expect(UpdateReminderSchema.safeParse({}).success).toBe(false);
    });

    it('UpdateScratchPadSchema rejects an empty patch', () => {
        expect(UpdateScratchPadSchema.safeParse({}).success).toBe(false);
    });
});

// ── JiraSiteUrlSchema — the only uncovered lines in @atlas/shared ──────────
//
// `schemas/index.ts:660-664` is the refine behind `site_url`. It was the one
// gap keeping the package off its ADR 0009 floor of 100% (measured 99.21%
// lines / 94.11% functions on 2026-09-20), and it guards something real: the
// Jira bridge sends Basic-auth credentials to this origin, so plain http is
// allowed only on loopback.
describe('Jira source schemas', () => {
    it('defaults a missing workflow to null — a source may wait for the Owner', () => {
        const out = CreateJiraSourceSchema.parse({ jql: 'project = ATL', repo_ids: ['r1'] });
        expect(out.workflow_id).toBeNull();
    });

    it('needs a query and at least one repo — a Task must name a repo', () => {
        expect(
            CreateJiraSourceSchema.safeParse({ jql: '   ', repo_ids: ['r1'] }).success
        ).toBe(false);
        expect(
            CreateJiraSourceSchema.safeParse({ jql: 'project = ATL', repo_ids: [] }).success
        ).toBe(false);
    });

    it('rejects an unknown key rather than dropping it', () => {
        expect(
            CreateJiraSourceSchema.safeParse({
                jql: 'project = ATL',
                repo_ids: ['r1'],
                repo_id: 'r1',
            }).success
        ).toBe(false);
    });

    // Written longhand rather than CreateJiraSourceSchema.partial(): .partial()
    // wraps workflow_id's .default(null) in a ZodOptional, which short-circuits
    // on undefined — an omitted key would come back present-but-undefined and
    // clear a workflow nobody asked to clear.
    it('leaves an omitted workflow absent instead of defaulting it to null', () => {
        const out = UpdateJiraSourceSchema.parse({ jql: 'project = ATL' });
        expect('workflow_id' in out).toBe(false);
        // …while an explicit null still clears it.
        expect(UpdateJiraSourceSchema.parse({ workflow_id: null }).workflow_id).toBeNull();
    });
});

describe('UpdateJiraConfigSchema — site_url origin rule', () => {
    const base = {
        enabled: true,
        email: 'a@b.com',
        api_token: '',
        poll_interval_minutes: 10,
        extra_fields: [],
    };
    const parse = (site_url: string | null) =>
        UpdateJiraConfigSchema.safeParse({ ...base, site_url });

    it('accepts https', () => {
        expect(parse('https://example.atlassian.net').success).toBe(true);
    });

    it('accepts plain http on loopback — a local Jira or a test double', () => {
        for (const u of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080']) {
            expect(parse(u).success).toBe(true);
        }
    });

    it('rejects plain http to any other origin — credentials would cross the wire', () => {
        expect(parse('http://jira.example.com').success).toBe(false);
        // A host that merely starts with "localhost" is a different origin.
        expect(parse('http://localhost.evil.com').success).toBe(false);
    });

    it('strips trailing slashes so the stored origin is canonical', () => {
        const r = parse('https://example.atlassian.net///');
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.site_url).toBe('https://example.atlassian.net');
    });

    it('allows null — the bridge is simply not configured', () => {
        expect(parse(null).success).toBe(true);
    });
});

describe('UpdateExternalNotificationSchema — G-007 strictness', () => {
    it('rejects the un-prefixed names an MCP caller would guess', () => {
        // Every field is optional, so without `.strict()` Zod strips these
        // and the object parses to `{}` — which the route then applied as an
        // empty patch, answering 200 having written nothing.
        const res = UpdateExternalNotificationSchema.safeParse({
            provider: 'telegram',
            token: 'abc',
            chat_id: '123',
        });
        expect(res.success).toBe(false);
    });

    it('still accepts the correctly-prefixed names', () => {
        const res = UpdateExternalNotificationSchema.safeParse({
            external_notification_provider: 'telegram',
            external_notification_token: 'abc',
            external_notification_chat_id: '123',
        });
        expect(res.success).toBe(true);
    });

    it('accepts {} — strictness is about unknown keys, not emptiness', () => {
        // The route, not the schema, rejects an empty patch. Asserting it here
        // keeps the division of labour explicit: move the empty check into the
        // schema and this test tells you that you did.
        expect(UpdateExternalNotificationSchema.safeParse({}).success).toBe(true);
    });
});

// ── GithubRepoUrlSchema — the last uncovered line in @atlas/shared ─────────
//
// `schemas/index.ts:522-527` is the refine behind every `repo_url`. It was the
// one gap keeping the package off its ADR 0009 floor of 100% (measured 99.65%
// statements / 97.05% functions on 2026-09-23), and it guards something real:
// a repo URL becomes a `git clone` target that Atlas hands a credential to, so
// the host has to be pinned, not merely well-formed.
describe('CreateProjectRepoSchema — repo_url host pinning', () => {
    const clone = {
        mode: 'clone' as const,
        name: 'web',
        repo_url: 'https://github.com/acme/web',
        credential_id: 'c1',
    };

    it('accepts a github.com https URL and defaults the branch to main', () => {
        const res = CreateProjectRepoSchema.safeParse(clone);
        expect(res.success).toBe(true);
        if (res.success && res.data.mode === 'clone') expect(res.data.default_branch).toBe('main');
    });

    it('rejects a well-formed URL on any other host', () => {
        // .url() passes, so this is the refine talking and nothing else.
        const res = CreateProjectRepoSchema.safeParse({
            ...clone,
            repo_url: 'https://gitlab.com/acme/web',
        });
        expect(res.success).toBe(false);
        if (!res.success) {
            expect(res.error.issues[0]?.message).toMatch(/Only https:\/\/github\.com URLs/);
        }
    });

    it('rejects http on github.com — the credential would go out in clear', () => {
        expect(
            CreateProjectRepoSchema.safeParse({ ...clone, repo_url: 'http://github.com/acme/web' })
                .success
        ).toBe(false);
    });

    it('applies the same rule to the connect branch', () => {
        const connect = {
            mode: 'connect' as const,
            name: 'web',
            folder_path: '/repos/web',
            credential_id: 'c1',
        };
        expect(
            CreateProjectRepoSchema.safeParse({
                ...connect,
                repo_url: 'https://github.com/acme/web',
            }).success
        ).toBe(true);
        expect(
            CreateProjectRepoSchema.safeParse({ ...connect, repo_url: 'https://example.com/x' })
                .success
        ).toBe(false);
    });
});
