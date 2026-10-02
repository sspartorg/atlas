/**
 * git-env.test.ts
 *
 * Branch coverage for gitInvokeEnv: the single conditional branch is
 * `gitConfigPath !== null ? { GIT_CONFIG_GLOBAL: path } : {}`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { gitInvokeEnv } from './git-env.js';

describe('gitInvokeEnv', () => {
    it('returns GCM-silencing env vars without GIT_CONFIG_GLOBAL when path is null', () => {
        const env = gitInvokeEnv(null);
        expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
        expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1');
        expect(env['GCM_INTERACTIVE']).toBe('Never');
        expect(env['GCM_GUI_PROMPT']).toBe('false');
        expect(env['GCM_MODAL_PROMPT']).toBe('false');
        expect(env['GIT_CONFIG_GLOBAL']).toBeUndefined();
    });

    it('adds GIT_CONFIG_GLOBAL when a config path is provided', () => {
        const path = '/tmp/atlas-git-test.config';
        const env = gitInvokeEnv(path);
        expect(env['GIT_CONFIG_GLOBAL']).toBe(path);
        // GCM silencers are still set.
        expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
        expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1');
    });

    afterEach(() => vi.unstubAllEnvs());

    it("drops a parent Claude Code session's identity so a spawned claude is its own session", () => {
        // Atlas started from a Claude Code terminal inherits these; a child
        // claude that sees them skips writing its own transcript.
        vi.stubEnv('CLAUDECODE', '1');
        vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'parent');
        vi.stubEnv('CLAUDE_CODE_CHILD_SESSION', '1');
        vi.stubEnv('CLAUDE_CONFIG_DIR', '/home/me/.claude-work');
        const env = gitInvokeEnv(null);
        expect(env['CLAUDECODE']).toBeUndefined();
        expect(env['CLAUDE_CODE_SESSION_ID']).toBeUndefined();
        expect(env['CLAUDE_CODE_CHILD_SESSION']).toBeUndefined();
        // Owner configuration is not session identity — it stays.
        expect(env['CLAUDE_CONFIG_DIR']).toBe('/home/me/.claude-work');
    });
});
