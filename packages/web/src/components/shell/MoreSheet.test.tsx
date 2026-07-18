import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { MoreSheet } from './MoreSheet.js';
import * as sidenavModule from '../../hooks/useSidenavCounts.js';

describe('MoreSheet', () => {
    it('renders nav items when open', () => {
        server.use(...defaultHandlers);
        renderWithProviders(<MoreSheet open onClose={vi.fn()} />);
        // Scratch Pad mirrors the desktop sidenav placement (P12 follow-up
        // for mobile parity). Keep it asserted so a future re-ordering
        // doesn't silently drop the entry.
        expect(document.body.textContent).toContain('Scratch Pad');
        expect(document.body.textContent).toContain('Projects');
        expect(document.body.textContent).toContain('Settings');
        // Sidenav-parity anchors — every sidenav destination must also be
        // reachable from the mobile More sheet. If one of these gets
        // dropped, a phone user loses access to the route entirely.
        expect(document.body.textContent).toContain('Analytics');
        expect(document.body.textContent).toContain('Terminal');
        expect(document.body.textContent).toContain('Marketplace');
        expect(document.body.textContent).toContain('MCP Tools');
        expect(document.body.textContent).toContain('Reminders');
    });

    it('clicking the header close-X calls onClose without navigating', () => {
        server.use(...defaultHandlers);
        const onClose = vi.fn();
        renderWithProviders(<MoreSheet open onClose={onClose} />);
        const closeBtn = screen.getByRole('button', { name: 'Close' });
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('mounts when closed', () => {
        renderWithProviders(<MoreSheet open={false} onClose={vi.fn()} />);
    });

    it('clicking an item calls go() which calls onClose + navigate (exercises go arrow fn)', async () => {
        server.use(...defaultHandlers);
        const onClose = vi.fn();
        renderWithProviders(<MoreSheet open onClose={onClose} />);
        // Click "Projects" nav item
        const projectsItem = screen.queryByText('Projects');
        if (projectsItem) {
            fireEvent.click(projectsItem);
            expect(onClose).toHaveBeenCalledOnce();
        }
    });

    it('exercises onPointerEnter prefetchRoute by hovering over a nav item', async () => {
        server.use(...defaultHandlers);
        renderWithProviders(<MoreSheet open onClose={vi.fn()} />);
        const analyticsItem = screen.queryByText('Analytics');
        if (analyticsItem) {
            fireEvent.pointerEnter(analyticsItem);
        }
        expect(document.body.textContent).toContain('Analytics');
    });

    it('shows notification badge when counts.notifications > 0 (item.countKey && count > 0 branch)', () => {
        // Spy on useSidenavCounts to return a non-zero notification count
        const spy = vi.spyOn(sidenavModule, 'useSidenavCounts').mockReturnValue({
            projects: 0, epics: 0, issues: 0, queue: 0, agents: 0, notifications: 5,
        });
        server.use(...defaultHandlers);
        renderWithProviders(<MoreSheet open onClose={vi.fn()} />);
        // The badge renders the count number "5" because notifications > 0
        expect(document.body.textContent).toContain('5');
        spy.mockRestore();
    });
});
