import type { AgentCli, CliDialect } from '../types/index.js';

// The CLI registry. Every enumeration of "which CLIs exist" derives from
// `AGENT_CLIS` — pickers, filters, Model Registry cards, bundle validation.
// Adding a fourth CLI means adding one entry here plus one entry in each
// `Record<AgentCli, …>` below; `tsc` enumerates the rest.
export const AGENT_CLIS = ['claude', 'copilot', 'ollama'] as const;

// Which binary + argv dialect a CLI value actually speaks.
//
// Ollama is NOT a separate CLI. Ollama exposes an Anthropic-compatible API
// (docs.ollama.com/integrations/claude-code), so `cli = 'ollama'` runs the
// SAME `claude` binary with the same flags, pointed at a different base URL
// by three env vars (see `ollamaEnv` in @atlas/api). Everything downstream
// that branches on "how do I talk to this CLI" — argv shape, stream-json
// parsing, `--session-id`/`--resume`, slash-command staging, the on-disk
// transcript path — must branch on the DIALECT, not on the cli value, or
// Ollama silently falls into the Copilot path.
export const CLI_DIALECT: Record<AgentCli, CliDialect> = {
    claude: 'claude',
    copilot: 'copilot',
    ollama: 'claude',
};

/** Full display name. Used in pickers, filters, and section headings. */
export const CLI_LABEL: Record<AgentCli, string> = {
    claude: 'Claude Code',
    copilot: 'GitHub Copilot',
    ollama: 'Ollama',
};

/** Compact display name for chips, legends, and chart segments. */
export const CLI_SHORT_LABEL: Record<AgentCli, string> = {
    claude: 'Claude',
    copilot: 'Copilot',
    ollama: 'Ollama',
};

// Default model when a create payload omits `model`. The web dialog and the
// server's create-handler both fall back to this. Update here when rotating
// any CLI's default. Every value must exist as a `cli_models` row for its
// CLI — the composite FK `agents (cli, model) → cli_models (cli, model_name)`
// rejects anything else.
export const DEFAULT_MODEL_BY_CLI: Record<AgentCli, string> = {
    claude: 'claude-opus-4-7',
    copilot: 'claude-sonnet-4.6',
    ollama: 'qwen3.5',
};

/** True when `cli` runs the Claude Code binary (i.e. `claude` or `ollama`). */
export function isClaudeDialect(cli: AgentCli): boolean {
    return CLI_DIALECT[cli] === 'claude';
}

const AGENT_CLI_SET: ReadonlySet<string> = new Set<string>(AGENT_CLIS);

/**
 * Narrow an untyped `cli` (raw SQL row, JSON body) to `AgentCli`, falling back
 * to `claude` for anything unrecognised.
 *
 * Use this instead of `x === 'copilot' ? 'copilot' : 'claude'`. That older
 * shape reads as a safe narrowing but silently REWRITES every value it doesn't
 * know — an `ollama` row would be reported to the UI as `claude`, landing its
 * cost and session count in the wrong bucket with nothing to debug.
 */
export function asAgentCli(value: unknown, fallback: AgentCli = 'claude'): AgentCli {
    return typeof value === 'string' && AGENT_CLI_SET.has(value) ? (value as AgentCli) : fallback;
}
