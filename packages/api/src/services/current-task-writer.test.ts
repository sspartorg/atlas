import { describe, expect, it, beforeEach, afterAll, afterEach, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCurrentTask } from './current-task-writer.js';
import { commentsService } from './comments.js';
import { itemLinks } from './item-links.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

let worktreePath: string;
const cleanupDirs: string[] = [];

function makeWorktree(): string {
    const p = mkdtempSync(join(tmpdir(), 'atlas-current-task-test-'));
    cleanupDirs.push(p);
    return p;
}

beforeEach(async () => {
    await truncateAll();
    worktreePath = makeWorktree();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
});

afterEach(() => {
    while (cleanupDirs.length > 0) {
        const p = cleanupDirs.pop()!;
        try {
            rmSync(p, { recursive: true, force: true });
        } catch {
            // ignore — tmpdir cleanup is best-effort
        }
    }
});

afterAll(async () => {
    await closeTestDb();
});

describe('writeCurrentTask', () => {
    it('writes .atlas/current-task.md with the expected core sections', async () => {
        await insertItem({
            id: 'ATL-10',
            type: 'epic',
            project_id: 'p1',
            title: 'Cool Epic',
            description: 'Epic-level description.',
        });
        await insertItem({
            id: 'ATL-11',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-10',
            parent_type: 'epic',
            title: 'Implement widget',
            description: 'Widget description.',
        });

        await commentsService.create({
            author: 'owner',
            issue_type: 'story',
            issue_id: 'ATL-11',
            body: 'first owner clarification',
        });
        await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'story',
            issue_id: 'ATL-11',
            body: 'agent ack',
        });

        const result = await writeCurrentTask({
            worktreePath,
            issueType: 'story',
            issueId: 'ATL-11',
        });

        expect(result.currentTaskPath).toBe(join(worktreePath, '.atlas', 'current-task.md'));
        expect(existsSync(result.currentTaskPath)).toBe(true);

        const body = readFileSync(result.currentTaskPath, 'utf8');
        expect(body).toContain('# Current Task');
        expect(body).toContain('**Issue type:** story');
        expect(body).toContain('**Issue ID:** ATL-11');
        expect(body).toContain('**Project:** Project p1');
        expect(body).toContain('**Epic:** Cool Epic');
        expect(body).toContain('**Epic description:** Epic-level description.');
        expect(body).toContain('## Title');
        expect(body).toContain('Implement widget');
        expect(body).toContain('## Description');
        expect(body).toContain('Widget description.');
        expect(body).toContain('## Discussion');
        expect(body).toContain('first owner clarification');
        expect(body).toContain('agent ack');
    });

    it('renders the Existing Spec section when spec_md is populated', async () => {
        await insertItem({
            id: 'ATL-19',
            type: 'epic',
            project_id: 'p1',
            title: 'Parent epic',
        });
        await insertItem({
            id: 'ATL-20',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-19',
            parent_type: 'epic',
            title: 'Spec-bearing story',
            description: 'Stub description.',
            spec_md: '# Spec\n\nThis is the design doc.',
        });

        await writeCurrentTask({
            worktreePath,
            issueType: 'story',
            issueId: 'ATL-20',
        });

        const body = readFileSync(
            join(worktreePath, '.atlas', 'current-task.md'),
            'utf8',
        );
        expect(body).toContain('## Existing Spec');
        expect(body).toContain('# Spec\n\nThis is the design doc.');
    });

    it('does not crash when the comment thread is empty', async () => {
        await insertItem({
            id: 'ATL-29',
            type: 'epic',
            project_id: 'p1',
            title: 'Parent epic 2',
        });
        await insertItem({
            id: 'ATL-30',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-29',
            parent_type: 'epic',
            title: 'No-discussion story',
            description: 'Just the seed.',
        });

        await expect(
            writeCurrentTask({
                worktreePath,
                issueType: 'story',
                issueId: 'ATL-30',
            }),
        ).resolves.toBeDefined();

        const body = readFileSync(
            join(worktreePath, '.atlas', 'current-task.md'),
            'utf8',
        );
        expect(body).toContain('## Discussion');
        // formatComments emits the empty-thread placeholder verbatim.
        expect(body).toContain('_(no comments yet');
    });

    it('renders the Related items section when depends_on / relates_to rows exist', async () => {
        await insertItem({
            id: 'ATL-39',
            type: 'epic',
            project_id: 'p1',
            title: 'Parent epic 3',
        });
        await insertItem({
            id: 'ATL-40',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-39',
            parent_type: 'epic',
            title: 'Upstream dep',
            description: 'I block ATL-41.',
            acceptance_criteria: '- Must do thing',
        });
        await insertItem({
            id: 'ATL-41',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-39',
            parent_type: 'epic',
            title: 'The story',
            description: 'depends on ATL-40',
        });
        await insertItem({
            id: 'ATL-42',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-39',
            parent_type: 'epic',
            title: 'Sibling note',
            description: 'related but not blocking',
        });
        await itemLinks.create('ATL-41', 'ATL-40', 'depends_on');
        await itemLinks.create('ATL-41', 'ATL-42', 'relates_to');

        await writeCurrentTask({
            worktreePath,
            issueType: 'story',
            issueId: 'ATL-41',
        });

        const body = readFileSync(
            join(worktreePath, '.atlas', 'current-task.md'),
            'utf8',
        );
        expect(body).toContain('## Related items');
        expect(body).toContain('### Depends on');
        expect(body).toContain('ATL-40');
        expect(body).toContain('### Relates to');
        expect(body).toContain('ATL-42');
    });

    it('overwrites a stale current-task.md from a prior run', async () => {
        // Pre-seed a stale file before the writer touches the directory.
        const atlasDir = join(worktreePath, '.atlas');
        mkdirSync(atlasDir, { recursive: true });
        const stalePath = join(atlasDir, 'current-task.md');
        writeFileSync(stalePath, 'STALE CONTENT FROM PRIOR RUN', 'utf8');

        await insertItem({
            id: 'ATL-49',
            type: 'epic',
            project_id: 'p1',
            title: 'Parent epic 4',
        });
        await insertItem({
            id: 'ATL-50',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-49',
            parent_type: 'epic',
            title: 'Fresh story',
            description: 'fresh body',
        });

        await writeCurrentTask({
            worktreePath,
            issueType: 'story',
            issueId: 'ATL-50',
        });

        const body = readFileSync(stalePath, 'utf8');
        expect(body).not.toContain('STALE CONTENT FROM PRIOR RUN');
        expect(body).toContain('# Current Task');
        expect(body).toContain('Fresh story');
    });

    it('throws when the item is not found', async () => {
        await expect(
            writeCurrentTask({
                worktreePath,
                issueType: 'story',
                issueId: 'ATL-DOES-NOT-EXIST',
            }),
        ).rejects.toThrow(/not found/i);
    });

    it('throws when neither issueType+issueId nor userPrompt is provided', async () => {
        await expect(
            writeCurrentTask({ worktreePath }),
        ).rejects.toThrow(/at least one of/i);
    });

    it('throws when userPrompt is whitespace-only (treated as no prompt)', async () => {
        await expect(
            writeCurrentTask({ worktreePath, userPrompt: '   ' }),
        ).rejects.toThrow(/at least one of/i);
    });

    it('writes file with User\'s initial prompt section when only userPrompt is provided', async () => {
        const result = await writeCurrentTask({ worktreePath, userPrompt: 'hello world' });

        expect(result.currentTaskPath).toBe(join(worktreePath, '.atlas', 'current-task.md'));
        expect(existsSync(result.currentTaskPath)).toBe(true);

        const body = readFileSync(result.currentTaskPath, 'utf8');
        expect(body).toContain('# Current Task');
        expect(body).toContain("## User's initial prompt");
        expect(body).toContain('hello world');
        // Should NOT contain item-specific sections
        expect(body).not.toContain('**Issue type:**');
        expect(body).not.toContain('## Description');
    });
});
