import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IApiClient } from '../api-client.js';
import {
    IssuePrioritySchema,
    IssueStatusSchema,
    IssueTypeSchema,
    ItemLabelsOptionalSchema,
    WORKTREE_BRANCH_RE_SOURCE,
} from '@atlas/shared';
import type { IssueType } from '@atlas/shared';
import type { ToolRegistration } from '../registrations.js';

function toToolResult(payload: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
}

// Bound agent identity (Batch-5 audit follow-up). When the agent-runner
// spawns a CLI + MCP subshell it MUST set `ATLAS_AGENT_ID=<slug>` in the
// child env. Every write-time audit-log attribution then uses this bound
// id, ignoring any caller-supplied `agent_id` in the tool args. This
// closes the impersonation gap where a malicious/buggy agent could stamp
// activity rows with another agent's chip. Read fresh on every call so
// tests can set/clear the env between cases; the cost is a property read.
function resolveAgentId(callerAgentId: string | undefined): string | null {
    const bound = (process.env['ATLAS_AGENT_ID'] ?? '').trim();
    if (bound) return bound;
    // Degraded / backward-compat: no env set → fall back to caller-supplied
    // value. The audit-runner rollout will set the env; this branch keeps
    // existing standalone-MCP invocations working until then.
    return callerAgentId ?? null;
}

// Tool consolidation 2026-07: the 17-tool items surface collapsed into FIVE:
//   * search_item  — full-text search
//   * create_item  — issue_type discriminator (task / sub_task)
//   * get_item     — always returns full envelope (item + parent + project + children + comments + related_links + external_links + activity); replaces getEpic / getItemFull / listComments / listItemLinks / listItemExternalLinks / replyToItem's read-context mode
//   * update_item  — `action` discriminator (replaces updateItem / transitionItemStatus / assignItem / addCommentToItem / replyToItem's write mode / createItemLink / deleteItemLink / createItemExternalLink / deleteItemExternalLink)
//   * delete_item  — issue_type + id

const CreateItemPayloadSchema = z
    .object({
        // Task-only
        project_id: z.string().min(1).optional(),
        // Sub-task-only (under its task)
        task_id: z.string().min(1).optional(),
        status: IssueStatusSchema.optional(),
        // Common
        title: z.string().min(1).max(500),
        description: z.string().optional(),
        priority: IssuePrioritySchema.optional(),
        acceptance_criteria: z.string().optional(),
        assignee_agent_id: z.string().nullable().optional(),
        reporter_agent_id: z.string().nullable().optional(),
        // Free-form labels — cap of 20 labels per item, 40 chars each.
        // The API accepts labels on every item type; exposing here so
        // the MCP surface can tag items at create time instead of
        // needing a follow-up update_item call.
        labels: ItemLabelsOptionalSchema,
    })
    // The MCP boundary is an untrusted-input surface (arbitrary caller
    // with the MCP token). `.passthrough()` silently forwarded unknown
    // keys to the API-side per-type schemas, some of which use `.strip()`
    // and would silently drop them. `.strict()` here surfaces typos and
    // future migration-added columns as 400s at the boundary — safer
    // default. Downstream API schemas remain the source of truth for
    // which fields ARE writable per issue type.
    .strict();

const UpdatePatchSchema = z
    .object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional(),
        priority: IssuePrioritySchema.optional(),
        acceptance_criteria: z.string().optional(),
        // Task-only (UpdateTaskSchema); the sub-task route rejects them.
        spec_md: z.string().nullable().optional(),
        pr_url: z.string().nullable().optional(),
        worktree_branch: z.string().regex(new RegExp(WORKTREE_BRANCH_RE_SOURCE)).nullable().optional(),
        reporter_agent_id: z.string().nullable().optional(),
        // Free-form labels — cap of 20 labels per item, 40 chars each.
        // Sending `labels` in a patch replaces the full array (matches
        // API semantics); to append, callers should read via get_item,
        // merge, and send the full set back.
        labels: ItemLabelsOptionalSchema,
    })
    // See CreateItemPayloadSchema above — `.strict()` at the MCP boundary
    // rejects unknown keys instead of silently forwarding them.
    .strict();

export const ITEM_TOOLS: ToolRegistration[] = [
    {
        name: 'search_item',
        title: 'Full-text search across items',
        description: [
            'Postgres tsvector FTS across item titles, descriptions, and spec_md (task / sub_task).',
            '',
            'Use this for dedup-by-source-tag (substring-check `description` for a tag string) or general keyword lookup. Returns up to 20 ranked items as `[{issue_type, issue_id, title, description, rank}]`.',
            '',
            'Parameters:',
            '- `query` (required): keyword(s) to search for.',
            '- `top_k` (optional, 1-20): cap on results returned (the endpoint already caps at 20).',
        ].join('\n'),
        group_name: 'ITEMS',
        sort_order: 20,
        inputSchema: {
            query: z.string().min(1),
            top_k: z.number().int().min(1).max(20).optional(),
        },
        handler: async (args, { client }) => {
            const { query, top_k } = args as { query: string; top_k?: number };
            return toToolResult(await client.searchItems(query, top_k));
        },
    },
    {
        name: 'create_item',
        title: 'Create an item (task / sub_task)',
        description: [
            'Create a new item under its proper parent. `issue_type` selects the kind:',
            '',
            "- `issue_type: 'task'` → requires `project_id` + `title` in `payload`. The top-level unit of work the Owner queues for a workflow.",
            "- `issue_type: 'sub_task'` → requires `task_id` + `title`. A piece of its Task's work. Optional: `status` (default `draft`).",
            '',
            'Common optional fields: `description`, `acceptance_criteria`, `priority` (default `normal`), `assignee_agent_id`, `reporter_agent_id`, `labels` (array of strings, up to 20 labels / 40 chars each — e.g. `["backend", "qa"]`).',
            '',
            'Optional top-level `agent_id` (string, your own agent id): credits the `created` activity event to you and defaults `reporter_agent_id` to you when the payload does not set it. Without it the create is recorded as the Owner.',
        ].join('\n'),
        group_name: 'ITEMS',
        sort_order: 21,
        inputSchema: {
            issue_type: IssueTypeSchema,
            payload: CreateItemPayloadSchema,
            agent_id: z.string().min(1).optional(),
        },
        handler: async (args, { client }) => {
            const { issue_type, payload, agent_id } = args as {
                issue_type: IssueType;
                payload: Record<string, unknown>;
                agent_id?: string;
            };
            const actor = resolveAgentId(agent_id);
            return toToolResult(
                issue_type === 'task'
                    ? await client.createTask(payload as unknown as Parameters<IApiClient['createTask']>[0], actor)
                    : await client.createSubTask(
                          payload as unknown as Parameters<IApiClient['createSubTask']>[0],
                          actor,
                      ),
            );
        },
    },
    {
        name: 'get_item',
        title: 'Read an item with its full context',
        description: [
            'Fetch the complete payload for an item — everything an agent needs to act in one round-trip:',
            '',
            '- the item itself under its kind key: `task` or `sub_task` (title, description, status, assignee, etc.)',
            '- on a sub-task, `task` is its parent Task; on a task, `sub_tasks` lists its children',
            '- `project` (id, name, default_branch, git_path…)',
            '- `comments` — full thread, oldest first',
            '- `related_links` — every depends_on / relates_to / tested_by link touching this item, both directions',
            '- `external_links` — off-platform refs (e.g. GitHub PR URLs)',
            '- `activity` — recent issue_events (status_changed, assigned, comment_added, etc.)',
            '- `agents` for UI / orchestrator',
            '',
            'There is **no partial-get tool**. Always call this when you need any of the above. Cheaper than the prior four+ tool calls.',
            '',
            'Required: `issue_type` (task / sub_task) + `id`.',
        ].join('\n'),
        group_name: 'ITEMS',
        sort_order: 22,
        inputSchema: {
            issue_type: IssueTypeSchema,
            id: z.string().min(1),
        },
        handler: async (args, { client }) => {
            const { issue_type, id } = args as { issue_type: IssueType; id: string };
            return toToolResult(await client.getItemFull(issue_type, id));
        },
    },
    {
        name: 'update_item',
        title: 'Update any aspect of an item (fields, status, assignee, comments, links)',
        description: [
            'Single entry point for every write-side operation on an existing item. The `action` enum selects what to do; required payload fields vary per action.',
            '',
            'Common required fields:',
            '- `issue_type` (task / sub_task)',
            '- `id` (the item id)',
            '- `action` (one of the values below)',
            '',
            'Actions and their payload fields:',
            '',
            "- `action: 'patch_fields'` → patch core fields. `payload` accepts: `title`, `description`, `priority`, `acceptance_criteria`, `labels` (full replacement — send the full array; to append, get_item → merge → send). Task extras: `spec_md`, `pr_url`, `reporter_agent_id`, `worktree_branch` (must match `atlas/<role>/<id>`, e.g. `atlas/wf/ATL-2`). Per-type Zod schema rejects fields that don't apply.",
            '',
            "- `action: 'change_status'` → move item to a new status. Required: `status` (string). Optional: `override` (boolean, Owner-only — bypasses status-machine guard), `agent_id` (string — credit the change to a specific agent). Status-machine guard rejects illegal transitions unless `override` is true. Owner-facing flow: an agent running inside a workflow must NOT use this to route work — the API returns 409 while a workflow run holds the item; report through the `atlas-outcome` block instead.",
            '',
            "- `action: 'assign'` → set/clear the assignee. Required: `assignee_agent_id` (string or null to unassign). Optional: `agent_id` (string — credit the reassignment to a specific agent). Server rejects assignment to inactive agents. Owner-facing flow: an agent running inside a workflow must NOT use this to route work — the API returns 409 while a workflow run holds the item; report through the `atlas-outcome` block instead.",
            '',
            "- `action: 'add_comment'` → post a comment. Required: `body` (string). Optional: `author` ('owner' | 'agent', default 'agent'), `agent_id` (string — the comment's avatar / chip).",
            '',
            "- `action: 'add_link'` → link two items. Required: `to_id` (string, the other item's id), `relation_type` ('depends_on' | 'relates_to' | 'tested_by'). The current item is the `from`. `depends_on` is directed (cycles rejected); `relates_to` is undirected; `tested_by` is directed QA→dev. Idempotent. Optional: `agent_id` (string — credit the link event to a specific agent; otherwise it is recorded as the Owner).",
            '',
            "- `action: 'remove_link'` → delete an item-link row by numeric id. Required: `link_id` (number). Get link ids from `get_item` → `related_links[].id`. Optional: `agent_id` (string — credit the unlink event).",
            '',
            "- `action: 'add_external_link'` → attach an off-platform URL. Required: `link_kind` ('pull_request'), `url` (must match https://github.com/<owner>/<repo>/pull/<number>). Optional: `title`, `agent_id` (string — forwarded as the acting agent). Idempotent on (item, url).",
            '',
            "- `action: 'remove_external_link'` → delete an external-link row. Required: `link_id` (number). Get from `get_item` → `external_links[].id`.",
            '',
            "- `action: 'remove_history'` → hard-delete every AGENT-authored comment plus every issue-events (activity) row on this item whose `created_at` is strictly before the supplied cutoff. Owner-authored comments are ALWAYS PRESERVED. Required: `before_time` (ISO 8601 datetime string, e.g. '2026-06-01T00:00:00Z'), must be at least 1 hour in the past. Returns `{ comments_deleted, events_deleted, owner_comments_preserved }`. Writes a `history_pruned` audit event attributed to the calling agent so the operation stays traceable. Use for pruning long-lived tracking items where an automation agent accumulates weekly noise. Rows exactly at the boundary are preserved. Destructive and non-recoverable for agent content — pick the cutoff carefully.",
        ].join('\n'),
        group_name: 'ITEMS',
        sort_order: 23,
        inputSchema: {
            issue_type: IssueTypeSchema,
            id: z.string().min(1),
            action: z.enum([
                'patch_fields',
                'change_status',
                'assign',
                'add_comment',
                'add_link',
                'remove_link',
                'add_external_link',
                'remove_external_link',
                'remove_history',
            ]),
            patch: UpdatePatchSchema.optional(),
            // change_status / assign / add_comment / add_link / remove_link /
            // add_external_link / remove_history credit field
            status: z.string().min(1).optional(),
            override: z.boolean().optional(),
            agent_id: z.string().min(1).optional(),
            // assign
            assignee_agent_id: z.string().nullable().optional(),
            // add_comment
            body: z.string().min(1).optional(),
            author: z.enum(['owner', 'agent']).optional(),
            // add_link
            to_id: z.string().min(1).optional(),
            relation_type: z.enum(['relates_to', 'depends_on', 'tested_by']).optional(),
            // remove_link / remove_external_link
            link_id: z.number().int().positive().optional(),
            // add_external_link
            link_kind: z.enum(['pull_request']).optional(),
            url: z.string().url().max(2_000).optional(),
            title: z.string().max(500).optional(),
            // remove_history
            before_time: z.string().datetime({ offset: true }).optional(),
        },
        handler: async (args, { client }) => {
            const a = args as {
                issue_type: IssueType;
                id: string;
                action:
                    | 'patch_fields'
                    | 'change_status'
                    | 'assign'
                    | 'add_comment'
                    | 'add_link'
                    | 'remove_link'
                    | 'add_external_link'
                    | 'remove_external_link'
                    | 'remove_history';
                patch?: Record<string, unknown>;
                status?: string;
                override?: boolean;
                agent_id?: string;
                assignee_agent_id?: string | null;
                body?: string;
                author?: 'owner' | 'agent';
                to_id?: string;
                relation_type?: 'relates_to' | 'depends_on' | 'tested_by';
                link_id?: number;
                link_kind?: 'pull_request';
                url?: string;
                title?: string;
                before_time?: string;
            };
            switch (a.action) {
                case 'patch_fields': {
                    if (!a.patch)
                        throw new Error("update_item: `patch` is required for action='patch_fields'");
                    return toToolResult(
                        await client.updateItem(a.issue_type, a.id, a.patch, resolveAgentId(a.agent_id)),
                    );
                }
                case 'change_status': {
                    if (!a.status)
                        throw new Error(
                            "update_item: `status` is required for action='change_status'",
                        );
                    // Security: `override` bypasses the status-machine
                    // guard AND the P16 `assertChildrenDone` invariant.
                    // The tool description already promises this is
                    // "Owner-only", but the MCP server has no way to
                    // authenticate as the Owner — any caller with the
                    // MCP token can currently set `override: true`. Until
                    // per-caller identity ships, reject it at the MCP
                    // boundary. Owner-driven overrides still work via
                    // the Web UI (which calls the API route directly).
                    if (a.override === true) {
                        throw new Error(
                            "update_item: `override` is Owner-only and not permitted via the MCP surface. Use the Web UI for status overrides.",
                        );
                    }
                    return toToolResult(
                        await client.transitionItemStatus(
                            a.issue_type,
                            a.id,
                            a.status,
                            false,
                            resolveAgentId(a.agent_id),
                        ),
                    );
                }
                case 'assign': {
                    if (a.assignee_agent_id === undefined)
                        throw new Error(
                            "update_item: `assignee_agent_id` is required for action='assign' (use null to unassign)",
                        );
                    return toToolResult(
                        await client.assignItem(
                            a.issue_type,
                            a.id,
                            a.assignee_agent_id,
                            resolveAgentId(a.agent_id),
                        ),
                    );
                }
                case 'add_comment': {
                    if (!a.body)
                        throw new Error(
                            "update_item: `body` is required for action='add_comment'",
                        );
                    // Security: force `author: 'agent'` at the MCP
                    // boundary. Previously any caller with the MCP token
                    // could post a comment claiming to be the Owner
                    // (`author: 'owner'`), which the UI renders with the
                    // Owner chip and any downstream automation keyed to
                    // owner sign-off treats as genuine. The MCP surface
                    // is called by CLI agents, not the Owner. If a real
                    // Owner comment is needed, it comes through the Web
                    // UI which calls the API route directly.
                    return toToolResult(
                        await client.addComment({
                            issue_type: a.issue_type,
                            issue_id: a.id,
                            body: a.body,
                            author: 'agent',
                            agent_id: resolveAgentId(a.agent_id),
                        }),
                    );
                }
                case 'add_link': {
                    if (!a.to_id || !a.relation_type)
                        throw new Error(
                            "update_item: `to_id` + `relation_type` are required for action='add_link'",
                        );
                    return toToolResult(
                        await client.createItemLink(
                            {
                                from_type: a.issue_type,
                                from_id: a.id,
                                to_id: a.to_id,
                                relation_type: a.relation_type,
                            },
                            resolveAgentId(a.agent_id),
                        ),
                    );
                }
                case 'remove_link': {
                    if (a.link_id === undefined)
                        throw new Error(
                            "update_item: `link_id` is required for action='remove_link'",
                        );
                    await client.deleteItemLink(a.link_id, resolveAgentId(a.agent_id));
                    return toToolResult({ deleted: true, link_id: a.link_id });
                }
                case 'add_external_link': {
                    if (!a.link_kind || !a.url)
                        throw new Error(
                            "update_item: `link_kind` + `url` are required for action='add_external_link'",
                        );
                    const ext: Parameters<IApiClient['createItemExternalLink']>[0] = {
                        issue_type: a.issue_type,
                        issue_id: a.id,
                        link_kind: a.link_kind,
                        url: a.url,
                    };
                    if (a.title !== undefined) ext.title = a.title;
                    return toToolResult(
                        await client.createItemExternalLink(ext, resolveAgentId(a.agent_id)),
                    );
                }
                case 'remove_external_link': {
                    if (a.link_id === undefined)
                        throw new Error(
                            "update_item: `link_id` is required for action='remove_external_link'",
                        );
                    await client.deleteItemExternalLink(a.link_id);
                    return toToolResult({ deleted: true, link_id: a.link_id });
                }
                case 'remove_history': {
                    if (!a.before_time)
                        throw new Error(
                            "update_item: `before_time` is required for action='remove_history'",
                        );
                    // Forward the bound agent identity for the audit event
                    // that historyPruneService writes inside its transaction.
                    // Without this, actor_agent_id on the `history_pruned`
                    // row is null and Owner can't tell who pruned what.
                    return toToolResult(
                        await client.pruneItemHistory(
                            a.issue_type,
                            a.id,
                            a.before_time,
                            resolveAgentId(a.agent_id),
                        ),
                    );
                }
            }
        },
    },
    {
        name: 'delete_item',
        title: 'Delete an item (cascade on children)',
        description: [
            'Permanently delete an item. Cascade semantics per the API:',
            '- Deleting a task drops its sub-tasks.',
            '- A sub-task has no children to cascade.',
            '',
            'Returns `{ deleted: true, issue_type, id }`.',
            '',
            "Use sparingly — the activity log loses the item context once it is gone. Required: `issue_type` + `id`.",
        ].join('\n'),
        group_name: 'ITEMS',
        sort_order: 24,
        inputSchema: {
            issue_type: IssueTypeSchema,
            id: z.string().min(1),
        },
        handler: async (args, { client }) => {
            const { issue_type, id } = args as { issue_type: IssueType; id: string };
            await client.deleteItem(issue_type, id);
            return toToolResult({ deleted: true, issue_type, id });
        },
    },
];

export function registerItemTools(server: McpServer, client: IApiClient): void {
    for (const t of ITEM_TOOLS) {
        server.registerTool(
            t.name,
            { title: t.title, description: t.description, inputSchema: t.inputSchema },
            (args) => t.handler(args, { client }),
        );
    }
}
