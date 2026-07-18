# Testing `@atlas/mcp`

Two ways to exercise the MCP server end-to-end: a scripted JSON-RPC smoke test, or the official **MCP Inspector** web UI. Both spawn the built server over stdio.

---

## Prerequisites

1. **Build the MCP package** (must re-run after any source change):
   ```powershell
   pnpm --filter @atlas/mcp build
   ```
   This emits `packages/mcp/dist/index.js`.

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
npx -y @modelcontextprotocol/inspector node packages/mcp/dist/index.js
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

1. The connection card on the left auto-fills **Command: `node`**, **Args: `packages/mcp/dist/index.js`**, **Transport: STDIO**. Click **Connect**.
2. Open the **Tools** tab → click **List Tools**. You should see exactly these 10:
   - `list_projects`
   - `list_epics`
   - `get_epic`
   - `get_epic_tree`
   - `list_stories`
   - `get_story`
   - `list_sub_tasks`
   - `list_sub_bugs`
   - `list_bugs`
   - `search_items`
3. Call `list_projects` with no args — should return every project as JSON.
4. Copy an epic id from `list_epics`, paste it into `get_epic_tree` — should return the epic nested with stories, each story's sub-tasks + sub-bugs, and the epic's standalone bugs.

### Stopping the Inspector

`Ctrl+C` in the terminal that launched `npx`. The Inspector also leaves the spawned `node packages/mcp/dist/index.js` child running for the duration of the session — `Ctrl+C` reaps it.

---

## Option B — Scripted smoke test (no browser)

Faster check that verifies the server boots, the JSON-RPC handshake works, and (optionally) one tool round-trips through the live API.

```powershell
# Tools/list only — does not need the API to be running
node packages/mcp/scripts/smoke-test.mjs

# Also exercise list_projects end-to-end (requires @atlas/api running)
$env:LIVE_API='1'
node packages/mcp/scripts/smoke-test.mjs
```

Expected output:

```
[smoke] initialize ok. server: { name: 'atlas-mcp', version: '0.1.0' }
[smoke] tools/list returned 10 tools:
  - list_projects  (List projects)
  - list_epics  (List epics)
  ...
[smoke] list_projects returned <N> project(s)
```

Non-zero exit means the handshake, the tools/list count, or the tools/call failed.

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

- **Tools list is empty / Connect fails in Inspector** → forgot to `pnpm --filter @atlas/mcp build`. The Inspector spawns `dist/index.js`, not source.
- **Every tool call errors with `fetch failed` or `ECONNREFUSED 127.0.0.1:4001`** → `@atlas/api` isn't running.
- **Port already in use** → use the `CLIENT_PORT` / `SERVER_PORT` env-var override shown above.
- **Inspector opens, but server log says nothing on stdout** → that is correct. The server writes JSON-RPC to stdout (consumed by the transport) and all diagnostics to stderr. `console.log` would corrupt the stream.
- **`list_projects` returns an empty array** → your local DB has no seeded projects, not an MCP error. Check the workspace data dir (`%APPDATA%/Atlas/atlas.db` on Windows, `~/.config/Atlas/atlas.db` on macOS/Linux).
