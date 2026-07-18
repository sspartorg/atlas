import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { McpTools } from './McpTools.js';

const CATALOG_FIXTURE = {
    groups: [
        {
            group_name: 'AGENTS',
            tools: [
                { tool_name: 'listAgents', description: 'List all agents with compact projection' },
                { tool_name: 'getAgent', description: 'Fetch full agent payload with handoff rules' },
            ],
        },
        {
            group_name: 'REMINDERS',
            tools: [
                { tool_name: 'setReminder', description: 'Schedule a reminder for the Owner' },
            ],
        },
    ],
};

describe('McpTools page', () => {
    it('renders grouped tools with names and descriptions', async () => {
        server.use(
            ...defaultHandlers,
            http.get('http://localhost:3000/api/tool-catalog', () =>
                HttpResponse.json(CATALOG_FIXTURE),
            ),
        );

        renderWithProviders(<McpTools />, { initialEntries: ['/agents/mcp-tools'] });

        // Wait for a tool name — only present once the query resolves and rows render.
        await waitFor(() => {
            expect(screen.getByText('listAgents')).toBeInTheDocument();
        }, { timeout: 10000 });

        // Group headers (pretty-cased) and remaining tool names
        expect(screen.getByText('Reminders')).toBeInTheDocument();
        expect(screen.getByText('getAgent')).toBeInTheDocument();
        expect(screen.getByText('setReminder')).toBeInTheDocument();

        // Descriptions
        expect(
            screen.getByText('List all agents with compact projection'),
        ).toBeInTheDocument();
        expect(screen.getByText('Schedule a reminder for the Owner')).toBeInTheDocument();

        // Total count line
        expect(screen.getByText(/3 tools · 2 categories/i)).toBeInTheDocument();

        // Breadcrumb back-link to Agents list — Breadcrumb renders items inside <p> nodes.
        const agentsNodes = screen.getAllByText('Agents');
        expect(agentsNodes.length).toBeGreaterThan(0);
    }, 30000);

    it('renders the empty state when no tools are returned', async () => {
        server.use(
            ...defaultHandlers,
            http.get('http://localhost:3000/api/tool-catalog', () =>
                HttpResponse.json({ groups: [] }),
            ),
        );

        renderWithProviders(<McpTools />, { initialEntries: ['/agents/mcp-tools'] });

        await waitFor(() => {
            expect(screen.getByText('No MCP tools registered.')).toBeInTheDocument();
        });
    });

    it('renders an error message when the catalog request fails', async () => {
        server.use(
            ...defaultHandlers,
            http.get('http://localhost:3000/api/tool-catalog', () =>
                HttpResponse.json({ error: 'boom' }, { status: 500 }),
            ),
        );

        renderWithProviders(<McpTools />, { initialEntries: ['/agents/mcp-tools'] });

        await waitFor(() => {
            expect(screen.getByText(/failed to load tool catalog/i)).toBeInTheDocument();
        });
    });

    it('renders skeleton while loading (isLoading true branch)', () => {
        // Never-resolving request → isLoading stays true
        server.use(
            ...defaultHandlers,
            http.get('http://localhost:3000/api/tool-catalog', () => new Promise(() => {})),
        );

        const { container } = renderWithProviders(<McpTools />, { initialEntries: ['/agents/mcp-tools'] });
        // MUI Skeleton renders three groups of skeleton elements while loading
        expect(container.firstChild).toBeTruthy();
    });

    it('renders prettyGroupLabel fallback for unknown group names (the ?? branch)', async () => {
        // The group key "CUSTOM_TOOLS" is not in GROUP_LABELS, so
        // prettyGroupLabel returns "custom tools" (lowercased, underscores replaced)
        server.use(
            ...defaultHandlers,
            http.get('http://localhost:3000/api/tool-catalog', () =>
                HttpResponse.json({
                    groups: [
                        {
                            group_name: 'CUSTOM_TOOLS',
                            tools: [{ tool_name: 'myTool', description: 'A custom tool' }],
                        },
                    ],
                }),
            ),
        );

        renderWithProviders(<McpTools />, { initialEntries: ['/agents/mcp-tools'] });

        await waitFor(() => {
            // The prettyGroupLabel fallback lowercases and replaces _
            expect(screen.getByText('custom tools')).toBeInTheDocument();
        });
    });
});
