import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IApiClient } from '../api-client.js';
import { registerAgentTools } from './agents.js';
import { registerItemTools } from './items.js';
import { registerProjectTools } from './projects.js';
import { registerReminderTools } from './reminders.js';
import { registerNotificationTools } from './notifications.js';

export function registerAllTools(server: McpServer, client: IApiClient): void {
    registerAgentTools(server, client);
    registerItemTools(server, client);
    registerProjectTools(server, client);
    registerReminderTools(server, client);
    registerNotificationTools(server, client);
}
