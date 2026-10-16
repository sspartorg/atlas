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

// A09 — one-shot external notification. The daily AI-news scout calls this
// to deliver its digest. The API logs it as a notification row that stays out
// of the in-app feed but shows in the Notification Log, so quiet hours HOLD it
// (sent when the window ends) and the event-key toggle applies when event_key
// is set — `services/external-notifications.ts:sendOwnerExternalMessage`
// (Telegram or Teams, by the Owner's selection).
export const NOTIFICATION_TOOLS: ToolRegistration[] = [
    {
        name: 'sendExternalNotification',
        title: 'Send an external notification',
        description:
            'Send a single external notification to the Owner. Markdown allowed. ' +
            'During quiet hours it is held and sent when the window ends ' +
            '(`held: true`); it is listed in the Notification Log, not the in-app feed. ' +
            "When `event_key` is set (e.g. 'agent.daily-digest'), the per-event " +
            'toggle in Settings → Notifications applies, also to a held message. ' +
            'Returns `sent`, `held`, `external_status` and `notification_id`.',
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
