import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { RunNowDialog } from './RunNowDialog.js';

const BASE = 'http://localhost:3000/api';
const scout = makeAgent({ id: 'agent-scout', name: 'AI News Scout' });

describe('RunNowDialog', () => {
    it('renders a project-level run dialog with no item pickers', async () => {
        server.use(...defaultHandlers);
        renderWithProviders(<RunNowDialog agent={scout} open onClose={() => {}} />);
        expect(await screen.findByText(/^Run AI News Scout$/)).toBeInTheDocument();
        expect(screen.queryByLabelText(/Project/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/Issue type/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Run now/i })).not.toBeDisabled();
        expect(screen.getByRole('button', { name: /Preview prompt/i })).not.toBeDisabled();
    });

    it('does not render when closed', () => {
        server.use(...defaultHandlers);
        renderWithProviders(<RunNowDialog agent={scout} open={false} onClose={() => {}} />);
        expect(screen.queryByText(/Run AI News Scout/i)).not.toBeInTheDocument();
    });

    it('calls onClose when Cancel is clicked', async () => {
        server.use(...defaultHandlers);
        const onClose = vi.fn();
        renderWithProviders(<RunNowDialog agent={scout} open onClose={onClose} />);
        await userEvent.click(await screen.findByRole('button', { name: /Cancel/i }));
        expect(onClose).toHaveBeenCalled();
    });

    it('Run now posts a run with no item and closes', async () => {
        let body: unknown = null;
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/run`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ runId: 'run-abc123' });
            }),
        );
        const onClose = vi.fn();
        renderWithProviders(<RunNowDialog agent={scout} open onClose={onClose} />);
        await userEvent.click(await screen.findByRole('button', { name: /Run now/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(body).toMatchObject({ agent_id: 'agent-scout', issue_type: null, issue_id: null });
    });

    it('keeps the dialog open when the run fails', async () => {
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/run`, () =>
                HttpResponse.json({ error: 'Agent busy' }, { status: 500 }),
            ),
        );
        const onClose = vi.fn();
        renderWithProviders(<RunNowDialog agent={scout} open onClose={onClose} />);
        await userEvent.click(await screen.findByRole('button', { name: /Run now/i }));
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows "Starting…" while the trigger mutation is pending', async () => {
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/run`, async () => {
                await delay(50);
                return HttpResponse.json({ runId: 'run-pending' });
            }),
        );
        renderWithProviders(<RunNowDialog agent={scout} open onClose={() => {}} />);
        fireEvent.click(await screen.findByRole('button', { name: /Run now/i }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Starting…/i })).toBeInTheDocument(),
        );
    });

    it('Preview prompt compiles with no item', async () => {
        let body: unknown = null;
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/agents/agent-scout/compile-prompt`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({
                    prompt: '# Agent Prompt\nDo stuff.',
                    filename: 'agent-scout-prompt.md',
                    length: 42,
                    agent: { id: 'agent-scout', name: 'AI News Scout', cli: 'claude', model: 'm' },
                    issue: null,
                    guardrails_count: 0,
                    sections: ['System'],
                });
            }),
        );
        renderWithProviders(<RunNowDialog agent={scout} open onClose={() => {}} />);
        await userEvent.click(await screen.findByRole('button', { name: /Preview prompt/i }));
        await waitFor(() => expect(body).toMatchObject({ issue_type: null, issue_id: null }));
    });

    it('re-enables Preview prompt after a compile error', async () => {
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/agents/agent-scout/compile-prompt`, () =>
                HttpResponse.json({ error: 'Compile failed' }, { status: 500 }),
            ),
        );
        renderWithProviders(<RunNowDialog agent={scout} open onClose={() => {}} />);
        await userEvent.click(await screen.findByRole('button', { name: /Preview prompt/i }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Preview prompt/i })).not.toBeDisabled(),
        );
    });

    it('warns when the agent CLI is not installed', async () => {
        server.use(
            http.get(`${BASE}/cli/availability`, () =>
                HttpResponse.json([
                    { cli: 'claude', binary: 'claude', available: true, version: '1.0.0' },
                    { cli: 'copilot', binary: 'copilot', available: false, version: null },
                    { cli: 'ollama', binary: 'claude', available: true, version: '1.0.0' },
                ]),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ cli: 'copilot' })} open onClose={() => {}} />,
        );
        expect(
            await screen.findByText(/copilot is not installed on this machine/),
        ).toBeInTheDocument();
    });
});
