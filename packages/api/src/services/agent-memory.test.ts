import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { agentsService } from './agents.js';
import {
    agentMemoryService,
    detectBoundaryViolations,
    MEMORY_BOUNDARY_RULE,
} from './agent-memory.js';
import { commentsService } from './comments.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem, insertAgent } from '../../tests/_items.js';

const base = {
    name: 'PO Writer',
    category: 'software-dev' as const,
    cli: 'claude' as const,
    model: 'claude-opus-4-7',
    framework: '',
    prompt_md: '# system',
    accent_color: '#007AC9',
    sort_order: 1,
};

beforeEach(async () => {
    await truncateAll();
    delete process.env['ATLAS_AI_ENABLED'];
});

afterAll(async () => {
    await closeTestDb();
});

describe('agentMemoryService', () => {
    // ensureRow: agentsService.create() already seeds an agent_memory row
    // in the same transaction, so every other test's `existing` lookup is
    // always truthy. Insert the agent directly (bypassing agentsService)
    // to exercise ensureRow's insert-then-reselect path when no row exists.
    it('get lazily creates the memory row when none exists yet (ensureRow insert path)', async () => {
        const agentId = await insertAgent({ id: 'agent-no-memory-yet' });
        const mem = await agentMemoryService.get(agentId);
        expect(mem.agent_id).toBe(agentId);
        expect(mem.body_md).toBe('');
        expect(mem.version).toBe(1);
        expect(mem.source).toBe('ai-generated');
        // A second call should find the now-existing row (existing truthy path).
        const again = await agentMemoryService.get(agentId);
        expect(again.version).toBe(1);
    });

    it('get returns a default empty row for a known agent without writing twice', async () => {
        const a = await agentsService.create(base);
        const first = await agentMemoryService.get(a.id);
        expect(first.agent_id).toBe(a.id);
        expect(first.body_md).toBe('');
        expect(first.version).toBe(1);
        expect(first.source).toBe('ai-generated');
        expect(first.last_run_id).toBeNull();
        const second = await agentMemoryService.get(a.id);
        expect(second.version).toBe(first.version);
    });

    it('put bumps version, flips source to manual-edit, persists body', async () => {
        const a = await agentsService.create(base);
        const next = await agentMemoryService.put(a.id, '# notes');
        expect(next.body_md).toBe('# notes');
        expect(next.version).toBe(2);
        expect(next.source).toBe('manual-edit');
    });

    it('regenerate (simulated) bumps version, flips source back to ai-generated, attaches last_run_id', async () => {
        const a = await agentsService.create(base);
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'e1', type: 'epic', project_id: 'p1', title: 'E' });
        await insertItem({
            id: 's1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'e1',
            parent_type: 'epic',
            title: 'Test',
        });
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'r-last',
                agent_id: a.id,
                item_id: 's1',
                status: 'completed',
            })
            .execute();
        await agentMemoryService.put(a.id, 'manual draft');
        const out = await agentMemoryService.regenerate(a.id);
        expect(out.source).toBe('ai-generated');
        expect(out.version).toBeGreaterThan(2);
        expect(out.last_run_id).toBe('r-last');
        expect(out.body_md).toContain('# Procedural Memory — PO Writer');
        expect(out.body_md).toContain('Course corrections');
        expect(out.body_md).toContain('Simulated body');
    });

    it('regenerate with no prior runs sets last_run_id to null', async () => {
        const a = await agentsService.create(base);
        const out = await agentMemoryService.regenerate(a.id);
        expect(out.last_run_id).toBeNull();
        expect(out.body_md).toContain('Procedural Memory');
    });

    it('cascades on agent delete', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.put(a.id, 'body');
        await agentsService.delete(a.id);
        const row = await testDb
            .selectFrom('agent_memory')
            .selectAll()
            .where('agent_id', '=', a.id)
            .executeTakeFirst();
        expect(row).toBeUndefined();
    });

    it('fileName slugifies the agent name', async () => {
        const a = await agentsService.create({ ...base, name: 'UI / UX Designer' });
        expect(agentMemoryService.fileName(a)).toBe('ui-ux-designer.memory.md');
    });

    it('regenerate throws when agent is missing', async () => {
        await expect(agentMemoryService.regenerate('does-not-exist')).rejects.toThrow(
            /Agent not found/,
        );
    });

    // ──────────────────────────────────────────────────────────────────
    // Theme 08 — lifecycle, audit, append, high-signal cadence.
    // ──────────────────────────────────────────────────────────────────

    it('MEMORY_BOUNDARY_RULE is non-empty and explicit about behavioral vs product', () => {
        expect(MEMORY_BOUNDARY_RULE).toMatch(/behavioral/i);
        expect(MEMORY_BOUNDARY_RULE).toMatch(/product/i);
        expect(MEMORY_BOUNDARY_RULE).toMatch(/Test:/);
    });

    it('regenerate writes a memory_regenerations audit row with the trigger', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.regenerate(a.id, { trigger: 'cadence' });
        const rows = await testDb
            .selectFrom('memory_regenerations')
            .selectAll()
            .where('agent_id', '=', a.id)
            .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.trigger).toBe('cadence');
        expect(rows[0]!.prev_version).toBe(1);
        expect(rows[0]!.new_version).toBe(2);
        expect(rows[0]!.chars_added).toBeGreaterThan(0);
    });

    it('regenerate resets runs_since_regen to 0', async () => {
        const a = await agentsService.create(base);
        await testDb
            .updateTable('agent_memory')
            .set({ runs_since_regen: 4 })
            .where('agent_id', '=', a.id)
            .execute();
        await agentMemoryService.regenerate(a.id);
        const row = await testDb
            .selectFrom('agent_memory')
            .select('runs_since_regen')
            .where('agent_id', '=', a.id)
            .executeTakeFirstOrThrow();
        expect(row.runs_since_regen).toBe(0);
    });

    it('appendLesson adds a bullet under ## Course corrections, bumps version, leaves cadence counter alone', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.put(
            a.id,
            '# Procedural Memory\n\n## Course corrections\n\n- existing\n',
        );
        await testDb
            .updateTable('agent_memory')
            .set({ runs_since_regen: 3 })
            .where('agent_id', '=', a.id)
            .execute();
        const after = await agentMemoryService.appendLesson(a.id, 'tighten AC checks');
        expect(after.body_md).toMatch(/- existing/);
        expect(after.body_md).toMatch(/- tighten AC checks/);
        // version was at 2 (put), now 3 after append.
        expect(after.version).toBe(3);
        const row = await testDb
            .selectFrom('agent_memory')
            .select('runs_since_regen')
            .where('agent_id', '=', a.id)
            .executeTakeFirstOrThrow();
        expect(row.runs_since_regen).toBe(3);
        // Audit row trigger is mcp_update.
        const audit = await testDb
            .selectFrom('memory_regenerations')
            .selectAll()
            .where('agent_id', '=', a.id)
            .execute();
        expect(audit).toHaveLength(1);
        expect(audit[0]!.trigger).toBe('mcp_update');
    });

    it('appendLesson creates the ## Course corrections section when missing', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.put(a.id, '# Procedural Memory\n\nNo sections yet.\n');
        const after = await agentMemoryService.appendLesson(a.id, 'first lesson');
        expect(after.body_md).toMatch(/## Course corrections/);
        expect(after.body_md).toMatch(/- first lesson/);
    });

    it('maybeRegenerateAfterRun returns null below cadence threshold', async () => {
        const a = await agentsService.create({ ...base, memory_cadence: 5 });
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'r1', agent_id: a.id, item_id: 'ATL-1', status: 'completed' })
            .execute();
        const trigger = await agentMemoryService.maybeRegenerateAfterRun(a.id, 'r1', 'completed');
        expect(trigger).toBeNull();
        const row = await testDb
            .selectFrom('agent_memory')
            .select('runs_since_regen')
            .where('agent_id', '=', a.id)
            .executeTakeFirstOrThrow();
        expect(row.runs_since_regen).toBe(1);
    });

    it('maybeRegenerateAfterRun fires cadence regen at threshold and resets counter', async () => {
        const a = await agentsService.create({ ...base, memory_cadence: 2 });
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'r1', agent_id: a.id, item_id: 'ATL-1', status: 'completed' })
            .execute();
        await testDb
            .updateTable('agent_memory')
            .set({ runs_since_regen: 1 })
            .where('agent_id', '=', a.id)
            .execute();
        const trigger = await agentMemoryService.maybeRegenerateAfterRun(a.id, 'r1', 'completed');
        expect(trigger).toBe('cadence');
        const row = await testDb
            .selectFrom('agent_memory')
            .select(['runs_since_regen', 'version'])
            .where('agent_id', '=', a.id)
            .executeTakeFirstOrThrow();
        expect(row.runs_since_regen).toBe(0);
        expect(row.version).toBe(2);
    });

    it('maybeRegenerateAfterRun: errors count double toward cadence', async () => {
        const a = await agentsService.create({ ...base, memory_cadence: 3 });
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'r1', agent_id: a.id, item_id: 'ATL-1', status: 'error' })
            .execute();
        // Counter at 1; an error bumps by 2 → 3, which trips cadence.
        await testDb
            .updateTable('agent_memory')
            .set({ runs_since_regen: 1 })
            .where('agent_id', '=', a.id)
            .execute();
        const trigger = await agentMemoryService.maybeRegenerateAfterRun(a.id, 'r1', 'error');
        expect(trigger).toBe('cadence');
    });

    it('maybeRegenerateAfterRun fires high_signal regardless of cadence when Owner posts [lesson:]', async () => {
        const a = await agentsService.create({ ...base, memory_cadence: 100 });
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'r1', agent_id: a.id, item_id: 'ATL-1', status: 'completed' })
            .execute();
        await commentsService.create({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'ATL-1',
            body: '[lesson: escalate ambiguous epics to Owner instead of guessing]',
        });
        const trigger = await agentMemoryService.maybeRegenerateAfterRun(a.id, 'r1', 'completed');
        expect(trigger).toBe('high_signal');
    });

    it('history returns memory_regenerations newest first', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.regenerate(a.id, { trigger: 'manual' });
        await agentMemoryService.regenerate(a.id, { trigger: 'manual' });
        const rows = await agentMemoryService.history(a.id, 5);
        expect(rows).toHaveLength(2);
        expect(new Date(rows[0]!.created_at).getTime()).toBeGreaterThanOrEqual(
            new Date(rows[1]!.created_at).getTime(),
        );
    });
});

// A06 — soft boundary-rule filter. Detects product/project specifics in
// memory bodies; persists alongside the audit row so the Memory tab can
// badge it. Soft semantics — memory still saves (Owner's choice).
describe('detectBoundaryViolations', () => {
    it('returns empty array for clean behavioral lessons', () => {
        expect(
            detectBoundaryViolations(
                'When AC is empty, escalate to Owner before drafting.',
            ),
        ).toEqual([]);
    });

    it('flags item IDs', () => {
        expect(
            detectBoundaryViolations('Story story_abc123 was about refunds'),
        ).toEqual(['item_id']);
        expect(
            detectBoundaryViolations('Saw epic_xyz789 fail during review'),
        ).toEqual(['item_id']);
        expect(
            detectBoundaryViolations('sub-task_qwe456 broke the build'),
        ).toEqual(['item_id']);
    });

    it('flags agent IDs', () => {
        expect(
            detectBoundaryViolations('Working with agent-coder yielded weird output'),
        ).toEqual(['agent_id']);
    });

    it('flags project IDs', () => {
        expect(detectBoundaryViolations('Project proj_abc1234 ran a migration')).toEqual([
            'project_id',
        ]);
        expect(
            detectBoundaryViolations('project_xyz999 has its own rules'),
        ).toEqual(['project_id']);
    });

    it('flags run UUIDs', () => {
        expect(
            detectBoundaryViolations(
                'Run d3b07384-d9a8-4f76-aaaa-bbbbccccdddd timed out',
            ),
        ).toEqual(['run_id']);
    });

    it('accumulates multiple flags', () => {
        const body =
            'Story story_abc123 was handed to agent-coder during ' +
            'run d3b07384-d9a8-4f76-aaaa-bbbbccccdddd';
        const flags = detectBoundaryViolations(body);
        expect(flags).toContain('item_id');
        expect(flags).toContain('agent_id');
        expect(flags).toContain('run_id');
    });

    it('is case-insensitive', () => {
        expect(detectBoundaryViolations('STORY_ABC123 failed')).toEqual(['item_id']);
        expect(detectBoundaryViolations('AGENT-CODER missed the AC')).toEqual([
            'agent_id',
        ]);
    });

    it('does not false-positive on generic English words', () => {
        const body = [
            '- Always check the description before scoping.',
            '- Comments override the description when they disagree.',
            '- Escalate before guessing.',
        ].join('\n');
        expect(detectBoundaryViolations(body)).toEqual([]);
    });

    it('persists detected flags on the audit row after appendLesson', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.appendLesson(
            a.id,
            'Always escalate when story_xyz1234 fails',
            'run-1',
        );
        const rows = await agentMemoryService.history(a.id, 5);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.boundary_flags).toEqual(['item_id']);
    });

    it('persists empty array on the audit row for clean writes', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.appendLesson(
            a.id,
            'When AC is empty, escalate to Owner before drafting.',
        );
        const rows = await agentMemoryService.history(a.id, 5);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.boundary_flags).toEqual([]);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// W2 backfill — cover remaining uncovered paths in agent-memory.ts
// ──────────────────────────────────────────────────────────────────────────────

describe('agentMemoryService.history — edge cases', () => {
    it('returns empty array when no regenerations have occurred', async () => {
        const a = await agentsService.create(base);
        const rows = await agentMemoryService.history(a.id, 5);
        expect(rows).toEqual([]);
    });

    it('respects the limit parameter', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.regenerate(a.id, { trigger: 'manual' });
        await agentMemoryService.regenerate(a.id, { trigger: 'manual' });
        await agentMemoryService.regenerate(a.id, { trigger: 'manual' });
        const rows = await agentMemoryService.history(a.id, 2);
        expect(rows).toHaveLength(2);
    });
});

describe('agentMemoryService.appendLesson — lesson starting with dash', () => {
    it('does not double-prefix a lesson that already starts with "-"', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.put(a.id, '# Memory\n\n## Course corrections\n\n- existing\n');
        const after = await agentMemoryService.appendLesson(a.id, '- already a bullet');
        // Should have "- already a bullet" not "- - already a bullet"
        expect(after.body_md).toMatch(/- already a bullet/);
        expect(after.body_md).not.toMatch(/- - already a bullet/);
    });

    it('ignores empty lesson strings (no-op)', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.put(a.id, '# Memory\n');
        const before = await agentMemoryService.get(a.id);
        const after = await agentMemoryService.appendLesson(a.id, '   ');
        // Empty lesson should not change the body
        expect(after.body_md).toBe(before.body_md);
    });
});

describe('agentMemoryService.maybeRegenerateAfterRun — run without item', () => {
    it('skips lesson check when run has no item_id, returns null below cadence', async () => {
        const a = await agentsService.create({ ...base, memory_cadence: 10 });
        // Insert a run without an item (freedom-mode run)
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'r-free', agent_id: a.id, item_id: null, status: 'completed' })
            .execute();
        const trigger = await agentMemoryService.maybeRegenerateAfterRun(a.id, 'r-free', 'completed');
        expect(trigger).toBeNull();
    });
});

describe('agentMemoryService — mode=replace (put) vs mode=append behaviors', () => {
    it('put(replace) overwrites existing body completely', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.put(a.id, 'first content');
        await agentMemoryService.put(a.id, 'replacement content');
        const mem = await agentMemoryService.get(a.id);
        expect(mem.body_md).toBe('replacement content');
        expect(mem.body_md).not.toContain('first content');
    });

    it('appendLesson appends, does NOT replace existing body', async () => {
        const a = await agentsService.create(base);
        await agentMemoryService.put(a.id, '# Memory\n\nExisting content.\n\n## Course corrections\n\n- old lesson\n');
        await agentMemoryService.appendLesson(a.id, 'new lesson');
        const mem = await agentMemoryService.get(a.id);
        expect(mem.body_md).toContain('Existing content.');
        expect(mem.body_md).toContain('old lesson');
        expect(mem.body_md).toContain('new lesson');
    });

    it('appendLesson inserts before the next ## heading (sectionEndAbs = afterHeading + nextHeadingRel branch)', async () => {
        // Body has a next ## heading AFTER ## Course corrections.
        // The append must insert inside "Course corrections", not after "Style fixes".
        const body =
            '# Memory\n\n## Course corrections\n\n- lesson1\n\n## Style fixes\n\n- style1\n';
        const a = await agentsService.create(base);
        await agentMemoryService.put(a.id, body);
        const after = await agentMemoryService.appendLesson(a.id, 'lesson2');
        const lines = after.body_md.split('\n');
        const corrIdx = lines.findIndex((l) => l.includes('Course corrections'));
        const styleIdx = lines.findIndex((l) => l.includes('Style fixes'));
        const lesson2Idx = lines.findIndex((l) => l.includes('lesson2'));
        // lesson2 must appear before "Style fixes"
        expect(lesson2Idx).toBeGreaterThan(corrIdx);
        expect(lesson2Idx).toBeLessThan(styleIdx);
        // lesson1 must still be present
        expect(after.body_md).toContain('lesson1');
        // style1 must still be present
        expect(after.body_md).toContain('style1');
    });

    it('appendLesson on body not ending with newline adds sep before the new section', async () => {
        // Covers the `existingBody.endsWith("\\n") ? "" : "\\n"` false branch.
        // Body ends with no trailing newline.
        const body = '# Memory\n\nSome content without trailing newline';
        const a = await agentsService.create(base);
        await agentMemoryService.put(a.id, body);
        const after = await agentMemoryService.appendLesson(a.id, 'my first lesson');
        expect(after.body_md).toContain('## Course corrections');
        expect(after.body_md).toContain('my first lesson');
    });
});
