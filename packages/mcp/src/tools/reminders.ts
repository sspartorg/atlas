import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IApiClient } from '../api-client.js';
import { ReminderScheduleSchema, ReminderChannelSchema } from '@atlas/shared';
import type { ToolRegistration } from '../registrations.js';

function toToolResult(payload: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
}

// Tool consolidation 2026-07: the 4-tool reminders surface (setReminder /
// updateReminder / cancelReminder / listReminders) collapsed into TWO:
//   * crud_reminder  — op: create | update | cancel
//   * search_reminder — list with optional filter args (status, channel, since)

export const REMINDER_TOOLS: ToolRegistration[] = [
    {
        name: 'crud_reminder',
        title: 'Create, update, or cancel a reminder',
        description: [
            'Single entry point for reminder mutations. The `agent-schedule-registry` tick fires due rows as external notifications + in-app + SSE.',
            '',
            'Branches on `op`:',
            "- `op: 'create'` → insert a new reminder. Required: `label`, `schedule`. Optional: `body`, `channel` (default `'notification'`), `created_by_agent_id`. Schedule shapes: { kind:'once', at:<ISO datetime> } | { kind:'daily', time_of_day:'HH:MM' } | { kind:'weekly', weekdays:[1..7], time_of_day:'HH:MM' } | { kind:'cron', expr:'<cron expr>' }. Channel: 'notification' (in-app + SSE), 'external' (delivered via the configured external-notification provider), or 'both'. Returns the reminder row including `id` and `next_fire_at`.",
            "- `op: 'update'` → patch an existing reminder's label / body / schedule / channel. Required: `id`. At least one of `label` / `body` / `schedule` / `channel` must be supplied. Only active or paused reminders are editable; cancelled / completed rows are frozen. Schedule changes recompute `next_fire_at`.",
            "- `op: 'cancel'` → flip status to 'cancelled' so the scheduler stops firing. Required: `id`. The row stays in the table for audit.",
        ].join('\n'),
        group_name: 'REMINDERS',
        sort_order: 60,
        inputSchema: {
            op: z.enum(['create', 'update', 'cancel']),
            id: z.number().int().positive().optional(),
            label: z.string().min(1).max(200).optional(),
            body: z.string().optional(),
            schedule: ReminderScheduleSchema.optional(),
            channel: ReminderChannelSchema.optional(),
            created_by_agent_id: z.string().nullable().optional(),
        },
        handler: async (args, { client }) => {
            const a = args as {
                op: 'create' | 'update' | 'cancel';
                id?: number;
                label?: string;
                body?: string;
                schedule?: Parameters<IApiClient['setReminder']>[0]['schedule'];
                channel?: Parameters<IApiClient['setReminder']>[0]['channel'];
                created_by_agent_id?: string | null;
            };
            switch (a.op) {
                case 'create': {
                    if (!a.label || !a.schedule)
                        throw new Error(
                            "crud_reminder: `label` + `schedule` are required for op='create'",
                        );
                    return toToolResult(
                        await client.setReminder({
                            label: a.label,
                            body: a.body ?? '',
                            schedule: a.schedule,
                            channel: a.channel ?? 'notification',
                            created_by_agent_id: a.created_by_agent_id ?? null,
                        }),
                    );
                }
                case 'update': {
                    if (a.id === undefined)
                        throw new Error("crud_reminder: `id` is required for op='update'");
                    const patch: Parameters<IApiClient['updateReminder']>[1] = {};
                    if (a.label !== undefined) patch.label = a.label;
                    if (a.body !== undefined) patch.body = a.body;
                    if (a.schedule !== undefined) patch.schedule = a.schedule;
                    if (a.channel !== undefined) patch.channel = a.channel;
                    return toToolResult(await client.updateReminder(a.id, patch));
                }
                case 'cancel': {
                    if (a.id === undefined)
                        throw new Error("crud_reminder: `id` is required for op='cancel'");
                    return toToolResult(await client.cancelReminder(a.id));
                }
            }
        },
    },
    {
        name: 'search_reminder',
        title: 'List reminders (with optional filters)',
        description: [
            'Return reminder rows sorted by `next_fire_at`. Includes active, paused, cancelled, and completed (one-shot done) reminders so the agent can audit history.',
            '',
            'Optional filters (omit any to return all):',
            "- `status` — one of `'active'`, `'paused'`, `'cancelled'`, `'completed'`.",
            "- `channel` — one of `'notification'`, `'external'`, `'both'`.",
            "- `since` — ISO datetime; return only reminders whose `next_fire_at` is on or after this instant.",
        ].join('\n'),
        group_name: 'REMINDERS',
        sort_order: 61,
        inputSchema: {
            status: z.enum(['active', 'paused', 'cancelled', 'completed']).optional(),
            channel: ReminderChannelSchema.optional(),
            since: z.string().datetime().optional(),
        },
        handler: async (args, { client }) => {
            const { status, channel, since } = args as {
                status?: 'active' | 'paused' | 'cancelled' | 'completed';
                channel?: z.infer<typeof ReminderChannelSchema>;
                since?: string;
            };
            const filter: Parameters<IApiClient['listReminders']>[0] = {};
            if (status !== undefined) filter.status = status;
            if (channel !== undefined) filter.channel = channel;
            if (since !== undefined) filter.since = since;
            return toToolResult(await client.listReminders(filter));
        },
    },
];

export function registerReminderTools(server: McpServer, client: IApiClient): void {
    for (const t of REMINDER_TOOLS) {
        server.registerTool(
            t.name,
            { title: t.title, description: t.description, inputSchema: t.inputSchema },
            (args) => t.handler(args, { client }),
        );
    }
}
