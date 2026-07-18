/**
 * git-env.test.ts
 *
 * Branch coverage for gitInvokeEnv: the single conditional branch is
 * `gitConfigPath !== null ? { GIT_CONFIG_GLOBAL: path } : {}`.
 */

import { describe, it, expect } from 'vitest';
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
});
