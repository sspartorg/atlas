import { describe, expect, it, beforeEach, afterAll, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleHandoff } from './handoff-assembler.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { db } from '../db/kysely-client.js';

let worktreePath: string;
const cleanupDirs: string[] = [];

function makeWorktree(): string {
    const p = mkdtempSync(join(tmpdir(), 'atlas-handoff-test-'));
    cleanupDirs.push(p);
    return p;
}

async function seedAgent(id: string): Promise<void> {
    await db
        .insertInto('agents')
        .values({
            id,
            name: id,
            kind_slug: 'custom',
            cli: 'claude',
            model: 'claude-opus-4-7',
            category: 'software-dev',
        })
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    worktreePath = makeWorktree();
});

afterEach(() => {
    while (cleanupDirs.length > 0) {
        const p = cleanupDirs.pop()!;
        try {
            rmSync(p, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    }
});

afterAll(async () => {
    await closeTestDb();
});

describe('assembleHandoff', () => {
    it('writes .atlas/handoff.md with checklist + on-pass/on-fail rules', async () => {
        await seedAgent('agent-pilot');
        await db
            .insertInto('agent_checklists')
            .values([
                { agent_id: 'agent-pilot', label: 'First check', sort_order: 1, required: true },
                { agent_id: 'agent-pilot', label: 'Second check', sort_order: 2, required: true },
            ])
            .execute();
        await db
            .insertInto('agent_handoff_rules')
            .values([
                {
                    agent_id: 'agent-pilot',
                    kind: 'on-pass',
                    target_agent_id: 'agent-next',
                    status: 'ready',
                },
                {
                    agent_id: 'agent-pilot',
                    kind: 'on-fail',
                    target_agent_id: 'owner',
                    status: 'waiting_for_info',
                },
            ])
            .execute();

        const result = await assembleHandoff({ worktreePath, agentId: 'agent-pilot' });

        expect(result.handoffPath).toBe(join(worktreePath, '.atlas', 'handoff.md'));
        expect(existsSync(result.handoffPath)).toBe(true);
        const body = readFileSync(result.handoffPath, 'utf8');
        expect(body).toContain('agent-pilot');
        expect(body).toContain('1. First check');
        expect(body).toContain('2. Second check');
        // on-pass: next agent + status — status uses the human label
        // (`Ready` not `ready`) so the LLM gets a self-consistent
        // instruction. Also includes the "EXACTLY" emphasis.
        expect(body).toContain('"agent-next"');
        expect(body).toContain('status EXACTLY: "Ready"');
        expect(body).toContain('Do NOT substitute any other status name');
        // on-fail: owner → null; human label for status
        expect(body).toContain('"Waiting for Info"');
        expect(body).toMatch(/assignee_agent_id:\s*null/);
        // Plain-prose stdout discipline
        expect(body).toContain('Do NOT emit a fenced YAML block');
        // Literal example skeleton — agents now have a copyable template
        // for the comment body, not just a prose hint.
        expect(body).toContain('## Example comment body');
        expect(body).toContain('## Summary');
        expect(body).toContain('## Checklist verdict');
        expect(body).toContain('## Artifacts');
        expect(body).toContain('## Next');
        expect(body).toContain('[PASS]');
        expect(body).toContain('[FAIL]');
    });

    it('renders the on-fail fallback (park with Owner) when its rule is missing', async () => {
        await seedAgent('agent-noFail');
        await db
            .insertInto('agent_checklists')
            .values({ agent_id: 'agent-noFail', label: 'Only check', sort_order: 1, required: true })
            .execute();
        await db
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-noFail',
                kind: 'on-pass',
                target_agent_id: 'agent-next',
                status: 'ready',
            })
            .execute();

        const result = await assembleHandoff({ worktreePath, agentId: 'agent-noFail' });
        const body = readFileSync(result.handoffPath, 'utf8');
        // Both sections always render now — the on-fail one falls back
        // to "park with Owner" so a missing rule never causes a silent
        // waiting_for_info parking by the orchestrator.
        expect(body).toContain('When all required items pass');
        expect(body).toContain('When any required item fails');
        expect(body).toContain('No on-fail routing rule is configured');
        expect(body).toMatch(/assignee_agent_id:\s*null/);
        expect(body).toContain('"Waiting for Info"');
    });

    it('falls back to Owner + Waiting for Info when neither rule exists', async () => {
        await seedAgent('agent-norules');

        const result = await assembleHandoff({ worktreePath, agentId: 'agent-norules' });
        const body = readFileSync(result.handoffPath, 'utf8');
        expect(body).toContain('No on-pass routing rule is configured');
        expect(body).toContain('No on-fail routing rule is configured');
        // Two `assignee_agent_id: null` lines (one per section).
        const nullAssignMatches = body.match(/assignee_agent_id:\s*null/g) ?? [];
        expect(nullAssignMatches.length).toBeGreaterThanOrEqual(2);
        // Both sections land in Waiting for Info.
        const waitingMatches = body.match(/"Waiting for Info"/g) ?? [];
        expect(waitingMatches.length).toBeGreaterThanOrEqual(2);
    });

    it('embeds an MCP-failure fallback inside a primary rule block', async () => {
        await seedAgent('agent-withfb');
        await db
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-withfb',
                kind: 'on-pass',
                target_agent_id: 'agent-ghost',
                status: 'ready',
            })
            .execute();

        const result = await assembleHandoff({ worktreePath, agentId: 'agent-withfb' });
        const body = readFileSync(result.handoffPath, 'utf8');
        expect(body).toContain('"agent-ghost"');
        expect(body).toContain('Fallback if step 3 errors');
        expect(body).toContain('"Waiting for Info"');
        expect(body).toContain('unable to assign to "agent-ghost"');
    });

    it('renders without checklist section when no required rows exist', async () => {
        await seedAgent('agent-bare');
        await db
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-bare',
                kind: 'on-pass',
                target_agent_id: 'agent-next',
                status: 'ready',
            })
            .execute();

        const result = await assembleHandoff({ worktreePath, agentId: 'agent-bare' });
        const body = readFileSync(result.handoffPath, 'utf8');
        expect(body).not.toContain('Required checklist');
        expect(body).toContain('"agent-next"');
        expect(body).toContain('"Ready"');
    });

    // HA-EXTRA — `renderAssignee` empty-string branch (line 205 of
    // handoff-assembler.ts). target_agent_id='' should render as `null`
    // (same as 'owner'), not as an empty-quoted `""` string.
    it('treats target_agent_id="" as null assignee (empty-string branch of renderAssignee)', async () => {
        await seedAgent('agent-emptyid');
        await db
            .insertInto('agent_handoff_rules')
            .values({
                agent_id: 'agent-emptyid',
                kind: 'on-pass',
                target_agent_id: '',
                status: 'ready',
            })
            .execute();

        const result = await assembleHandoff({ worktreePath, agentId: 'agent-emptyid' });
        const body = readFileSync(result.handoffPath, 'utf8');
        // Empty-string targetAgentId should produce null, not `""`
        expect(body).toMatch(/assignee_agent_id:\s*null/);
        expect(body).not.toContain('assignee_agent_id: ""');
    });
});
