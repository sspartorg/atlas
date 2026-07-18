const DEFAULT_API_BASE = 'http://127.0.0.1:4001';

export interface IMcpConfig {
    apiBase: string;
    requestTimeoutMs: number;
    /**
     * Shared secret sent as `X-Atlas-Token` on every write request. Empty string
     * means "no token"; the API will reject writes unless its own
     * `ATLAS_MCP_TOKEN` is also empty. Reads (GET) never include the header.
     */
    mcpToken: string;
    /**
     * Bound agent identity for THIS MCP process. When the agent-runner spawns
     * a CLI + MCP subshell, it sets `ATLAS_AGENT_ID=<slug>` in the child env.
     * All write operations (change_status, assign, add_comment, add_link)
     * MUST attribute the audit-log entry to this bound id, ignoring any
     * caller-supplied `agent_id`. Empty string means "no bound identity" —
     * the pre-fix behavior where the caller was trusted. Callers should
     * treat empty as "no identity injection" and preserve backward compat.
     */
    boundAgentId: string;
}

export function loadConfig(): IMcpConfig {
    const apiBase = (process.env['ATLAS_API_BASE'] ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    const rawTimeout = process.env['ATLAS_MCP_TIMEOUT_MS'];
    const requestTimeoutMs = rawTimeout ? Math.max(1000, Number(rawTimeout)) : 15_000;
    const mcpToken = process.env['ATLAS_MCP_TOKEN'] ?? '';
    const boundAgentId = (process.env['ATLAS_AGENT_ID'] ?? '').trim();
    return { apiBase, requestTimeoutMs, mcpToken, boundAgentId };
}
