import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IApiClient } from '../api-client.js';
import type { ToolRegistration } from '../registrations.js';

function toToolResult(payload: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
}

// A09 — one-shot external-notification passthrough. The daily AI-news scout
// calls this to deliver its digest; future agents can use the same channel
// without having to plumb a notifications row through the items model. Quiet
// hours + event-key toggles are honored when event_key is provided —
// `services/external-notifications.ts:sendExternalNotification` does the
// gating + dispatch under the hood (Telegram or Teams, by Owner's selection).
export const NOTIFICATION_TOOLS: ToolRegistration[] = [
    {
        name: 'sendExternalNotification',
        title: 'Send an external notification',
        description:
            'Send a single external notification to the Owner. Markdown allowed. ' +
            "When `event_key` is set (e.g. 'agent.daily-digest'), quiet hours " +
            'and the per-event toggle in Settings → Notifications apply.',
        group_name: 'NOTIFICATIONS',
        sort_order: 70,
        inputSchema: {
            message: z.string().min(1).max(4000),
            event_key: z.string().max(64).optional(),
        },
        handler: async (args, { client }) => {
            const typed = args as { message: string; event_key?: string };
            const payload: { message: string; event_key?: string } = { message: typed.message };
            if (typed.event_key !== undefined) payload.event_key = typed.event_key;
            return toToolResult(await client.sendExternalNotification(payload));
        },
    },
];

export function registerNotificationTools(server: McpServer, client: IApiClient): void {
    for (const t of NOTIFICATION_TOOLS) {
        server.registerTool(
            t.name,
            { title: t.title, description: t.description, inputSchema: t.inputSchema },
            (args) => t.handler(args, { client }),
        );
    }
}
