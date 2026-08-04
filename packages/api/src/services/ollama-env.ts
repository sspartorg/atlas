import type { AgentCli } from '@atlas/shared';

/**
 * Ollama's default listen address. Overridable per-install via
 * `ATLAS_OLLAMA_BASE_URL` (writable from Settings -> Env — deliberately NOT on
 * `ENV_WRITE_DENYLIST`, since retargeting a LAN Ollama box is a normal Owner
 * action and the value carries no credential).
 */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

export function ollamaBaseUrl(): string {
    const configured = process.env['ATLAS_OLLAMA_BASE_URL'];
    return configured && configured.length > 0 ? configured : OLLAMA_DEFAULT_BASE_URL;
}

/**
 * Env overlay that repoints the Claude Code binary at Ollama's
 * Anthropic-compatible API. Empty object for every other CLI.
 *
 * Per docs.ollama.com/integrations/claude-code the manual setup is exactly:
 *   ANTHROPIC_AUTH_TOKEN=ollama
 *   ANTHROPIC_API_KEY=""
 *   ANTHROPIC_BASE_URL=http://localhost:11434
 *
 * `ANTHROPIC_API_KEY: ''` is load-bearing, not decoration. Every spawn site
 * layers this on top of `gitInvokeEnv`, which spreads `process.env` — so an
 * `ANTHROPIC_API_KEY` sitting in the Owner's shell would otherwise ride into
 * the child and send a nominally-free local run to Anthropic at full price.
 * **Always spread `ollamaEnv(...)` AFTER the `process.env` spread.**
 *
 * `model` repoints the small/fast tier too. Claude Code reaches for a
 * haiku-class model for background work (title generation, summaries); against
 * an Ollama base URL that model id has no valid target, so we pin those knobs
 * to the same model the run is using. Both names are set because the CLI has
 * used each across versions; an env var a given build doesn't read is inert.
 */
export function ollamaEnv(cli: AgentCli, model?: string | null): NodeJS.ProcessEnv {
    if (cli !== 'ollama') return {};
    return {
        ANTHROPIC_BASE_URL: ollamaBaseUrl(),
        ANTHROPIC_AUTH_TOKEN: 'ollama',
        ANTHROPIC_API_KEY: '',
        ...(model
            ? { ANTHROPIC_SMALL_FAST_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model }
            : {}),
    };
}
