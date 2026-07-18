# `@atlas/mcp` â€” MCP server for agent + item operations

The `@atlas/mcp` package exposes the Atlas tool surface to MCP clients
(Claude Code, Cursor, Claude Desktop). It has **two** transports:

- **HTTP (recommended, single-entry config)** â€” hosted in-process by
  `@atlas/api` on the fixed loopback port `127.0.0.1:4500`. Boot path:
  `packages/api/src/plugins/mcp-host.ts` â†’ `packages/mcp/src/http-handler.ts`.
  One entry in `~/.claude.json` (`atlas` â†’ `url: http://127.0.0.1:4500/mcp`)
  serves both the dev (`pnpm dev`) and prod (`pnpm prod`) local stacks â€”
  whichever is currently running owns the port.
- **stdio (legacy / standalone)** â€” `packages/mcp/src/index.ts`. AI clients
  spawn `node packages/mcp/dist/index.js` and pass `ATLAS_API_BASE` as an
  env var. Kept for CI, sandbox testing, and environments where the API
  process can't host the MCP listener.

The server itself holds **no state** and touches **no database**. It is a thin
tool layer that calls `@atlas/api` over HTTP â€” at `http://127.0.0.1:4001`
(dev) or `http://127.0.0.1:4001` (prod), driven by whichever API process is
hosting it.

---

## Why this package exists

When the Owner or an agent runs a task, the AI client needs both **context**
(parent epic, sibling stories, related comments) and **write access** (file
a sub-bug, transition a story, reply with context). The MCP server gives the
model a tool surface to pull exactly the slice of context it needs and apply
mutations through the same audited API path the UI uses.

Guardrails and auto-fetch schedules are deliberately **not** on the MCP
surface â€” both are one-time Owner setup (the workspace constitution and
project cron cadence), and exposing them to agents risks self-modification
of the very rules that bind them. Guardrails are still applied to every
agent run via the constitution baked into the system prompt by
`buildConstitutionMarkdown()` in `packages/api/src/services/prompt-builder.ts`.

---

## Live tool catalogue

The authoritative tool list â€” name, route, group, sort_order â€” lives in
`.agents/api-surface.md` under the **MCP tool catalogue** section. The MCP
server registers tools from `packages/mcp/src/registrations.ts`
(`ALL_TOOL_REGISTRATIONS`); the API's `services/tool-catalog-sync.ts` projects
the same list into the Allowed Tools picker (A06 â€” one source, no drift).

Current surface (consolidation 2026-07-01): **13 tools registered**, all in
the picker. The previous 35-tool surface was collapsed into enum-parameterized
tools so low-context CLIs (Copilot CLI, Gemini, anything without semantic tool
search) pay a much smaller schema-load tax per prompt.

| Group | Count | File | Tools |
|---|---|---|---|
| AGENTS | 3 | `tools/agents.ts` | `crud_agent` (op: search\|get\|create\|update\|delete) + `agent_memory` (op: get\|update) + `marketplace_agent` (op: search\|get) |
| ITEMS | 5 | `tools/items.ts` | `search_item` + `create_item` (issue_type: epic\|story\|sub_task\|sub_bug\|bug) + `get_item` (always full envelope: item + parent + project + children + comments + item_links + external_links + activity) + `update_item` (action: patch_fields\|change_status\|assign\|add_comment\|add_link\|remove_link\|add_external_link\|remove_external_link) + `delete_item` |
| PROJECTS | 2 | `tools/projects.ts` | `listProjects`, `getProject` |
| REMINDERS | 2 | `tools/reminders.ts` | `crud_reminder` (op: create\|update\|cancel) + `search_reminder` (optional filters: status\|channel\|since) |
| NOTIFICATIONS | 1 | `tools/notifications.ts` | `sendExternalNotification` (A09) |

Deleted outright in the consolidation: `listAgentRuns` (zero agent-prompt
refs; the REST route `GET /api/agents/:id/runs` stays for the Activity tab).
The legacy per-action tool names (`listAgents`, `addCommentToItem`,
`transitionItemStatus`, `assignItem`, `updateItem`, etc.) are all replaced
by the consolidated tools above.

Adding a new tool = one entry in the relevant `<GROUP>_TOOLS` array; the
picker + MCP server both pick it up on the next boot.

---

## Transport

Two transports, share the same tool registrations (`registerAllTools()`):

### HTTP (recommended)

- Listener: `127.0.0.1:4500/mcp`, bound by the API process via
  `startMcpHost()` (`packages/api/src/plugins/mcp-host.ts`).
- Uses `StreamableHTTPServerTransport` from
  `@modelcontextprotocol/sdk/server/streamableHttp.js` in stateless mode
  (`sessionIdGenerator: undefined`) â€” each request is independent, no
  in-memory session table to leak across API restarts.
- **First-boot-wins.** Whichever API instance (dev or prod) calls
  `listen(4500)` first owns the port. The second instance catches
  `EADDRINUSE`, logs `[mcp] port 4500 in use â€” running API-only`, and
  serves its own `/api/*` traffic without MCP. To hand MCP over, stop the
  owning instance and start the other.
- Opt-out via `ATLAS_HOST_MCP=false` on a given instance â€” useful when
  running a second stack headless or in CI.
- Loopback only. No LAN exposure regardless of `ATLAS_LAN_ACCESS`.
- MCP â†’ API loopback HTTP still carries `X-Atlas-Token` per the existing
  `api-client.ts`; the token is the `ATLAS_MCP_TOKEN` from `.env` /
  `.env.prod` of the owning stack.

### stdio (legacy)

- `packages/mcp/src/index.ts` + `StdioServerTransport`. AI client spawns it
  as a child process.
- Diagnostic logs go to `stderr` (the stdio transport owns `stdout`).
  `console.log` inside the server would corrupt the JSON-RPC stream â€” code
  uses `console.error` instead.
- The `ATLAS_API_BASE` env var pins the API it talks to. Without the
  HTTP transport's "follow whichever stack is up" behaviour, switching
  between dev and prod under stdio requires a config edit.

---

## Workflows the tool surface supports

The MCP layer now spans read + write, so workflows are no longer
"discover â†’ pull â†’ draft". Patterns external AI clients run against Atlas:

### PO Writer expanding an epic
`get_item { issue_type: 'epic', id }` â€” returns the epic + project + every
child story / bug + comments + item_links + external_links + activity in one
round trip. The envelope is *always* the full payload â€” there is no partial
get.

### Coder picking up a sub-task
`get_item { issue_type: 'sub_task', id }` for the full context â†’
`search_item { query }` (substring on title / description) to spot prior
duplicates â†’ after work, `update_item { action: 'add_comment', ... }` to
comment, `update_item { action: 'change_status', ... }` to move state,
`update_item { action: 'patch_fields', patch: { pr_url } }` to record the PR.

### Owner-led item maintenance via Claude
Every mutation is one `update_item` call with an `action` discriminator:
- `action: 'patch_fields'` for description / priority / spec edits (per-type
  Zod validation on the API route).
- `action: 'change_status'` for status transitions (with optional `override`
  for Owner corrections).
- `action: 'assign'` to reassign (active-agent guard on the API).
- `action: 'add_link' / 'remove_link'` for `depends_on` / `relates_to` /
  `tested_by` graph edits.
- `action: 'add_external_link' / 'remove_external_link'` for off-platform
  refs (GitHub PR URLs today).
- `delete_item` for outright removal (cascades per type).

### Search-driven traversal
`search_item { query }` â†’ `get_item` on the top hit. The envelope's
`description` field on each search result is populated, so callers can do
follow-up substring checks for dedup without a second tool call.

### Replying with context
`get_item { issue_type, id }` returns the full envelope (comments thread,
linked items, recent activity). Compose your reply with that context, then
`update_item { action: 'add_comment', body, ... }` to post.

### Agent maintenance
`crud_agent { op: 'search' }` / `{ op: 'get', id }` for read paths;
`{ op: 'create' / 'update' / 'delete' }` are reserved for Owner via the UI
and forbidden in agent prompts (constitution `FORBIDDEN_TOOLS_SECTION`).
`agent_memory { op: 'get' / 'update' }` is the procedural memory channel.
`marketplace_agent { op: 'search' / 'get' }` for catalog discovery + install
chains.

---

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ATLAS_API_BASE` | `http://127.0.0.1:4001` | Base URL of the `@atlas/api` server |
| `ATLAS_MCP_TIMEOUT_MS` | `15000` | Per-request HTTP timeout |
| `ATLAS_MCP_TOKEN` | _(unset)_ | When set, sent as `X-Atlas-Token` on every non-GET request. The API's `requireMcpToken` preHandler rejects mutating calls when this header is missing on protected routes. |

The MCP server expects the API server to already be running. If the API is
down, individual tool calls return an error carrying the HTTP status and a
response snippet.

---

## Registering with an AI client

### HTTP (recommended)

Start the API at least once (`pnpm dev` or `pnpm prod`) so port 4500 is live.
Then add ONE entry to `~/.claude.json` â€” never edit it again:

```json
{
  "mcpServers": {
    "atlas": {
      "url": "http://127.0.0.1:4500/mcp"
    }
  }
}
```

Restart Claude Code. All 31 picker tools appear in the tool list. The same
config follows whichever stack you have running: stop dev, start prod, and
the next MCP call lands on prod without touching `~/.claude.json`.

### stdio (legacy)

Build the package: `pnpm --filter @atlas/mcp build`. Entry point is
`packages/mcp/dist/index.js`. Example config:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/packages/mcp/dist/index.js"],
      "env": { "ATLAS_API_BASE": "http://127.0.0.1:4001" }
    }
  }
}
```

Switch the env var to `http://127.0.0.1:5001` (prod) by editing this file
and restarting the client â€” stdio doesn't auto-follow the running stack.

---

## How agent runs see this server

The `@atlas/api` server **does not** pass `--mcp-config` or `--tools` when it
spawns Claude / Copilot CLI for an agent run. The spawned process inherits
Owner's user-level MCP config â€” whatever Owner has connected via
`claude mcp add` (Atlas + Atlassian + Playwright + anything else).

To connect Atlas at the user level:

```bash
claude mcp add atlas node <repo>/packages/mcp/dist/index.js
```

After that, every spawned agent run can call Atlas MCP tools alongside any
other MCP server Owner has connected. There is no per-agent allowlist â€” the
prompt is the safety boundary, and the system constitution
(`buildConstitutionMarkdown` in `packages/api/src/services/prompt-builder.ts`)
carries an explicit "Forbidden Atlas MCP tool calls" clause that forbids
`crud_agent` with `op` in `{create, update, delete}` and any project /
guardrail / global-settings mutation.

The `tool_catalog` table (read-only directory at `GET /api/tool-catalog`)
still lists every Atlas MCP tool the server exposes. It's informational â€”
useful for discoverability â€” but no longer drives enforcement.

---

## Hard rules (from `packages/mcp/AGENTS.md`)

- No direct DB access. The package never imports `better-sqlite3` or `pg`. All data flows through `@atlas/api`.
- No imports from `@atlas/api` or `@atlas/web`. The only workspace dep is `@atlas/shared`.
- No `console.log` â€” corrupts JSON-RPC. Use `console.error` for diagnostics.
- No HTTP server, no port binding. Transport is stdio only.
- Writes go through API routes that already validate via the shared Zod schemas; the MCP layer does not duplicate validation logic, only documents the writable fields per tool.

---

## Tool consolidation (2026-07-01)

The 35-tool surface (audited 2026-05-28) was collapsed to **13 tools** to cut
the upfront schema-load cost in low-context CLIs (Copilot CLI, Gemini, etc.)
by ~63%. Mapping:

- `listAgents` / `getAgent` / `createAgent` / `updateAgent` / `deleteAgent` â†’ `crud_agent { op }`
- `getAgentMemory` / `updateAgentMemory` â†’ `agent_memory { op }`
- `search_marketplace_agents` / `get_full_marketplace_agent` â†’ `marketplace_agent { op }`
- `listAgentRuns` â†’ **deleted** (REST route `GET /api/agents/:id/runs` stays for the Activity tab)
- `searchItems` â†’ `search_item`
- `createEpic` / `createStory` / `createSubTask` / `createSubBug` / `createBug` â†’ `create_item { issue_type, payload }`
- `getEpic` / `getItemFull` / `listComments` / `listItemLinks` / `listItemExternalLinks` / `replyToItem` (read-context mode) â†’ `get_item` (always full envelope)
- `updateItem` / `transitionItemStatus` / `assignItem` / `addCommentToItem` / `replyToItem` (write mode) / `createItemLink` / `deleteItemLink` / `createItemExternalLink` / `deleteItemExternalLink` â†’ `update_item { action }`
- `deleteItem` â†’ `delete_item`
- `setReminder` / `updateReminder` / `cancelReminder` â†’ `crud_reminder { op }`
- `listReminders` â†’ `search_reminder { status?, channel?, since? }`

Unchanged: `listProjects`, `getProject`, `sendExternalNotification`.

Marketplace catalog prompts were rewritten to use the new surface; each
agent's `manifest.json` version was bumped so installed Owners see one
Accept-Upgrade banner per agent. The constitution's `FORBIDDEN_TOOLS_SECTION`
was updated to forbid `crud_agent` actions instead of the now-deleted
per-action tool names.

## Removed from MCP surface (2026-05-28)

- **Workspace guardrails** (`listGuardrails`, `createGuardrail`, `updateGuardrail`, `deleteGuardrail`) â€” removed. Guardrails are the constitution that binds every agent; exposing CRUD to the same agents lets a hallucination or prompt injection erase the safety rules. Guardrails continue to flow into every agent prompt via `buildConstitutionMarkdown()`; REST routes (`/api/guardrails*`) stay for the web UI.
- **Project guardrails** (`listProjectGuardrails`, `createProjectGuardrail`, `updateProjectGuardrail`, `toggleProjectGuardrail`, `deleteProjectGuardrail`) â€” removed for the same reason; per-project rules are Owner-curated in the UI.
- **Auto-fetch schedules** (`listSchedules`, `upsertProjectSchedule`, `deleteProjectSchedule`, `triggerProjectAutoFetch`) â€” removed. Schedules are one-time project setup; agents have no business reshaping their own cron or firing manual auto-fetches. REST routes (`/api/schedules*`, `/api/projects/:id/schedule*`) stay for the web UI.

## What's deferred (C03 scope boundary, 2026-05-27)

- **Reset-rounds via MCP** â€” Owner-only escape hatch (per A04). Stays UI-only.
- **Comment edit** â€” `PATCH /api/comments/:id` exists but no MCP tool; audit-trail concern. Revisit if Owner asks.
- **Run spawning** â€” `POST /api/run` exists but no MCP tool; cross-agent handoffs go through `handoff_rules`, not ad-hoc MCP spawns.
- **Project lifecycle** â€” clone / connect / reclone / delete project are onboarding flows; stay Owner-only.
- **Workspace settings**, **model registry**, **notification settings** â€” explicitly excluded by `requirments_new.md` L19.

MCP `resources/*` (subscribable feeds) and HTTP transport remain deferred â€”
the stdio child-process model serves every current consumer.
