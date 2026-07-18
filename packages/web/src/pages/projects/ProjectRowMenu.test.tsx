import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ProjectRowMenu } from './ProjectRowMenu.js';

describe('ProjectRowMenu', () => {
    it('shows the menu and fires Delete', async () => {
        const onDelete = vi.fn();
        renderWithProviders(
            <ProjectRowMenu
                onOpen={vi.fn()}
                onCopyUrl={vi.fn()}
                onReclone={vi.fn()}
                onScheduleFetch={vi.fn()}
                onDelete={onDelete}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Project actions/i }));
        await userEvent.click(await screen.findByText(/Delete project/));
        expect(onDelete).toHaveBeenCalled();
    });

    it('hides "Open project" and "Re-clone" items on mobile (line 24/34 false branch)', async () => {
        // Mock matchMedia to simulate mobile viewport
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
            matches: query.includes('max-width'),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        renderWithProviders(
            <ProjectRowMenu
                onOpen={vi.fn()}
                onCopyUrl={vi.fn()}
                onReclone={vi.fn()}
                onScheduleFetch={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Project actions/i }));
        // On mobile, !isMobile is false — "Open project" and "Re-clone" are omitted
        // Only "Copy repo URL", "Auto-fetch schedule…", "Delete project…" should appear
        const items = await screen.findAllByRole('menuitem');
        const itemLabels = items.map((i) => i.textContent ?? '');
        expect(itemLabels.some((l) => l.includes('Open project'))).toBe(false);
        expect(itemLabels.some((l) => l.includes('Re-clone from remote'))).toBe(false);
        expect(itemLabels.some((l) => l.includes('Copy repo URL'))).toBe(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });
});
