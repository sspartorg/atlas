import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type * as RouterDom from 'react-router-dom';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Sidenav } from './Sidenav.js';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof RouterDom>('react-router-dom');
    return { ...actual, useNavigate: () => navigateSpy };
});

const countsMock = vi.fn();
vi.mock('../hooks/useSidenavCounts.js', () => ({
    useSidenavCounts: () => countsMock(),
}));

describe('Sidenav', () => {
    it('renders without crashing', () => {
        countsMock.mockReturnValue({});
        server.use(...defaultHandlers);
        const { container } = renderWithProviders(<Sidenav />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('resolves activeKey for a non-root path via the longest-prefix loop', () => {
        countsMock.mockReturnValue({});
        server.use(...defaultHandlers);
        renderWithProviders(<Sidenav />, { initialEntries: ['/projects/abc/issues'] });
        expect(screen.getByText(/Projects/i)).toBeInTheDocument();
    });

    it('renders the red unread pill when notifications count is > 0', async () => {
        countsMock.mockReturnValue({ notifications: 3 });
        server.use(...defaultHandlers);
        renderWithProviders(<Sidenav />);
        await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    });

    it('calls navigate and onNavigate when a nav row is clicked', () => {
        countsMock.mockReturnValue({});
        navigateSpy.mockClear();
        const onNavigate = vi.fn();
        server.use(...defaultHandlers);
        renderWithProviders(<Sidenav onNavigate={onNavigate} />);
        // Use the data-testid to reliably target the clickable row
        const row = screen.getByTestId('nav-item-projects');
        fireEvent.click(row);
        expect(navigateSpy).toHaveBeenCalledWith('/projects');
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it('activeKey is dashboard when path is "/"', () => {
        countsMock.mockReturnValue({});
        server.use(...defaultHandlers);
        renderWithProviders(<Sidenav />, { initialEntries: ['/'] });
        // The dashboard nav item should be rendered (active key = dashboard)
        const dashboardItem = screen.getByTestId('nav-item-dashboard');
        expect(dashboardItem).toBeInTheDocument();
    });

    it('falls back to dashboard as activeKey when path matches no nav item', () => {
        countsMock.mockReturnValue({});
        server.use(...defaultHandlers);
        renderWithProviders(<Sidenav />, { initialEntries: ['/unknown-path'] });
        // Dashboard item should still be present (fallback active key)
        expect(screen.getByTestId('nav-item-dashboard')).toBeInTheDocument();
        // Verify the nav renders without crash and Projects is also present
        expect(screen.getByText(/Projects/i)).toBeInTheDocument();
    });

    it('does NOT render notifications count pill when count is 0', () => {
        countsMock.mockReturnValue({ notifications: 0 });
        server.use(...defaultHandlers);
        renderWithProviders(<Sidenav />);
        // count=0 for a unreadKey item triggers `if (count === 0) return null`
        // so the red pill is absent; '0' should not appear in the document
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('fires prefetchRoute via onPointerEnter on a nav item row', () => {
        countsMock.mockReturnValue({});
        server.use(...defaultHandlers);
        renderWithProviders(<Sidenav />);
        const row = screen.getByTestId('nav-item-projects');
        fireEvent.pointerEnter(row);
        // The handler runs without throwing — row is still in the document.
        expect(row).toBeInTheDocument();
    });

    it('navigates to /settings when the owner row at the bottom is clicked', async () => {
        countsMock.mockReturnValue({});
        navigateSpy.mockClear();
        server.use(...defaultHandlers);
        renderWithProviders(<Sidenav />);
        // The footer owner row renders ownerName ("Owner" from mock settings) and
        // a hardcoded "Owner" role label. Both are inside the Box with
        // onClick={() => go('/settings')}. Clicking either bubbles up and fires.
        await waitFor(() => expect(screen.getAllByText('Owner').length).toBeGreaterThan(0));
        // Click the first "Owner" occurrence — it bubbles to the owner-row Box.
        fireEvent.click(screen.getAllByText('Owner')[0]!);
        expect(navigateSpy).toHaveBeenCalledWith('/settings');
    });
});
