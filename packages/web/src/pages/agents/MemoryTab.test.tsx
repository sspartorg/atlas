import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { MemoryTab } from './MemoryTab.js';

const BASE = 'http://localhost:3000/api';

function makeMemory(over: Partial<{
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
        body_md: '# Procedural Memory\n\nFirst note.',
        version: 3,
        source: 'ai-generated' as const,
        last_run_id: '08507bc0-1234-5678-9abc-def012345678',
        runs_since_regen: 0,
        updated_at: '2026-05-16T00:00:00.000Z',
        ...over,
    };
}

describe('MemoryTab', () => {
    it('renders the memory body once loaded', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/agents/agent-coder/memory`, () =>
                HttpResponse.json(makeMemory())
            )
        );
        const { findByText } = renderWithProviders(<MemoryTab agent={makeAgent()} memory={makeMemory()} />);
        expect(await findByText(/Procedural memory — course corrections only./i)).toBeInTheDocument();
        expect(await findByText(/First note\./)).toBeInTheDocument();
        expect(await findByText('AI-GEN')).toBeInTheDocument();
    });

    it('shows a MANUAL badge when source is manual-edit', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/agents/agent-coder/memory`, () =>
                HttpResponse.json(makeMemory({ source: 'manual-edit' }))
            )
        );
        const { findByText } = renderWithProviders(
            <MemoryTab agent={makeAgent()} memory={makeMemory({ source: 'manual-edit' })} />,
        );
        expect(await findByText('MANUAL')).toBeInTheDocument();
    });

    it('renders the regenerate button', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/agents/agent-coder/memory`, () =>
                HttpResponse.json(makeMemory())
            )
        );
        const { findByRole } = renderWithProviders(<MemoryTab agent={makeAgent()} memory={makeMemory()} />);
        const button = await findByRole('button', { name: /Regenerate from runs/i });
        expect(button).toBeInTheDocument();
    });

    // A06 — when a regeneration row carries boundary_flags, the row renders an
    // amber "BOUNDARY" chip next to the trigger badge. Clean rows omit it.
    it('renders the BOUNDARY chip on rows with boundary_flags', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/agents/agent-coder/memory`, () =>
                HttpResponse.json(makeMemory()),
            ),
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: 'agent-coder',
                        run_id: null,
                        trigger: 'mcp_update',
                        prev_version: 2,
                        new_version: 3,
                        prev_body_hash: 'aa',
                        new_body_hash: 'bb',
                        chars_added: 40,
                        chars_removed: 0,
                        boundary_flags: ['item_id'],
                        created_at: '2026-05-26T12:00:00.000Z',
                    },
                ]),
            ),
        );
        const { findByText } = renderWithProviders(
            <MemoryTab agent={makeAgent()} memory={makeMemory()} />,
        );
        expect(await findByText(/boundary/i)).toBeInTheDocument();
    });

    it('renders MemoryTabSkeleton when memory is undefined (skeleton branch)', () => {
        // When memory prop is undefined, MemoryTab returns <MemoryTabSkeleton />
        // This exercises lines 12-18 (MemoryTabSkeleton fn) and the `if (!ready || memory === undefined)` branch
        server.use(...defaultHandlers);
        const { container } = renderWithProviders(<MemoryTab agent={makeAgent()} memory={undefined} />);
        // MemoryTabSkeleton renders MUI Skeletons
        expect(container.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
    });

    it('omits the BOUNDARY chip when flags are empty', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/agents/agent-coder/memory`, () =>
                HttpResponse.json(makeMemory()),
            ),
            http.get(`${BASE}/agents/agent-coder/memory/history`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: 'agent-coder',
                        run_id: null,
                        trigger: 'cadence',
                        prev_version: 2,
                        new_version: 3,
                        prev_body_hash: 'aa',
                        new_body_hash: 'bb',
                        chars_added: 80,
                        chars_removed: 12,
                        boundary_flags: [],
                        created_at: '2026-05-26T12:00:00.000Z',
                    },
                ]),
            ),
        );
        const { findByText, queryByText } = renderWithProviders(
            <MemoryTab agent={makeAgent()} memory={makeMemory()} />,
        );
        // Wait for history to load so we know the chip's absence is meaningful.
        expect(await findByText(/cadence/i)).toBeInTheDocument();
        expect(queryByText(/boundary/i)).toBeNull();
    });
});
