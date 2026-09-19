import { describe, expect, it, beforeEach, afterEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import {
    externalLinks,
    parseGithubPrUrl,
    fetchGithubPrTitle,
    fetchGithubPrState,
} from './external-links.js';
import { broadcastSSE } from '../routes/events.js';
import { credentialsService } from './credentials.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';
import type * as NodeChildProcess from 'node:child_process';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    // Items only — PR external links attach to any item type, but the
    // non-epic items need a parent epic.
    await insertItem({ id: 'ATL-EPIC', type: 'task', project_id: 'p1', title: 'Epic' });
    await insertItem({
        id: 'ATL-1',
        type: 'sub_task',
        project_id: 'p1',
        parent_id: 'ATL-EPIC',
        parent_type: 'task',
        title: 'Story',
    });
    await insertItem({
        id: 'ATL-2',
        type: 'sub_task',
        project_id: 'p1',
        parent_id: 'ATL-EPIC',
        parent_type: 'task',
        title: 'Bug',
    });
});

afterAll(async () => {
    await closeTestDb();
});

describe('parseGithubPrUrl', () => {
    it('parses a canonical GitHub PR URL', () => {
        expect(parseGithubPrUrl('https://github.com/foo/bar/pull/123')).toEqual({
            owner: 'foo',
            repo: 'bar',
            number: '123',
        });
    });

    it('accepts trailing slash and querystring/fragment', () => {
        expect(parseGithubPrUrl('https://github.com/foo/bar/pull/42/files')).toMatchObject({
            number: '42',
        });
        expect(parseGithubPrUrl('https://github.com/foo/bar/pull/42?x=y')).toMatchObject({
            number: '42',
        });
        expect(parseGithubPrUrl('https://github.com/foo/bar/pull/42#diff-0')).toMatchObject({
            number: '42',
        });
    });

    it('accepts http as well as https', () => {
        expect(parseGithubPrUrl('http://github.com/foo/bar/pull/9')).toMatchObject({ number: '9' });
    });

    it('rejects non-PR URLs', () => {
        expect(parseGithubPrUrl('https://github.com/foo/bar')).toBeNull();
        expect(parseGithubPrUrl('https://github.com/foo/bar/issues/123')).toBeNull();
        expect(parseGithubPrUrl('https://gitlab.com/foo/bar/-/merge_requests/1')).toBeNull();
        expect(parseGithubPrUrl('not-a-url')).toBeNull();
        expect(parseGithubPrUrl('')).toBeNull();
    });

    it('trims surrounding whitespace', () => {
        expect(parseGithubPrUrl('  https://github.com/foo/bar/pull/7  ')).toMatchObject({
            number: '7',
        });
    });
});

describe('fetchGithubPrTitle', () => {
    it('returns null for a non-PR URL without spawning gh', async () => {
        expect(await fetchGithubPrTitle('not-a-pr-url')).toBeNull();
    });

    it('returns null when gh fails (no auth / not installed / network error)', async () => {
        // Use a fake binary path so the spawn fails fast regardless of host
        // gh state. Sandbox-friendly — no network call required.
        const got = await fetchGithubPrTitle(
            'https://github.com/no-such-user/no-such-repo/pull/9999999',
            { PATH: '' },
        );
        expect(got).toBeNull();
    });

    // EL-EXTRA — covers the `typeof parsed.title === 'string' ? ... : null`
    // branch on the success path, which the two tests above never reach
    // (one short-circuits before spawning `gh`, the other only exercises
    // the catch block). Mocks `node:child_process`'s `execFile` so `gh` is
    // never actually spawned. Migrated from `exec` (shell string) to
    // `execFile` (array-form args) with the command-injection fix in
    // external-links.ts (Batch 1 audit).
    describe('with a mocked gh CLI', () => {
        beforeEach(() => {
            vi.resetModules();
        });

        afterEach(() => {
            vi.doUnmock('node:child_process');
            vi.resetModules();
        });

        it('returns the title when gh succeeds with a string title', async () => {
            vi.doMock('node:child_process', async () => {
                const actual =
                    await vi.importActual<typeof NodeChildProcess>(
                        'node:child_process',
                    );
                return {
                    ...actual,
                    execFile: (
                        _file: string,
                        _args: string[],
                        _opts: unknown,
                        cb: (err: unknown, res?: { stdout: string; stderr: string }) => void,
                    ) => {
                        cb(null, { stdout: JSON.stringify({ title: 'Add the thing' }), stderr: '' });
                    },
                };
            });
            const mod = await import('./external-links.js');
            const got = await mod.fetchGithubPrTitle('https://github.com/foo/bar/pull/1');
            expect(got).toBe('Add the thing');
        });

        it('returns null when gh succeeds but title is not a string', async () => {
            vi.doMock('node:child_process', async () => {
                const actual =
                    await vi.importActual<typeof NodeChildProcess>(
                        'node:child_process',
                    );
                return {
                    ...actual,
                    execFile: (
                        _file: string,
                        _args: string[],
                        _opts: unknown,
                        cb: (err: unknown, res?: { stdout: string; stderr: string }) => void,
                    ) => {
                        cb(null, { stdout: JSON.stringify({ title: null }), stderr: '' });
                    },
                };
            });
            const mod = await import('./external-links.js');
            const got = await mod.fetchGithubPrTitle('https://github.com/foo/bar/pull/1');
            expect(got).toBeNull();
        });
    });
});

describe('externalLinks.create', () => {
    const url = 'https://github.com/foo/bar/pull/42';

    it('inserts a new pull_request link and records an external_link event', async () => {
        const link = await externalLinks.create({
            itemId: 'ATL-1',
            url,
            linkKind: 'pull_request',
            title: 'Add the thing',
            externalRef: '42',
        });
        expect(link.id).toBeTypeOf('number');
        expect(link.item_id).toBe('ATL-1');
        expect(link.url).toBe(url);
        expect(link.title).toBe('Add the thing');
        expect(link.external_ref).toBe('42');

        const events = await eventsLog.list('ATL-1');
        const evt = events.find((e) => e.event_type === 'link_created' && e.field === 'external_link');
        expect(evt).toBeDefined();
        expect(evt?.to_value).toBe(url);
        expect(evt?.detail).toBe(`pull_request → ${url}`);
    });

    it('is idempotent on (item_id, url) — second call returns the same id', async () => {
        const a = await externalLinks.create({ itemId: 'ATL-1', url, linkKind: 'pull_request' });
        const b = await externalLinks.create({ itemId: 'ATL-1', url, linkKind: 'pull_request' });
        expect(b.id).toBe(a.id);
        // Second call must NOT emit a duplicate created event.
        const events = await eventsLog.list('ATL-1');
        expect(
            events.filter((e) => e.event_type === 'link_created' && e.field === 'external_link'),
        ).toHaveLength(1);
    });

    it('allows the same URL on a different item', async () => {
        const a = await externalLinks.create({ itemId: 'ATL-1', url, linkKind: 'pull_request' });
        const b = await externalLinks.create({ itemId: 'ATL-2', url, linkKind: 'pull_request' });
        expect(a.id).not.toBe(b.id);
        expect(a.item_id).toBe('ATL-1');
        expect(b.item_id).toBe('ATL-2');
    });

    it('persists nullable fields as null when omitted', async () => {
        const link = await externalLinks.create({ itemId: 'ATL-1', url, linkKind: 'pull_request' });
        expect(link.title).toBeNull();
        expect(link.external_ref).toBeNull();
        expect(link.created_by_run_id).toBeNull();
    });
});

describe('externalLinks.list', () => {
    it('returns links ordered newest-first', async () => {
        await externalLinks.create({
            itemId: 'ATL-1',
            url: 'https://github.com/o/r/pull/1',
            linkKind: 'pull_request',
        });
        await externalLinks.create({
            itemId: 'ATL-1',
            url: 'https://github.com/o/r/pull/2',
            linkKind: 'pull_request',
        });
        await externalLinks.create({
            itemId: 'ATL-1',
            url: 'https://github.com/o/r/pull/3',
            linkKind: 'pull_request',
        });
        const rows = await externalLinks.list('ATL-1');
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.url)).toEqual([
            'https://github.com/o/r/pull/3',
            'https://github.com/o/r/pull/2',
            'https://github.com/o/r/pull/1',
        ]);
    });

    it('scopes by item_id', async () => {
        await externalLinks.create({
            itemId: 'ATL-1',
            url: 'https://github.com/o/r/pull/1',
            linkKind: 'pull_request',
        });
        await externalLinks.create({
            itemId: 'ATL-2',
            url: 'https://github.com/o/r/pull/2',
            linkKind: 'pull_request',
        });
        const onOne = await externalLinks.list('ATL-1');
        const onTwo = await externalLinks.list('ATL-2');
        expect(onOne).toHaveLength(1);
        expect(onTwo).toHaveLength(1);
        expect(onOne[0]?.url).toContain('/pull/1');
        expect(onTwo[0]?.url).toContain('/pull/2');
    });

    it('returns [] for an item with no links', async () => {
        expect(await externalLinks.list('ATL-1')).toEqual([]);
    });
});

describe('externalLinks.delete', () => {
    it('removes the row and records a link_deleted event', async () => {
        const url = 'https://github.com/foo/bar/pull/42';
        const link = await externalLinks.create({
            itemId: 'ATL-1',
            url,
            linkKind: 'pull_request',
        });
        await externalLinks.delete(link.id);
        expect(await externalLinks.list('ATL-1')).toEqual([]);
        const events = await eventsLog.list('ATL-1');
        const evt = events.find(
            (e) => e.event_type === 'link_deleted' && e.field === 'external_link',
        );
        expect(evt).toBeDefined();
        expect(evt?.to_value).toBe(url);
    });

    it('is a no-op (no event) when the link id is unknown', async () => {
        await externalLinks.delete(999_999);
        const events = await eventsLog.list('ATL-1');
        expect(events.filter((e) => e.event_type === 'link_deleted')).toHaveLength(0);
    });
});

describe('external link cascade on item delete', () => {
    it('removes external links when the item is deleted', async () => {
        await externalLinks.create({
            itemId: 'ATL-1',
            url: 'https://github.com/o/r/pull/1',
            linkKind: 'pull_request',
        });
        await testDb.deleteFrom('items').where('id', '=', 'ATL-1').execute();
        const rows = await testDb
            .selectFrom('item_external_links')
            .selectAll()
            .execute();
        expect(rows).toEqual([]);
    });
});

describe('fetchGithubPrState', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubGithub(status: number, body: unknown) {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    it('GETs the pulls endpoint with the bearer token and maps merged_at to merged', async () => {
        const fetchMock = stubGithub(200, { state: 'closed', merged_at: '2026-09-01T00:00:00Z' });
        expect(await fetchGithubPrState('https://github.com/foo/bar/pull/42', 'tok')).toBe('merged');
        const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(calledUrl).toBe('https://api.github.com/repos/foo/bar/pulls/42');
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    });

    it('maps an unmerged closed PR to closed and anything else to open', async () => {
        stubGithub(200, { state: 'closed', merged_at: null });
        expect(await fetchGithubPrState('https://github.com/foo/bar/pull/1', 'tok')).toBe('closed');
        stubGithub(200, { state: 'open', merged_at: null });
        expect(await fetchGithubPrState('https://github.com/foo/bar/pull/1', 'tok')).toBe('open');
    });

    it('returns null on a GitHub error, a network failure, or a non-PR URL', async () => {
        stubGithub(404, { message: 'Not Found' });
        expect(await fetchGithubPrState('https://github.com/foo/bar/pull/1', 'tok')).toBeNull();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        expect(await fetchGithubPrState('https://github.com/foo/bar/pull/1', 'tok')).toBeNull();
        expect(await fetchGithubPrState('https://github.com/foo/bar/issues/1', 'tok')).toBeNull();
    });
});

describe('PR state refresh', () => {
    const url = 'https://github.com/foo/bar/pull/42';
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.mocked(broadcastSSE).mockClear();
        await testDb
            .insertInto('credentials')
            .values({
                id: 'cred-1',
                label: 'GH PAT',
                host: 'github',
                kind: 'pat',
                username: 'octocat',
                token_encrypted: 'enc',
                token_fingerprint: 'fp',
                scope: 'repo',
                expires_at: null,
            })
            .execute();
        await testDb.updateTable('projects').set({ credential_id: 'cred-1' }).where('id', '=', 'p1').execute();
        vi.spyOn(credentialsService, 'getToken').mockResolvedValue('tok');
        fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ state: 'closed', merged_at: '2026-09-01T00:00:00Z' }), {
                status: 200,
            }),
        );
        vi.stubGlobal('fetch', fetchMock);
        await externalLinks.create({ itemId: 'ATL-1', url, linkKind: 'pull_request' });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    async function storedState() {
        return testDb
            .selectFrom('item_external_links')
            .select(['pr_state', 'pr_state_checked_at'])
            .where('item_id', '=', 'ATL-1')
            .executeTakeFirstOrThrow();
    }

    it('refreshPrStates fetches synchronously, persists the state and broadcasts the change', async () => {
        const links = await externalLinks.refreshPrStates('ATL-1');
        expect(links).toHaveLength(1);
        expect(links[0]?.pr_state).toBe('merged');
        expect(links[0]).not.toHaveProperty('pr_state_checked_at');
        expect((await storedState()).pr_state_checked_at).not.toBeNull();
        expect(broadcastSSE).toHaveBeenCalledWith({
            type: 'counts_changed',
            issueType: 'sub_task',
            issueId: 'ATL-1',
        });
    });

    describe('a merged Task PR', () => {
        const taskPr = 'https://github.com/foo/bar/pull/12';
        const statusOf = async (id: string) =>
            (await testDb.selectFrom('items').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

        beforeEach(async () => {
            await testDb.updateTable('items').set({ status: 'in_review' }).where('id', 'in', ['ATL-EPIC', 'ATL-1', 'ATL-2']).execute();
            await externalLinks.create({ itemId: 'ATL-EPIC', url: taskPr, linkKind: 'pull_request' });
        });

        it('closes the Task and the sub-tasks it was reviewed with', async () => {
            await externalLinks.refreshPrStates('ATL-EPIC');
            expect(await statusOf('ATL-EPIC')).toBe('done');
            expect(await statusOf('ATL-1')).toBe('done');
            expect(await statusOf('ATL-2')).toBe('done');
        });

        it('leaves the Task in review while a sub-task is still open', async () => {
            await testDb.updateTable('items').set({ status: 'in_progress' }).where('id', '=', 'ATL-2').execute();
            await externalLinks.refreshPrStates('ATL-EPIC');
            expect(await statusOf('ATL-1')).toBe('done');
            expect(await statusOf('ATL-2')).toBe('in_progress');
            expect(await statusOf('ATL-EPIC')).toBe('in_review');
        });

        it('the scheduler tick checks in-review Tasks without anyone opening them', async () => {
            await externalLinks.syncReviewedTaskPrs();
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/pulls/12'), expect.anything());
            expect(await statusOf('ATL-EPIC')).toBe('done');
        });

        it('with a PR per repo, the Task closes only when the last one merges (ADR 0017)', async () => {
            const webPr = 'https://github.com/foo/web/pull/3';
            await externalLinks.create({ itemId: 'ATL-EPIC', url: webPr, linkKind: 'pull_request' });
            let webMerged = false;
            fetchMock.mockImplementation(
                async (u: string) =>
                    new Response(
                        JSON.stringify(
                            u.includes('/web/') && !webMerged
                                ? { state: 'open', merged_at: null }
                                : { state: 'closed', merged_at: '2026-09-01T00:00:00Z' }
                        ),
                        { status: 200 }
                    )
            );
            await externalLinks.refreshPrStates('ATL-EPIC');
            expect(await statusOf('ATL-EPIC')).toBe('in_review');

            webMerged = true;
            await externalLinks.refreshPrStates('ATL-EPIC');
            expect(await statusOf('ATL-EPIC')).toBe('done');
        });

        it("checks each PR with the credential of the repo it belongs to", async () => {
            await testDb
                .insertInto('credentials')
                .values({
                    id: 'cred-web',
                    label: 'Web PAT',
                    host: 'github',
                    kind: 'pat',
                    username: 'octocat',
                    token_encrypted: 'enc',
                    token_fingerprint: 'fp2',
                    scope: 'repo',
                    expires_at: null,
                })
                .execute();
            await testDb
                .insertInto('project_repos')
                .values({
                    id: 'repo-web',
                    project_id: 'p1',
                    name: 'web',
                    git_url: 'https://github.com/foo/web.git',
                    git_path: '/tmp/web',
                    credential_id: 'cred-web',
                })
                .execute();
            vi.mocked(credentialsService.getToken).mockImplementation(async (id: string) => (id === 'cred-web' ? 'tok-web' : 'tok'));
            await externalLinks.create({ itemId: 'ATL-EPIC', url: 'https://github.com/foo/web/pull/3', linkKind: 'pull_request' });

            await externalLinks.refreshPrStates('ATL-EPIC');

            const auth = (needle: string) =>
                (fetchMock.mock.calls.find(([u]) => String(u).includes(needle))?.[1] as { headers: Record<string, string> })
                    .headers['Authorization'];
            expect(auth('/foo/web/pulls/3')).toBe('Bearer tok-web');
            expect(auth('/foo/bar/pulls/12')).toBe('Bearer tok');
        });

        it('an open PR closes nothing', async () => {
            fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: 'open', merged_at: null }), { status: 200 }));
            await externalLinks.syncReviewedTaskPrs();
            expect(await statusOf('ATL-EPIC')).toBe('in_review');
            expect(await statusOf('ATL-1')).toBe('in_review');
        });
    });

    it('does not broadcast when the state is unchanged', async () => {
        await externalLinks.refreshPrStates('ATL-1');
        vi.mocked(broadcastSSE).mockClear();
        await externalLinks.refreshPrStates('ATL-1');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(broadcastSSE).not.toHaveBeenCalled();
    });

    it('stamps checked_at but keeps the last state when the lookup fails', async () => {
        await externalLinks.refreshPrStates('ATL-1');
        await testDb.updateTable('item_external_links').set({ pr_state_checked_at: null }).execute();
        fetchMock.mockResolvedValueOnce(new Response('{}', { status: 502 }));
        const links = await externalLinks.refreshPrStates('ATL-1');
        expect(links[0]?.pr_state).toBe('merged');
        expect((await storedState()).pr_state_checked_at).not.toBeNull();
    });

    it('skips GitHub entirely when the project has no credential', async () => {
        await testDb.updateTable('projects').set({ credential_id: null }).where('id', '=', 'p1').execute();
        const links = await externalLinks.refreshPrStates('ATL-1');
        expect(links[0]?.pr_state).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('list returns immediately and refreshes never-checked links in the background', async () => {
        const links = await externalLinks.list('ATL-1');
        expect(links[0]?.pr_state).toBeNull();
        await vi.waitFor(async () => expect((await storedState()).pr_state).toBe('merged'));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('list does not re-check a link checked within the last 5 minutes', async () => {
        await externalLinks.refreshPrStates('ATL-1');
        fetchMock.mockClear();
        await externalLinks.list('ATL-1');
        // Give a (wrongly) scheduled background refresh time to hit fetch.
        await new Promise((r) => setTimeout(r, 50));
        expect(fetchMock).not.toHaveBeenCalled();

        await testDb
            .updateTable('item_external_links')
            .set({ pr_state_checked_at: new Date(Date.now() - 6 * 60_000).toISOString() })
            .execute();
        await externalLinks.list('ATL-1');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });
});
