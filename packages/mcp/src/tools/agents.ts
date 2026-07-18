import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IApiClient, IAgentWritePayload } from '../api-client.js';
import {
    AgentCategorySchema,
    AgentChecklistItemInputSchema,
    AgentCliSchema,
    AgentHandoffRuleInputSchema,
    AgentSchedulePresetSchema,
    AgentStatusSchema,
    SdlcRoleSchema,
} from '@atlas/shared';
import type { ToolRegistration } from '../registrations.js';

function toToolResult(payload: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
}

// Tool consolidation 2026-07: the 8-tool agent surface (listAgents,
// getAgent, createAgent, updateAgent, deleteAgent, getAgentMemory,
// updateAgentMemory, listAgentRuns) plus the 2-tool marketplace surface
// (search_marketplace_agents, get_full_marketplace_agent) collapsed into
// THREE tools:
//   * crud_agent      — op: search | get | create | update | delete
//   * agent_memory    — op: get | update
//   * marketplace_agent — op: search | get
// `listAgentRuns` was deleted outright (no agent prompt referenced it; the
// Activity tab in the UI continues to use `GET /api/agents/:id/runs`
// directly — only the MCP wrapper is gone).

const AGENT_WRITABLE_FIELDS_SHAPE = {
    name: z.string().min(1).max(100).optional(),
    category: AgentCategorySchema.optional(),
    cli: AgentCliSchema.optional(),
    model: z.string().min(1).optional(),
    framework: z.string().optional(),
    prompt_md: z.string().optional(),
    handoff_prompt_md: z.string().optional(),
    status: AgentStatusSchema.optional(),
    accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    sort_order: z.number().int().optional(),
    description: z.string().optional(),
    designation: z.string().max(100).optional(),
    role_id: SdlcRoleSchema.nullable().optional(),
    schedule_hours: z.number().nonnegative().optional(),
    schedule_preset: AgentSchedulePresetSchema.optional(),
    schedule_time_of_day: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .nullable()
        .optional(),
    schedule_weekdays: z
        .array(z.number().int().min(1).max(7))
        .min(1)
        .max(7)
        .nullable()
        .optional(),
    schedule_day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    concurrent_runs: z.number().int().nonnegative().optional(),
    glyph: z.string().optional(),
    handoff_rules: z.array(AgentHandoffRuleInputSchema).optional(),
    checklists: z.array(AgentChecklistItemInputSchema).optional(),
} as const;

const AgentWritablePayloadSchema = z
    .object({
        // Same fields as above but as a Zod object so it can live inside a
        // top-level `payload` slot. Only `id` and `name` are required at
        // create-time; everything else is optional.
        id: z.string().min(1).optional(),
        ...AGENT_WRITABLE_FIELDS_SHAPE,
    })
    .passthrough();

const KindSlugSchema = z.enum([
    'ai-news',
    'market-research',
    'regulations',
    'jira-to-epic',
    'ai-readiness',
    'knowledge-base',
    'custom',
]);

export const AGENT_TOOLS: ToolRegistration[] = [
    {
        name: 'crud_agent',
        title: 'Search, fetch, create, update, or delete an agent',
        description: [
            'Single entry point for all five basic operations against the `agents` table.',
            '',
            'Branches on `op`:',
            "- `op: 'search'` → returns the full agent list (compact projection per row: id, name, category, cli, status, sort_order, prompt_version). Use this when you need to find an agent id or audit the roster.",
            "- `op: 'get'` → fetch one agent by `id` along with its handoff rules and checklists. Required: `id`.",
            "- `op: 'create'` → install a new agent. Required: `payload` with at minimum `name`, `category`, `cli`, `model`, `accent_color`. A stable kebab-case `id` is strongly recommended so handoff targets and update calls can reference it.",
            "- `op: 'update'` → patch an existing agent. Required: `id` + `payload` (subset of writable fields). Editing `prompt_md` automatically bumps `prompt_version` and snapshots into `agent_prompt_versions`. Passing `handoff_rules` / `checklists` replaces those collections transactionally.",
            "- `op: 'delete'` → permanently remove an agent. Required: `id`. Cascade deletes prompt_versions, checklists, handoff_rules, memory. agent_runs survive (preserve history).",
            '',
            "**Forbidden for agents.** Per constitution, agents must not call `crud_agent` with `op` in {create, update, delete} — those are reserved for the Owner via the UI. Reading (`search`, `get`) is permitted.",
        ].join('\n'),
        group_name: 'AGENTS',
        sort_order: 10,
        inputSchema: {
            op: z.enum(['search', 'get', 'create', 'update', 'delete']),
            id: z.string().min(1).optional(),
            payload: AgentWritablePayloadSchema.optional(),
        },
        handler: async (args, { client }) => {
            const { op, id, payload } = args as {
                op: 'search' | 'get' | 'create' | 'update' | 'delete';
                id?: string;
                payload?: Record<string, unknown>;
            };
            switch (op) {
                case 'search': {
                    const agents = await client.listAgents();
                    return toToolResult(
                        agents.map((a) => ({
                            id: a.id,
                            name: a.name,
                            category: a.category,
                            cli: a.cli,
                            status: a.status,
                            sort_order: a.sort_order,
                            prompt_version: a.prompt_version,
                        })),
                    );
                }
                case 'get':
                    if (!id) throw new Error("crud_agent: `id` is required for op='get'");
                    return toToolResult(await client.getAgent(id));
                case 'create': {
                    if (!payload)
                        throw new Error("crud_agent: `payload` is required for op='create'");
                    const created = await client.createAgent(
                        payload as unknown as IAgentWritePayload & { id: string; name: string },
                    );
                    return toToolResult(created);
                }
                case 'update': {
                    if (!id || !payload)
                        throw new Error(
                            "crud_agent: `id` and `payload` are required for op='update'",
                        );
                    return toToolResult(
                        await client.updateAgent(id, payload as unknown as IAgentWritePayload),
                    );
                }
                case 'delete':
                    if (!id) throw new Error("crud_agent: `id` is required for op='delete'");
                    await client.deleteAgent(id);
                    return toToolResult({ deleted: true, id });
            }
        },
    },
    {
        name: 'agent_memory',
        title: "Read or write an agent's persistent memory",
        description: [
            "Single entry point for agent-memory CRUD. Memory is the agent's procedural notes — what it learned in prior runs that should persist across sessions.",
            '',
            'Branches on `op`:',
            "- `op: 'get'` → return the agent's memory markdown. Required: `id`. Use before authoring an edit so you don't clobber.",
            "- `op: 'update'` → write to memory. Required: `id`, `body_md`. Optional: `mode` (`'replace'` default vs `'append'`), `source` (`'ai-generated'` default vs `'manual-edit'`).",
            '',
            '**Memory boundary — what belongs here, what does not.** Memory is for *behavioral generalizations* of how YOU should approach future similar work — process, style, anti-patterns, escalation triggers. Memory is NOT for product or project facts. Test: "would this fact be just as true if a different item or different project hit this code path?" If yes → save. If it\'s tied to project X / item Y / a specific user → does NOT belong; put it in item comments or spec_md instead.',
            '',
            '**`mode`**:',
            "- `'replace'` (default) overwrites the whole body; the API bumps `version`.",
            "- `'append'` surgically appends a bullet under `## Course corrections`. Use this for one-off lessons captured mid-run. Append audits as `trigger='mcp_update'` and does NOT reset the cadence regenerator.",
        ].join('\n'),
        group_name: 'AGENTS',
        sort_order: 11,
        inputSchema: {
            op: z.enum(['get', 'update']),
            id: z.string().min(1),
            body_md: z.string().optional(),
            mode: z.enum(['replace', 'append']).optional(),
            source: z.enum(['ai-generated', 'manual-edit']).optional(),
        },
        handler: async (args, { client }) => {
            const { op, id, body_md, mode, source } = args as {
                op: 'get' | 'update';
                id: string;
                body_md?: string;
                mode?: 'replace' | 'append';
                source?: 'ai-generated' | 'manual-edit';
            };
            if (op === 'get') {
                return toToolResult(await client.getAgentMemory(id));
            }
            if (body_md === undefined)
                throw new Error("agent_memory: `body_md` is required for op='update'");
            return toToolResult(
                await client.updateAgentMemory(id, {
                    body_md,
                    mode: mode ?? 'replace',
                    source: source ?? 'ai-generated',
                }),
            );
        },
    },
    {
        name: 'marketplace_agent',
        title: 'Search or fetch from the org-shared agent marketplace',
        description: [
            'Single entry point for browsing the marketplace catalog (org-shared installable / upgradable agents).',
            '',
            'Branches on `op`:',
            "- `op: 'search'` → returns a lightweight projection of catalog rows (id, name, category, kind_slug, summary, accent_color, glyph, version, installed/linked/upgrade-available flags). Optional filters: `query`, `category`, `kind_slug`, `limit`. Use this first to find a candidate id.",
            "- `op: 'get'` → fetch the full catalog entry for one marketplace agent: manifest + prompt_md + memory_template_md + handoff_rules + checklists + version + published_at. Required: `id`. Cheaper than three separate calls. Chain after `op='search'`, before installing or applying its prompt to an existing agent via `crud_agent op='update'`.",
            '',
            "The `upgrade_available` flag on a search result is true when the local agent's `marketplace_pulled_version` is strictly less than the catalog version.",
        ].join('\n'),
        group_name: 'AGENTS',
        sort_order: 12,
        inputSchema: {
            op: z.enum(['search', 'get']),
            id: z.string().min(1).optional(),
            query: z.string().optional(),
            category: AgentCategorySchema.optional(),
            kind_slug: KindSlugSchema.optional(),
            limit: z.number().int().min(1).max(100).optional(),
        },
        handler: async (args, { client }) => {
            const { op, id, query, category, kind_slug, limit } = args as {
                op: 'search' | 'get';
                id?: string;
                query?: string;
                category?: z.infer<typeof AgentCategorySchema>;
                kind_slug?: z.infer<typeof KindSlugSchema>;
                limit?: number;
            };
            if (op === 'search') {
                // Strip undefined entries so exactOptionalPropertyTypes is happy
                // when the args land on `searchMarketplaceAgents`.
                const params: {
                    query?: string;
                    category?: z.infer<typeof AgentCategorySchema>;
                    kind_slug?: z.infer<typeof KindSlugSchema>;
                    limit?: number;
                } = {};
                if (query !== undefined) params.query = query;
                if (category !== undefined) params.category = category;
                if (kind_slug !== undefined) params.kind_slug = kind_slug;
                if (limit !== undefined) params.limit = limit;
                return toToolResult(await client.searchMarketplaceAgents(params));
            }
            if (!id) throw new Error("marketplace_agent: `id` is required for op='get'");
            return toToolResult(await client.getMarketplaceAgent(id));
        },
    },
];

export function registerAgentTools(server: McpServer, client: IApiClient): void {
    for (const t of AGENT_TOOLS) {
        server.registerTool(
            t.name,
            { title: t.title, description: t.description, inputSchema: t.inputSchema },
            (args) => t.handler(args, { client }),
        );
    }
}
