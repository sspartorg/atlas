import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent } from '../test-utils/factories.js';
import { AssigneePickerPopover } from './AssigneePickerPopover.js';

const BASE = 'http://localhost:3000/api';

function makeAnchor(): HTMLElement {
    const el = document.createElement('button');
    document.body.appendChild(el);
    return el;
}

const ACTIVE_AGENT = makeAgent({
    id: 'agent-coder',
    name: 'Coder',
    status: 'active',
    accent_color: '#31AB46',
});

describe('AssigneePickerPopover', () => {
    it('mounts without crashing in closed state', () => {
        server.use(...defaultHandlers);
        renderWithProviders(
            <AssigneePickerPopover
                anchorEl={null}
                open={false}
                onClose={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
            />,
        );
    });

    it('open=true — owner menu item is visible', async () => {
        server.use(...defaultHandlers);
        const anchor = makeAnchor();
        renderWithProviders(
            <AssigneePickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
            />,
        );
        await waitFor(() => {
            const items = screen.queryAllByRole('menuitem');
            expect(items.length).toBeGreaterThan(0);
            expect(items.some((el) => el.textContent?.includes('Owner'))).toBe(true);
        }, { timeout: 5000 });
    });

    it('open=true — active agents from API are listed', async () => {
        server.use(
            http.get(`${BASE}/agents`, () => HttpResponse.json([ACTIVE_AGENT])),
            ...defaultHandlers,
        );
        const anchor = makeAnchor();
        renderWithProviders(
            <AssigneePickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
            />,
        );
        await waitFor(() => {
            const items = screen.queryAllByRole('menuitem');
            expect(items.some((el) => el.textContent?.includes('Coder'))).toBe(true);
        }, { timeout: 5000 });
    });

    it('assigneeAgentId === null — check icon shown on Owner row', async () => {
        server.use(...defaultHandlers);
        const anchor = makeAnchor();
        renderWithProviders(
            <AssigneePickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
            />,
        );
        await waitFor(() => {
            const items = screen.queryAllByRole('menuitem');
            expect(items.length).toBeGreaterThan(0);
        }, { timeout: 5000 });
        // The Owner row has the check span when assigneeAgentId is null
        const checkSpans = document.querySelectorAll('.material-symbols-rounded');
        expect(checkSpans.length).toBeGreaterThan(0);
        expect(Array.from(checkSpans).some((s) => s.textContent === 'check')).toBe(true);
    });

    it('assigneeAgentId === agent id — check icon shown on that agent row', async () => {
        server.use(
            http.get(`${BASE}/agents`, () => HttpResponse.json([ACTIVE_AGENT])),
            ...defaultHandlers,
        );
        const anchor = makeAnchor();
        renderWithProviders(
            <AssigneePickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                assigneeAgentId="agent-coder"
                onAssign={vi.fn()}
            />,
        );
        await waitFor(() => {
            const items = screen.queryAllByRole('menuitem');
            expect(items.some((el) => el.textContent?.includes('Coder'))).toBe(true);
        }, { timeout: 5000 });
        const checkSpans = document.querySelectorAll('.material-symbols-rounded');
        // Only one check icon (on the Coder row), not on the Owner row
        expect(checkSpans.length).toBe(1);
    });

    it('onAssign(null) called when clicking Owner row', async () => {
        server.use(...defaultHandlers);
        const anchor = makeAnchor();
        const onAssign = vi.fn();
        const onClose = vi.fn();
        renderWithProviders(
            <AssigneePickerPopover
                anchorEl={anchor}
                open
                onClose={onClose}
                assigneeAgentId="agent-coder"
                onAssign={onAssign}
            />,
        );
        await waitFor(() => {
            const items = screen.queryAllByRole('menuitem');
            expect(items.some((el) => el.textContent?.includes('Owner'))).toBe(true);
        }, { timeout: 5000 });
        const ownerItem = screen.getAllByRole('menuitem').find(
            (el) => el.textContent?.includes('Owner'),
        )!;
        fireEvent.click(ownerItem);
        expect(onAssign).toHaveBeenCalledWith(null);
        expect(onClose).toHaveBeenCalled();
    });

    it('onAssign(w.id) called when clicking an agent row', async () => {
        server.use(
            http.get(`${BASE}/agents`, () => HttpResponse.json([ACTIVE_AGENT])),
            ...defaultHandlers,
        );
        const anchor = makeAnchor();
        const onAssign = vi.fn();
        const onClose = vi.fn();
        renderWithProviders(
            <AssigneePickerPopover
                anchorEl={anchor}
                open
                onClose={onClose}
                assigneeAgentId={null}
                onAssign={onAssign}
            />,
        );
        await waitFor(() => {
            const items = screen.queryAllByRole('menuitem');
            expect(items.some((el) => el.textContent?.includes('Coder'))).toBe(true);
        }, { timeout: 5000 });
        const coderItem = screen.getAllByRole('menuitem').find(
            (el) => el.textContent?.includes('Coder'),
        )!;
        fireEvent.click(coderItem);
        expect(onAssign).toHaveBeenCalledWith('agent-coder');
        expect(onClose).toHaveBeenCalled();
    });

    it('inactive agents are NOT listed', async () => {
        const inactiveAgent = makeAgent({
            id: 'agent-inactive',
            name: 'InactiveBot',
            status: 'inactive',
        });
        server.use(
            http.get(`${BASE}/agents`, () => HttpResponse.json([inactiveAgent])),
            ...defaultHandlers,
        );
        const anchor = makeAnchor();
        renderWithProviders(
            <AssigneePickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
            />,
        );
        await waitFor(() => {
            const items = screen.queryAllByRole('menuitem');
            expect(items.length).toBeGreaterThan(0);
        }, { timeout: 5000 });
        const items = screen.getAllByRole('menuitem');
        expect(items.some((el) => el.textContent?.includes('InactiveBot'))).toBe(false);
    });
});
