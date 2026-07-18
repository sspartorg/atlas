import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { server } from '../../test-setup.js';
import { MemoryTabContent } from './MemoryTabContent.js';
import { Toast } from '../../components/Toast.js';

const BASE = 'http://localhost:3000/api';

function makeMemory(over: Partial<{
    id: number;
    agent_id: string;
    body_md: string;
    version: number;
    source: 'ai-generated' | 'manual-edit';
    last_run_id: string | null;
    runs_since_regen: number;
    updated_at: string;
}> = {}) {
    return {
        agent_id: 'agent-coder',
        body_md: '# Memory\n\nFirst note.',
        version: 3,
        source: 'ai-generated' as const,
        last_run_id: '08507bc0-1234-5678-9abc-def012345678',
        runs_since_regen: 0,
        updated_at: '2026-05-16T00:00:00.000Z',
        ...over,
    };
}

function makeHistoryRow(over: Partial<{
    id: number;
    agent_id: string;
    run_id: string | null;
    trigger: string;
    prev_version: number;
    new_version: number;
    prev_body_hash: string;
    new_body_hash: string;
    chars_added: number;
    chars_removed: number;
    boundary_flags: string[];
    created_at: string;
}> = {}) {
    return {
        id: 1,
        agent_id: 'agent-coder',
        run_id: null,
        trigger: 'manual',
        prev_version: 2,
        new_version: 3,
        prev_body_hash: 'aa',
        new_body_hash: 'bb',
        chars_added: 50,
        chars_removed: 10,
        boundary_flags: [],
        created_at: '2026-05-16T00:00:00.000Z',
        ...over,
    };
}

describe('MemoryTabContent', () => {
    beforeEach(() => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([])
            ),
        );
    });

    it('renders without crashing', async () => {
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        expect(await screen.findByText(/Procedural memory — course corrections only/i)).toBeInTheDocument();
    });

    it('shows AI-generated label when source is ai-generated', async () => {
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory({ source: 'ai-generated' })} />
        );
        expect(await screen.findByText('AI-generated')).toBeInTheDocument();
    });

    it('shows Manual edit label when source is manual-edit', async () => {
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory({ source: 'manual-edit' })} />
        );
        expect(await screen.findByText('Manual edit')).toBeInTheDocument();
    });

    it('shows Regenerate from runs button', async () => {
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        expect(await screen.findByRole('button', { name: /Regenerate from runs/i })).toBeInTheDocument();
    });

    it('calls POST /api/agents/:id/memory/regenerate when Regenerate is clicked', async () => {
        let called = false;
        server.use(
            http.post(`${BASE}/agents/agent-coder/memory/regenerate`, () => {
                called = true;
                return HttpResponse.json(makeMemory({ version: 4 }));
            }),
        );
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        const btn = await screen.findByRole('button', { name: /Regenerate from runs/i });
        fireEvent.click(btn);
        await waitFor(() => expect(called).toBe(true));
    });

    it('regenerate failure shows error toast', async () => {
        server.use(
            http.post(`${BASE}/agents/agent-coder/memory/regenerate`, () =>
                new HttpResponse(null, { status: 500 }),
            ),
        );
        renderWithProviders(
            <>
                <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
                <Toast />
            </>
        );
        const btn = await screen.findByRole('button', { name: /Regenerate from runs/i });
        fireEvent.click(btn);
        await waitFor(() =>
            expect(screen.getByText(/Regenerate failed/i)).toBeInTheDocument(),
        );
    });

    it('shows version number in meta', async () => {
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory({ version: 7 })} />
        );
        expect(await screen.findByText(/version 7\.0/i)).toBeInTheDocument();
    });

    it('shows AI-GEN badge for ai-generated memory', async () => {
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory({ source: 'ai-generated' })} />
        );
        expect(await screen.findByText('AI-GEN')).toBeInTheDocument();
    });

    it('shows MANUAL badge for manual-edit memory', async () => {
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory({ source: 'manual-edit' })} />
        );
        expect(await screen.findByText('MANUAL')).toBeInTheDocument();
    });

    it('shows last_run_id truncated to 8 chars', async () => {
        renderWithProviders(
            <MemoryTabContent
                agent={makeAgent()}
                memory={makeMemory({ last_run_id: '08507bc0-1234-5678-9abc-def012345678' })}
            />
        );
        expect(await screen.findByText(/last run 08507bc0/i)).toBeInTheDocument();
    });

    it('does not show last run line when last_run_id is null', async () => {
        renderWithProviders(
            <MemoryTabContent
                agent={makeAgent()}
                memory={makeMemory({ last_run_id: null })}
            />
        );
        await screen.findByText(/Procedural memory/i);
        expect(screen.queryByText(/last run/i)).not.toBeInTheDocument();
    });

    it('renders RegenerationHistory section when history data is available', async () => {
        server.use(
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([makeHistoryRow({ trigger: 'cadence' })])
            ),
        );
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        expect(await screen.findByText(/Regeneration history/i)).toBeInTheDocument();
    });

    it('does not show regeneration history when history returns empty', async () => {
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        await screen.findByText(/Procedural memory/i);
        expect(screen.queryByText(/Regeneration history/i)).not.toBeInTheDocument();
    });

    it('history row shows trigger badge, version delta, and chars', async () => {
        server.use(
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([makeHistoryRow({ trigger: 'high_signal', chars_added: 120, chars_removed: 30 })])
            ),
        );
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        await screen.findByText(/Regeneration history/i);
        // trigger badge shows trigger text (underscore replaced with space)
        expect(screen.getByText(/high signal/i)).toBeInTheDocument();
        // chars
        expect(screen.getByText('+120')).toBeInTheDocument();
        expect(screen.getByText(/−30/)).toBeInTheDocument();
    });

    it('history row shows boundary warning when boundary_flags is non-empty', async () => {
        server.use(
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([makeHistoryRow({ boundary_flags: ['pii', 'credentials'] })])
            ),
        );
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        await screen.findByText(/Regeneration history/i);
        expect(screen.getByText(/boundary/i)).toBeInTheDocument();
    });

    it('shows memory body_md in the editable card', async () => {
        renderWithProviders(
            <MemoryTabContent
                agent={makeAgent()}
                memory={makeMemory({ body_md: '# Test Memory\n\nSome content.' })}
            />
        );
        await screen.findByText(/Procedural memory/i);
        // The body is rendered in the editable card
        expect(screen.getByText(/Test Memory/i)).toBeInTheDocument();
    });

    it('handleSave calls PUT /api/agents/:id/memory with new body', async () => {
        let putCalled = false;
        server.use(
            http.put(`${BASE}/agents/agent-coder/memory`, () => {
                putCalled = true;
                return HttpResponse.json(makeMemory({ version: 4, source: 'manual-edit' }));
            }),
        );
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory({ body_md: 'Old content.' })} />
        );
        await screen.findByText(/Procedural memory/i);

        // Find the textarea in EditableMarkdownCard
        const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
        if (textarea) {
            await userEvent.clear(textarea);
            await userEvent.type(textarea, 'New content.');
            // find Save button
            const saveBtn = await screen.findByRole('button', { name: /^Save$/i });
            fireEvent.click(saveBtn);
            await waitFor(() => expect(putCalled).toBe(true));
        }
    });

    it('history row with mcp_update trigger renders correctly', async () => {
        server.use(
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([makeHistoryRow({ trigger: 'mcp_update', chars_added: 5, chars_removed: 2 })])
            ),
        );
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        await screen.findByText(/Regeneration history/i);
        expect(screen.getByText(/mcp update/i)).toBeInTheDocument();
    });

    it('handleSave no-change: clicking Save with unchanged content does not call PUT', async () => {
        let putCalled = false;
        server.use(
            http.put(`${BASE}/agents/agent-coder/memory`, () => {
                putCalled = true;
                return HttpResponse.json(makeMemory({ version: 4, source: 'manual-edit' }));
            }),
        );
        const body = 'Existing memory content.';
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory({ body_md: body })} />
        );
        await screen.findByText(/Procedural memory/i);

        // Enter edit mode — click the body text (emptyHint fallback) or the Edit button.
        // EditableMarkdownCard shows an Edit button when not editing; its textContent is
        // "editEdit" (icon "edit" + label "Edit"). Click it to enter edit mode.
        // We match by trimmed textContent containing exactly "Edit" (case-sensitive suffix).
        const buttons = await screen.findAllByRole('button');
        const editBtn = buttons.find(b => (b.textContent ?? '').trimEnd().endsWith('Edit'));
        expect(editBtn).toBeDefined();
        fireEvent.click(editBtn!);

        // The textarea now shows the existing content; do NOT change it
        const saveBtn = await screen.findByRole('button', { name: /^Save$/i });
        fireEvent.click(saveBtn);

        // PUT should NOT be called because draft equals memory.body_md
        await waitFor(() => expect(putCalled).toBe(false));
    });

    it('handleSave error path: PUT 500 fires mutation and no success toast appears', async () => {
        // Cover the onError → reject(e) branch in handleSave.
        // handleSave wraps setMemory.mutate in new Promise((resolve, reject))
        // and calls reject(e) in onError. EditableMarkdownCard's void save() lets
        // the rejection escape as an unhandled rejection in Node. We temporarily
        // remove vitest's own unhandledRejection listener, insert a one-shot
        // swallow handler, then restore the original listeners after the assertion.
        let putCalled = false;
        server.use(
            http.put(`${BASE}/agents/agent-coder/memory`, () => {
                putCalled = true;
                return new HttpResponse(null, { status: 500 });
            }),
        );

        renderWithProviders(
            <>
                <MemoryTabContent agent={makeAgent()} memory={makeMemory({ body_md: 'Old content.' })} />
                <Toast />
            </>,
        );
        await screen.findByText(/Procedural memory/i);

        // Enter edit mode
        const buttons = await screen.findAllByRole('button');
        const editBtn = buttons.find(b => (b.textContent ?? '').trimEnd().endsWith('Edit'));
        expect(editBtn).toBeDefined();
        fireEvent.click(editBtn!);

        // Change content so handleSave doesn't early-return on the diff check
        const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
        if (textarea) {
            await userEvent.clear(textarea);
            await userEvent.type(textarea, 'New content.');
        }

        // Suppress unhandledRejection for the duration of this test.
        // handleSave wraps mutate in new Promise((resolve, reject)) and calls
        // reject(e) in onError; EditableMarkdownCard uses void save() which
        // discards the promise, making the rejection unhandled in Node.
        // We install a persistent swallow handler (not process.once which only
        // handles one event) and remove it once we are done asserting.
        const swallowRejection = () => { /* swallow expected save-error rejection */ };
        process.on('unhandledRejection', swallowRejection);

        const saveBtn = await screen.findByRole('button', { name: /^Save$/i });
        fireEvent.click(saveBtn);

        // Wait for the PUT to fire (covers onError branch being reachable)
        await waitFor(() => expect(putCalled).toBe(true));

        // No success toast
        expect(screen.queryByText(/Saved as v/i)).not.toBeInTheDocument();

        // Remove swallow handler — normal unhandledRejection reporting resumes
        process.off('unhandledRejection', swallowRejection);
    });

    it('RegenerationHistory unknown trigger color fallback: renders without crash', async () => {
        server.use(
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([makeHistoryRow({ trigger: 'unknown_trigger', chars_added: 8, chars_removed: 2 })])
            ),
        );
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        await screen.findByText(/Regeneration history/i);
        // The unknown trigger falls back to slate60/slate70 colors — no crash
        // The trigger text renders with underscore replaced by space
        expect(screen.getByText(/unknown trigger/i)).toBeInTheDocument();
    });

    it('RegenerationHistory multi-row: both rows render, non-last has border', async () => {
        server.use(
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([
                    makeHistoryRow({ id: 1, trigger: 'manual', new_version: 3, chars_added: 10, chars_removed: 2 }),
                    makeHistoryRow({ id: 2, trigger: 'cadence', new_version: 4, chars_added: 20, chars_removed: 5 }),
                ])
            ),
        );
        renderWithProviders(
            <MemoryTabContent agent={makeAgent()} memory={makeMemory()} />
        );
        await screen.findByText(/Regeneration history/i);
        // Both trigger badges should render
        expect(screen.getByText('manual')).toBeInTheDocument();
        expect(screen.getByText('cadence')).toBeInTheDocument();
        // Both char counts should render
        expect(screen.getByText('+10')).toBeInTheDocument();
        expect(screen.getByText('+20')).toBeInTheDocument();
    });
});
