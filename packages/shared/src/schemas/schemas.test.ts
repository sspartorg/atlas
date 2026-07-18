import { describe, it, expect } from 'vitest';
import {
    AgentCategorySchema,
    AgentCliSchema,
    AgentMemoryUpdateSchema,
    AgentStatusSchema,
    AssignSchema,
    SdlcRoleSchema,
    UpdateRoleSchema,
    MemoryRegenerationTriggerSchema,
    UpdateAgentSchema,
    BugFailureScopeSchema,
    BugFrequencySchema,
    CloneProjectSchema,
    ConnectExistingProjectSchema,
    CreateAgentSchema,
    CreateBugSchema,
    CreateCliModelSchema,
    CreateCommentSchema,
    CreateCredentialSchema,
    CreateEpicSchema,
    CreateGuardrailRuleSchema,
    CreateGuardrailScriptSchema,
    CreateIssueLinkSchema,
    CreateProjectGuardrailSchema,
    CreateProjectSchema,
    CreateStorySchema,
    CreateSubBugSchema,
    CreateSubTaskSchema,
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
    UpdateBugSchema,
    UpdateCliModelSchema,
    UpdateCredentialSchema,
    UpdateEnvSchema,
    UpdateGuardrailRuleSchema,
    UpdateGuardrailScriptSchema,
    UpdateNotificationsSchema,
    UpdateProfileSchema,
    UpdateProjectGuardrailSchema,
    UpdateProjectSchema,
    UpdateStorySchema,
    UpdateSubBugSchema,
    UpdateSubTaskSchema,
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
        ['IssueTypeSchema', IssueTypeSchema, 'story', 'task'],
        ['RunStatusSchema', RunStatusSchema, 'queued', 'pending'],
        ['IssueStatusSchema', IssueStatusSchema, 'draft', 'archived'],
        ['SubTaskStatusSchema', SubTaskStatusSchema, 'ready', 'archived'],
        ['IssuePrioritySchema', IssuePrioritySchema, 'normal', 'p0'],
        ['BugFrequencySchema', BugFrequencySchema, 'always', 'every-time'],
        ['BugFailureScopeSchema', BugFailureScopeSchema, 'cosmetic', 'visual'],
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

    it('UpdateAgentSchema accepts push_code / requires_worktree / kind_slug / settings_json / cron_expr', () => {
        const parsed = UpdateAgentSchema.parse({
            push_code: true,
            requires_worktree: true,
            kind_slug: 'jira-to-epic',
            settings_json: { topic: 'compliance' },
            cron_expr: '0 9 * * *',
        });
        expect(parsed.push_code).toBe(true);
        expect(parsed.requires_worktree).toBe(true);
        expect(parsed.kind_slug).toBe('jira-to-epic');
        expect(parsed.settings_json).toEqual({ topic: 'compliance' });
        expect(parsed.cron_expr).toBe('0 9 * * *');
    });

    it('UpdateAgentSchema stays strict — unknown keys still rejected', () => {
        const result = UpdateAgentSchema.safeParse({ totally_made_up_field: 'nope' });
        expect(result.success).toBe(false);
    });

    it('UpdateAgentSchema accepts null cron_expr (clearing the override)', () => {
        const parsed = UpdateAgentSchema.parse({ cron_expr: null });
        expect(parsed.cron_expr).toBeNull();
    });

    it('UpdateAgentSchema rejects cron_expr longer than 200 chars', () => {
        const tooLong = '* '.repeat(101); // 202 chars including spaces
        const result = UpdateAgentSchema.safeParse({ cron_expr: tooLong });
        expect(result.success).toBe(false);
    });

    it('UpdateAgentSchema accepts any non-empty cron_expr up to the length cap (service does croner-parse)', () => {
        // Boundary validation lives in the service layer where croner is a
        // dep; the schema just enforces the size cap.
        const parsed = UpdateAgentSchema.parse({ cron_expr: 'literally anything 200 chars or less' });
        expect(parsed.cron_expr).toBe('literally anything 200 chars or less');
    });
});

describe('IssueKeyPrefixSchema', () => {
    it('accepts 3 uppercase letters', () => {
        expect(IssueKeyPrefixSchema.parse('CER')).toBe('CER');
    });
    it('rejects lowercase', () => {
        expect(IssueKeyPrefixSchema.safeParse('cer').success).toBe(false);
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
        expect(out.git_path).toBe('');
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
    it('CreateEpicSchema applies defaults', () => {
        const out = CreateEpicSchema.parse({ project_id: 'p1', title: 'E1' });
        expect(out.priority).toBe('normal');
        expect(out.reporter_agent_id).toBeNull();
        expect(out.assignee_agent_id).toBeNull();
        expect(out.description).toBe('');
    });

    it('CreateEpicSchema rejects empty title', () => {
        expect(
            CreateEpicSchema.safeParse({ project_id: 'p1', title: '' }).success
        ).toBe(false);
    });

    it('CreateStorySchema accepts minimal input', () => {
        const out = CreateStorySchema.parse({ epic_id: 'e1', title: 'S1' });
        expect(out.acceptance_criteria).toBe('');
    });

    it('CreateSubTaskSchema accepts minimal input', () => {
        const out = CreateSubTaskSchema.parse({ story_id: 's1', title: 'T1' });
        expect(out.description).toBe('');
    });

    it('CreateSubBugSchema fills bug-field defaults', () => {
        const out = CreateSubBugSchema.parse({ story_id: 's1', title: 'SB1' });
        expect(out.frequency).toBe('sometimes');
        expect(out.failure_scope).toBe('cosmetic');
    });

    it('CreateBugSchema fills bug-field defaults', () => {
        const out = CreateBugSchema.parse({ epic_id: 'e1', title: 'B1' });
        expect(out.frequency).toBe('sometimes');
        expect(out.failure_scope).toBe('cosmetic');
    });
});

describe('Update* issue schemas (strict + partial)', () => {
    it('UpdateStorySchema accepts partial input', () => {
        expect(UpdateStorySchema.parse({ title: 'changed' }).title).toBe('changed');
    });

    it('UpdateStorySchema rejects unknown fields', () => {
        expect(
            UpdateStorySchema.safeParse({ injected: 'no' }).success
        ).toBe(false);
    });

    // T2 — PO Writer's `worktree_branch` patch must round-trip through
    // the schema; the regex matches the dev/QA convention.
    it('UpdateStorySchema accepts a valid worktree_branch', () => {
        const out = UpdateStorySchema.parse({ worktree_branch: 'atlas/dev/ATL-12' });
        expect(out.worktree_branch).toBe('atlas/dev/ATL-12');
    });

    it('UpdateStorySchema rejects a non-conforming worktree_branch', () => {
        expect(
            UpdateStorySchema.safeParse({ worktree_branch: 'feature/foo' }).success,
        ).toBe(false);
    });

    it('UpdateSubTaskSchema accepts empty object (all fields optional)', () => {
        expect(UpdateSubTaskSchema.parse({})).toEqual({});
    });

    it('UpdateSubBugSchema honours bug-field updates', () => {
        const out = UpdateSubBugSchema.parse({ frequency: 'always' });
        expect(out.frequency).toBe('always');
    });

    it('UpdateBugSchema rejects unknown fields', () => {
        expect(UpdateBugSchema.safeParse({ injected: 'no' }).success).toBe(false);
    });

});

describe('comment / link / onboarding / assign / transition', () => {
    it('CreateIssueLinkSchema requires to_type and to_id', () => {
        const out = CreateIssueLinkSchema.parse({ to_type: 'story', to_id: 's1' });
        expect(out.to_id).toBe('s1');
        expect(
            CreateIssueLinkSchema.safeParse({ to_type: 'story', to_id: '' }).success
        ).toBe(false);
    });

    it('CreateCommentSchema accepts owner author with no agent_id', () => {
        const out = CreateCommentSchema.parse({
            author: 'owner',
            issue_type: 'story',
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
                issue_type: 'story',
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
            UpdateCredentialSchema.parse({ app_installation_owner: 'isw-CDM-Next' })
                .app_installation_owner,
        ).toBe('isw-CDM-Next');
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

describe('project lifecycle schemas (clone / connect / delete / reclone)', () => {
    it('CloneProjectSchema accepts a github URL', () => {
        const out = CloneProjectSchema.parse({
            repo_url: 'https://github.com/example/atlas',
            credential_id: 'c1',
            project_name: 'Atlas',
            issue_key_prefix: 'ATL',
        });
        expect(out.default_branch).toBe('main');
    });

    it('CloneProjectSchema rejects non-github URL (the .refine body fires)', () => {
        expect(
            CloneProjectSchema.safeParse({
                repo_url: 'https://gitlab.com/x/y',
                credential_id: 'c1',
                project_name: 'X',
                issue_key_prefix: 'XXX',
            }).success
        ).toBe(false);
    });

    it('ConnectExistingProjectSchema accepts a github URL (.refine body fires)', () => {
        const out = ConnectExistingProjectSchema.parse({
            folder_path: '/tmp/x',
            repo_url: 'https://github.com/o/r',
            credential_id: 'c1',
            issue_key_prefix: 'ABC',
        });
        expect(out.repo_url).toContain('github.com');
    });

    it('ConnectExistingProjectSchema rejects non-github URL', () => {
        expect(
            ConnectExistingProjectSchema.safeParse({
                folder_path: '/tmp/x',
                repo_url: 'https://bitbucket.org/o/r',
                credential_id: 'c1',
                issue_key_prefix: 'ABC',
            }).success
        ).toBe(false);
    });

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
describe('UpdateAgentSchema schedule refinement branches', () => {
    it('every_n_hours requires schedule_hours > 0', () => {
        const bad = UpdateAgentSchema.safeParse({
            schedule_preset: 'every_n_hours',
            schedule_hours: 0,
        });
        expect(bad.success).toBe(false);
        const good = UpdateAgentSchema.safeParse({
            schedule_preset: 'every_n_hours',
            schedule_hours: 6,
        });
        expect(good.success).toBe(true);
    });

    it('daily requires schedule_time_of_day in HH:MM', () => {
        const bad = UpdateAgentSchema.safeParse({ schedule_preset: 'daily' });
        expect(bad.success).toBe(false);
        const bad2 = UpdateAgentSchema.safeParse({
            schedule_preset: 'daily',
            schedule_time_of_day: '25:00',
        });
        expect(bad2.success).toBe(false);
        const good = UpdateAgentSchema.safeParse({
            schedule_preset: 'daily',
            schedule_time_of_day: '09:00',
        });
        expect(good.success).toBe(true);
    });

    it('weekly requires schedule_weekdays + time_of_day', () => {
        const noDays = UpdateAgentSchema.safeParse({
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
        });
        expect(noDays.success).toBe(false);
        const good = UpdateAgentSchema.safeParse({
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
            schedule_weekdays: [1, 2, 3],
        });
        expect(good.success).toBe(true);
    });

    it('monthly requires schedule_day_of_month 1..31', () => {
        const oob = UpdateAgentSchema.safeParse({
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 32,
        });
        expect(oob.success).toBe(false);
        const good = UpdateAgentSchema.safeParse({
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 15,
        });
        expect(good.success).toBe(true);
    });
});

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
                to_type: 'story',
                to_id: 's1',
                relation_type: rel,
            });
            expect(out.relation_type).toBe(rel);
        }
    });

    it('rejects unknown relation_type values', () => {
        expect(
            CreateIssueLinkSchema.safeParse({
                to_type: 'story',
                to_id: 's1',
                relation_type: 'mentions',
            }).success,
        ).toBe(false);
    });
});

describe('refine-callback coverage', () => {
    it('UpdateAgentSchema rejects duplicate schedule_weekdays (AgentWeekdaysSchema refine)', () => {
        const dup = UpdateAgentSchema.safeParse({
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
            schedule_weekdays: [1, 2, 2, 3],
        });
        expect(dup.success).toBe(false);
    });

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
