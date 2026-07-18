import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { IAgent, IGuardrailRule, IProjectGuardrail } from '@atlas/shared';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import {
    buildConstitutionMarkdown,
    buildPrompt,
    buildLinkedItemsSection,
    renderSelfMemorySection,
    renderRunOutcomeContract,
    SELF_MEMORY_CHAR_CAP,
} from './prompt-builder.js';
import { commentsService } from './comments.js';
import { itemLinks } from './item-links.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

function rule(
    category: IGuardrailRule['category'],
    text: string,
    severity: IGuardrailRule['severity'],
    sortOrder: number,
    detail: string | null = null,
): IGuardrailRule {
    return {
        id: `${category}-${sortOrder}`,
        category,
        rule_text: text,
        detail,
        severity,
        sort_order: sortOrder,
        created_at: '2026-05-12T00:00:00Z',
        updated_at: '2026-05-12T00:00:00Z',
    };
}

function agent(over: Partial<IAgent> = {}): IAgent {
    return {
        id: 'agent-coder',
        name: 'Coder',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-opus-4-7',
        framework: 'tdd',
        prompt_md: '',
        prompt_version: 1,
        status: 'active',
        accent_color: '#31AB46',
        sort_order: 1,
        description: '',
        designation: '',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 6,
        concurrent_runs: 1,
        glyph: '',
        created_at: '2026-05-16T00:00:00.000Z',
        updated_at: '2026-05-16T00:00:00.000Z',
        ...over,
    };
}

describe('buildConstitutionMarkdown', () => {
    it('renders the header and the always-on Forbidden Atlas MCP tool calls section when there are no rules', () => {
        // Post-`253c43d` the constitution always carries the Forbidden clause
        // (the prompt-level safety net that replaced per-agent allowed_tools);
        // empty rules just means no category blocks render between header and
        // forbidden section.
        const out = buildConstitutionMarkdown([]);
        expect(out).toMatch(/^# Atlas Constitution/);
        expect(out).toContain('## Forbidden Atlas MCP tool calls');
        expect(out).toContain('`crud_agent`');
    });

    it('renders categories in canonical order, rules in sort_order', () => {
        const rules: IGuardrailRule[] = [
            rule('git_branches', 'No force push', 'block', 1),
            rule('file_system', 'No deletes', 'block', 2),
            rule('file_system', 'No edits outside repo', 'block', 1),
        ];
        const out = buildConstitutionMarkdown(rules);
        expect(out).toMatch(/^# Atlas Constitution/);
        const fsIdx = out.indexOf('## File System');
        const gitIdx = out.indexOf('## Git & Branches');
        expect(fsIdx).toBeGreaterThan(0);
        expect(gitIdx).toBeGreaterThan(fsIdx);
        const noEditsIdx = out.indexOf('No edits outside repo');
        const noDeletesIdx = out.indexOf('No deletes');
        expect(noEditsIdx).toBeLessThan(noDeletesIdx);
    });

    it('prefixes severity label in square brackets', () => {
        const out = buildConstitutionMarkdown([rule('file_system', 'foo', 'ask_owner', 1)]);
        expect(out).toContain('- [ASK OWNER] foo');
    });

    it('renders detail on a continuation line under the rule', () => {
        const out = buildConstitutionMarkdown([
            rule('file_system', 'rule one', 'warn', 1, 'extra context'),
        ]);
        expect(out).toContain('- [WARN] rule one');
        expect(out).toContain('extra context');
    });

    it('skips categories that have no rules', () => {
        const out = buildConstitutionMarkdown([rule('file_system', 'foo', 'block', 1)]);
        expect(out).toContain('## File System');
        expect(out).not.toContain('## Git & Branches');
    });

    // Task 12 — the dual performer/reviewer reply paths collapsed into a
    // single `summary` field on the agent's terminal `atlas-outcome`
    // block. The constitution still mandates a structured summary (the
    // body shape carries through), but stops referencing the retired MCP
    // tools and the role split.
    it('mandates a structured summary comment on the item before exit, sourced from the outcome block', () => {
        const out = buildConstitutionMarkdown([]);
        expect(out).toContain('## Replying on the ticket');
        expect(out).toContain('`atlas-outcome`');
        expect(out).toMatch(/summary/i);
        // Body shape is preserved.
        expect(out).toContain('What I did');
        expect(out).toContain('What I verified');
        expect(out).toContain('Open questions');
        // The retired MCP tools must not be referenced.
        expect(out).not.toContain('performer_done');
        expect(out).not.toContain('submit_review');
    });

    // Workstream #5 — strengthen the no-sub-agents clause with the failure
    // mode the Owner actually observed (sub-agents not closing cleanly,
    // burning tokens, orphaning work outside orchestrator visibility).
    it('warns that sub-agents do not close cleanly and burn tokens', () => {
        const out = buildConstitutionMarkdown([]);
        expect(out).toContain('## One run = one model session');
        // The new paragraph: unclosed sub-agents → token burn → orphaned work.
        expect(out).toMatch(/(close cleanly|stay alive|leak|never close)/i);
        expect(out).toMatch(/burn[^.]*tokens?/i);
        expect(out).toMatch(/orphan/i);
    });
});

describe('buildPrompt', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL', { name: 'Atlas' });
        await insertAgent({ id: 'agent-coder' });
        await insertItem({
            id: 'ATL-1',
            type: 'epic',
            project_id: 'p1',
            title: 'Epic Title',
            description: 'Epic body',
        });
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Story Title',
            description: 'Story body',
            spec_md: '## Spec',
        });
        await insertItem({
            id: 'ATL-5',
            type: 'bug',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Bug Title',
            description: 'Bug body',
            acceptance_criteria: '',
            steps_to_reproduce: '',
            expected: '',
            actual: '',
            frequency: 'sometimes',
            failure_scope: 'cosmetic',
        });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('throws when the issue does not exist', async () => {
        await expect(buildPrompt({ agent: agent(), issueType: 'story', issueId: 'nope', constitutionMd: '' })).rejects.toThrow(/not found/);
    });

    it('assembles constitution + role + context for a story', async () => {
        const out = await buildPrompt({ agent: agent({ prompt_md: '# I am the agent' }), issueType: 'story', issueId: 'ATL-2', constitutionMd: '## Be safe' });
        // The `# Atlas Constitution` header is owned by buildConstitutionMarkdown;
        // buildPrompt just inlines whatever it receives as `constitutionMd`.
        expect(out).toContain('## Be safe');
        expect(out).toContain('# Your Role');
        expect(out).toContain('# I am the agent');
        expect(out).toContain('**Issue type:** story');
        expect(out).toContain('**Issue ID:** ATL-2');
        expect(out).toContain('**Project:** Atlas');
        expect(out).toContain('**Epic:** Epic Title');
        expect(out).toContain('Story Title');
        expect(out).toContain('Story body');
        expect(out).toContain('## Existing Spec');
        expect(out).toContain('## Spec');
        expect(out).toContain('# Output Instructions');
    });

    it('skips the constitution block when empty', async () => {
        const out = await buildPrompt({ agent: agent({ prompt_md: 'a' }), issueType: 'epic', issueId: 'ATL-1', constitutionMd: '   ' });
        expect(out).not.toContain('# Atlas Constitution');
    });

    it('skips the role block when prompt_md is empty/whitespace', async () => {
        const out = await buildPrompt({ agent: agent({ prompt_md: '   ' }), issueType: 'epic', issueId: 'ATL-1', constitutionMd: 'rules' });
        expect(out).not.toContain('# Your Role');
    });

    it('renders _(none)_ placeholder for empty description', async () => {
        await testDb.updateTable('items').set({ description: '' }).where('id', '=', 'ATL-2').execute();
        const out = await buildPrompt({ agent: agent(), issueType: 'story', issueId: 'ATL-2', constitutionMd: '' });
        expect(out).toContain('_(none)_');
    });

    it('builds an epic prompt without epic/spec section', async () => {
        const out = await buildPrompt({ agent: agent({ prompt_md: 'r' }), issueType: 'epic', issueId: 'ATL-1', constitutionMd: '' });
        expect(out).toContain('**Issue type:** epic');
        expect(out).toContain('Epic Title');
        expect(out).toContain('**Project:** Atlas');
        expect(out).not.toContain('**Epic:**');
        expect(out).not.toContain('## Existing Spec');
    });

    it('builds a bug prompt with minimal context (no project/epic context)', async () => {
        const out = await buildPrompt({ agent: agent({ prompt_md: 'r' }), issueType: 'bug', issueId: 'ATL-5', constitutionMd: '' });
        expect(out).toContain('**Issue type:** bug');
        expect(out).toContain('Bug Title');
        expect(out).not.toContain('**Project:**');
        expect(out).not.toContain('**Epic:**');
    });

    it('throws for an unsupported issue type', async () => {
        await expect(buildPrompt({ agent: agent(), issueType: 'sub_task', issueId: 'ATL-3', constitutionMd: '' })).rejects.toThrow(/not found/);
    });

    it('renders the discussion section with owner + agent comments in chronological order', async () => {
        await commentsService.create({
            author: 'owner',
            issue_type: 'story',
            issue_id: 'ATL-2',
            body: 'Owner asks for clarification.',
        });
        await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'story',
            issue_id: 'ATL-2',
            body: 'Agent replies with plan.',
        });
        const out = await buildPrompt({ agent: agent(), issueType: 'story', issueId: 'ATL-2', constitutionMd: '' });
        expect(out).toContain('## Discussion');
        expect(out).toContain('**Owner**');
        expect(out).toContain('Owner asks for clarification.');
        expect(out).toContain('**agent-coder**');
        expect(out).toContain('Agent replies with plan.');
        // Owner comment is older — should appear before the agent reply.
        expect(out.indexOf('Owner asks')).toBeLessThan(out.indexOf('Agent replies'));
    });

    // A06 — Working Protocol bullet #5 ("End-of-run memory draft") directs
    // the agent to optionally call `updateAgentMemory(mode='append')` for
    // generic behavioral lessons. Must appear in performer prompts.
    it('item-attached performer prompts carry the End-of-run memory draft clause', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'story',
            issueId: 'ATL-2',
            constitutionMd: '',
        });
        expect(out).toContain('End-of-run memory draft');
        expect(out).toContain('updateAgentMemory');
        expect(out).toContain("mode: 'append'");
    });

    // Task 12 — `agent_checklists` rows render into the unified
    // **Run Outcome Contract** section. The Owner's Handoffs-tab edits
    // still reach the agent's prompt; the surface name + format changed.
    it('injects the Run Outcome Contract between Your Role and Current Task when the agent has rows', async () => {
        await testDb
            .insertInto('agent_checklists')
            .values([
                { agent_id: 'agent-coder', label: 'first item', required: true, sort_order: 0 },
                { agent_id: 'agent-coder', label: 'second item', required: false, sort_order: 1 },
            ])
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'story',
            issueId: 'ATL-2',
            constitutionMd: '',
        });
        expect(out).toContain('# Run Outcome Contract');
        expect(out).toMatch(/\(required\) \[id: \d+\] first item/);
        expect(out).toMatch(/\(optional\) \[id: \d+\] second item/);
        const contractIdx = out.indexOf('# Run Outcome Contract');
        const roleIdx = out.indexOf('# Your Role');
        const taskIdx = out.indexOf('# Current Task');
        expect(roleIdx).toBeGreaterThanOrEqual(0);
        expect(contractIdx).toBeGreaterThan(roleIdx);
        expect(contractIdx).toBeLessThan(taskIdx);
    });

    // Task 12 — the contract is now appended to every dispatched
    // agent's prompt regardless of whether the agent has checklist
    // rows. (Pre-Task-12 this section was skipped when rows were
    // empty.) When there are no rows the section renders a short
    // "no required checklist" hint instead of being omitted.
    it('still renders the Run Outcome Contract when the agent has no checklist rows', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'story',
            issueId: 'ATL-2',
            constitutionMd: '',
        });
        expect(out).toContain('# Run Outcome Contract');
        expect(out).toContain('no required checklist');
    });

    // Coverage gap: exercises line 708 (if linkedSection truthy branch in buildPrompt)
    it('includes the linked items section in the prompt when item has outgoing depends_on links', async () => {
        // ATL-2 (story) already exists from beforeEach; insert a link target.
        await insertItem({
            id: 'ATL-6',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Linked Target',
            description: 'deps target',
        });
        await itemLinks.create('ATL-2', 'ATL-6', 'depends_on');
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'story',
            issueId: 'ATL-2',
            constitutionMd: '',
        });
        // The linked items section is appended to the context block.
        expect(out).toContain('ATL-6');
        expect(out).toContain('Depends on');
    });
});

describe('renderRunOutcomeContract', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertAgent({ id: 'agent-coder' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('still renders the contract section with a no-checklist hint when the agent has no rows', async () => {
        const out = await renderRunOutcomeContract('agent-coder');
        expect(out).toContain('# Run Outcome Contract');
        expect(out).toContain('no required checklist');
        // No row block when there are no rows.
        expect(out).not.toMatch(/\[id: \d+\]/);
    });

    it('renders required items with (required) and optional items with (optional) plus id prefix', async () => {
        await testDb
            .insertInto('agent_checklists')
            .values([
                { agent_id: 'agent-coder', label: 'must-do', required: true, sort_order: 0 },
                { agent_id: 'agent-coder', label: 'nice-to-have', required: false, sort_order: 1 },
            ])
            .execute();
        const out = await renderRunOutcomeContract('agent-coder');
        expect(out).toContain('# Run Outcome Contract');
        expect(out).toMatch(/- \(required\) \[id: \d+\] must-do/);
        expect(out).toMatch(/- \(optional\) \[id: \d+\] nice-to-have/);
    });

    it('documents the three outcomes and the fenced atlas-outcome block format', async () => {
        const out = await renderRunOutcomeContract('agent-coder');
        expect(out).toContain('`done`');
        expect(out).toContain('`rejected`');
        expect(out).toContain('`asked_question`');
        expect(out).toContain('```atlas-outcome');
        expect(out).toContain('outcome: done');
        expect(out).toContain('summary:');
        expect(out).toContain('checklist:');
    });

    it('warns about strict mode when required rows exist', async () => {
        await testDb
            .insertInto('agent_checklists')
            .values({ agent_id: 'agent-coder', label: 'only', required: true, sort_order: 0 })
            .execute();
        const out = await renderRunOutcomeContract('agent-coder');
        expect(out).toMatch(/strict/i);
        expect(out).toContain('on-fail');
    });

    it('honours sort_order — lower sort_order appears first', async () => {
        await testDb
            .insertInto('agent_checklists')
            .values([
                { agent_id: 'agent-coder', label: 'second', required: true, sort_order: 5 },
                { agent_id: 'agent-coder', label: 'first', required: true, sort_order: 1 },
                { agent_id: 'agent-coder', label: 'third', required: true, sort_order: 10 },
            ])
            .execute();
        const out = await renderRunOutcomeContract('agent-coder');
        const firstIdx = out.indexOf('first');
        const secondIdx = out.indexOf('second');
        const thirdIdx = out.indexOf('third');
        expect(firstIdx).toBeGreaterThan(0);
        expect(secondIdx).toBeGreaterThan(firstIdx);
        expect(thirdIdx).toBeGreaterThan(secondIdx);
    });

    it('scopes by agent_id — does not leak another agent\'s items', async () => {
        await insertAgent({ id: 'agent-other' });
        await testDb
            .insertInto('agent_checklists')
            .values([
                { agent_id: 'agent-coder', label: 'mine', required: true, sort_order: 0 },
                { agent_id: 'agent-other', label: 'theirs', required: true, sort_order: 0 },
            ])
            .execute();
        const out = await renderRunOutcomeContract('agent-coder');
        expect(out).toContain('mine');
        expect(out).not.toContain('theirs');
    });
});

describe('buildLinkedItemsSection', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic A' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Epic B' });
        await insertItem({ id: 'ATL-3', type: 'epic', project_id: 'p1', title: 'Epic C' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('returns empty string when the item has no links', async () => {
        expect(await buildLinkedItemsSection('ATL-1')).toBe('');
    });

    it('renders a `Depends on` subsection for outgoing depends_on links', async () => {
        await itemLinks.create('ATL-1', 'ATL-2', 'depends_on');
        const out = await buildLinkedItemsSection('ATL-1');
        expect(out).toContain('## Related items');
        expect(out).toContain('### Depends on');
        expect(out).toContain('`ATL-2`');
        expect(out).toContain('Epic B');
    });

    it('renders a `Blocks` subsection for incoming depends_on links', async () => {
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');
        const out = await buildLinkedItemsSection('ATL-1');
        expect(out).toContain('### Blocks');
        expect(out).toContain('`ATL-2`');
    });

    it('renders a `Relates to` subsection without blocking semantics', async () => {
        await itemLinks.create('ATL-1', 'ATL-3', 'relates_to');
        const out = await buildLinkedItemsSection('ATL-1');
        expect(out).toContain('### Relates to');
        expect(out).toContain('`ATL-3`');
        expect(out).not.toContain('### Depends on');
        expect(out).not.toContain('### Blocks');
    });

    it('keeps subsections in canonical order: Depends on → Blocks → Relates to', async () => {
        await itemLinks.create('ATL-1', 'ATL-2', 'depends_on'); // outgoing depends_on
        await itemLinks.create('ATL-3', 'ATL-1', 'depends_on'); // incoming depends_on (ATL-3 depends on ATL-1)
        await itemLinks.create('ATL-1', 'ATL-2', 'relates_to');
        const out = await buildLinkedItemsSection('ATL-1');
        const dependsIdx = out.indexOf('### Depends on');
        const blocksIdx = out.indexOf('### Blocks');
        const relatesIdx = out.indexOf('### Relates to');
        expect(dependsIdx).toBeGreaterThan(-1);
        expect(blocksIdx).toBeGreaterThan(dependsIdx);
        expect(relatesIdx).toBeGreaterThan(blocksIdx);
    });

    it('bakes description + acceptance_criteria into each `Depends on` entry (B04)', async () => {
        // Re-seed ATL-2 with description + AC so the enrichment has something
        // to project. Update via raw kysely since insertItem's defaults don't
        // include AC for epics.
        await testDb
            .updateTable('items')
            .set({
                description: 'Build the auth middleware',
                acceptance_criteria: '- Token must validate against the issuer\n- 401 on expired tokens',
            })
            .where('id', '=', 'ATL-2')
            .execute();
        await itemLinks.create('ATL-1', 'ATL-2', 'depends_on');

        const out = await buildLinkedItemsSection('ATL-1');

        expect(out).toContain('### Depends on');
        // Title row remains.
        expect(out).toContain('`ATL-2`');
        expect(out).toContain('Epic B');
        // Description is inlined under the title.
        expect(out).toContain('Description: Build the auth middleware');
        // AC is rendered as a labelled list, with the author's bullet markers
        // normalized away.
        expect(out).toContain('Acceptance criteria:');
        expect(out).toContain('- Token must validate against the issuer');
        expect(out).toContain('- 401 on expired tokens');
    });

    it('keeps `Blocks` and `Relates to` entries shallow — no description or AC inlined (B04)', async () => {
        // Same data on ATL-3 as the enriched case, but it's an inbound (Blocks)
        // and a relates_to link rather than outbound (Depends on). The renderer
        // must NOT inline content for those.
        await testDb
            .updateTable('items')
            .set({
                description: 'Should not appear in prompt',
                acceptance_criteria: '- should not appear',
            })
            .where('id', '=', 'ATL-3')
            .execute();
        await itemLinks.create('ATL-3', 'ATL-1', 'depends_on'); // incoming
        await itemLinks.create('ATL-1', 'ATL-3', 'relates_to');

        const out = await buildLinkedItemsSection('ATL-1');

        expect(out).toContain('### Blocks');
        expect(out).toContain('### Relates to');
        expect(out).not.toContain('Should not appear in prompt');
        expect(out).not.toContain('Acceptance criteria:');
    });
});

// Theme 09b — project-scope buildPrompt branch.
describe('buildPrompt project-scope (Theme 09b)', () => {
    beforeEach(async () => {
        await truncateAll();
    });

    it('renders a project preamble when projectId is set + no item', async () => {
        await insertProject('p1', 'ATL');
        await testDb
            .updateTable('projects')
            .set({ description: 'A real project description' })
            .where('id', '=', 'p1')
            .execute();
        await insertItem({
            id: 'ATL-1',
            type: 'epic',
            project_id: 'p1',
            title: 'First epic',
            description: 'The PRD body',
        });
        const out = await buildPrompt({
            agent: agent({ prompt_md: '# Role\nDo X' }),
            issueType: null,
            issueId: null,
            projectId: 'p1',
            constitutionMd: '',
        });
        expect(out).toContain('# Project Context');
        expect(out).toContain('A real project description');
        expect(out).toContain('First epic');
        expect(out).toContain('The PRD body');
        expect(out).toContain('Commit Discipline');
        expect(out).not.toContain('# Current Task');
        expect(out).not.toContain('# Freedom Run');
    });

    it('renders an empty-epics fallback when project has no epics', async () => {
        await insertProject('p2', 'OTH');
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: 'p2',
            constitutionMd: '',
        });
        expect(out).toContain('_(none yet)_');
        expect(out).toContain('_(no description set)_');
    });

    it('throws when the project does not exist', async () => {
        await expect(
            buildPrompt({
                agent: agent({}),
                issueType: null,
                issueId: null,
                projectId: 'no-such-project',
                constitutionMd: '',
            }),
        ).rejects.toThrow(/not found/);
    });

    it('still renders freedom-run preamble when all three are null', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: null,
            constitutionMd: '',
        });
        expect(out).toContain('# Freedom Run');
    });

    // A06 — freedom-run prompts SKIP the memory-draft clause. Freedom agents
    // have no item to anchor a lesson against and the clause's "behavioral
    // lesson" framing is fuzzier without that anchor. Deferred to a later
    // chunk if freedom agents need it.
    it('freedom-run prompts do NOT carry the End-of-run memory draft clause', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: null,
            constitutionMd: '',
        });
        expect(out).not.toContain('End-of-run memory draft');
    });
});

// T1 — buildReviewerPrompt was removed; the reviewer side of each SDLC
// role now lives on its own agent record (`agent-<role>-reviewer`)
// whose `prompt_md` is rendered by the standard buildPrompt above.
// Reviewer-prompt tests landed in this file before T1; they are gone now.

// A5 / 05-coverage-gap — null-side coverage for getIssueContext + buildPrompt
// optional fields. Each `??` and `?:` against an optional column gets the
// `null` arm exercised. Targets branch coverage in `prompt-builder.ts`.
describe('buildPrompt — optional field null branches (A5)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL', { name: 'Atlas' });
        await insertAgent({ id: 'agent-coder' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('renders story prompt when description/spec_md/epic_description/project_name are all NULL', async () => {
        // Insert epic + story, then null out the columns explicitly via UPDATE
        // (the insertItem helper coerces null → '' for description, so the
        // NULL path requires a follow-up update).
        await insertItem({
            id: 'ATL-1',
            type: 'epic',
            project_id: 'p1',
            title: 'Epic with null body',
        });
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Null Story',
        });
        await testDb
            .updateTable('items')
            .set({ description: null, spec_md: null })
            .where('id', 'in', ['ATL-1', 'ATL-2'])
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'story',
            issueId: 'ATL-2',
            constitutionMd: '',
        });
        // Description fallback fires `(none)` placeholder.
        expect(out).toContain('_(none)_');
        // spec_md null → the Existing Spec section is skipped.
        expect(out).not.toContain('## Existing Spec');
    });

    it('renders bug prompt when description is NULL (description ?? "" branch)', async () => {
        await insertItem({
            id: 'ATL-3',
            type: 'epic',
            project_id: 'p1',
            title: 'Parent Epic',
        });
        await insertItem({
            id: 'ATL-4',
            type: 'bug',
            project_id: 'p1',
            parent_id: 'ATL-3',
            parent_type: 'epic',
            title: 'Null Body Bug',
            acceptance_criteria: '',
            steps_to_reproduce: '',
            expected: '',
            actual: '',
            frequency: 'sometimes',
            failure_scope: 'cosmetic',
        });
        await testDb
            .updateTable('items')
            .set({ description: null })
            .where('id', '=', 'ATL-4')
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'bug',
            issueId: 'ATL-4',
            constitutionMd: '',
        });
        expect(out).toContain('Null Body Bug');
        expect(out).toContain('_(none)_');
    });

    it('renders epic prompt when description is NULL (description ?? "" branch)', async () => {
        await insertItem({
            id: 'ATL-5',
            type: 'epic',
            project_id: 'p1',
            title: 'Epic No Body',
        });
        await testDb
            .updateTable('items')
            .set({ description: null })
            .where('id', '=', 'ATL-5')
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'epic',
            issueId: 'ATL-5',
            constitutionMd: '',
        });
        expect(out).toContain('Epic No Body');
        expect(out).toContain('_(none)_');
    });

    it('project-scope: renders the no-description and no-guardrails fallbacks together', async () => {
        // Project row keeps both `description` and `guardrails_md` empty so
        // the `(no description set)` placeholder fires AND the guardrails
        // branch is skipped.
        await insertProject('p-empty', 'EMP', { name: 'Empty' });
        await testDb
            .updateTable('projects')
            .set({ description: '', guardrails_md: '' })
            .where('id', '=', 'p-empty')
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: 'p-empty',
            constitutionMd: '',
        });
        expect(out).toContain('_(no description set)_');
        expect(out).not.toContain('## Project guardrails');
    });

    it('project-scope: renders the guardrails section when guardrails_md is set', async () => {
        await insertProject('p-guard', 'GRD', { name: 'Guarded' });
        await testDb
            .updateTable('projects')
            .set({ description: 'x', guardrails_md: '- never push to main' })
            .where('id', '=', 'p-guard')
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: 'p-guard',
            constitutionMd: '',
        });
        expect(out).toContain('## Project guardrails');
        expect(out).toContain('never push to main');
    });

    it('project-scope: renders the epic description fallback and the spec_md branch together', async () => {
        await insertProject('p-epi', 'EPI', { name: 'EpicScope' });
        // First epic has description and spec_md set NULL via update —
        // exercises the _(no description)_ fallback + skips `_Spec:_`.
        await insertItem({
            id: 'EPI-1',
            type: 'epic',
            project_id: 'p-epi',
            title: 'Epic no body',
        });
        // Second epic has spec_md set — exercises the spec_md non-null arm.
        await insertItem({
            id: 'EPI-2',
            type: 'epic',
            project_id: 'p-epi',
            title: 'Epic with spec',
            description: 'desc',
            spec_md: '## Spec body',
        });
        await testDb
            .updateTable('items')
            .set({ description: null, spec_md: null })
            .where('id', '=', 'EPI-1')
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: 'p-epi',
            constitutionMd: '',
        });
        expect(out).toContain('_(no description)_');
        expect(out).toContain('_Spec:_');
        expect(out).toContain('## Spec body');
    });
});

// A5 / 05-coverage-gap — agent settings substitution branches.
// `applyAgentSettingsSubstitution` covers the `(unset)`, string, and
// JSON.stringify arms. Existing tests only exercise the no-template path.
describe('buildPrompt — agent settings substitution (A5)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL');
        await insertAgent({ id: 'agent-coder' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('renders (unset) for a placeholder whose key is not in settings_json', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        const ag = { ...agent({ prompt_md: 'Source: {{ missing }}' }), settings_json: { other: 'x' } } as IAgent;
        const out = await buildPrompt({
            agent: ag,
            issueType: 'epic',
            issueId: 'ATL-1',
            constitutionMd: '',
        });
        expect(out).toContain('Source: (unset)');
    });

    it('renders (unset) when the value is explicitly null', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        const ag = { ...agent({ prompt_md: 'Source: {{ key }}' }), settings_json: { key: null } } as IAgent;
        const out = await buildPrompt({
            agent: ag,
            issueType: 'epic',
            issueId: 'ATL-1',
            constitutionMd: '',
        });
        expect(out).toContain('Source: (unset)');
    });

    it('JSON.stringifies non-string values', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        const ag = { ...agent({ prompt_md: 'Count: {{ n }}; List: {{ list }}' }), settings_json: { n: 7, list: ['a', 'b'] } } as IAgent;
        const out = await buildPrompt({
            agent: ag,
            issueType: 'epic',
            issueId: 'ATL-1',
            constitutionMd: '',
        });
        expect(out).toContain('Count: 7');
        expect(out).toContain('List: ["a","b"]');
    });

    it('passes a string value through unchanged', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        const ag = { ...agent({ prompt_md: 'Source: {{ key }}' }), settings_json: { key: 'hello' } } as IAgent;
        const out = await buildPrompt({
            agent: ag,
            issueType: 'epic',
            issueId: 'ATL-1',
            constitutionMd: '',
        });
        expect(out).toContain('Source: hello');
    });
});

// A5 / 05-coverage-gap — buildLinkedItemsSection acceptance-criteria branch.
// Existing tests cover empty AC and bullet-led AC; the no-trim / empty-input
// path needs explicit coverage so the `[]` arm of renderAcceptanceCriteria fires.
describe('buildLinkedItemsSection — AC empty/whitespace branches (A5)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic A' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Epic B' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('omits the Acceptance criteria section when AC is whitespace-only', async () => {
        await testDb
            .updateTable('items')
            .set({
                description: 'has desc',
                acceptance_criteria: '   \n  \n',
            })
            .where('id', '=', 'ATL-2')
            .execute();
        await itemLinks.create('ATL-1', 'ATL-2', 'depends_on');
        const out = await buildLinkedItemsSection('ATL-1');
        expect(out).toContain('Description: has desc');
        expect(out).not.toContain('Acceptance criteria:');
    });

    it('omits the Acceptance criteria section when AC is null', async () => {
        // ATL-2 was inserted with no acceptance_criteria override; for epics
        // the column is NULL by default.
        await itemLinks.create('ATL-1', 'ATL-2', 'depends_on');
        const out = await buildLinkedItemsSection('ATL-1');
        expect(out).not.toContain('Acceptance criteria:');
    });

    it('omits the Description line when description is empty', async () => {
        await testDb
            .updateTable('items')
            .set({
                description: '',
                acceptance_criteria: '- one',
            })
            .where('id', '=', 'ATL-2')
            .execute();
        await itemLinks.create('ATL-1', 'ATL-2', 'depends_on');
        const out = await buildLinkedItemsSection('ATL-1');
        // Description row is skipped because the trimmed value is empty.
        expect(out).not.toContain('Description:');
        expect(out).toContain('Acceptance criteria:');
    });
});

// P10 — Per-agent self-memory injected into prompt at run start.
//
// `buildPrompt` and `buildReviewerPrompt` fetch the agent's
// `agent_memory.body_md` and append it under a
// `## Self-memory (your past course-corrections)` heading. The body is
// truncated from the top (older entries dropped) at the
// `SELF_MEMORY_CHAR_CAP` budget so prompt cost stays bounded.
async function seedMemory(agentId: string, body: string): Promise<void> {
    // Insert directly to bypass the `appendLesson` codepath — the row may
    // not exist yet (a fresh agent has no memory row until the cadence
    // regenerator or the MCP tool creates one).
    await testDb
        .insertInto('agent_memory')
        .values({
            agent_id: agentId,
            body_md: body,
            version: 1,
            source: 'ai-generated',
        })
        .onConflict((oc) =>
            oc.column('agent_id').doUpdateSet({ body_md: body }),
        )
        .execute();
}

describe('renderSelfMemorySection (P10)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertAgent({ id: 'agent-coder' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('returns empty string when no agent_memory row exists', async () => {
        // Fresh agent, never touched by the regenerator — no row in
        // agent_memory. The renderer must be safe to call against any
        // agent id and emit nothing rather than throwing.
        expect(await renderSelfMemorySection('agent-coder')).toBe('');
    });

    it('returns empty string when body_md is empty / whitespace', async () => {
        await seedMemory('agent-coder', '   \n  \n');
        expect(await renderSelfMemorySection('agent-coder')).toBe('');
    });

    it('renders the heading plus body when memory is short', async () => {
        await seedMemory(
            'agent-coder',
            '- Escalate ambiguous AC to Owner before drafting.\n- Prefer concrete actors over the generic "user".',
        );
        const out = await renderSelfMemorySection('agent-coder');
        expect(out).toContain('## Self-memory (your past course-corrections)');
        expect(out).toContain('Escalate ambiguous AC to Owner');
        expect(out).toContain('Prefer concrete actors');
        // No truncation marker on a short body.
        expect(out).not.toContain('(truncated');
    });

    it('truncates from the top (keeps the tail) when body exceeds the cap', async () => {
        // Build a body well over the cap. Tag the head and tail so we can
        // assert which survived. The renderer drops the head (older
        // entries) and keeps the tail (newest entries).
        const headMarker = '## HEAD-MARKER-XYZ';
        const tailMarker = '## TAIL-MARKER-XYZ';
        const filler = 'a'.repeat(SELF_MEMORY_CHAR_CAP);
        const body = `${headMarker}\n${filler}\n${tailMarker}\nrecent lesson body.`;
        await seedMemory('agent-coder', body);

        const out = await renderSelfMemorySection('agent-coder');
        expect(out).toContain('## Self-memory (your past course-corrections)');
        // Tail (newer entries) must survive.
        expect(out).toContain(tailMarker);
        expect(out).toContain('recent lesson body.');
        // Head (older entries) must be dropped.
        expect(out).not.toContain(headMarker);
        // Truncation marker is appended so the agent knows the section
        // is incomplete.
        expect(out).toContain('(truncated');
    });
});

describe('buildPrompt — self-memory injection (P10)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL', { name: 'Atlas' });
        await insertAgent({ id: 'agent-coder' });
        await insertItem({
            id: 'ATL-1',
            type: 'epic',
            project_id: 'p1',
            title: 'Epic Title',
            description: 'Epic body',
        });
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Story Title',
            description: 'Story body',
        });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('appends the self-memory section to item-attached prompts when memory is non-empty', async () => {
        await seedMemory(
            'agent-coder',
            '- When AC is empty, escalate to Owner before drafting.',
        );
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'role' }),
            issueType: 'story',
            issueId: 'ATL-2',
            constitutionMd: '',
        });
        expect(out).toContain('## Self-memory (your past course-corrections)');
        expect(out).toContain('When AC is empty, escalate to Owner');
        // The memory section is the LAST section in the rendered prompt —
        // the role-prompt clause tells the agent it lives at the bottom.
        const memIdx = out.indexOf('## Self-memory');
        const outputInstructionsIdx = out.indexOf('# Output Instructions');
        expect(memIdx).toBeGreaterThan(outputInstructionsIdx);
    });

    it('omits the self-memory section when the agent has no memory row', async () => {
        // No seedMemory call — agent-coder has never been touched by the
        // regenerator.
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'role' }),
            issueType: 'story',
            issueId: 'ATL-2',
            constitutionMd: '',
        });
        expect(out).not.toContain('## Self-memory');
    });

    it('appends memory to freedom-run prompts too', async () => {
        await seedMemory(
            'agent-coder',
            '- Freedom-mode lesson — surface unusual repo state in run output.',
        );
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r', requires_item: false }),
            issueType: null,
            issueId: null,
            constitutionMd: '',
        });
        expect(out).toContain('# Freedom Run');
        expect(out).toContain('## Self-memory (your past course-corrections)');
        expect(out).toContain('Freedom-mode lesson');
    });

    it('appends memory to project-scope prompts too (Theme 09b)', async () => {
        await seedMemory(
            'agent-coder',
            '- Project-scope lesson — check git_path before assuming a repo is cloned.',
        );
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: 'p1',
            constitutionMd: '',
        });
        expect(out).toContain('# Project Context');
        expect(out).toContain('## Self-memory (your past course-corrections)');
        expect(out).toContain('Project-scope lesson');
    });

    it('truncates memory in the rendered prompt when body exceeds the cap', async () => {
        const headMarker = '## HEAD-MARKER-PROMPT';
        const tailMarker = '## TAIL-MARKER-PROMPT';
        const filler = 'b'.repeat(SELF_MEMORY_CHAR_CAP);
        const body = `${headMarker}\n${filler}\n${tailMarker}\nthe newest lesson.`;
        await seedMemory('agent-coder', body);

        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'story',
            issueId: 'ATL-2',
            constitutionMd: '',
        });
        expect(out).toContain(tailMarker);
        expect(out).toContain('the newest lesson.');
        expect(out).not.toContain(headMarker);
        expect(out).toContain('(truncated');
    });
});

// T1 — buildReviewerPrompt removed; reviewer agents inject self-memory
// via the standard buildPrompt path (the same memory tests above
// already cover that path for the role-as-agent model).

// PB-EXTRA — branch coverage gaps identified after W14 baseline measurement.
describe('prompt-builder — remaining branch gaps (PB-EXTRA)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL', { name: 'Atlas' });
        await insertAgent({ id: 'agent-coder' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    // Line 17: `settings ?? {}` — settings is null / undefined
    it('renders (unset) for placeholder when settings_json is null on the agent', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        // settings_json is not set on the agent helper (undefined → ?? {} fires)
        const ag = { ...agent({ prompt_md: 'Source: {{ x }}' }) } as IAgent;
        // Explicitly null out settings_json to hit the null arm
        (ag as IAgent & { settings_json: null }).settings_json = null;
        const out = await buildPrompt({
            agent: ag,
            issueType: 'epic',
            issueId: 'ATL-1',
            constitutionMd: '',
        });
        expect(out).toContain('Source: (unset)');
    });

    // Line 123: `c.agent_id ?? 'agent'` — agent_id is null on an agent comment
    it('formatComments falls back to "agent" when agent_id is null on an agent comment', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        // Insert a comment with author='agent' and agent_id=null directly (item_id FK)
        await testDb
            .insertInto('comments')
            .values({
                author: 'agent',
                agent_id: null,
                item_id: 'ATL-1',
                body: 'anonymous agent comment',
            })
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'epic',
            issueId: 'ATL-1',
            constitutionMd: '',
        });
        expect(out).toContain('**agent**');
        expect(out).toContain('anonymous agent comment');
    });

    // Line 263: `firstNewline === -1` arm — no newline in the tail slice
    it('truncateMemoryFromTop handles body with no newlines (firstNewline === -1)', async () => {
        // Single line longer than cap — tail slice will contain no newline
        const noNewlineBody = 'x'.repeat(SELF_MEMORY_CHAR_CAP + 10);
        await testDb
            .insertInto('agent_memory')
            .values({
                agent_id: 'agent-coder',
                body_md: noNewlineBody,
                version: 1,
                source: 'ai-generated',
            })
            .execute();
        const out = await renderSelfMemorySection('agent-coder');
        // Section renders, contains truncation notice, no crash
        expect(out).toContain('## Self-memory (your past course-corrections)');
        expect(out).toContain('(truncated');
    });

    // Line 280-281: `row?.body_md ?? ''` + `if (!body.trim()) return ''` —
    // a row with only whitespace body_md returns empty string (covers empty-trim path)
    it('renderSelfMemorySection returns empty string when body_md is whitespace-only', async () => {
        // Insert row with body_md = '   ' — body.trim() === '' → returns ''
        await testDb
            .insertInto('agent_memory')
            .values({
                agent_id: 'agent-coder',
                body_md: '   ',
                version: 1,
                source: 'ai-generated',
            })
            .execute();
        const out = await renderSelfMemorySection('agent-coder');
        expect(out).toBe('');
    });

    // Line 561: `constitutionMd.trim()` in project-scope branch — non-empty constitution
    it('project-scope buildPrompt renders non-empty constitutionMd', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: 'p1',
            constitutionMd: '## Safety rules',
        });
        expect(out).toContain('## Safety rules');
        expect(out).toContain('# Project Context');
    });

    // Line 583: `(project.guardrails_md ?? '').trim()` — guardrails_md is empty → section skipped
    it('project-scope buildPrompt does not render guardrails when guardrails_md is empty string', async () => {
        await testDb
            .updateTable('projects')
            .set({ guardrails_md: '' })
            .where('id', '=', 'p1')
            .execute();
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: 'p1',
            constitutionMd: '',
        });
        // empty guardrails_md → trim() is '' → falsy → section skipped
        expect(out).toContain('# Project Context');
        expect(out).not.toContain('## Project guardrails');
    });

    // Line 617: `constitutionMd.trim()` in freedom-run branch — non-empty constitution
    it('freedom-run buildPrompt renders non-empty constitutionMd', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: null,
            issueId: null,
            projectId: null,
            constitutionMd: '## Freedom Rules',
        });
        expect(out).toContain('## Freedom Rules');
        expect(out).toContain('# Freedom Run');
    });
});

// Coverage gap: buildConstitutionMarkdown with projectArticles (lines 405-413)
describe('buildConstitutionMarkdown — projectArticles branch (coverage)', () => {
    function article(overrides: Partial<IProjectGuardrail> = {}): IProjectGuardrail {
        return {
            id: 'art-1',
            project_id: 'p1',
            title: 'No secrets in prompts',
            body_md: 'Do not expose API keys.',
            icon: '',
            enabled: 1,
            sort_order: 1,
            created_at: '2026-05-12T00:00:00Z',
            updated_at: '2026-05-12T00:00:00Z',
            ...overrides,
        };
    }

    it('renders Project-Specific Rules section when enabled articles are present', () => {
        const out = buildConstitutionMarkdown([], [article()]);
        expect(out).toContain('## Project-Specific Rules');
        expect(out).toContain('No secrets in prompts');
        // body_md non-empty → body lines rendered indented
        expect(out).toContain('Do not expose API keys.');
    });

    it('renders article title without body when body_md is empty', () => {
        const out = buildConstitutionMarkdown([], [article({ body_md: '' })]);
        expect(out).toContain('## Project-Specific Rules');
        expect(out).toContain('No secrets in prompts');
        // empty body → no body lines appended
        expect(out).not.toContain('Do not expose API keys.');
    });

    it('skips disabled articles (enabled === 0)', () => {
        const out = buildConstitutionMarkdown([], [article({ enabled: 0 })]);
        expect(out).not.toContain('## Project-Specific Rules');
    });

    // Round 2 — sort comparator tie-break: `a.sort_order - b.sort_order ||
    // a.created_at.localeCompare(b.created_at)`. Equal sort_order forces the
    // `||` to fall through to the created_at comparison.
    it('breaks a sort_order tie using created_at when two rules share sort_order', () => {
        const out = buildConstitutionMarkdown([
            rule('file_system', 'created later', 'block', 1, null),
            { ...rule('file_system', 'created earlier', 'block', 1, null), created_at: '2026-01-01T00:00:00Z' },
        ].map((r, i) => (i === 0 ? { ...r, created_at: '2026-06-01T00:00:00Z' } : r)));
        const earlierIdx = out.indexOf('created earlier');
        const laterIdx = out.indexOf('created later');
        expect(earlierIdx).toBeGreaterThan(-1);
        expect(laterIdx).toBeGreaterThan(earlierIdx);
    });

    it('breaks a sort_order tie using created_at when two project articles share sort_order', () => {
        const out = buildConstitutionMarkdown(
            [],
            [
                article({ id: 'a1', title: 'second article', sort_order: 3, created_at: '2026-06-01T00:00:00Z' }),
                article({ id: 'a2', title: 'first article', sort_order: 3, created_at: '2026-01-01T00:00:00Z' }),
            ],
        );
        const firstIdx = out.indexOf('first article');
        const secondIdx = out.indexOf('second article');
        expect(firstIdx).toBeGreaterThan(-1);
        expect(secondIdx).toBeGreaterThan(firstIdx);
    });
});

// Round 2 (API-R2-PROMPTB) — targeted branch-coverage lift. Existing suite
// left ~22 branches uncovered per the vitest coverage report. Each test
// below is annotated with the exact source line it exercises. Genuinely
// unreachable defensive branches (DB constraints guarantee the "null" arm
// of certain `??` fallbacks can never fire — e.g. `items.project_id` and
// `stories.parent_id` are NOT NULL / FK-enforced, and `projects.git_path`,
// `description`, `guardrails_md` are NOT NULL DEFAULT '') are annotated
// with `/* v8 ignore next */` directly in prompt-builder.ts instead of
// force-fed with schema-violating test data here.
describe('getIssueContext — not-found branches (round 2)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL', { name: 'Atlas' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    // Line 92: epic issue type, no matching row → `if (!row) return null`
    // true arm, surfaced through buildPrompt as a thrown "not found" error.
    it('throws not-found for a non-existent epic id', async () => {
        await expect(
            buildPrompt({ agent: agent(), issueType: 'epic', issueId: 'does-not-exist', constitutionMd: '' }),
        ).rejects.toThrow(/not found/);
    });

    // Line 108: bug issue type, no matching row → `if (!row) return null`
    // true arm.
    it('throws not-found for a non-existent bug id', async () => {
        await expect(
            buildPrompt({ agent: agent(), issueType: 'bug', issueId: 'does-not-exist', constitutionMd: '' }),
        ).rejects.toThrow(/not found/);
    });
});

describe('buildLinkedItemsSection — dep description null branch (round 2)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic A' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Epic B' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    // Line 458: `(r.description as string | null) ?? null` — every existing
    // test seeds a real description on the dep row, so the `??` fallback
    // (description IS NULL) never fires. Force it explicitly here; the
    // detail map entry still exists (so `if (detail)` at line 492 is true)
    // but its description is null so the "Description:" line is skipped.
    it('omits the Description line when the dep row has a NULL description (detail present, desc null)', async () => {
        await testDb
            .updateTable('items')
            .set({ description: null, acceptance_criteria: '- some AC' })
            .where('id', '=', 'ATL-2')
            .execute();
        await itemLinks.create('ATL-1', 'ATL-2', 'depends_on');
        const out = await buildLinkedItemsSection('ATL-1');
        expect(out).toContain('### Depends on');
        expect(out).not.toContain('Description:');
        expect(out).toContain('Acceptance criteria:');
    });
});

describe('buildPrompt — omitConstitution flag (round 2)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL', { name: 'Atlas' });
        await insertAgent({ id: 'agent-coder' });
        await insertItem({
            id: 'ATL-0',
            type: 'epic',
            project_id: 'p1',
            title: 'Parent Epic',
        });
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-0',
            parent_type: 'epic',
            title: 'Story Title',
            description: 'Story body',
        });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    // Line 541: `omitConstitution ? '' : rawConstitution` — true arm. Plan E
    // run-artefact split: the runner writes the constitution to its own
    // MANDATE_CONSTITUTION.md and buildPrompt must not duplicate it into
    // WORK.md when the flag is set.
    it('omits the constitution section entirely when omitConstitution is true, even with non-empty constitutionMd', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'story',
            issueId: 'ATL-1',
            constitutionMd: '## Safety rules that would normally render',
            omitConstitution: true,
        });
        expect(out).not.toContain('## Safety rules that would normally render');
        // The rest of the prompt still renders normally.
        expect(out).toContain('# Your Role');
        expect(out).toContain('Story Title');
    });

    it('still renders the constitution when omitConstitution is false (default)', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: 'r' }),
            issueType: 'story',
            issueId: 'ATL-1',
            constitutionMd: '## Safety rules',
        });
        expect(out).toContain('## Safety rules');
    });
});

describe('buildPrompt — project-scope null-field branches (round 2)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertAgent({ id: 'agent-coder' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    // Line 567: project-scope prompt with an EMPTY/whitespace prompt_md —
    // the `# Your Role` section must be skipped. Every existing
    // project-scope test uses a non-empty prompt_md, leaving the false arm
    // (skip) uncovered.
    it('skips the Your Role section in project-scope prompts when prompt_md is empty', async () => {
        await insertProject('p1', 'ATL');
        const out = await buildPrompt({
            agent: agent({ prompt_md: '   ' }),
            issueType: null,
            issueId: null,
            projectId: 'p1',
            constitutionMd: '',
        });
        expect(out).not.toContain('# Your Role');
        expect(out).toContain('# Project Context');
    });

    // Note: `project.git_path`/`description`/`guardrails_md` are DB-level
    // `NOT NULL DEFAULT ''` columns (see migrations/001_baseline.sql), so
    // the `?? '(unknown)'` / `?? ''` fallback arms on those fields can
    // never fire through a real query and are marked unreachable
    // (`/* v8 ignore next */`) directly in prompt-builder.ts rather than
    // exercised here with schema-violating NULL writes.
});

describe('buildPrompt — freedom-run empty prompt_md branch (round 2)', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertAgent({ id: 'agent-coder' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    // Line 624: freedom-run `if (agent.prompt_md.trim())` — false arm.
    // Every existing freedom-run test uses prompt_md: 'r'; none exercise
    // the skip-the-role-section path.
    it('skips the Your Role section in freedom-run prompts when prompt_md is empty/whitespace', async () => {
        const out = await buildPrompt({
            agent: agent({ prompt_md: '  ' }),
            issueType: null,
            issueId: null,
            constitutionMd: '',
        });
        expect(out).toContain('# Freedom Run');
        expect(out).not.toContain('# Your Role');
    });
});

