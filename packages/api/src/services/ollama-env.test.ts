import { describe, it, expect, afterEach } from 'vitest';
import { ollamaEnv, ollamaBaseUrl, OLLAMA_DEFAULT_BASE_URL } from './ollama-env.js';

const KEY = 'ATLAS_OLLAMA_BASE_URL';

afterEach(() => {
    delete process.env[KEY];
});

describe('ollamaBaseUrl', () => {
    it('defaults to Ollama’s documented local address', () => {
        expect(ollamaBaseUrl()).toBe(OLLAMA_DEFAULT_BASE_URL);
        expect(OLLAMA_DEFAULT_BASE_URL).toBe('http://localhost:11434');
    });

    it('honours ATLAS_OLLAMA_BASE_URL for a LAN or non-default-port server', () => {
        process.env[KEY] = 'http://192.168.1.50:11500';
        expect(ollamaBaseUrl()).toBe('http://192.168.1.50:11500');
    });

    it('treats an empty override as unset rather than as a blank base URL', () => {
        process.env[KEY] = '';
        expect(ollamaBaseUrl()).toBe(OLLAMA_DEFAULT_BASE_URL);
    });
});

describe('ollamaEnv', () => {
    it('is a no-op for every non-ollama CLI', () => {
        expect(ollamaEnv('claude', 'claude-opus-4-7')).toEqual({});
        expect(ollamaEnv('copilot', 'gpt-5.4')).toEqual({});
    });

    it('emits the three variables Ollama’s Claude Code integration requires', () => {
        const env = ollamaEnv('ollama', null);
        expect(env['ANTHROPIC_BASE_URL']).toBe(OLLAMA_DEFAULT_BASE_URL);
        expect(env['ANTHROPIC_AUTH_TOKEN']).toBe('ollama');
        expect(env['ANTHROPIC_API_KEY']).toBe('');
    });

    it('blanks ANTHROPIC_API_KEY so a host key cannot divert a free run to Anthropic', () => {
        // The overlay is spread AFTER process.env at every spawn site, so an
        // explicit '' is what actually neutralises an inherited key. A missing
        // key here would silently bill Anthropic for a "free" local run.
        // Deliberately not shaped like a real Anthropic key — a realistic
        // prefix in a fixture trips secretlint on every commit for no benefit.
        const merged = { ANTHROPIC_API_KEY: 'inherited-host-key', ...ollamaEnv('ollama', 'qwen3.5') };
        expect(merged.ANTHROPIC_API_KEY).toBe('');
    });

    it('pins the small/fast model tiers to the run’s model when one is given', () => {
        const env = ollamaEnv('ollama', 'qwen3.5');
        expect(env['ANTHROPIC_SMALL_FAST_MODEL']).toBe('qwen3.5');
        expect(env['ANTHROPIC_DEFAULT_HAIKU_MODEL']).toBe('qwen3.5');
    });

    it('omits the small/fast pins when no model is known', () => {
        const env = ollamaEnv('ollama');
        expect(env).not.toHaveProperty('ANTHROPIC_SMALL_FAST_MODEL');
        expect(env).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL');
    });

    it('routes through the configured base URL', () => {
        process.env[KEY] = 'http://ollama.lan:11434';
        expect(ollamaEnv('ollama', 'qwen3.5')['ANTHROPIC_BASE_URL']).toBe('http://ollama.lan:11434');
    });
});
