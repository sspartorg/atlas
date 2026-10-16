import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { sql } from 'kysely';

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    // reminders is not in truncateAll (persistent store), clear it explicitly
    await sql`DELETE FROM reminders`.execute(testDb);
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

// SetReminderSchema: label (string min1), body (string), schedule (ReminderScheduleSchema discriminated union), channel enum: 'external'|'notification'|'both'
// ReminderScheduleSchema: { kind: 'once', at: ISO datetime } | { kind: 'daily', time_of_day: 'HH:MM' } | ...
const VALID_REMINDER = {
    label: 'Daily standup',
    body: 'Time for your daily standup meeting',
    schedule: { kind: 'daily', time_of_day: '09:00' },
    channel: 'notification',
};

describe('GET /api/reminders', () => {
    it('returns 200 with empty array when no reminders', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/reminders' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('accepts ?status filter (covers the if(q.status) branch on line 22)', async () => {
        // Seed one reminder to have non-empty data
        await app.inject({ method: 'POST', url: '/api/reminders', payload: VALID_REMINDER });
        const res = await app.inject({ method: 'GET', url: '/api/reminders?status=active' });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });

    it('accepts ?channel filter (covers the if(q.channel) branch on line 24)', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/reminders?channel=notification' });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });

    it('accepts ?since filter (covers the if(q.since) branch on line 25)', async () => {
        const since = new Date(Date.now() - 86_400_000).toISOString();
        const res = await app.inject({
            method: 'GET',
            url: `/api/reminders?since=${encodeURIComponent(since)}`,
        });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });
});

describe('POST /api/reminders', () => {
    it('creates a reminder and returns 201', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: VALID_REMINDER,
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ label: 'Daily standup' });
        expect(body.id).toBeDefined();
    });

    it('returns 400 for missing label', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: { body: 'some body', schedule: { kind: 'daily', time_of_day: '09:00' }, channel: 'notification' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid channel', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: { ...VALID_REMINDER, channel: 'whatsapp' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid schedule (missing kind)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: { ...VALID_REMINDER, schedule: { time_of_day: '09:00' } },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/reminders/:id', () => {
    it('returns 200 for an existing reminder', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: VALID_REMINDER,
        });
        const { id } = JSON.parse(created.body) as { id: number };
        const res = await app.inject({ method: 'GET', url: `/api/reminders/${id}` });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ id, label: 'Daily standup' });
    });

    it('returns 400 for a non-numeric id', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/reminders/not-a-number' });
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 for a missing reminder', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/reminders/99999' });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/reminders/:id', () => {
    it('updates a reminder label and returns updated row', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: VALID_REMINDER,
        });
        const { id } = JSON.parse(created.body) as { id: number };

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/reminders/${id}`,
            payload: { label: 'Updated Label' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ label: 'Updated Label' });
    });

    it('returns 400 for non-numeric id', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/reminders/not-a-number',
            payload: { label: 'x' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 for missing reminder', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/reminders/99999',
            payload: { label: 'x' },
        });
        expect(res.statusCode).toBe(404);
    });
});

// REM-EXTRA — branch coverage gaps

describe('POST /api/reminders — created_by_agent_id non-null (REM-EXTRA)', () => {
    // Line 29: `body.created_by_agent_id ?? null` — non-null arm.
    // Existing tests use VALID_REMINDER which has no created_by_agent_id (undefined → null).
    // Supplying a string value exercises the non-null path.
    it('creates a reminder with created_by_agent_id set (non-null arm of ?? null)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: { ...VALID_REMINDER, created_by_agent_id: 'agent-news-scout' },
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.created_by_agent_id).toBe('agent-news-scout');
    });
});

describe('PATCH /api/reminders — catch → 409 (REM-EXTRA)', () => {
    // Line 42-44: `catch (e) → reply.status(409).send({ error: ... })`.
    // Trigger the catch by patching a reminder after it has been cancelled
    // (the service throws when trying to update a cancelled/deleted reminder).
    it('returns 409 when PATCH throws (patching a cancelled reminder)', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: VALID_REMINDER,
        });
        const { id } = JSON.parse(created.body) as { id: number };
        // Cancel the reminder first
        await app.inject({ method: 'DELETE', url: `/api/reminders/${id}` });
        // Now PATCH the cancelled (deleted) reminder — service throws or returns null
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/reminders/${id}`,
            payload: { label: 'Updated after cancel' },
        });
        // Either 404 (null return) or 409 (thrown exception) — both are correct outcomes
        // depending on service implementation; the catch block at line 42-44 is exercised
        // by the throw path (409).
        expect(res.statusCode).toBe(409);
    });
});

describe('a bad cron expression is a 400 the modal can show, not a 500', () => {
    it('POST and PATCH refuse it with the reason', async () => {
        const bad = { ...VALID_REMINDER, schedule: { kind: 'cron', expr: 'every tuesday' } };
        const post = await app.inject({ method: 'POST', url: '/api/reminders', payload: bad });
        expect(post.statusCode).toBe(400);
        expect(JSON.parse(post.body)).toMatchObject({ kind: 'validation_error', error: expect.stringMatching(/^Invalid cron expression "every tuesday"/) });

        const created = await app.inject({ method: 'POST', url: '/api/reminders', payload: VALID_REMINDER });
        const { id } = JSON.parse(created.body) as { id: number };
        const patch = await app.inject({ method: 'PATCH', url: `/api/reminders/${id}`, payload: { schedule: bad.schedule } });
        expect(patch.statusCode).toBe(400);
        const never = await app.inject({ method: 'POST', url: '/api/reminders', payload: { ...VALID_REMINDER, schedule: { kind: 'cron', expr: '0 0 30 2 *' } } });
        expect(never.statusCode).toBe(400);
        expect(JSON.parse(never.body).error).toMatch(/no future fire/);
    });
});

describe('DELETE /api/reminders/:id', () => {
    it('cancels (deletes) a reminder and returns 200', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/reminders',
            payload: VALID_REMINDER,
        });
        const { id } = JSON.parse(created.body) as { id: number };

        const res = await app.inject({ method: 'DELETE', url: `/api/reminders/${id}` });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ id });
    });

    it('returns 404 for a missing reminder', async () => {
        const res = await app.inject({ method: 'DELETE', url: '/api/reminders/99999' });
        expect(res.statusCode).toBe(404);
    });
});

async function createReminder(): Promise<number> {
    const res = await app.inject({ method: 'POST', url: '/api/reminders', payload: VALID_REMINDER });
    return (JSON.parse(res.body) as { id: number }).id;
}

describe('PATCH /api/reminders/:id — pause / resume', () => {
    it('pauses and resumes; a terminal status is a 400', async () => {
        const id = await createReminder();
        const paused = await app.inject({ method: 'PATCH', url: `/api/reminders/${id}`, payload: { status: 'paused' } });
        expect(paused.statusCode).toBe(200);
        expect(JSON.parse(paused.body).status).toBe('paused');
        const resumed = await app.inject({ method: 'PATCH', url: `/api/reminders/${id}`, payload: { status: 'active' } });
        expect(JSON.parse(resumed.body).status).toBe('active');
        const bad = await app.inject({ method: 'PATCH', url: `/api/reminders/${id}`, payload: { status: 'completed' } });
        expect(bad.statusCode).toBe(400);
    });
});

describe('POST /api/reminders/:id/snooze', () => {
    it('moves next_fire_at to now + minutes and returns the row', async () => {
        const id = await createReminder();
        const before = Date.now();
        const res = await app.inject({ method: 'POST', url: `/api/reminders/${id}/snooze`, payload: { minutes: 10 } });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { next_fire_at: string; status: string; fire_count: number };
        expect(body.status).toBe('active');
        expect(body.fire_count).toBe(0);
        const at = new Date(body.next_fire_at).getTime();
        expect(at).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
        expect(at).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
    });

    it('400 on bad minutes, 404 on a missing reminder, 409 on a cancelled one', async () => {
        const id = await createReminder();
        expect((await app.inject({ method: 'POST', url: `/api/reminders/${id}/snooze`, payload: { minutes: 0 } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: `/api/reminders/${id}/snooze`, payload: {} })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: '/api/reminders/abc/snooze', payload: { minutes: 5 } })).statusCode).toBe(400);
        const missing = await app.inject({ method: 'POST', url: '/api/reminders/99999/snooze', payload: { minutes: 5 } });
        expect(missing.statusCode).toBe(404);
        expect(JSON.parse(missing.body).kind).toBe('not_found');
        await app.inject({ method: 'DELETE', url: `/api/reminders/${id}` });
        const cancelled = await app.inject({ method: 'POST', url: `/api/reminders/${id}/snooze`, payload: { minutes: 5 } });
        expect(cancelled.statusCode).toBe(409);
        expect(JSON.parse(cancelled.body).kind).toBe('conflict');
    });
});

describe('GET /api/reminders/:id/fires', () => {
    it('returns the fire log (time, push and external status), honouring ?limit', async () => {
        const id = await createReminder();
        for (let i = 0; i < 3; i++) {
            await testDb
                .insertInto('notifications')
                .values({ event_type: 'reminder', message: 'x', sent_external: 0, kind: 'system', external_status: 'sent', reminder_id: id })
                .execute();
        }
        const res = await app.inject({ method: 'GET', url: `/api/reminders/${id}/fires?limit=2` });
        expect(res.statusCode).toBe(200);
        const fires = JSON.parse(res.body) as Array<Record<string, unknown>>;
        expect(fires).toHaveLength(2);
        expect(Object.keys(fires[0]!).sort()).toEqual(
            ['external_status', 'failure_reason', 'fired_at', 'notification_id', 'push_status'],
        );
        expect(fires[0]!['external_status']).toBe('sent');
        const all = await app.inject({ method: 'GET', url: `/api/reminders/${id}/fires` });
        expect(JSON.parse(all.body)).toHaveLength(3);
        const row = await app.inject({ method: 'GET', url: `/api/reminders/${id}` });
        expect(JSON.parse(row.body).fire_count).toBe(3);
    });

    it('404 for a missing reminder, 400 for a bad limit', async () => {
        expect((await app.inject({ method: 'GET', url: '/api/reminders/99999/fires' })).statusCode).toBe(404);
        const id = await createReminder();
        expect((await app.inject({ method: 'GET', url: `/api/reminders/${id}/fires?limit=0` })).statusCode).toBe(400);
    });
});

describe('DELETE /api/reminders/:id?hard=1', () => {
    it('409 while the reminder can still fire; 204 once cancelled, then gone', async () => {
        const id = await createReminder();
        const live = await app.inject({ method: 'DELETE', url: `/api/reminders/${id}?hard=1` });
        expect(live.statusCode).toBe(409);
        await app.inject({ method: 'DELETE', url: `/api/reminders/${id}` });
        const del = await app.inject({ method: 'DELETE', url: `/api/reminders/${id}?hard=1` });
        expect(del.statusCode).toBe(204);
        expect((await app.inject({ method: 'GET', url: `/api/reminders/${id}` })).statusCode).toBe(404);
        expect((await app.inject({ method: 'DELETE', url: `/api/reminders/${id}?hard=1` })).statusCode).toBe(404);
    });
});

describe('GET /api/reminders — status list + paging', () => {
    it('takes a comma list of statuses and pages with limit/offset', async () => {
        const a = await createReminder();
        const b = await createReminder();
        await app.inject({ method: 'PATCH', url: `/api/reminders/${b}`, payload: { status: 'paused' } });
        const c = await createReminder();
        await app.inject({ method: 'DELETE', url: `/api/reminders/${c}` });

        const live = JSON.parse((await app.inject({ method: 'GET', url: '/api/reminders?status=active,paused' })).body) as Array<{ id: number }>;
        expect(live.map((r) => r.id).sort()).toEqual([a, b].sort());
        const hist = JSON.parse((await app.inject({ method: 'GET', url: '/api/reminders?status=cancelled,completed&limit=50&offset=0' })).body) as Array<{ id: number }>;
        expect(hist.map((r) => r.id)).toEqual([c]);
        const paged = JSON.parse((await app.inject({ method: 'GET', url: '/api/reminders?limit=1&offset=1' })).body) as unknown[];
        expect(paged).toHaveLength(1);
    });

    it('400 for an unknown status or a bad limit', async () => {
        expect((await app.inject({ method: 'GET', url: '/api/reminders?status=active,bogus' })).statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/api/reminders?limit=-1' })).statusCode).toBe(400);
    });
});
