import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { IAgent } from '@atlas/shared';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { compilePromptFor } from './compile-prompt.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';
import { db } from '../db/kysely-client.js';

function freedomAgent(over: Partial<IAgent> = {}): IAgent {
    return {
        id: 'agent-freedom',
        name: 'Freedom Scout',
        category: 'content',
        cli: 'claude',
        model: 'claude-opus-4-7',
        framework: 'scout',
        prompt_md: 'Be a freedom-mode scout.',
        prompt_version: 1,
        status: 'active',
        accent_color: '#FACC15',
        sort_order: 1,
        description: '',
        designation: '',
        max_rounds: 5,
        requires_item: false,
        schedule_hours: 0,
        concurrent_runs: 1,
        glyph: '',
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
        ...over,
    };
}

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('compilePromptFor — issue not found', () => {
    it('throws when item params are provided but item does not exist in DB', async () => {
        await expect(
            compilePromptFor(freedomAgent(), 'story', 'CPT-NOTEXIST'),
        ).rejects.toThrow(/CPT-NOTEXIST/);
    });
});

describe('compilePromptFor — freedom mode', () => {
    it('returns issue:null and a freedom-mode filename when called with null item params', async () => {
        const result = await compilePromptFor(freedomAgent(), null, null);

        expect(result.issue).toBeNull();
        expect(result.filename).toMatch(/^prompt-freedom-scout-freedom-\d{8}-\d{6}\.md$/);
        expect(result.prompt).toContain('# Freedom Run');
        // The freedom preamble should NOT include any item context block.
        expect(result.prompt).not.toContain('# Current Task');
        // Regression — the constitution header used to render twice because
        // buildConstitutionMarkdown emitted it AND every buildPrompt branch
        // wrapped its output with another copy.
        const constitutionHeader = /^# Atlas Constitution \(System Rules — read first\)$/gm;
        expect(result.prompt.match(constitutionHeader)?.length ?? 0).toBe(1);
    });

    it('returns issue + item-attached filename when called with both item params', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent({ id: 'agent-coder' });
        await insertItem({ id: 'ATL-100', type: 'epic', project_id: 'p1', title: 'E' });
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
            title: 'A story',
        });

        const agent = await db
            .selectFrom('agents')
            .selectAll()
            .where('id', '=', 'agent-coder')
            .executeTakeFirstOrThrow();

        const result = await compilePromptFor(agent as unknown as IAgent, 'story', 'ATL-1');

        expect(result.issue).toEqual({ type: 'story', id: 'ATL-1', title: 'A story' });
        expect(result.filename).toMatch(/^prompt-coder-story-ATL-1-\d{8}-\d{6}\.md$/);
        expect(result.prompt).toContain('# Current Task');
    });
});

describe('compilePromptFor — slugify fallback (CPT-SLUG)', () => {
    it('uses "agent" as slug when agent name contains only non-alphanumeric chars (CPT-SLUG-1)', async () => {
        // Agent name "---" → slugify returns "" → || "agent" fires (line 33).
        const result = await compilePromptFor(freedomAgent({ name: '---' }), null, null);
        expect(result.filename).toMatch(/^prompt-agent-freedom-\d{8}-\d{6}\.md$/);
    });
});
