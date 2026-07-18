import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// config.ts imports './load-env.js' purely for its side effect (loading the
// root .env file via dotenv). Mock it out so config.test.ts doesn't depend
// on a real .env file on disk and doesn't spam console output.
vi.mock('./load-env.js', () => ({}));

describe('loadConfig', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('throws when DATABASE_URL is missing', async () => {
        vi.stubEnv('DATABASE_URL', '');
        const { loadConfig } = await import('./config.js');
        expect(() => loadConfig()).toThrow(/DATABASE_URL is required/);
    });

    it('throws when DATABASE_URL has an invalid scheme', async () => {
        vi.stubEnv('DATABASE_URL', 'mysql://user:pass@localhost:3306/db');
        const { loadConfig } = await import('./config.js');
        expect(() => loadConfig()).toThrow(/DATABASE_URL is required/);
    });

    it('accepts a postgres:// URL', async () => {
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
        delete process.env['ATLAS_LOG_LEVEL'];
        delete process.env['NODE_ENV'];
        const { loadConfig } = await import('./config.js');
        const config = loadConfig();
        expect(config.databaseUrl).toBe('postgres://user:pass@localhost:5432/db');
    });

    it('accepts a postgresql:// URL', async () => {
        vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
        const { loadConfig } = await import('./config.js');
        const config = loadConfig();
        expect(config.databaseUrl).toBe('postgresql://user:pass@localhost:5432/db');
    });

    it('defaults logLevel to info when ATLAS_LOG_LEVEL is unset', async () => {
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
        delete process.env['ATLAS_LOG_LEVEL'];
        const { loadConfig } = await import('./config.js');
        expect(loadConfig().logLevel).toBe('info');
    });

    it('uses ATLAS_LOG_LEVEL when it is a recognized level', async () => {
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
        vi.stubEnv('ATLAS_LOG_LEVEL', 'debug');
        const { loadConfig } = await import('./config.js');
        expect(loadConfig().logLevel).toBe('debug');
    });

    it('falls back to info when ATLAS_LOG_LEVEL is not a recognized level', async () => {
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
        vi.stubEnv('ATLAS_LOG_LEVEL', 'bogus-level');
        const { loadConfig } = await import('./config.js');
        expect(loadConfig().logLevel).toBe('info');
    });

    it('defaults nodeEnv to development when NODE_ENV is unset', async () => {
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
        delete process.env['NODE_ENV'];
        const { loadConfig } = await import('./config.js');
        expect(loadConfig().nodeEnv).toBe('development');
    });

    it('uses NODE_ENV when it is a recognized value', async () => {
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
        vi.stubEnv('NODE_ENV', 'production');
        const { loadConfig } = await import('./config.js');
        expect(loadConfig().nodeEnv).toBe('production');
    });

    it('falls back to development when NODE_ENV is not a recognized value', async () => {
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
        vi.stubEnv('NODE_ENV', 'staging');
        const { loadConfig } = await import('./config.js');
        expect(loadConfig().nodeEnv).toBe('development');
    });

    it('caches the config after the first call, ignoring subsequent env changes', async () => {
        vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
        const { loadConfig } = await import('./config.js');
        const first = loadConfig();
        vi.stubEnv('DATABASE_URL', 'postgres://someone-else@localhost:5432/other');
        const second = loadConfig();
        expect(second).toBe(first);
        expect(second.databaseUrl).toBe('postgres://user:pass@localhost:5432/db');
    });
});
