import { describe, expect, it, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server.js';
import { __resetCliAvailabilityCacheForTest } from '../services/cli-availability.js';
import { closeTestDb } from '../../tests/_pg-db.js';

// The real spawn path, pointed at binaries we control: the running node
// binary answers `--version` like a real CLI would, and a missing path
// stands in for an uninstalled one.
let app: FastifyInstance;
const saved = {
    claude: process.env['ATLAS_CLAUDE_BINARY'],
    copilot: process.env['ATLAS_COPILOT_BINARY'],
};

beforeEach(async () => {
    __resetCliAvailabilityCacheForTest();
    process.env['ATLAS_CLAUDE_BINARY'] = process.execPath;
    process.env['ATLAS_COPILOT_BINARY'] = '/nonexistent/atlas-test/copilot';
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterEach(() => {
    for (const [cli, value] of Object.entries(saved)) {
        const key = `ATLAS_${cli.toUpperCase()}_BINARY`;
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/cli/availability', () => {
    it('returns one entry per CLI with ollama probing the claude binary', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/cli/availability' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([
            { cli: 'claude', binary: process.execPath, available: true, version: process.version },
            {
                cli: 'copilot',
                binary: '/nonexistent/atlas-test/copilot',
                available: false,
                version: null,
            },
            { cli: 'ollama', binary: process.execPath, available: true, version: process.version },
        ]);
    });

    it('caches the probe so a changed binary is not re-spawned within the window', async () => {
        await app.inject({ method: 'GET', url: '/api/cli/availability' });
        process.env['ATLAS_CLAUDE_BINARY'] = '/nonexistent/atlas-test/claude';
        const res = await app.inject({ method: 'GET', url: '/api/cli/availability' });
        expect(res.json()[0]).toMatchObject({ cli: 'claude', available: true });

        __resetCliAvailabilityCacheForTest();
        const fresh = await app.inject({ method: 'GET', url: '/api/cli/availability' });
        expect(fresh.json()[0]).toEqual({
            cli: 'claude',
            binary: '/nonexistent/atlas-test/claude',
            available: false,
            version: null,
        });
    });
});
