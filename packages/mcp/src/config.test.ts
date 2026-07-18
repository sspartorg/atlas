import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const ENV_KEYS = ['ATLAS_API_BASE', 'ATLAS_MCP_TIMEOUT_MS', 'ATLAS_MCP_TOKEN'] as const;
const snapshot: Record<(typeof ENV_KEYS)[number], string | undefined> = {
    ATLAS_API_BASE: process.env['ATLAS_API_BASE'],
    ATLAS_MCP_TIMEOUT_MS: process.env['ATLAS_MCP_TIMEOUT_MS'],
    ATLAS_MCP_TOKEN: process.env['ATLAS_MCP_TOKEN'],
};

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (snapshot[k] === undefined) delete process.env[k];
        else process.env[k] = snapshot[k];
    }
});

describe('loadConfig', () => {
    it('returns the default api base + timeout + empty token when no env vars are set', () => {
        delete process.env['ATLAS_API_BASE'];
        delete process.env['ATLAS_MCP_TIMEOUT_MS'];
        delete process.env['ATLAS_MCP_TOKEN'];
        const c = loadConfig();
        expect(c.apiBase).toBe('http://127.0.0.1:4001');
        expect(c.requestTimeoutMs).toBe(15_000);
        expect(c.mcpToken).toBe('');
    });

    it('honours ATLAS_API_BASE override', () => {
        process.env['ATLAS_API_BASE'] = 'http://api.example.com';
        expect(loadConfig().apiBase).toBe('http://api.example.com');
    });

    it('strips trailing slashes from the api base', () => {
        process.env['ATLAS_API_BASE'] = 'http://api.example.com///';
        expect(loadConfig().apiBase).toBe('http://api.example.com');
    });

    it('honours ATLAS_MCP_TIMEOUT_MS override', () => {
        process.env['ATLAS_MCP_TIMEOUT_MS'] = '30000';
        expect(loadConfig().requestTimeoutMs).toBe(30_000);
    });

    it('clamps the timeout to a 1000ms floor', () => {
        process.env['ATLAS_MCP_TIMEOUT_MS'] = '50';
        expect(loadConfig().requestTimeoutMs).toBe(1000);
    });

    it('reads ATLAS_MCP_TOKEN when provided', () => {
        process.env['ATLAS_MCP_TOKEN'] = 'dev-secret';
        expect(loadConfig().mcpToken).toBe('dev-secret');
    });
});
