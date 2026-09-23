import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { agentRunEnv, allowedToolsFor, claudeIsolationArgs, copilotDenyToolArgs } from './agent-runner.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// The allowlist has to match what the run can actually reach. An item-attached
// run is strict-MCP-isolated, so naming the Atlassian prefix only told the agent
// it could fetch a Jira issue live — and a bridge-imported Task hands it a key
// and a browse URL in the description. The snapshot IS the source of truth.
describe('allowedToolsFor', () => {
    it('withholds the Atlassian prefix from item-attached runs', () => {
        const tools = allowedToolsFor(true).split(',');
        expect(tools).not.toContain('mcp__claude_ai_Atlassian');
        expect(tools).toContain('mcp__atlas');
        expect(tools).toContain('mcp__playwright');
        expect(tools).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']));
    });

    it('keeps it for freedom scouts, whose whole job is reading Jira', () => {
        expect(allowedToolsFor(false).split(',')).toContain('mcp__claude_ai_Atlassian');
    });
});

// Copilot has no strict-MCP-config flag and Atlas spawns it with
// --allow-all-tools, so an item-attached Copilot run used to reach every MCP
// server the Owner had registered — further than an item-attached Claude run,
// which strict-config confines to the Atlas server. Deny rules beat
// --allow-all-tools, so denying each server by name is the equivalent.
describe('copilotDenyToolArgs', () => {
    const saved = process.env['COPILOT_HOME'];
    let home: string;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'atlas-copilot-home-'));
        process.env['COPILOT_HOME'] = home;
    });

    afterEach(() => {
        if (saved === undefined) delete process.env['COPILOT_HOME'];
        else process.env['COPILOT_HOME'] = saved;
        rmSync(home, { recursive: true, force: true });
    });

    function writeConfig(body: string) {
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, 'mcp-config.json'), body, 'utf8');
    }

    /** ['--deny-tool','a','--deny-tool','b'] -> ['a','b'] */
    function denied(args: string[]): string[] {
        expect(args.length % 2).toBe(0);
        return args.filter((_, i) => i % 2 === 1);
    }

    it('leaves freedom scouts alone — agent-jira-to-epic exists to read Jira', () => {
        writeConfig(JSON.stringify({ mcpServers: { atlassian: {}, github: {} } }));
        expect(copilotDenyToolArgs(false)).toEqual([]);
    });

    it('denies every server the Owner registered, plus the built-in', () => {
        writeConfig(JSON.stringify({ mcpServers: { atlassian: {}, playwright: {} } }));
        const args = copilotDenyToolArgs(true);
        expect(args.filter((a) => a === '--deny-tool')).toHaveLength(3);
        expect(denied(args).sort()).toEqual(['atlassian', 'github-mcp-server', 'playwright']);
    });

    it("keeps Atlas's own server reachable", () => {
        writeConfig(JSON.stringify({ mcpServers: { atlas: {}, atlassian: {} } }));
        expect(denied(copilotDenyToolArgs(true))).not.toContain('atlas');
        expect(denied(copilotDenyToolArgs(true))).toContain('atlassian');
    });

    // A deny naming a server that isn't configured is inert, so the built-in
    // is still worth passing on a machine where Copilot has never run.
    it('still denies the built-in when there is no config at all', () => {
        expect(denied(copilotDenyToolArgs(true))).toEqual(['github-mcp-server']);
    });

    it('does not throw on a malformed or empty config', () => {
        writeConfig('{ not json');
        expect(denied(copilotDenyToolArgs(true))).toEqual(['github-mcp-server']);
        writeConfig(JSON.stringify({}));
        expect(denied(copilotDenyToolArgs(true))).toEqual(['github-mcp-server']);
    });

    it('reads COPILOT_HOME rather than assuming ~/.copilot', () => {
        // Nothing written to `home` yet, so a stray read of the real ~/.copilot
        // would be the only way another server could appear here.
        expect(denied(copilotDenyToolArgs(true))).toEqual(['github-mcp-server']);
        writeConfig(JSON.stringify({ mcpServers: { relocated: {} } }));
        expect(denied(copilotDenyToolArgs(true)).sort()).toEqual([
            'github-mcp-server',
            'relocated',
        ]);
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
