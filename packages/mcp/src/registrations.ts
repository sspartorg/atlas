import type { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IApiClient } from './api-client.js';

import { AGENT_TOOLS } from './tools/agents.js';
import { ITEM_TOOLS } from './tools/items.js';
import { PROJECT_TOOLS } from './tools/projects.js';
import { REMINDER_TOOLS } from './tools/reminders.js';
import { NOTIFICATION_TOOLS } from './tools/notifications.js';
// Plan E (Owner request, 2026-06-01) — the `execGitHub` tool from
// `./tools/github.ts` was removed. Agents no longer drive `git push` or
// `gh pr create`; the orchestrator owns those, gated by
// `agents.raises_pr`. Re-introducing a GitHub MCP surface here would
// take the audit trail and credential isolation back to the 2026-05
// state — don't.

// A06 — single source of truth for every MCP tool the Atlas server exposes.
//
// Each `tools/<group>.ts` exports a typed array of these registrations; this
// file concatenates them so downstream consumers (the MCP server's
// `registerAllTools()`, the API's `tool-catalog-sync`) iterate one list. Adding
// a new tool = appending one entry to the group array; the picker and the MCP
// server both pick it up on the next boot — no second list to maintain.
//
// `excludeFromCatalog: true` hides a tool from the Allowed Tools picker for
// tools the runner injects unconditionally (none today — Task 12 retired
// the `submit_review` / `performer_done` tools; outcome signalling now
// happens via the agent's fenced `atlas-outcome` output block).
export type ToolGroupName =
    | 'AGENTS'
    | 'ITEMS'
    | 'PROJECTS'
    | 'REMINDERS'
    | 'NOTIFICATIONS';

export interface ToolRegistration {
    name: string;
    title: string;
    description: string;
    group_name: ToolGroupName;
    sort_order: number;
    excludeFromCatalog?: boolean;
    inputSchema: z.ZodRawShape;
    // Args are validated at runtime via `inputSchema`; the handler receives
    // the parsed object. Typed as `any` so each per-tool handler can
    // destructure its own shape without fighting TS variance rules.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (args: any, ctx: { client: IApiClient }) => Promise<CallToolResult>;
}

export const ALL_TOOL_REGISTRATIONS: ToolRegistration[] = [
    ...AGENT_TOOLS,
    ...ITEM_TOOLS,
    ...PROJECT_TOOLS,
    ...REMINDER_TOOLS,
    ...NOTIFICATION_TOOLS,
];
