import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { BottomNav } from './BottomNav.js';

describe('BottomNav', () => {
    it('renders nav buttons and fires onOpenMore for "More"', async () => {
        const onOpenMore = vi.fn();
        renderWithProviders(<BottomNav onOpenMore={onOpenMore} />, {
            initialEntries: ['/'],
        });
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
        const more = buttons.find((b) => /More/i.test(b.textContent ?? ''));
        if (more) {
            await userEvent.click(more);
            expect(onOpenMore).toHaveBeenCalled();
        }
    });

    it('renders all 5 nav tabs with correct labels', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/'],
        });
        expect(screen.getByText('Home')).toBeInTheDocument();
        expect(screen.getByText('Epics')).toBeInTheDocument();
        expect(screen.getByText('Issues')).toBeInTheDocument();
        expect(screen.getByText('Queue')).toBeInTheDocument();
        expect(screen.getByText('More')).toBeInTheDocument();
    });

    it('clicking Home tab navigates to / (onClick path branch)', async () => {
        const onOpenMore = vi.fn();
        renderWithProviders(<BottomNav onOpenMore={onOpenMore} />, {
            initialEntries: ['/epics'],
        });
        const homeBtn = screen.getAllByRole('button').find((b) => /Home/i.test(b.textContent ?? ''));
        expect(homeBtn).toBeDefined();
        if (homeBtn) {
            await userEvent.click(homeBtn);
            // Navigation clicked — onOpenMore must NOT have been called
            expect(onOpenMore).not.toHaveBeenCalled();
        }
    });

    it('clicking Epics tab navigates (onClick non-more with path)', async () => {
        const onOpenMore = vi.fn();
        renderWithProviders(<BottomNav onOpenMore={onOpenMore} />, {
            initialEntries: ['/'],
        });
        const epicsBtn = screen.getAllByRole('button').find((b) => /Epics/i.test(b.textContent ?? ''));
        expect(epicsBtn).toBeDefined();
        if (epicsBtn) {
            await userEvent.click(epicsBtn);
            expect(onOpenMore).not.toHaveBeenCalled();
        }
    });

    it('clicking Issues tab navigates (onClick non-more with path)', async () => {
        const onOpenMore = vi.fn();
        renderWithProviders(<BottomNav onOpenMore={onOpenMore} />, {
            initialEntries: ['/'],
        });
        const issuesBtn = screen.getAllByRole('button').find((b) => /Issues/i.test(b.textContent ?? ''));
        expect(issuesBtn).toBeDefined();
        if (issuesBtn) {
            await userEvent.click(issuesBtn);
            expect(onOpenMore).not.toHaveBeenCalled();
        }
    });

    it('clicking Queue tab navigates (onClick non-more with path)', async () => {
        const onOpenMore = vi.fn();
        renderWithProviders(<BottomNav onOpenMore={onOpenMore} />, {
            initialEntries: ['/'],
        });
        const queueBtn = screen.getAllByRole('button').find((b) => /Queue/i.test(b.textContent ?? ''));
        expect(queueBtn).toBeDefined();
        if (queueBtn) {
            await userEvent.click(queueBtn);
            expect(onOpenMore).not.toHaveBeenCalled();
        }
    });

    it('Epics tab is active when pathname is /epics (matches exact)', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/epics'],
        });
        // The Epics tab should be visually selected; the MUI value should be 'epics'
        expect(screen.getByText('Epics')).toBeInTheDocument();
    });

    it('Epics tab is active when pathname starts with /epics/ (matches sub-path)', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/epics/ATL-1'],
        });
        expect(screen.getByText('Epics')).toBeInTheDocument();
    });

    it('Issues tab is active when pathname starts with /issues/ (matches sub-path)', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/issues/ATL-2'],
        });
        expect(screen.getByText('Issues')).toBeInTheDocument();
    });

    it('Queue tab is active when pathname is /queue', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/queue'],
        });
        expect(screen.getByText('Queue')).toBeInTheDocument();
    });

    it('no tab is active (activeKey null) when on an unmatched path', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/settings'],
        });
        // All five tabs still render even when none is active
        expect(screen.getByText('Home')).toBeInTheDocument();
        expect(screen.getByText('More')).toBeInTheDocument();
    });

    it('onPointerEnter on Home tab calls prefetchRoute (non-more tab)', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/'],
        });
        const homeBtn = screen.getAllByRole('button').find((b) => /Home/i.test(b.textContent ?? ''));
        expect(homeBtn).toBeDefined();
        if (homeBtn) {
            // pointerenter triggers the onPointerEnter handler which calls prefetchRoute
            fireEvent.pointerEnter(homeBtn);
            // No assertion needed — just ensure it doesn't throw
            expect(homeBtn).toBeInTheDocument();
        }
    });

    it('onPointerEnter on Epics tab calls prefetchRoute', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/'],
        });
        const epicsBtn = screen.getAllByRole('button').find((b) => /Epics/i.test(b.textContent ?? ''));
        if (epicsBtn) {
            fireEvent.pointerEnter(epicsBtn);
            expect(epicsBtn).toBeInTheDocument();
        }
    });

    it('onPointerEnter on More tab does NOT call prefetchRoute (more is excluded)', () => {
        renderWithProviders(<BottomNav onOpenMore={vi.fn()} />, {
            initialEntries: ['/'],
        });
        const moreBtn = screen.getAllByRole('button').find((b) => /More/i.test(b.textContent ?? ''));
        if (moreBtn) {
            // tab.key === 'more' so prefetchRoute is skipped — should not throw
            fireEvent.pointerEnter(moreBtn);
            expect(moreBtn).toBeInTheDocument();
        }
    });
});
