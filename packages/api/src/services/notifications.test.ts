import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { notificationsService } from './notifications.js';
import { closeTestDb, truncateAll } from '../../tests/_pg-db.js';

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
            expect((await notificationsService.get(n.id))!.external_status).toBe('none');
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
