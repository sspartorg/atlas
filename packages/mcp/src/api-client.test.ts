import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, AtlasApiError } from './api-client.js';
import type { IAgent } from '@atlas/shared';

const config = {
    apiBase: 'http://api.test',
    requestTimeoutMs: 5000,
    mcpToken: 'unit-secret',
};

const okJson = (body: unknown) =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });

const okEmpty = () => new Response(null, { status: 204 });

const sampleAgent: IAgent = {
    id: 'a1',
    name: 'PO Writer',
    category: 'software-dev',
    cli: 'claude',
    model: 'claude-opus-4-7',
    framework: '',
    prompt_md: '',
    prompt_version: 1,
    handoff_prompt_md: '',
    status: 'active',
    accent_color: '#007AC9',
    sort_order: 1,
    description: '',
    designation: '',
    kind: 'performer',
    reviewer_agent_id: null,
    max_rounds: 5,
    requires_item: true,
    schedule_hours: 6,
    concurrent_runs: 1,
    glyph: '',
    created_at: '2026-05-18T00:00:00Z',
    updated_at: '2026-05-18T00:00:00Z',
};

afterEach(() => vi.restoreAllMocks());

describe('createApiClient — agent endpoints', () => {
    it('listAgents hits /api/agents with GET and no token header', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson([sampleAgent]));
        const out = await createApiClient(config).listAgents();
        expect(out).toEqual([sampleAgent]);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/agents');
        expect((init as RequestInit).method).toBe('GET');
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['X-Atlas-Token']).toBeUndefined();
    });

    it('getAgent fans out to three parallel GETs', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson(sampleAgent))
            .mockResolvedValueOnce(okJson([]))
            .mockResolvedValueOnce(okJson([]));
        const out = await createApiClient(config).getAgent('a1');
        const urls = fetchSpy.mock.calls.map((c) => c[0]).sort();
        expect(urls).toEqual([
            'http://api.test/api/agents/a1',
            'http://api.test/api/agents/a1/checklists',
            'http://api.test/api/agents/a1/handoff-rules',
        ]);
        expect(out.agent).toEqual(sampleAgent);
    });

    it('createAgent POSTs the payload with the token header, then re-fetches the composite', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ ...sampleAgent, id: 'a1' })) // POST
            .mockResolvedValueOnce(okJson(sampleAgent)) // GET agent
            .mockResolvedValueOnce(okJson([])) // handoff
            .mockResolvedValueOnce(okJson([])); // checklists
        await createApiClient(config).createAgent({
            id: 'a1',
            name: 'PO Writer',
            category: 'software-dev',
            cli: 'claude',
            model: 'claude-opus-4-7',
            accent_color: '#007AC9',
        });
        const [postUrl, postInit] = fetchSpy.mock.calls[0]!;
        expect(postUrl).toBe('http://api.test/api/agents');
        expect((postInit as RequestInit).method).toBe('POST');
        const headers = (postInit as RequestInit).headers as Record<string, string>;
        expect(headers['X-Atlas-Token']).toBe('unit-secret');
        expect(headers['Content-Type']).toBe('application/json');
        expect(JSON.parse((postInit as RequestInit).body as string)).toMatchObject({
            id: 'a1',
            name: 'PO Writer',
        });
    });

    it('updateAgent PATCHes and refetches', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson(sampleAgent)) // PATCH
            .mockResolvedValueOnce(okJson(sampleAgent))
            .mockResolvedValueOnce(okJson([]))
            .mockResolvedValueOnce(okJson([]));
        await createApiClient(config).updateAgent('a1', {
            description: 'New description',
        });
        const [patchUrl, patchInit] = fetchSpy.mock.calls[0]!;
        expect(patchUrl).toBe('http://api.test/api/agents/a1');
        expect((patchInit as RequestInit).method).toBe('PATCH');
        const headers = (patchInit as RequestInit).headers as Record<string, string>;
        expect(headers['X-Atlas-Token']).toBe('unit-secret');
    });

    it('tolerates empty 204 responses (decoded as undefined)', async () => {
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okEmpty()) // PATCH returns 204
            .mockResolvedValueOnce(okJson(sampleAgent))
            .mockResolvedValueOnce(okJson([]))
            .mockResolvedValueOnce(okJson([]));
        const out = await createApiClient(config).updateAgent('a1', { description: 'x' });
        expect(out.agent).toEqual(sampleAgent);
    });

    it('encodes id segments with reserved characters', async () => {
        // getAgent fires four parallel requests; each call needs its own Response
        // instance because a body can only be read once.
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (url) => {
                if (typeof url === 'string' && url.endsWith('/weird%20id%2Fslash')) {
                    return okJson(sampleAgent);
                }
                return okJson([]);
            });
        await createApiClient(config).getAgent('weird id/slash');
        const urls = fetchSpy.mock.calls.map((c) => c[0] as string);
        expect(urls).toContain('http://api.test/api/agents/weird%20id%2Fslash');
        expect(urls).toContain(
            'http://api.test/api/agents/weird%20id%2Fslash/handoff-rules'
        );
    });

    it('throws AtlasApiError on non-2xx with snippet body', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } })
        );
        const err = await createApiClient(config).listAgents().catch((e) => e);
        expect(err).toBeInstanceOf(AtlasApiError);
        expect(err.status).toBe(500);
        expect(err.bodySnippet).toBe('boom');
        expect(err.message).toContain('500');
    });

    it('coalesces unreadable error bodies to an empty snippet', async () => {
        const broken = new Response('ignored', { status: 502 });
        vi.spyOn(broken, 'text').mockRejectedValue(new Error('stream broken'));
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(broken);
        const err = await createApiClient(config).listAgents().catch((e) => e);
        expect(err).toBeInstanceOf(AtlasApiError);
        expect(err.bodySnippet).toBe('');
    });

    it('truncates the error snippet at 200 chars', async () => {
        const long = 'x'.repeat(500);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(long, { status: 400, headers: { 'content-type': 'text/plain' } })
        );
        const err = await createApiClient(config).listAgents().catch((e) => e);
        expect(err.bodySnippet.length).toBe(200);
    });

    it('aborts the request when the configured timeout fires', async () => {
        vi.useFakeTimers();
        try {
            vi.spyOn(globalThis, 'fetch').mockImplementation(
                (_url, init) =>
                    new Promise((_resolve, reject) => {
                        const signal = (init as RequestInit | undefined)?.signal;
                        signal?.addEventListener('abort', () =>
                            reject(new DOMException('aborted', 'AbortError'))
                        );
                    })
            );
            const promise = createApiClient({
                apiBase: 'http://api.test',
                requestTimeoutMs: 100,
                mcpToken: '',
            }).listAgents();
            const settled = vi.fn();
            promise.catch(settled);
            await vi.advanceTimersByTimeAsync(150);
            await Promise.resolve();
            expect(settled).toHaveBeenCalled();
            const [err] = settled.mock.calls[0] ?? [];
            expect((err as Error).name).toBe('AbortError');
        } finally {
            vi.useRealTimers();
        }
    });

    it('omits the token header when mcpToken is empty', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson(sampleAgent))
            .mockResolvedValueOnce(okJson(sampleAgent))
            .mockResolvedValueOnce(okJson([]))
            .mockResolvedValueOnce(okJson([]))
            .mockResolvedValueOnce(okJson([]));
        await createApiClient({
            apiBase: 'http://api.test',
            requestTimeoutMs: 5000,
            mcpToken: '',
        }).updateAgent('a1', { description: 'x' });
        const [, init] = fetchSpy.mock.calls[0]!;
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['X-Atlas-Token']).toBeUndefined();
    });
});

describe('createApiClient — sub-task / sub-bug endpoints', () => {
    // Sub-tasks and sub-bugs are nested resources under a story. The
    // REST surface is /api/stories/:id/sub-{tasks,bugs}, not a flat
    // /api/sub-{tasks,bugs}. Prior to this fix, the api-client posted
    // to the flat URL and every QA Writer createSubTask call 404'd —
    // see the MON-6 incident. The test locks the URL shape so the
    // route mismatch can't drift back.

    it('createSubTask posts to /api/stories/:id/sub-tasks', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ id: 'ST1', story_id: 'ATL-2' }));
        await createApiClient(config).createSubTask({
            story_id: 'ATL-2',
            title: 'Wire X',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/stories/ATL-2/sub-tasks');
        expect((init as RequestInit).method).toBe('POST');
        // story_id is in the URL; body must not duplicate it (route's
        // schema re-injects it from the path, but keeping the body
        // narrow makes the contract clearer).
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).not.toHaveProperty('story_id');
        expect(body.title).toBe('Wire X');
    });

    it('createSubBug posts to /api/stories/:id/sub-bugs', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ id: 'SB1', story_id: 'ATL-2' }));
        await createApiClient(config).createSubBug({
            story_id: 'ATL-2',
            title: 'Crash on save',
            steps_to_reproduce: '...',
            expected: '...',
            actual: '...',
            frequency: 'sometimes',
            failure_scope: 'cosmetic',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/stories/ATL-2/sub-bugs');
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).not.toHaveProperty('story_id');
        expect(body.title).toBe('Crash on save');
    });

    it('createSubTask URL-encodes the story id', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ id: 'ST1' }));
        await createApiClient(config).createSubTask({
            story_id: 'ATL 2/x',
            title: 't',
        });
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/stories/ATL%202%2Fx/sub-tasks');
    });
});

describe('createApiClient — agent lifecycle gaps (delete + memory + runs)', () => {
    it('deleteAgent issues a DELETE with the token header', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okEmpty());
        await createApiClient(config).deleteAgent('a1');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/agents/a1');
        expect((init as RequestInit).method).toBe('DELETE');
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['X-Atlas-Token']).toBe('unit-secret');
    });

    it('getAgentMemory hits /memory with GET', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ agent_id: 'a1', body_md: '#m', version: 2 }));
        const out = await createApiClient(config).getAgentMemory('a1');
        expect(out.agent_id).toBe('a1');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/agents/a1/memory');
        expect((init as RequestInit).method).toBe('GET');
    });

    it('updateAgentMemory PUTs the payload with the token header', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ agent_id: 'a1', body_md: '#m', version: 3 }));
        await createApiClient(config).updateAgentMemory('a1', {
            body_md: '## section\n- note',
            mode: 'append',
            source: 'ai-generated',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/agents/a1/memory');
        expect((init as RequestInit).method).toBe('PUT');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.mode).toBe('append');
        expect(body.body_md).toContain('- note');
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['X-Atlas-Token']).toBe('unit-secret');
    });

    it('listAgentRuns GETs /runs', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson([{ id: 'r1', agent_id: 'a1' }]));
        const out = await createApiClient(config).listAgentRuns('a1');
        expect(out).toEqual([{ id: 'r1', agent_id: 'a1' }]);
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/agents/a1/runs');
    });
});

describe('createApiClient — marketplace', () => {
    it('searchMarketplaceAgents builds a query string from filters', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson([]));
        await createApiClient(config).searchMarketplaceAgents({
            query: 'po',
            category: 'software-dev',
            kind_slug: 'jira-to-epic',
            limit: 5,
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toContain('/api/marketplace/agents?');
        expect(url).toContain('q=po');
        expect(url).toContain('category=software-dev');
        expect(url).toContain('kind=jira-to-epic');
        expect(url).toContain('limit=5');
        expect((init as RequestInit).method).toBe('GET');
    });

    it('searchMarketplaceAgents omits the qs entirely when no filters supplied', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson([]));
        await createApiClient(config).searchMarketplaceAgents({});
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/marketplace/agents');
    });

    it('getMarketplaceAgent fetches a single composite by id', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ agent: { id: 'mp1' } }));
        await createApiClient(config).getMarketplaceAgent('mp1');
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/marketplace/agents/mp1');
    });
});

describe('createApiClient — issue create endpoints', () => {
    it('getEpic GETs /api/epics/:id', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'E1' }));
        await createApiClient(config).getEpic('E1');
        expect(fetchSpy.mock.calls[0]![0]).toBe('http://api.test/api/epics/E1');
    });

    it('createEpic POSTs to /api/epics with the payload', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'E1' }));
        await createApiClient(config).createEpic({ project_id: 'p1', title: 'New' });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/epics');
        expect((init as RequestInit).method).toBe('POST');
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({
            project_id: 'p1',
            title: 'New',
        });
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['X-Atlas-Token']).toBe('unit-secret');
    });

    it('createStory POSTs to /api/stories', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'S1' }));
        await createApiClient(config).createStory({ epic_id: 'E1', title: 'S' });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/stories');
        expect((init as RequestInit).method).toBe('POST');
    });

    it('createBug POSTs to /api/bugs', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'B1' }));
        await createApiClient(config).createBug({ epic_id: 'E1', title: 'b' });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/bugs');
        expect((init as RequestInit).method).toBe('POST');
    });
});

describe('createApiClient — comments + reply', () => {
    it('addComment defaults author=agent and agent_id=null when not given', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 1 }));
        await createApiClient(config).addComment({
            issue_type: 'story',
            issue_id: 'S1',
            body: 'hi',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/comments');
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({
            author: 'agent',
            agent_id: null,
            issue_type: 'story',
            issue_id: 'S1',
            body: 'hi',
        });
    });

    it('addComment forwards author + agent_id when given', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 1 }));
        await createApiClient(config).addComment({
            issue_type: 'story',
            issue_id: 'S1',
            body: 'hi',
            author: 'owner',
            agent_id: 'a1',
        });
        const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
        expect(body.author).toBe('owner');
        expect(body.agent_id).toBe('a1');
    });

    it('listComments builds GET URL with type + id query', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).listComments('story', 'S 1');
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/comments?issue_type=story&issue_id=S%201');
    });

    it('getReplyContext GETs /reply-context with encoded ids', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ item: { id: 'S1' } }));
        await createApiClient(config).getReplyContext('story', 'S/1');
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/story/S%2F1/reply-context');
    });

    it('postReply POSTs body + author + agent_id (default owner / null)', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ comment: {}, context: {} }));
        await createApiClient(config).postReply({
            issue_type: 'story',
            issue_id: 'S1',
            body: 'reply',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/story/S1/reply');
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({ body: 'reply', author: 'owner', agent_id: null });
    });
});

describe('createApiClient — items (getItemFull / search / projects / links)', () => {
    it('getItemFull maps issue_type to the right route segment and merges comments into the envelope', async () => {
        // Tool consolidation 2026-07: get_item is "always full payload" —
        // the api-client fans out the /full + /comments reads in parallel
        // and splices `comments` into the response so callers see one
        // envelope per round-trip. No API-side schema change needed.
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy.mockImplementation(async (url) => {
            if (typeof url === 'string' && url.includes('/api/comments')) {
                return okJson([{ id: 1, body: 'hi' }]);
            }
            return okJson({ stub: true });
        });
        const client = createApiClient(config);
        const out = await client.getItemFull('story', 'S1');
        const urls = fetchSpy.mock.calls.map((c) => c[0] as string).sort();
        expect(urls).toEqual([
            'http://api.test/api/comments?issue_type=story&issue_id=S1',
            'http://api.test/api/stories/S1/full',
        ]);
        expect(out).toEqual({ stub: true, comments: [{ id: 1, body: 'hi' }] });
    });

    it('getItemFull URL-encodes issue ids for both fanout calls', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy.mockImplementation(async () => okJson([]));
        await createApiClient(config).getItemFull('sub_bug', 'ATL 9/x');
        const urls = fetchSpy.mock.calls.map((c) => c[0] as string).sort();
        expect(urls).toEqual([
            'http://api.test/api/comments?issue_type=sub_bug&issue_id=ATL%209%2Fx',
            'http://api.test/api/sub-bugs/ATL%209%2Fx/full',
        ]);
    });

    it('searchItems builds query string with q + top_k', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).searchItems('foo bar', 7);
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/search?q=foo+bar&top_k=7');
    });

    it('searchItems omits top_k when not provided', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).searchItems('foo');
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/search?q=foo');
    });

    it('listProjects + getProject hit the projects routes', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy.mockResolvedValueOnce(okJson([])).mockResolvedValueOnce(okJson({ id: 'p1' }));
        const client = createApiClient(config);
        await client.listProjects();
        await client.getProject('p 1');
        const urls = fetchSpy.mock.calls.map((c) => c[0] as string);
        expect(urls).toEqual([
            'http://api.test/api/projects',
            'http://api.test/api/projects/p%201',
        ]);
    });

    it('listItemLinks GETs /api/issues/:type/:id/links', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).listItemLinks('story', 'S1');
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/story/S1/links');
    });

    it('createItemLink POSTs to from-item links endpoint', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 1 }));
        await createApiClient(config).createItemLink({
            from_type: 'story',
            from_id: 'S1',
            to_id: 'S2',
            relation_type: 'depends_on',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/story/S1/links');
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.to_id).toBe('S2');
        expect(body.relation_type).toBe('depends_on');
    });

    it('deleteItemLink DELETEs by linkId', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okEmpty());
        await createApiClient(config).deleteItemLink(42);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/links/42');
        expect((init as RequestInit).method).toBe('DELETE');
    });

    it('pruneItemHistory POSTs before_time + forwards agent id header', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(
                okJson({ comments_deleted: 2, events_deleted: 3, owner_comments_preserved: 1 }),
            );
        const result = await createApiClient(config).pruneItemHistory(
            'epic',
            'JDA-1',
            '2026-06-01T00:00:00Z',
            'agent-coder',
        );
        expect(result).toEqual({
            comments_deleted: 2,
            events_deleted: 3,
            owner_comments_preserved: 1,
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/epic/JDA-1/history/prune');
        const req = init as RequestInit;
        expect(req.method).toBe('POST');
        expect(JSON.parse(req.body as string)).toEqual({ before_time: '2026-06-01T00:00:00Z' });
        // x-atlas-agent-id is forwarded so the audit event can attribute
        // the destructive call to the bound MCP identity.
        expect((req.headers as Record<string, string>)['x-atlas-agent-id']).toBe('agent-coder');
    });

    it('listItemExternalLinks GETs /api/issues/:type/:id/external-links', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).listItemExternalLinks('story', 'S1');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/story/S1/external-links');
        expect((init as RequestInit).method).toBe('GET');
    });

    it('createItemExternalLink POSTs to /api/issues/:type/:id/external-links', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ id: 1, url: 'https://github.com/o/r/pull/3' }));
        await createApiClient(config).createItemExternalLink({
            issue_type: 'story',
            issue_id: 'S1',
            link_kind: 'pull_request',
            url: 'https://github.com/o/r/pull/3',
            title: 'feat: thing',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/story/S1/external-links');
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.link_kind).toBe('pull_request');
        expect(body.url).toBe('https://github.com/o/r/pull/3');
        expect(body.title).toBe('feat: thing');
    });

    it('createItemExternalLink coerces missing title to null', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ id: 2, url: 'u' }));
        await createApiClient(config).createItemExternalLink({
            issue_type: 'epic',
            issue_id: 'E1',
            link_kind: 'pull_request',
            url: 'https://github.com/o/r/pull/9',
        });
        const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
        expect(body.title).toBeNull();
    });

    it('deleteItemExternalLink DELETEs by linkId', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okEmpty());
        await createApiClient(config).deleteItemExternalLink(77);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/issues/external-links/77');
        expect((init as RequestInit).method).toBe('DELETE');
    });
});

describe('createApiClient — guardrails (workspace)', () => {
    it('listGuardrails GETs /api/guardrails', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).listGuardrails();
        expect(fetchSpy.mock.calls[0]![0]).toBe('http://api.test/api/guardrails');
    });

    it('createGuardrail POSTs payload', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'g1' }));
        await createApiClient(config).createGuardrail({
            category: 'general',
            rule_text: 'rule',
            severity: 'warn',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/guardrails');
        expect((init as RequestInit).method).toBe('POST');
    });

    it('updateGuardrail PATCHes by id', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'g1' }));
        await createApiClient(config).updateGuardrail('g1', { rule_text: 'new' });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/guardrails/g1');
        expect((init as RequestInit).method).toBe('PATCH');
    });

    it('deleteGuardrail DELETEs by id', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okEmpty());
        await createApiClient(config).deleteGuardrail('g1');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/guardrails/g1');
        expect((init as RequestInit).method).toBe('DELETE');
    });
});

describe('createApiClient — reminders + notifications', () => {
    it('setReminder POSTs payload', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 1 }));
        await createApiClient(config).setReminder({
            label: 'ping',
            schedule: { kind: 'once', at: '2099-01-01T00:00:00Z' },
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/reminders');
        expect((init as RequestInit).method).toBe('POST');
    });

    it('updateReminder PATCHes by id', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 1 }));
        await createApiClient(config).updateReminder(1, { label: 'renamed' });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/reminders/1');
        expect((init as RequestInit).method).toBe('PATCH');
    });

    it('cancelReminder DELETEs (returns updated row)', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ id: 1, status: 'cancelled' }));
        await createApiClient(config).cancelReminder(1);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/reminders/1');
        expect((init as RequestInit).method).toBe('DELETE');
    });

    it('listReminders GETs /api/reminders (no filter args = empty query string)', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).listReminders();
        expect(fetchSpy.mock.calls[0]![0]).toBe('http://api.test/api/reminders');
    });

    it('listReminders builds a filter query string when status/channel/since are supplied', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).listReminders({
            status: 'active',
            channel: 'external',
            since: '2026-07-01T00:00:00Z',
        });
        const url = fetchSpy.mock.calls[0]![0] as string;
        expect(url).toContain('/api/reminders?');
        expect(url).toContain('status=active');
        expect(url).toContain('channel=external');
        expect(url).toContain('since=2026-07-01T00');
    });

    it('sendExternalNotification POSTs to /api/notifications/send-external', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ ok: true }));
        await createApiClient(config).sendExternalNotification({
            message: 'hi',
            event_key: 'agent.daily-digest',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/notifications/send-external');
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({ message: 'hi', event_key: 'agent.daily-digest' });
    });
});

describe('createApiClient — item mutation (polymorphic)', () => {
    it('updateItem PATCHes the per-type route with patch body', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'S1' }));
        await createApiClient(config).updateItem('story', 'S1', {
            title: 'new',
            spec_md: '## spec',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/stories/S1');
        expect((init as RequestInit).method).toBe('PATCH');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.spec_md).toBe('## spec');
    });

    it('transitionItemStatus PATCHes /status without override query when override=false/undefined', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({}));
        await createApiClient(config).transitionItemStatus('story', 'S1', 'in_progress');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/stories/S1/status');
        expect((init as RequestInit).method).toBe('PATCH');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({ status: 'in_progress' });
    });

    it('transitionItemStatus adds ?override=1 and requested_by_agent_id when supplied', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({}));
        await createApiClient(config).transitionItemStatus(
            'story',
            'S1',
            'done',
            true,
            'agent-po-reviewer',
        );
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/stories/S1/status?override=1');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({ status: 'done', requested_by_agent_id: 'agent-po-reviewer' });
    });

    it('assignItem PATCHes /assign with assignee_agent_id (string or null)', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        fetchSpy.mockImplementation(async () => okJson({}));
        const client = createApiClient(config);
        await client.assignItem('story', 'S1', 'agent-coder');
        await client.assignItem('story', 'S1', null, 'agent-po-reviewer');
        const [, init1] = fetchSpy.mock.calls[0]!;
        expect(JSON.parse((init1 as RequestInit).body as string)).toEqual({
            assignee_agent_id: 'agent-coder',
        });
        const [, init2] = fetchSpy.mock.calls[1]!;
        expect(JSON.parse((init2 as RequestInit).body as string)).toEqual({
            assignee_agent_id: null,
            requested_by_agent_id: 'agent-po-reviewer',
        });
    });

    it('deleteItem DELETEs the per-type route', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okEmpty());
        await createApiClient(config).deleteItem('sub_bug', 'SB1');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/sub-bugs/SB1');
        expect((init as RequestInit).method).toBe('DELETE');
    });

    it('updateItem maps epic → /api/epics/:id', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'E1' }));
        await createApiClient(config).updateItem('epic', 'E1', { title: 'renamed' });
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/epics/E1');
    });

    it('updateItem maps sub_task → /api/sub-tasks/:id', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'ST1' }));
        await createApiClient(config).updateItem('sub_task', 'ST1', { title: 'done' });
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/sub-tasks/ST1');
    });

    it('updateItem maps bug → /api/bugs/:id', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'B1' }));
        await createApiClient(config).updateItem('bug', 'B1', { title: 'fixed' });
        const [url] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/bugs/B1');
    });
});

describe('createApiClient — project guardrails (per-project)', () => {
    it('listProjectGuardrails GETs the per-project route', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).listProjectGuardrails('p1');
        expect(fetchSpy.mock.calls[0]![0]).toBe('http://api.test/api/projects/p1/guardrails');
    });

    it('createProjectGuardrail POSTs to the per-project route', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'g1' }));
        await createApiClient(config).createProjectGuardrail('p1', {
            title: 't',
            body_md: 'b',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/projects/p1/guardrails');
        expect((init as RequestInit).method).toBe('POST');
    });

    it('updateProjectGuardrail PATCHes the rule under its project', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'g1' }));
        await createApiClient(config).updateProjectGuardrail('p1', 'g1', { title: 'x' });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/projects/p1/guardrails/g1');
        expect((init as RequestInit).method).toBe('PATCH');
    });

    it('toggleProjectGuardrail PATCHes /toggle with enabled flag', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({ id: 'g1' }));
        await createApiClient(config).toggleProjectGuardrail('p1', 'g1', 0);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/projects/p1/guardrails/g1/toggle');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({ enabled: 0 });
    });

    it('deleteProjectGuardrail DELETEs the rule under its project', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okEmpty());
        await createApiClient(config).deleteProjectGuardrail('p1', 'g1');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/projects/p1/guardrails/g1');
        expect((init as RequestInit).method).toBe('DELETE');
    });
});

describe('createApiClient — schedules', () => {
    it('listSchedules GETs /api/schedules', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson([]));
        await createApiClient(config).listSchedules();
        expect(fetchSpy.mock.calls[0]![0]).toBe('http://api.test/api/schedules');
    });

    it('upsertProjectSchedule PUTs the schedule payload', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okJson({}));
        await createApiClient(config).upsertProjectSchedule('p1', {
            enabled: true,
            preset: 'daily',
            time_of_day: '09:00',
            weekday: null,
            cron_expression: '0 9 * * *',
            skip_if_dirty: false,
            pause_while_agents_active: false,
            conflict_policy: 'skip',
        });
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/projects/p1/schedule');
        expect((init as RequestInit).method).toBe('PUT');
    });

    it('deleteProjectSchedule DELETEs the schedule', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okEmpty());
        await createApiClient(config).deleteProjectSchedule('p1');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/projects/p1/schedule');
        expect((init as RequestInit).method).toBe('DELETE');
    });

    it('triggerProjectAutoFetch POSTs to /schedule/fire', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(okJson({ autofetch_id: 'af1' }));
        const out = await createApiClient(config).triggerProjectAutoFetch('p1');
        expect(out.autofetch_id).toBe('af1');
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(url).toBe('http://api.test/api/projects/p1/schedule/fire');
        expect((init as RequestInit).method).toBe('POST');
    });
});

describe('AtlasApiError', () => {
    it('captures status, url, and snippet', () => {
        const e = new AtlasApiError(418, 'http://x/y', 'short');
        expect(e.status).toBe(418);
        expect(e.url).toBe('http://x/y');
        expect(e.bodySnippet).toBe('short');
        expect(e.message).toContain('418');
    });

    it('prefixes 4xx messages with a [atlas-api-NNN] marker for log highlighting', () => {
        const e = new AtlasApiError(400, 'http://x/y', 'bad body');
        expect(e.message.startsWith('[atlas-api-400] ')).toBe(true);
    });

    it('does not prefix 5xx messages', () => {
        const e = new AtlasApiError(503, 'http://x/y', 'gateway');
        expect(e.message.startsWith('[atlas-api-')).toBe(false);
    });
});
