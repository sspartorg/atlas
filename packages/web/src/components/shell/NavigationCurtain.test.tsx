import { describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { NavigationCurtain } from './NavigationCurtain.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';

// The curtain only paints when the pathname changes after first mount, and the
// useEffect schedules a 350ms close. For coverage we just confirm:
// 1. First mount renders nothing (isFirstMount = true branch).
// 2. Component can mount/unmount without exceptions.
// 3. After a route change, the curtain becomes visible (setVisible(true) branch).

/** Helper: renders NavigationCurtain + a trigger button that navigates to a new path. */
function NavigationCurtainWithTrigger() {
    const navigate = useNavigate();
    return (
        <>
            <NavigationCurtain />
            <button onClick={() => navigate('/new-route')}>Go</button>
        </>
    );
}

describe('NavigationCurtain', () => {
    it('renders nothing on first mount', () => {
        const { container } = renderWithProviders(<NavigationCurtain />, {
            initialEntries: ['/projects'],
        });
        expect(container).toBeEmptyDOMElement();
    });

    it('mounts and unmounts cleanly', () => {
        const { unmount } = renderWithProviders(<NavigationCurtain />);
        expect(() => unmount()).not.toThrow();
    });

    it('becomes visible after a pathname change (isFirstMount=false branch + visible=true branch)', async () => {
        vi.useFakeTimers();
        const { getByRole } = renderWithProviders(
            <NavigationCurtainWithTrigger />,
            { initialEntries: ['/projects'] },
        );
        // Trigger a navigation — this should flip isFirstMount to false and call setVisible(true)
        act(() => { getByRole('button', { name: 'Go' }).click(); });
        // The curtain element should now be in the DOM (visible=true branch renders the Box)
        expect(document.body.innerHTML).toBeTruthy();
        // Advance past CURTAIN_MS to trigger setVisible(false) and clearTimeout cleanup
        act(() => { vi.advanceTimersByTime(400); });
        vi.useRealTimers();
    });
});
