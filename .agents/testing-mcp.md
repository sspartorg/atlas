# Testing `@atlas/mcp`

Two ways to exercise the MCP server end-to-end: a scripted JSON-RPC smoke test, or the official **MCP Inspector** web UI. Both spawn the server over stdio from source through tsx — `@atlas/shared` ships raw TypeScript, so a built `node dist/index.js` can't load it (`pnpm --filter @atlas/mcp start` runs `node --import tsx src/index.ts` for the same reason).

---

## Prerequisites

1. **Install deps** once (`pnpm install`); no build step — the server runs from `packages/mcp/src` through tsx.

2. **Start `@atlas/api`** in another terminal (the MCP tools call it over HTTP):
   ```powershell
   pnpm --filter @atlas/api dev
   ```
   Confirm it's up: `http://127.0.0.1:4001/api/health` returns `{"status":"ok",...}`.

---

## Option A — MCP Inspector (browser UI)

The Inspector spawns the server, lists tools, and lets you call any tool with a form-based UI.

### Launch

```powershell
$env:CLIENT_PORT='6280'
$env:SERVER_PORT='6281'
$env:ATLAS_API_BASE='http://127.0.0.1:4001'
npx -y @modelcontextprotocol/inspector node --import tsx packages/mcp/src/index.ts
```

The first run downloads the inspector via `npx`. On startup it prints a line like:

```
🚀 MCP Inspector is up and running at:
   http://localhost:6280/?MCP_PROXY_PORT=6281&MCP_PROXY_AUTH_TOKEN=<token>
```

Open the printed URL — the token is baked in. The Inspector should auto-open your browser.

### Why custom ports

The Inspector defaults to **6274** (UI) + **6277** (proxy). If either is already bound (e.g. a previous Inspector session, or another dev tool), startup fails with `Proxy Server PORT IS IN USE at port 6277`. Setting `CLIENT_PORT` / `SERVER_PORT` to free ports avoids that collision. Any free pair works — 6280/6281 is just one choice.

### What to verify

1. The connection card on the left auto-fills **Command: `node`**, **Args: `--import tsx packages/mcp/src/index.ts`**, **Transport: STDIO**. Click **Connect**.
2. Open the **Tools** tab → click **List Tools**. You should see the 13 consolidated tools listed in [`mcp.md`](mcp.md): `crud_agent`, `agent_memory`, `marketplace_agent`, `search_item`, `create_item`, `get_item`, `update_item`, `delete_item`, `listProjects`, `getProject`, `crud_reminder`, `search_reminder`, `sendExternalNotification`.
3. Call `listProjects` with no args — should return every project as JSON.
4. Call `search_item { query }`, take a Task id from the hits, and call `get_item { issue_type: 'task', id }` — should return the Task with its `sub_tasks`, project, comments, links and activity. `get_item { issue_type: 'sub_task', id }` on one of those returns the sub-task with its parent `task`.

### Stopping the Inspector

`Ctrl+C` in the terminal that launched `npx`. The Inspector also leaves the spawned `node --import tsx packages/mcp/src/index.ts` child running for the duration of the session — `Ctrl+C` reaps it.

---

## Option B — Scripted smoke test (no browser)

`packages/mcp/scripts/smoke-test.mjs` boots the server **from source** over stdio (`node --import tsx src/index.ts`, like `examples/claude-desktop-config.json`; no build needed — `@atlas/shared` ships raw TypeScript, so `node dist/index.js` can't load it), does the JSON-RPC handshake, and checks `tools/list` against the 13 tools `src/tools/*.ts` register. With `LIVE_API=1` it also round-trips the **read-only** tools against a running API: `listProjects` → `getProject`, `crud_agent op=search` → `op=get`, `search_item` → `get_item`. It never writes, so pointing it at a dev stack with real data is safe.

```bash
# Tool surface only — no API needed
node packages/mcp/scripts/smoke-test.mjs

# Plus the read-only round-trip (API must be running; default base http://127.0.0.1:4001)
LIVE_API=1 ATLAS_API_BASE=http://127.0.0.1:4001 node packages/mcp/scripts/smoke-test.mjs
```

`SMOKE_QUERY` (default `todo`) is the `search_item` keyword; zero hits only skip the `get_item` leg, and an empty project / agent list skips its `get` leg.

Expected output ends with:

```
[smoke] tools/list returned 13 tools: agent_memory, create_item, crud_agent, ...
[smoke] OK ✓          # LIVE_API=1; otherwise "LIVE_API not set — skipping round-trip"
```

Non-zero exit means the handshake, the tool surface, or a tool call failed. A tool added or removed in `src/tools/*.ts` must be added to / removed from `EXPECTED_TOOLS` in the script.

---

## Environment variables the server reads

| Var | Default | Purpose |
|---|---|---|
| `ATLAS_API_BASE` | `http://127.0.0.1:4001` | Where the MCP tools send their HTTP calls |
| `ATLAS_MCP_TIMEOUT_MS` | `15000` | Per-API-request timeout in ms |

---

## Wiring into a real AI client

Sample config at `packages/mcp/examples/claude-desktop-config.json`. Replace `<absolute-path-to-repo>` with your local repo path. After restarting the AI client (Claude Desktop / Claude Code / Cursor), the 10 tools appear in its tool picker.

---

## Common gotchas

- **Tools list is empty / Connect fails in Inspector** → the Inspector was pointed at `dist/index.js`; it can't load `@atlas/shared`'s TypeScript. Use `node --import tsx packages/mcp/src/index.ts`.
- **Every tool call errors with `fetch failed` or `ECONNREFUSED 127.0.0.1:4001`** → `@atlas/api` isn't running.
- **Port already in use** → use the `CLIENT_PORT` / `SERVER_PORT` env-var override shown above.
- **Inspector opens, but server log says nothing on stdout** → that is correct. The server writes JSON-RPC to stdout (consumed by the transport) and all diagnostics to stderr. `console.log` would corrupt the stream.
- **`list_projects` returns an empty array** → your local DB has no seeded projects, not an MCP error. Check the workspace data dir (`%APPDATA%/Atlas/atlas.db` on Windows, `~/.config/Atlas/atlas.db` on macOS/Linux).
