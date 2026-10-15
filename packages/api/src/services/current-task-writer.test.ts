import { describe, expect, it, beforeEach, afterAll, afterEach, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCurrentTask } from './current-task-writer.js';
import { commentsService } from './comments.js';
import { itemLinks } from './item-links.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
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
            type: 'task',
            project_id: 'p1',
            title: 'Cool Task',
            description: 'Task-level description.',
            spec_md: 'Task spec.',
        });
        await insertItem({
            id: 'ATL-11',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-10',
            parent_type: 'task',
            title: 'Implement widget',
            description: 'Widget description.',
        });

        await commentsService.create({
            author: 'owner',
            issue_type: 'sub_task',
            issue_id: 'ATL-11',
            body: 'first owner clarification',
        });
        await commentsService.create({
            author: 'agent',
            agent_id: 'agent-coder',
            issue_type: 'sub_task',
            issue_id: 'ATL-11',
            body: 'agent ack',
        });

        const result = await writeCurrentTask({
            worktreePath,
            issueType: 'sub_task',
            issueId: 'ATL-11',
        });

        expect(result.currentTaskPath).toBe(join(worktreePath, '.atlas', 'current-task.md'));
        expect(existsSync(result.currentTaskPath)).toBe(true);

        const body = readFileSync(result.currentTaskPath, 'utf8');
        expect(body).toContain('# Current Task');
        expect(body).toContain('**Issue type:** sub_task');
        expect(body).toContain('**Issue ID:** ATL-11');
        expect(body).toContain('**Project:** Project p1');
        expect(body).toContain('**Task:** Cool Task (ATL-10)');
        expect(body).toContain('### Task description\nTask-level description.');
        expect(body).toContain('### Task spec\nTask spec.');
        expect(body).toContain('## Title');
        expect(body).toContain('Implement widget');
        expect(body).toContain('## Description');
        expect(body).toContain('Widget description.');
        expect(body).toContain('## Discussion');
        expect(body).toContain('first owner clarification');
        expect(body).toContain('agent ack');
    });

    it('renders the Existing Spec section when a task has spec_md', async () => {
        await insertItem({
            id: 'ATL-20',
            type: 'task',
            project_id: 'p1',
            title: 'Spec-bearing task',
            description: 'Stub description.',
            spec_md: '# Spec\n\nThis is the design doc.',
        });

        await writeCurrentTask({
            worktreePath,
            issueType: 'task',
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
            type: 'task',
            project_id: 'p1',
            title: 'Parent task 2',
        });
        await insertItem({
            id: 'ATL-30',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-29',
            parent_type: 'task',
            title: 'No-discussion sub-task',
            description: 'Just the seed.',
        });

        await expect(
            writeCurrentTask({
                worktreePath,
                issueType: 'sub_task',
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
            type: 'task',
            project_id: 'p1',
            title: 'Parent task 3',
        });
        await insertItem({
            id: 'ATL-40',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-39',
            parent_type: 'task',
            title: 'Upstream dep',
            description: 'I block ATL-41.',
            acceptance_criteria: '- Must do thing',
        });
        await insertItem({
            id: 'ATL-41',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-39',
            parent_type: 'task',
            title: 'The sub-task',
            description: 'depends on ATL-40',
        });
        await insertItem({
            id: 'ATL-42',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-39',
            parent_type: 'task',
            title: 'Sibling note',
            description: 'related but not blocking',
        });
        await itemLinks.create('ATL-41', 'ATL-40', 'depends_on');
        await itemLinks.create('ATL-41', 'ATL-42', 'relates_to');

        await writeCurrentTask({
            worktreePath,
            issueType: 'sub_task',
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
            type: 'task',
            project_id: 'p1',
            title: 'Parent task 4',
        });
        await insertItem({
            id: 'ATL-50',
            type: 'sub_task',
            project_id: 'p1',
            parent_id: 'ATL-49',
            parent_type: 'task',
            title: 'Fresh sub-task',
            description: 'fresh body',
        });

        await writeCurrentTask({
            worktreePath,
            issueType: 'sub_task',
            issueId: 'ATL-50',
        });

        const body = readFileSync(stalePath, 'utf8');
        expect(body).not.toContain('STALE CONTENT FROM PRIOR RUN');
        expect(body).toContain('# Current Task');
        expect(body).toContain('Fresh sub-task');
    });

    it('throws when the item is not found', async () => {
        await expect(
            writeCurrentTask({
                worktreePath,
                issueType: 'sub_task',
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

describe('writeCurrentTask — Jira attachments', () => {
    it('stages the Task\'s copied Jira files into .atlas/attachments and lists them', async () => {
        const taskId = await insertItem({ type: 'task', project_id: 'p1', title: 'T' });
        const store = mkdtempSync(join(tmpdir(), 'atlas-att-'));
        cleanupDirs.push(store);
        writeFileSync(join(store, 'shot'), 'png-bytes');
        await testDb.insertInto('jira_issues').values({ jira_key: 'JIR-1', item_id: taskId, jira_id: '1', url: 'u', raw: '{}' } as never).execute();
        await testDb
            .insertInto('jira_attachments')
            .values([
                { id: '10', jira_key: 'JIR-1', filename: 'shot.png', mime_type: 'image/png', size: 9, path: join(store, 'shot') },
                { id: '11', jira_key: 'JIR-1', filename: 'huge.mov', mime_type: 'video/quicktime', size: 1, path: null, skipped_reason: 'over 25 MB' },
            ] as never)
            .execute();

        // A sub-task sees its parent Task's files too.
        const subId = await insertItem({ type: 'sub_task', project_id: 'p1', title: 'S', parent_id: taskId, parent_type: 'task' } as never);
        for (const [type, id] of [['task', taskId], ['sub_task', subId]] as const) {
            const wt = makeWorktree();
            const { currentTaskPath } = await writeCurrentTask({ worktreePath: wt, issueType: type, issueId: id });
            const body = readFileSync(currentTaskPath, 'utf8');
            expect(body).toContain('## Attachment files');
            expect(body).toContain('- `.atlas/attachments/shot.png`');
            expect(body).not.toContain('huge.mov');
            expect(readFileSync(join(wt, '.atlas', 'attachments', 'shot.png'), 'utf8')).toBe('png-bytes');
        }
    });

    it('two files with the same name both reach the agent', async () => {
        const taskId = await insertItem({ type: 'task', project_id: 'p1', title: 'T' });
        const store = mkdtempSync(join(tmpdir(), 'atlas-att-'));
        cleanupDirs.push(store);
        writeFileSync(join(store, 'one'), 'first');
        writeFileSync(join(store, 'two'), 'second');
        await testDb.insertInto('jira_issues').values({ jira_key: 'JIR-2', item_id: taskId, jira_id: '2', url: 'u', raw: '{}' } as never).execute();
        await testDb
            .insertInto('jira_attachments')
            .values([
                { id: '20', jira_key: 'JIR-2', filename: 'log.txt', mime_type: 'text/plain', size: 5, path: join(store, 'one') },
                { id: '21', jira_key: 'JIR-2', filename: 'log.txt', mime_type: 'text/plain', size: 6, path: join(store, 'two') },
            ] as never)
            .execute();
        const { currentTaskPath } = await writeCurrentTask({ worktreePath, issueType: 'task', issueId: taskId });
        const body = readFileSync(currentTaskPath, 'utf8');
        expect(body).toContain('- `.atlas/attachments/log.txt`');
        expect(body).toContain('- `.atlas/attachments/21-log.txt`');
        expect(readFileSync(join(worktreePath, '.atlas', 'attachments', '21-log.txt'), 'utf8')).toBe('second');
    });

    it('writes no attachments section for a Task without Jira files', async () => {
        const taskId = await insertItem({ type: 'task', project_id: 'p1', title: 'T' });
        const { currentTaskPath } = await writeCurrentTask({ worktreePath, issueType: 'task', issueId: taskId });
        expect(readFileSync(currentTaskPath, 'utf8')).not.toContain('## Attachment files');
        expect(existsSync(join(worktreePath, '.atlas', 'attachments'))).toBe(false);
    });
});

