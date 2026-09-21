import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { QualityChecklistCard } from './QualityChecklistCard.js';

const BASE = 'http://localhost:3000/api';

function labelInputs(): HTMLInputElement[] {
    return screen.queryAllByRole('textbox') as HTMLInputElement[];
}

describe('QualityChecklistCard', () => {
    it('shows the empty state and explains the fail path', async () => {
        server.use(...defaultHandlers);
        renderWithProviders(<QualityChecklistCard agentId="agent-coder" />);
        expect(await screen.findByText(/No checks yet/i)).toBeInTheDocument();
        expect(screen.getByText(/workflow's fail path/i)).toBeInTheDocument();
    });

    it('hydrates persisted checks, adds, removes via confirm, and saves the result', async () => {
        let saved: unknown = null;
        server.use(
            http.get(`${BASE}/agents/agent-coder/checklists`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: 'agent-coder',
                        label: 'Tests pass',
                        sort_order: 0,
                        required: true,
                    },
                    {
                        id: 2,
                        agent_id: 'agent-coder',
                        label: 'Lint clean',
                        sort_order: 1,
                        required: false,
                    },
                ])
            ),
            http.put(`${BASE}/agents/agent-coder/checklists`, async ({ request }) => {
                saved = await request.json();
                return HttpResponse.json([]);
            }),
            ...defaultHandlers
        );
        renderWithProviders(<QualityChecklistCard agentId="agent-coder" />);
        await waitFor(() =>
            expect(labelInputs().map((i) => i.value)).toEqual(['Tests pass', 'Lint clean'])
        );

        await userEvent.click(screen.getByRole('button', { name: /Add check/i }));
        const added = labelInputs()[2];
        await userEvent.clear(added!);
        await userEvent.type(added!, 'Docs updated');

        await userEvent.click(
            screen.getByRole('button', { name: /Remove checklist item: Lint clean/i })
        );
        expect(await screen.findByText(/Delete this checklist item/i)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Delete item/i }));
        await waitFor(() =>
            expect(labelInputs().map((i) => i.value)).toEqual(['Tests pass', 'Docs updated'])
        );

        await userEvent.click(screen.getByRole('button', { name: /Save checklist/i }));
        await waitFor(() =>
            expect(saved).toEqual({
                items: [
                    { label: 'Tests pass', sort_order: 0, required: true },
                    { label: 'Docs updated', sort_order: 1, required: true },
                ],
            })
        );
    });

    it('Cancel in the confirm dialog keeps the check', async () => {
        server.use(
            http.get(`${BASE}/agents/agent-coder/checklists`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: 'agent-coder',
                        label: 'Tests pass',
                        sort_order: 0,
                        required: true,
                    },
                ])
            ),
            ...defaultHandlers
        );
        renderWithProviders(<QualityChecklistCard agentId="agent-coder" />);
        await userEvent.click(
            await screen.findByRole('button', { name: /Remove checklist item: Tests pass/i })
        );
        await userEvent.click(await screen.findByRole('button', { name: /Cancel/i }));
        await waitFor(() =>
            expect(screen.queryByText(/Delete this checklist item/i)).not.toBeInTheDocument()
        );
        expect(labelInputs().map((i) => i.value)).toEqual(['Tests pass']);
    });
});
