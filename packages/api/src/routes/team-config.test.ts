import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

const dataDir = mkdtempSync(join(tmpdir(), 'atlas-team-routes-'));
process.env['ATLAS_DATA_DIR'] = dataDir;

import { buildApp } from '../server.js';
import { encrypt } from '../services/crypto.js';
import { teamConfigDir } from '../services/team-config.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

let app: FastifyInstance;

async function insertCredential(id: string): Promise<void> {
    await testDb
        .insertInto('credentials')
        .values({ id, label: id, kind: 'pat', username: 'x-access-token', token_encrypted: encrypt('tok'), token_fingerprint: 'tok' } as never)
        .execute();
}

const put = (payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/team-config', payload });

beforeEach(async () => {
    await truncateAll();
    rmSync(teamConfigDir(), { recursive: true, force: true });
    app = await buildApp({ logger: false });
    await app.ready();
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
    rmSync(dataDir, { recursive: true, force: true });
});

describe('/api/team-config', () => {
    it('returns the defaults before anything is saved', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/team-config' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            role: 'off',
            repo_url: null,
            credential_id: null,
            branch: 'main',
            interval_minutes: 60,
            last_sync_at: null,
            last_sync_ok: null,
            last_sync_message: null,
            last_commit: null,
        });
    });

    it('saves a partial update and returns the whole config', async () => {
        await insertCredential('c1');
        const res = await put({ role: 'subscriber', repo_url: 'https://github.com/acme/team.git', credential_id: 'c1', interval_minutes: 15 });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ role: 'subscriber', repo_url: 'https://github.com/acme/team.git', credential_id: 'c1', branch: 'main', interval_minutes: 15 });

        const branch = await put({ branch: 'atlas-sync' });
        expect(branch.json()).toMatchObject({ role: 'subscriber', branch: 'atlas-sync', interval_minutes: 15 });
    });

    it.each([
        [{ repo_url: 'http://github.com/acme/team.git' }, /https/],
        [{ repo_url: 'not a url' }, /URL|url/],
        [{ branch: 'bad branch!' }, /branch/],
        [{ interval_minutes: 2 }, />=5/],
        [{ role: 'admin' }, /off/],
        [{ last_commit: 'abc' }, /Unrecognized|unrecognized/],
    ])('rejects %o', async (payload, message) => {
        const res = await put(payload);
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(message);
    });

    it('rejects an unknown credential', async () => {
        const res = await put({ credential_id: 'missing' });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('Credential not found');
    });

    it('drops the local clone when the repo or branch changes, and keeps it otherwise', async () => {
        await put({ repo_url: 'https://github.com/acme/team.git' });
        mkdirSync(teamConfigDir(), { recursive: true });
        await put({ interval_minutes: 30 });
        expect(existsSync(teamConfigDir())).toBe(true);
        await put({ branch: 'other' });
        expect(existsSync(teamConfigDir())).toBe(false);
        mkdirSync(teamConfigDir(), { recursive: true });
        await put({ repo_url: 'https://github.com/acme/other.git' });
        expect(existsSync(teamConfigDir())).toBe(false);
    });

    it('refuses a manual sync while the role is off', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/team-config/sync', payload: {} });
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toMatch(/off/);
    });

    it('asks for the repo URL and credential before a sync', async () => {
        await put({ role: 'subscriber' });
        const noUrl = await app.inject({ method: 'POST', url: '/api/team-config/sync', payload: {} });
        expect(noUrl.statusCode).toBe(400);
        expect(noUrl.json().error).toMatch(/repo URL/);

        await put({ repo_url: 'https://github.com/acme/team.git' });
        const noCred = await app.inject({ method: 'POST', url: '/api/team-config/sync', payload: {} });
        expect(noCred.statusCode).toBe(400);
        expect(noCred.json().error).toMatch(/credential/);
    });

    it('syncs on demand and returns the message with the updated config', async () => {
        const { execFileSync } = await import('node:child_process');
        const remote = mkdtempSync(join(tmpdir(), 'atlas-remote-'));
        execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
        await insertCredential('c1');
        // The schema only takes https; a file remote is set below it so no git host is needed.
        await testDb.insertInto('team_config').values({ id: 1, role: 'subscriber', repo_url: `file://${remote}`, credential_id: 'c1' }).execute();

        const res = await app.inject({ method: 'POST', url: '/api/team-config/sync', payload: {} });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ message: 'Nothing published yet', config: { role: 'subscriber', last_sync_ok: true } });
        rmSync(remote, { recursive: true, force: true });
    });
});

describe('PATCH /api/projects/:id team_managed', () => {
    it('includes a project in the team config and takes it out again', async () => {
        await insertProject('p1', 'ATL', { no_repo: true });
        const on = await app.inject({ method: 'PATCH', url: '/api/projects/p1', payload: { team_managed: true } });
        expect(on.statusCode).toBe(200);
        expect(on.json().team_managed).toBe(true);
        const off = await app.inject({ method: 'PATCH', url: '/api/projects/p1', payload: { team_managed: false } });
        expect(off.json().team_managed).toBe(false);
        const list = await app.inject({ method: 'GET', url: '/api/projects' });
        expect(list.json()[0].team_managed).toBe(false);
    });
});

describe('POST /api/settings/reset', () => {
    it('clears the team config and its local clone', async () => {
        await put({ role: 'subscriber', repo_url: 'https://github.com/acme/team.git' });
        mkdirSync(teamConfigDir(), { recursive: true });
        const res = await app.inject({ method: 'POST', url: '/api/settings/reset' });
        expect(res.statusCode).toBe(200);
        expect((await app.inject({ method: 'GET', url: '/api/team-config' })).json().role).toBe('off');
        expect(existsSync(teamConfigDir())).toBe(false);
    });
});
