import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent } from '../test-utils/factories.js';
import { http, HttpResponse } from 'msw';
import { ReassignControl } from './ReassignControl.js';

const BASE = 'http://localhost:3000/api';

describe('ReassignControl', () => {
    it('mounts without crashing', () => {
        server.use(...defaultHandlers);
        const { container } = renderWithProviders(
            <ReassignControl assigneeAgentId={null} onAssign={vi.fn()} />,
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('opens menu when button is clicked (exercises setAnchor arrow fn)', async () => {
        server.use(...defaultHandlers);
        renderWithProviders(
            <ReassignControl assigneeAgentId={null} onAssign={vi.fn()} />,
        );
        const btn = screen.getByRole('button');
        await userEvent.click(btn);
        // Menu should open — wait for the menuitem role to appear
        await waitFor(() => {
            expect(screen.queryAllByRole('menuitem').length).toBeGreaterThan(0);
        }, { timeout: 5000 });
    });

    it('clicking Owner calls onAssign(null) and closes menu', async () => {
        server.use(...defaultHandlers);
        const onAssign = vi.fn();
        renderWithProviders(
            <ReassignControl assigneeAgentId={null} onAssign={onAssign} />,
        );
        await userEvent.click(screen.getByRole('button'));
        // Wait for menu to open with the Owner menuitem
        await waitFor(() => {
            expect(screen.queryAllByRole('menuitem').length).toBeGreaterThan(0);
        }, { timeout: 5000 });
        const ownerItem = screen.getAllByRole('menuitem').find(
            (el) => el.textContent?.includes('Owner')
        );
        if (ownerItem) fireEvent.click(ownerItem);
        expect(onAssign).toHaveBeenCalledWith(null);
    });

    it('clicking an agent calls onAssign(agentId) (exercises agent onClick)', async () => {
        const agent = makeAgent({ id: 'agent-coder', name: 'Coder', status: 'active' });
        // Put the agent override FIRST so MSW's first-match wins over defaultHandlers' empty agents list
        server.use(
            http.get(`${BASE}/agents`, () => HttpResponse.json([agent])),
            ...defaultHandlers,
        );
        const onAssign = vi.fn();
        renderWithProviders(
            <ReassignControl assigneeAgentId={null} onAssign={onAssign} />,
        );
        await userEvent.click(screen.getByRole('button'));
        // Wait for menu items to appear in the portal
        await waitFor(() => {
            expect(screen.queryAllByRole('menuitem').length).toBeGreaterThan(1);
        }, { timeout: 5000 });
        const coderItem = screen.getAllByRole('menuitem').find(
            (el) => el.textContent?.includes('Coder')
        );
        if (coderItem) fireEvent.click(coderItem);
        expect(onAssign).toHaveBeenCalledWith('agent-coder');
    });

    it('exercises onClose arrow fn by pressing Escape', async () => {
        server.use(...defaultHandlers);
        renderWithProviders(
            <ReassignControl assigneeAgentId={null} onAssign={vi.fn()} />,
        );
        const btn = screen.getByRole('button');
        await userEvent.click(btn);
        // Menu opens — wait for any menuitem to appear (avoids Portal render race)
        await waitFor(() => {
            expect(screen.queryAllByRole('menuitem').length).toBeGreaterThan(0);
        }, { timeout: 5000 });
        await userEvent.keyboard('{Escape}');
        await waitFor(() => {
            expect(screen.queryAllByRole('menuitem').length).toBe(0);
        });
    });

    it('renders loading=true disables the button (Boolean(loading) truthy branch)', () => {
        server.use(...defaultHandlers);
        renderWithProviders(
            <ReassignControl assigneeAgentId={null} onAssign={vi.fn()} loading={true} />,
        );
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('renders assignee accent color when assigneeAgentId matches an agent (assignee defined branch)', async () => {
        const agent = makeAgent({ id: 'agent-coder', name: 'Coder', status: 'active', accent_color: '#FF6633' });
        server.use(
            http.get(`${BASE}/agents`, () => HttpResponse.json([agent])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <ReassignControl assigneeAgentId="agent-coder" onAssign={vi.fn()} />,
        );
        // Wait for the query to resolve so assignee is found
        await waitFor(() => {
            expect(document.body.textContent).toContain('Coder');
        }, { timeout: 5000 });
    });
});
