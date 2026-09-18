import { describe, expect, it, afterEach } from 'vitest';
import { agentRunEnv, claudeIsolationArgs } from './agent-runner.js';

// Agent runs spawn the Owner's own `claude` binary. Without isolation they
// inherit ~/.claude hooks, plugins, user CLAUDE.md and every user-scope MCP
// server; with it they load only project/local settings (so the worktree's
// `.claude/commands/atlas-*` still resolve) and the Atlas MCP server.
describe('claudeIsolationArgs', () => {
    it('restricts settings to project+local and MCP to the Atlas HTTP server only', () => {
        const args = claudeIsolationArgs(true);
        expect(args.slice(0, 3)).toEqual(['--setting-sources', 'project,local', '--strict-mcp-config']);
        expect(args[3]).toBe('--mcp-config');
        expect(JSON.parse(args[4] ?? '')).toEqual({
            mcpServers: { atlas: { type: 'http', url: 'http://127.0.0.1:4500/mcp' } },
        });
        expect(args).toHaveLength(5);
    });

    it('leaves freedom-mode scouts on the Owner config so their Playwright / claude.ai connectors still load', () => {
        expect(claudeIsolationArgs(false)).toEqual([]);
    });
});

describe('agentRunEnv', () => {
    const saved = { API_PORT: process.env['API_PORT'], PORT: process.env['PORT'] };
    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    it('exposes ATLAS_API_URL on the API port so .atlas/scripts validators can query the API', () => {
        process.env['API_PORT'] = '4101';
        expect(agentRunEnv('claude', 'claude-opus-4-7', null, null)['ATLAS_API_URL']).toBe('http://127.0.0.1:4101');
    });

    it('falls back to PORT, then 4001', () => {
        delete process.env['API_PORT'];
        process.env['PORT'] = '5001';
        expect(agentRunEnv('copilot', 'gpt-5.4', null, null)['ATLAS_API_URL']).toBe('http://127.0.0.1:5001');
        delete process.env['PORT'];
        expect(agentRunEnv('copilot', 'gpt-5.4', null, null)['ATLAS_API_URL']).toBe('http://127.0.0.1:4001');
    });

    it('keeps the git credential env and layers the ollama overlay last', () => {
        const env = agentRunEnv('ollama', 'qwen3.5', '/tmp/gitconfig', 'gh-token');
        expect(env['GIT_CONFIG_GLOBAL']).toBe('/tmp/gitconfig');
        expect(env['GH_TOKEN']).toBe('gh-token');
        expect(env['ANTHROPIC_API_KEY']).toBe('');
        expect(env['ATLAS_API_URL']).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });
});
