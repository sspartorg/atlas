import { describe, expect, it, beforeEach, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverItem } from './recover-architect-stranded.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

const ARCHITECT = 'agent-architect';
const ARCHITECT_REVIEWER = 'agent-architect-reviewer';

// Make a real temp worktree with the right shape so the recovery
// script's spec lookup exercises the same filesystem code path it
// would in production.
function makeWorktreeWithSpec(slug: string, contents: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-rec-'));
    const specDir = path.join(root, 'specs', slug);
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), contents, 'utf8');
    return root;
}

function makeEmptyWorktree(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-rec-'));
}

const tempRoots: string[] = [];
function track(p: string): string {
    tempRoots.push(p);
    return p;
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'MON');
    await insertAgent({ id: ARCHITECT, name: 'Architect' });
    await insertAgent({ id: ARCHITECT_REVIEWER, name: 'Architect Reviewer' });
    await insertItem({ id: 'MON-1', type: 'epic', project_id: 'p1', title: 'Epic' });
});

afterEach(() => {
    for (const p of tempRoots.splice(0)) {
        try {
            fs.rmSync(p, { recursive: true, force: true });
        } catch {
            /* test cleanup is best-effort */
        }
    }
});

afterAll(async () => {
    await closeTestDb();
});

async function setStrandedItem(itemId: string, worktreePath: string | null): Promise<void> {
    await testDb
        .insertInto('items')
        .values({
            id: itemId,
            type: 'story',
            project_id: 'p1',
            parent_id: 'MON-1',
            parent_type: 'epic',
            title: 'Stranded story',
            description: '',
            status: 'in_review',
            priority: 'normal',
            assignee_agent_id: ARCHITECT,
            spec_md: null,
            worktree_path: worktreePath,
            worktree_branch: worktreePath ? 'atlas/dev/MON-X' : null,
        })
        .execute();
}

async function readState(itemId: string) {
    return testDb
        .selectFrom('items')
        .select(['status', 'assignee_agent_id', 'spec_md'])
        .where('id', '=', itemId)
        .executeTakeFirst();
}

describe('recoverItem — Architect-stranded item recovery', () => {
    it('backfills spec_md and routes to Architect Reviewer when spec.md is on the worktree', async () => {
        const worktree = track(makeWorktreeWithSpec('1-bootstrap', '# Spec\n\nfeasibility...'));
        await setStrandedItem('MON-10', worktree);

        const result = await recoverItem('MON-10');

        expect(result.outcome).toBe('recovered_with_spec');
        const post = await readState('MON-10');
        expect(post?.status).toBe('ready');
        expect(post?.assignee_agent_id).toBe(ARCHITECT_REVIEWER);
        expect(post?.spec_md).toBe('# Spec\n\nfeasibility...');
    });

    it('resets to ready/Architect when no spec.md exists on the worktree', async () => {
        const worktree = track(makeEmptyWorktree());
        await setStrandedItem('MON-11', worktree);

        const result = await recoverItem('MON-11');

        expect(result.outcome).toBe('reset_no_spec');
        const post = await readState('MON-11');
        expect(post?.status).toBe('ready');
        expect(post?.assignee_agent_id).toBe(ARCHITECT);
        expect(post?.spec_md).toBeNull();
    });

    it('resets to ready/Architect when worktree_path is null', async () => {
        await setStrandedItem('MON-12', null);

        const result = await recoverItem('MON-12');

        expect(result.outcome).toBe('reset_no_spec');
        const post = await readState('MON-12');
        expect(post?.status).toBe('ready');
        expect(post?.assignee_agent_id).toBe(ARCHITECT);
    });

    it('is idempotent on a recovered item (no double-write)', async () => {
        const worktree = track(makeWorktreeWithSpec('1-bootstrap', '# Spec'));
        await setStrandedItem('MON-13', worktree);

        await recoverItem('MON-13');
        const result2 = await recoverItem('MON-13');

        expect(result2.outcome).toBe('already_recovered');
    });

    it('returns not_found for a non-existent id', async () => {
        const result = await recoverItem('MON-NOPE');
        expect(result.outcome).toBe('not_found');
    });

    it('refuses to touch an item that is not in the stranded shape', async () => {
        // Item is `done`, not in_review — must not be reset.
        await testDb
            .insertInto('items')
            .values({
                id: 'MON-14',
                type: 'story',
                project_id: 'p1',
                parent_id: 'MON-1',
                parent_type: 'epic',
                title: 'Already done',
                description: '',
                status: 'done',
                priority: 'normal',
                assignee_agent_id: null,
                spec_md: 'something',
                worktree_path: null,
            })
            .execute();

        const result = await recoverItem('MON-14');
        expect(result.outcome).toBe('not_stranded');
        const post = await readState('MON-14');
        expect(post?.status).toBe('done');
        expect(post?.spec_md).toBe('something');
    });
});
