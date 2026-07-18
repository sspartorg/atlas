# 0006. MCP HTTP Shim over Stdio

**Date:** 2026-06-04
**Status:** Accepted

## Context

The `@atlas/mcp` package exposes Atlas's tool surface to MCP clients (Claude Code, Cursor, Claude Desktop, GitHub Copilot, Codex). The traditional MCP transport is stdio — the AI client spawns the MCP binary as a subprocess and speaks JSON-RPC over its stdin/stdout. That works, but it means every client config must hardcode the path to the binary on the user's machine.

Two specific problems with the stdio-only model:

- **Path drift.** A `node packages/mcp/dist/index.js` invocation hardcoded into `~/.claude.json`, `~/.codex/config.toml`, and `~/.github/copilot/mcp_config.json` is fragile. Move the repo, rename the package, switch laptops, and every client config breaks in a different way. The Owner memory `[[feedback_mcp_client_config_no_hardcoded_paths]]` records the explicit pushback: client configs must be path-and-secret-free.
- **Multi-stack switching.** Atlas runs both `pnpm dev` (api on 4001) and `pnpm prod` (api on 5001) on the same Owner laptop. Two stdio configs (one per stack) would force the Owner to swap configs every time they switched between dev and prod.

The fix is to make the MCP host an HTTP endpoint, hosted by whichever API process is currently running, on a fixed loopback port. Then clients configure a URL once and never touch the config again. Documentation in `.agents/mcp.md:1-21`.

## Decision

Run the MCP server as an HTTP endpoint hosted in-process by `@atlas/api`. The host listens on the fixed loopback port `127.0.0.1:4500/mcp`. Boot path: `packages/api/src/plugins/mcp-host.ts` -> `packages/mcp/src/http-handler.ts`. The stdio transport (`packages/mcp/src/index.ts`) is kept as a fallback for CI, sandbox testing, and environments where the API process cannot host the listener — but is no longer the recommended client integration.

For clients that cannot speak HTTP/MCP directly, the canonical shim is `npx -y mcp-remote` pointing at the HTTP URL. Client configs (Claude, Codex, Copilot) point at the URL or the shim — they never embed a hardcoded path to the stdio binary.

## Consequences

- Client configs are portable. One entry in `~/.claude.json` (`atlas -> url: http://127.0.0.1:4500/mcp`) serves both the dev and prod stacks — whichever API process is running owns the port.
- The MCP host inherits the API process's authentication, logging, and config. There is one place to look when something is wrong.
- The MCP host depends on the API being up. A user running an MCP client without `pnpm dev` or `pnpm prod` gets a connection-refused error, where the stdio model would have spawned the binary fresh each time.
- The port `4500` is now reserved. Anything else trying to bind it will conflict.
- The stdio path remains supported but unmaintained for daily use. Tests that mock stdio still work; clients that prefer stdio (e.g., niche CI environments) can still use it.
- The Owner pushback against hardcoded paths in MCP client configs is enforced by architecture, not by convention.
