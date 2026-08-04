import { describe, it, expect } from 'vitest';
import {
    AGENT_CLIS,
    CLI_DIALECT,
    CLI_LABEL,
    CLI_SHORT_LABEL,
    DEFAULT_MODEL_BY_CLI,
    isClaudeDialect,
    asAgentCli,
} from './index.js';
import { AgentCliSchema } from '../schemas/index.js';

describe('CLI registry', () => {
    it('lists exactly the CLIs the Zod enum accepts', () => {
        expect([...AGENT_CLIS]).toEqual([...AgentCliSchema.options]);
    });

    // Every one of these is `Record<AgentCli, …>`, so tsc already enforces
    // completeness. These assertions catch the other half: a key present but
    // empty, which compiles fine and renders as a blank label / broken spawn.
    it.each([
        ['CLI_DIALECT', CLI_DIALECT],
        ['CLI_LABEL', CLI_LABEL],
        ['CLI_SHORT_LABEL', CLI_SHORT_LABEL],
        ['DEFAULT_MODEL_BY_CLI', DEFAULT_MODEL_BY_CLI],
    ])('%s has a non-empty entry for every CLI', (_name, map) => {
        for (const cli of AGENT_CLIS) {
            expect(map[cli]).toBeTruthy();
        }
    });

    it('maps ollama onto the claude dialect — it runs the same binary', () => {
        expect(CLI_DIALECT.ollama).toBe('claude');
        expect(CLI_DIALECT.claude).toBe('claude');
        expect(CLI_DIALECT.copilot).toBe('copilot');
        expect(isClaudeDialect('ollama')).toBe(true);
        expect(isClaudeDialect('copilot')).toBe(false);
    });
});

describe('asAgentCli', () => {
    it('passes through every known CLI', () => {
        for (const cli of AGENT_CLIS) {
            expect(asAgentCli(cli)).toBe(cli);
        }
    });

    it('does NOT collapse ollama to claude — the old ternary narrowing did', () => {
        expect(asAgentCli('ollama')).toBe('ollama');
    });

    it('falls back to claude for unknown, empty, and non-string input', () => {
        expect(asAgentCli('gemini')).toBe('claude');
        expect(asAgentCli('')).toBe('claude');
        expect(asAgentCli(undefined)).toBe('claude');
        expect(asAgentCli(null)).toBe('claude');
        expect(asAgentCli(7)).toBe('claude');
    });

    it('honours an explicit fallback', () => {
        expect(asAgentCli('nope', 'copilot')).toBe('copilot');
    });
});
