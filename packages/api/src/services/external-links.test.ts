import { describe, expect, it, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { externalLinks, parseGithubPrUrl, fetchGithubPrTitle } from './external-links.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';
import type * as NodeChildProcess from 'node:child_process';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    // Items only — PR external links attach to any item type, but the
    // non-epic items need a parent epic.
    await insertItem({ id: 'ATL-EPIC', type: 'epic', project_id: 'p1', title: 'Epic' });
    await insertItem({
        id: 'ATL-1',
        type: 'story',
        project_id: 'p1',
        parent_id: 'ATL-EPIC',
        parent_type: 'epic',
        title: 'Story',
    });
    await insertItem({
        id: 'ATL-2',
        type: 'bug',
        project_id: 'p1',
        parent_id: 'ATL-EPIC',
        parent_type: 'epic',
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
