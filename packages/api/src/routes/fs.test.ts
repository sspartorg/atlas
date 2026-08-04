import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { homedir } from 'node:os';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { closeTestDb } from '../../tests/_pg-db.js';

let app: FastifyInstance;

beforeEach(async () => {
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/fs/home', () => {
    it('returns 200 with the home directory path', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/fs/home' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('path');
        expect(typeof body.path).toBe('string');
        expect(body.path).toBe(homedir());
    });
});

describe('GET /api/fs/list', () => {
    it('returns 200 with drives list when path is empty (Windows sentinel)', async () => {
        // On Windows (process.platform === 'win32') this should return drives.
        // On POSIX it should return root children. Either way it returns 200.
        const res = await app.inject({ method: 'GET', url: '/api/fs/list' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('entries');
        expect(Array.isArray(body.entries)).toBe(true);
    });

    it('returns 200 with drives list when path=drives sentinel', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/fs/list?path=drives' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('entries');
        expect(Array.isArray(body.entries)).toBe(true);
        // path sentinel returns empty path and null parent
        expect(body.parent).toBeNull();
    });

    it('returns 200 listing an actual directory (home dir)', async () => {
        const home = homedir();
        const res = await app.inject({
            method: 'GET',
            url: `/api/fs/list?path=${encodeURIComponent(home)}`,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('entries');
        expect(Array.isArray(body.entries)).toBe(true);
        expect(body.path).toBe(home);
        // homedir should have a parent dir
        expect(body.parent).not.toBeNull();
    });

    it('returns 404 when path does not exist', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/fs/list?path=%2Fno-such-path-zzz-xyz123',
        });
        // On Windows, /no-such-path resolves to a path under current drive root
        // that doesn't exist either. On POSIX it's definitely not found.
        expect([400, 404]).toContain(res.statusCode);
    });

    it('returns 200 with null parent when listing a drive root (parent === self on Windows)', async () => {
        // On Windows, dirname('C:\\') === 'C:\\' so parent === absolute → null
        // On POSIX systems this test is a no-op (C:\ doesn't exist, gets 404)
        const res = await app.inject({
            method: 'GET',
            url: `/api/fs/list?path=${encodeURIComponent('C:\\')}`,
        });
        if (process.platform === 'win32') {
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.parent).toBeNull();
        } else {
            // POSIX: 'C:\' is not a valid path → 404
            expect([400, 404]).toContain(res.statusCode);
        }
    });

    it('returns 400 when path points to a file (not a directory — line 77-79)', async () => {
        // Use the api package.json as a guaranteed real file.
        // `fileURLToPath` gives a proper OS-native absolute path (handles
        // the Windows /C:/ → C:/ stripping that URL.pathname leaves in).
        const { fileURLToPath } = await import('node:url');
        // src/routes/ → ../../  → packages/api/
        const apiPackageJson = fileURLToPath(new URL('../../package.json', import.meta.url));
        const res = await app.inject({
            method: 'GET',
            url: `/api/fs/list?path=${encodeURIComponent(apiPackageJson)}`,
        });
        // The file exists but is not a directory → 400
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe('Path is not a directory');
    });
});

describe('GET /api/fs/stat', () => {
    it('returns 400 when path is empty', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/fs/stat' });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe('path required');
    });

    it('returns 200 with exists=true for the home directory', async () => {
        const home = homedir();
        const res = await app.inject({
            method: 'GET',
            url: `/api/fs/stat?path=${encodeURIComponent(home)}`,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.exists).toBe(true);
        expect(body.is_directory).toBe(true);
    });

    it('returns 200 with exists=false for a non-existent path', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/fs/stat?path=%2Fno-such-path-zzz-xyz123-abc',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.exists).toBe(false);
        expect(body.is_directory).toBe(false);
    });
});

describe('GET /api/fs/join', () => {
    it('returns 400 when base is missing', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/fs/join?name=foo' });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe('base and name required');
    });

    it('returns 400 when name is missing', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/fs/join?base=%2Fsome%2Fpath' });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe('base and name required');
    });

    it('returns 200 with joined path for normal base', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/fs/join?base=%2Fsome%2Fpath&name=subdir',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('path');
        expect(body.path).toContain('subdir');
    });

    it('returns 200 for a Windows-style drive root base (trailing backslash)', async () => {
        // Drive root like C:\ — base.endsWith(':\\') branch
        const res = await app.inject({
            method: 'GET',
            url: '/api/fs/join?base=C%3A%5C&name=Users',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        // Should concatenate directly: C:\Users
        expect(body.path).toBe('C:\\Users');
    });

    it('returns 200 for a Windows-style drive root base (trailing forward slash)', async () => {
        // Drive root like C:/ — base.endsWith(':/') branch
        const res = await app.inject({
            method: 'GET',
            url: '/api/fs/join?base=C%3A%2F&name=Users',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        // Should concatenate directly: C:/Users
        expect(body.path).toBe('C:/Users');
    });
});
