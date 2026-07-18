# @atlas/mcp — AI Rules

## Responsibility

Standalone MCP (Model Context Protocol) server. Owns:
- A stdio JSON-RPC server that AI clients (Claude Code, Cursor, Claude Desktop) spawn as a child process.
- A small **agent authoring** tool surface: list / get / create / update `agents`. The Owner connects this MCP to Claude to let Claude rewrite agent prompts, handoffs, checklists, and allowed-tools on their behalf — instead of hand-editing the web UI.

This package does **not** open a network port, does **not** access Postgres directly, and does **not** spawn agents. It is a thin tool layer that calls `@atlas/api` over HTTP.

---

## File Structure Rules

```
src/
├── index.ts              → Entry point. Instantiate StdioServerTransport and start the server.
├── server.ts             → createServer(): wires the MCP SDK with the tool registry.
├── config.ts             → Reads ATLAS_API_BASE, ATLAS_MCP_TIMEOUT_MS, ATLAS_MCP_TOKEN from env.
├── api-client.ts         → Thin typed fetch wrapper. The ONLY file that knows about API URLs.
└── tools/
    ├── index.ts          → registerAllTools(server): registers every tool.
    └── agents.ts         → The four agent-authoring tools.
```

---

## Hard Rules

- **No direct DB access.** This package never imports a DB driver. All data flows through `@atlas/api`. Enforced by AGENTS.md root rule "DB access is ONLY from packages/api".
- **No imports from `@atlas/api` or `@atlas/web`.** The only workspace dependency is `@atlas/shared` (types + status machine + Zod schemas).
- **All tool input schemas are Zod schemas.** Validate at the tool boundary. Return helpful errors on bad input.
- **Tool responses are JSON-serialized via `JSON.stringify`** and returned in the `content[0].text` field per MCP spec. Don't invent new content shapes.
- **No stdout writes outside the MCP transport.** `console.log` corrupts the JSON-RPC stream. Use `console.error` for any diagnostic logging.
- **Writes go through `X-Atlas-Token`.** Every POST/PATCH request sends `X-Atlas-Token: <ATLAS_MCP_TOKEN>`. The API rejects writes with 401 if the header is missing or mismatched. GETs are unauthenticated (same as before).
- **No delete tool.** The API still exposes `DELETE /api/agents/:id` for the web UI list page, but the MCP layer deliberately does not surface it. Removing agents is an Owner-only action via the UI.

---

## Tool Naming

- camelCase verb-noun for agent-authoring tools: `listAgents`, `getAgent`, `createAgent`, `updateAgent`. (The earlier snake_case read-only tools — `list_epics`, `get_epic`, `search_items`, etc. — were removed.)
- The `epic.read` / `story.write` tool-catalog names in the database are **capability grants for Atlas's own agent runner** and are a separate abstraction — do not reuse them as MCP tool names.

---

## What NOT to Do

- No HTTP server. No port binding. Transport is stdio only.
- No `console.log` — it corrupts stdio JSON-RPC. Use `console.error` for diagnostics.
- No retries, no caching, no circuit breakers. If the API is down, return the error to the client.
- No delete capability. See above.
