import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { plainNotice, notificationsService, CANCELLED_BY_OWNER } from './notifications.js';
import { broadcastSSE } from '../routes/events.js';
import { closeTestDb, truncateAll, testDb } from '../../tests/_pg-db.js';
import { insertItem, insertProject } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('notificationsService', () => {
    describe('create / get / list', () => {
        it('creates with defaults and returns the inserted row', async () => {
            const n = await notificationsService.create({
                event_type: 'epic_created',
                message: 'New epic',
            });
            expect(n.id).toBeGreaterThan(0);
            expect(n.event_type).toBe('epic_created');
            expect(n.kind).toBe('update');
            expect(n.external_status).toBe('none');
            expect(n.read_at).toBeNull();
            expect(n.message).toBe('New epic');
        });

        it('honors the kind enum (needs_you/update/system)', async () => {
            const n = await notificationsService.create({
                event_type: 'ask',
                message: 'need owner',
                kind: 'needs_you',
            });
            expect(n.kind).toBe('needs_you');
            const sys = await notificationsService.create({
                event_type: 'boot',
                message: 'sys',
                kind: 'system',
            });
            expect(sys.kind).toBe('system');
        });

        it('honors the external_status enum', async () => {
            const n = await notificationsService.create({
                event_type: 'e',
                message: 'm',
                external_status: 'pending',
            });
            expect(n.external_status).toBe('pending');
        });

        it('rejects an invalid kind per CHECK', async () => {
            await expect(
                notificationsService.create({
                    event_type: 'x',
                    message: 'm',
                    kind: 'bogus' as unknown as 'update',
                }),
            ).rejects.toThrow();
        });

        it('rejects an invalid external_status per CHECK', async () => {
            await expect(
                notificationsService.create({
                    event_type: 'x',
                    message: 'm',
                    external_status: 'half-pregnant' as unknown as 'sent',
                }),
            ).rejects.toThrow();
        });

        it('get returns null for missing id', async () => {
            expect(await notificationsService.get(99999)).toBeNull();
        });

        it('list returns the full set by default (limit 50)', async () => {
            for (let i = 0; i < 3; i++) {
                await notificationsService.create({ event_type: 'e', message: `m${i}` });
            }
            const list = await notificationsService.list();
            expect(list).toHaveLength(3);
            expect(list.map((r) => r.message).sort()).toEqual(['m0', 'm1', 'm2']);
        });

        it('list filter by kind', async () => {
            await notificationsService.create({ event_type: 'e', message: 'a', kind: 'update' });
            await notificationsService.create({ event_type: 'e', message: 'b', kind: 'needs_you' });
            const list = await notificationsService.list({ kind: 'needs_you' });
            expect(list).toHaveLength(1);
            expect(list[0]!.kind).toBe('needs_you');
        });

        it('list filter by external_status', async () => {
            await notificationsService.create({
                event_type: 'e',
                message: 'a',
                external_status: 'pending',
            });
            await notificationsService.create({
                event_type: 'e',
                message: 'b',
                external_status: 'sent',
            });
            const list = await notificationsService.list({ external_status: 'sent' });
            expect(list).toHaveLength(1);
            expect(list[0]!.external_status).toBe('sent');
        });

        it('list filter combines kind + external_status', async () => {
            await notificationsService.create({
                event_type: 'e',
                message: 'a',
                kind: 'needs_you',
                external_status: 'sent',
            });
            await notificationsService.create({
                event_type: 'e',
                message: 'b',
                kind: 'update',
                external_status: 'sent',
            });
            const list = await notificationsService.list({ kind: 'needs_you', external_status: 'sent' });
            expect(list).toHaveLength(1);
            expect(list[0]!.message).toBe('a');
        });

        it('list respects the limit param', async () => {
            for (let i = 0; i < 4; i++) {
                await notificationsService.create({ event_type: 'e', message: `m${i}` });
            }
            const list = await notificationsService.list({ limit: 2 });
            expect(list).toHaveLength(2);
        });

        it('create persists explicit optional fields with no FK constraint (link_url/failure_reason)', async () => {
            // Exercises the "value provided" side of the `data.link_url ?? null`
            // and `data.failure_reason ?? null` fallbacks in create() — the
            // defaults-only test above only hits the undefined side of these
            // ternaries. issue_id/project_id/agent_id are FK-constrained
            // columns and are covered indirectly elsewhere; exercising their
            // "provided" branch would require seeding items/projects/agents
            // rows, which is out of scope for this targeted branch test.
            const n = await notificationsService.create({
                event_type: 'terminal_idle',
                message: 'idle',
                link_url: '/terminal/abc',
                failure_reason: 'previously failed once',
            });
            expect(n.link_url).toBe('/terminal/abc');
        });

    });

    describe('updateExternalStatus / markSent / cancel', () => {
        it('updates external_status and sent_external flag', async () => {
            const n = await notificationsService.create({ event_type: 'e', message: 'x' });
            await notificationsService.updateExternalStatus(n.id, 'sent');
            const got = (await notificationsService.get(n.id))!;
            expect(got.external_status).toBe('sent');
            expect(got.sent_external).toBe(1);
            expect(got.failure_reason).toBeNull();
        });

        it('updateExternalStatus failed leaves sent_external=0 and stamps failure_reason', async () => {
            const n = await notificationsService.create({ event_type: 'e', message: 'x' });
            await notificationsService.updateExternalStatus(n.id, 'failed', 'bad creds');
            const got = (await notificationsService.get(n.id))!;
            expect(got.external_status).toBe('failed');
            expect(got.sent_external).toBe(0);
            expect(got.failure_reason).toBe('bad creds');
        });

        it('markSent is a convenience for updateExternalStatus(id, sent)', async () => {
            const n = await notificationsService.create({ event_type: 'e', message: 'x' });
            await notificationsService.markSent(n.id);
            expect((await notificationsService.get(n.id))!.external_status).toBe('sent');
        });

        it('cancel resets a pending notification', async () => {
            const n = await notificationsService.create({
                event_type: 'e',
                message: 'x',
                external_status: 'pending',
            });
            const ok = await notificationsService.cancel(n.id);
            expect(ok).toBe(true);
            // It stays in the log, marked cancelled, rather than vanishing.
            expect(await notificationsService.get(n.id)).toMatchObject({
                external_status: 'none',
                failure_reason: CANCELLED_BY_OWNER,
            });
            // A second cancel finds nothing pending.
            expect(await notificationsService.cancel(n.id)).toBe(false);
        });

        it('cancel returns false when the row is missing or not pending', async () => {
            expect(await notificationsService.cancel(9999)).toBe(false);
            const n = await notificationsService.create({ event_type: 'e', message: 'x' });
            // default status is 'none', not pending
            expect(await notificationsService.cancel(n.id)).toBe(false);
        });
    });

    describe('markRead / markAllRead / countUnread', () => {
        it('countUnread counts rows with read_at IS NULL', async () => {
            await notificationsService.create({ event_type: 'e', message: 'a' });
            await notificationsService.create({ event_type: 'e', message: 'b' });
            expect(await notificationsService.countUnread()).toBe(2);
            await notificationsService.markAllRead();
            expect(await notificationsService.countUnread()).toBe(0);
        });

        it('markAllRead returns the number of rows updated; subsequent calls return 0', async () => {
            await notificationsService.create({ event_type: 'e', message: 'a' });
            await notificationsService.create({ event_type: 'e', message: 'b' });
            expect(await notificationsService.markAllRead()).toBe(2);
            expect(await notificationsService.markAllRead()).toBe(0);
        });

        it('markRead toggles one row, returns true once, false if already read', async () => {
            const n = await notificationsService.create({ event_type: 'e', message: 'a' });
            expect(await notificationsService.markRead(n.id)).toBe(true);
            expect(await notificationsService.markRead(n.id)).toBe(false);
            expect((await notificationsService.get(n.id))!.read_at).toBeTruthy();
        });

        it('markRead returns false for missing id', async () => {
            expect(await notificationsService.markRead(9999)).toBe(false);
        });
    });

    describe('log-only rows (in_app = false)', () => {
        it('default to in_app; a log-only row stays out of the unread count and Mark All Read', async () => {
            const feed = await notificationsService.create({ event_type: 'reminder', message: 'feed' });
            vi.mocked(broadcastSSE).mockClear();
            const logOnly = await notificationsService.create({ event_type: 'reminder', message: 'external only', in_app: false });
            expect(feed.in_app).toBe(true);
            expect(logOnly.in_app).toBe(false);
            // The log refreshes, but no badge changed.
            expect(vi.mocked(broadcastSSE).mock.calls.map((c) => c[0].type)).toEqual(['notification_created']);
            await expect(notificationsService.countUnread()).resolves.toBe(1);
            await expect(notificationsService.markAllRead()).resolves.toBe(1);
            expect((await notificationsService.get(logOnly.id))!.read_at).toBeNull();
            // The Notification Log (no filter) still lists both.
            expect((await notificationsService.list()).map((n) => n.message).sort()).toEqual(['external only', 'feed']);
            expect((await notificationsService.list({ in_app: true })).map((n) => n.message)).toEqual(['feed']);
        });
    });

    describe('stale needs_you (item left waiting_for_info / in_review)', () => {
        async function seed() {
            await insertProject('p1');
            const waiting = await insertItem({ type: 'task', project_id: 'p1', status: 'waiting_for_info' });
            const moved = await insertItem({ type: 'task', project_id: 'p1', status: 'waiting_for_info' });
            const mk = (issue_id: string | null, event_type = 'agent_completed') =>
                notificationsService.create({ event_type, message: 'm', kind: 'needs_you', issue_id });
            await mk(waiting);
            await mk(moved);
            await mk(null);
            // agent errors / terminal idle are not item-state prompts — must not be hidden
            await mk(moved, 'agent_error');
            await notificationsService.create({ event_type: 'e', message: 'u', kind: 'update', issue_id: moved });
            await testDb.updateTable('items').set({ status: 'in_progress' }).where('id', '=', moved).execute();
            return { waiting, moved };
        }

        it('list hides agent_completed needs_you rows whose item is no longer awaiting the Owner', async () => {
            const { waiting, moved } = await seed();
            const rows = await notificationsService.list();
            const needsYou = rows.filter((r) => r.kind === 'needs_you' && r.event_type === 'agent_completed');
            expect(needsYou.map((r) => r.issue_id).sort()).toEqual([waiting, null].sort());
            expect(rows.some((r) => r.event_type === 'agent_error' && r.issue_id === moved)).toBe(true);
            expect(rows.some((r) => r.kind === 'update' && r.issue_id === moved)).toBe(true);
        });

        it('countUnread excludes the same stale rows', async () => {
            await seed();
            expect(await notificationsService.countUnread()).toBe(4);
        });

        it('a workflow run needs_you goes stale once its item moves on', async () => {
            await insertProject('p1');
            const item = await insertItem({ type: 'task', project_id: 'p1', status: 'waiting_for_info' });
            await notificationsService.create({ event_type: 'workflow_run', message: 'm', kind: 'needs_you', issue_id: item });
            await testDb.updateTable('items').set({ status: 'in_progress' }).where('id', '=', item).execute();
            expect(await notificationsService.countUnread()).toBe(0);
        });

        it('a newer needs_you on the same item supersedes the older one', async () => {
            // An answered question must not resurface when the item later
            // reaches in_review for a different reason (its PR is ready).
            await insertProject('p1');
            const item = await insertItem({ type: 'task', project_id: 'p1', status: 'in_review' });
            // workflow_run: what a Delivery / Quick change run emits.
            const mk = (message: string) =>
                notificationsService.create({ event_type: 'workflow_run', message, kind: 'needs_you', issue_id: item });
            await mk('needs you: open questions');
            await mk('finished: PR ready');
            const live = (await notificationsService.list()).filter((r) => r.issue_id === item);
            expect(live.map((r) => r.message)).toEqual(['finished: PR ready']);
            expect(await notificationsService.countUnread()).toBe(1);
        });
    });

    describe('plainNotice', () => {
        it('turns an agent markdown reason into one readable line', () => {
            const md = '## Brainstorm — open questions\n\n`todo count` already **ships**.\n- see `## What`';
            expect(plainNotice(md)).toBe('Brainstorm — open questions todo count already ships. see What');
        });

        it('caps a long reason with an ellipsis', () => {
            const out = plainNotice('word '.repeat(200));
            expect(out.length).toBeLessThanOrEqual(240);
            expect(out.endsWith('…')).toBe(true);
        });
    });

    describe('updatePushStatus', () => {
        it('sets push_status and push_failure_reason on the row', async () => {
            const n = await notificationsService.create({ event_type: 'e', message: 'x' });
            await notificationsService.updatePushStatus(n.id, 'sent');
            const got = (await notificationsService.get(n.id))!;
            expect(got.push_status).toBe('sent');
            expect(got.push_failure_reason).toBeNull();
        });

        it('stamps push_failure_reason when push fails', async () => {
            const n = await notificationsService.create({ event_type: 'e', message: 'x' });
            await notificationsService.updatePushStatus(n.id, 'failed', 'token expired');
            const got = (await notificationsService.get(n.id))!;
            expect(got.push_status).toBe('failed');
            expect(got.push_failure_reason).toBe('token expired');
        });
    });
});

describe('create stamps link_url', () => {
    it('derives the item route, looking the type up when the producer did not pass it', async () => {
        await insertProject('p1', 'ATL');
        await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 't', status: 'ready' });
        await insertItem({ id: 'ATL-1-1', type: 'sub_task', project_id: 'p1', title: 's', status: 'ready', parent_id: 'ATL-1', parent_type: 'task' });
        expect((await notificationsService.create({ event_type: 'ci_failed', message: 'm', issue_type: 'task', issue_id: 'ATL-1' })).link_url).toBe('/tasks/ATL-1');
        expect((await notificationsService.create({ event_type: 'x', message: 'm', issue_id: 'ATL-1-1' })).link_url).toBe('/sub-tasks/ATL-1-1');
    });

    it('derives reminder, jira and project routes; keeps an explicit link; leaves the rest null', async () => {
        await insertProject('p9', 'PNN');
        expect((await notificationsService.create({ event_type: 'reminder', message: 'm' })).link_url).toBe('/reminders');
        expect((await notificationsService.create({ event_type: 'jira_sync', message: 'm' })).link_url).toBe('/settings?tab=jira');
        expect((await notificationsService.create({ event_type: 'autofetch_failed', message: 'm', project_id: 'p9' })).link_url).toBe('/projects/p9');
        expect((await notificationsService.create({ event_type: 'terminal.waiting_for_input', message: 'm', project_id: 'p9', link_url: '/terminal/s1' })).link_url).toBe('/terminal/s1');
        expect((await notificationsService.create({ event_type: 'boot', message: 'm' })).link_url).toBeNull();
    });
});
