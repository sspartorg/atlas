import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { issueFullService } from './issue-full.js';
import { itemLinks } from './item-links.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { seedFullTree } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await seedFullTree();
});

afterAll(async () => {
    await closeTestDb();
});

describe('issueFullService', () => {
    describe('story', () => {
        it('returns the story with epic, project, sub-tasks, sub-bugs, links, activity, agents', async () => {
            const res = (await issueFullService.story('ATL-2'))!;
            expect(res.story.id).toBe('ATL-2');
            expect(res.epic!.id).toBe('ATL-1');
            expect(res.project!.id).toBe('p1');
            expect(res.sub_tasks).toHaveLength(1);
            expect(res.sub_bugs).toHaveLength(1);
            expect(res.agents).toHaveLength(1);
            expect(Array.isArray(res.related_links)).toBe(true);
            expect(Array.isArray(res.activity)).toBe(true);
        });

        it('returns null for missing id', async () => {
            expect(await issueFullService.story('nope')).toBeNull();
        });
    });

    describe('bug', () => {
        it('returns the bug with epic + project', async () => {
            const res = (await issueFullService.bug('ATL-5'))!;
            expect(res.bug.id).toBe('ATL-5');
            expect(res.epic!.id).toBe('ATL-1');
            expect(res.project!.id).toBe('p1');
        });

        it('returns null for missing', async () => {
            expect(await issueFullService.bug('nope')).toBeNull();
        });
    });

    describe('subTask', () => {
        it('returns sub-task with parent story, epic, project', async () => {
            const res = (await issueFullService.subTask('ATL-3'))!;
            expect(res.sub_task.id).toBe('ATL-3');
            expect(res.parent_story!.id).toBe('ATL-2');
            expect(res.epic!.id).toBe('ATL-1');
            expect(res.project!.id).toBe('p1');
        });

        it('returns null for missing id', async () => {
            expect(await issueFullService.subTask('nope')).toBeNull();
        });
    });

    describe('subBug', () => {
        it('returns sub-bug with parent story, epic, project', async () => {
            const res = (await issueFullService.subBug('ATL-4'))!;
            expect(res.sub_bug.id).toBe('ATL-4');
            expect(res.parent_story!.id).toBe('ATL-2');
            expect(res.epic!.id).toBe('ATL-1');
            expect(res.project!.id).toBe('p1');
        });

        it('returns null for missing id', async () => {
            expect(await issueFullService.subBug('nope')).toBeNull();
        });
    });

    describe('epic', () => {
        it('returns the epic with project + stories + bugs', async () => {
            const res = (await issueFullService.epic('ATL-1'))!;
            expect(res.epic.id).toBe('ATL-1');
            expect(res.project!.id).toBe('p1');
            expect(res.stories).toHaveLength(1);
            expect(res.bugs).toHaveLength(1);
            expect(res.agents).toHaveLength(1);
        });

        it('returns null for missing', async () => {
            expect(await issueFullService.epic('nope')).toBeNull();
        });
    });

    describe('round_count null branch (no assignee)', () => {
        it('returns round_count=null for story with no assignee_agent_id', async () => {
            // seedFullTree inserts items without assignee_agent_id (defaults null).
            // roundCountFor(id, null) → returns null immediately.
            const res = (await issueFullService.story('ATL-2'))!;
            expect(res.round_count).toBeNull();
        });

        it('returns round_count=null for epic with no assignee_agent_id', async () => {
            const res = (await issueFullService.epic('ATL-1'))!;
            expect(res.round_count).toBeNull();
        });
    });

    describe('related_links shape', () => {
        it('maps each item-link row through to the IIssueLinkRow projection', async () => {
            const created = await itemLinks.create('ATL-2', 'ATL-5', 'relates_to');
            expect(created.ok).toBe(true);
            const res = (await issueFullService.story('ATL-2'))!;
            expect(res.related_links).toHaveLength(1);
            const link = res.related_links[0]!;
            expect(link.item_id).toBe('ATL-5');
            expect(link.relation_type).toBe('relates_to');
            expect(link.title).toBeDefined();
            expect(link.status).toBeDefined();
            expect(link.created_at).toBeDefined();
        });
    });

});
