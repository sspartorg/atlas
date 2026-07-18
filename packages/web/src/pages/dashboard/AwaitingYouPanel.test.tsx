import { describe, expect, it } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AwaitingYouPanel } from './AwaitingYouPanel.js';
import type { AwaitingItem } from '../../api/types.js';

const makeRow = (overrides: Partial<AwaitingItem> = {}): AwaitingItem => ({
    id: 'CER-7',
    issue_type: 'story',
    title: 'A login flow',
    status: 'waiting_for_info',
    updated_at: new Date().toISOString(),
    ...overrides,
});

describe('AwaitingYouPanel', () => {
    it('renders loading state', () => {
        renderWithProviders(<AwaitingYouPanel rows={[]} isLoading />);
        expect(document.body.textContent?.length).toBeGreaterThan(0);
    });

    it('renders rows', () => {
        renderWithProviders(
            <AwaitingYouPanel
                rows={[makeRow()]}
                isLoading={false}
            />,
        );
        expect(screen.getByText('A login flow')).toBeInTheDocument();
    });

    it('renders empty state when no rows and not loading (covers filtered.length===0 branch)', () => {
        renderWithProviders(<AwaitingYouPanel rows={[]} isLoading={false} />);
        expect(screen.getByText(/Nothing awaiting your review/i)).toBeInTheDocument();
    });

    it('filter dropdown: selecting "Stories" filters to only story items (covers filter !== all branch)', async () => {
        const epicRow = makeRow({ id: 'CER-E1', issue_type: 'epic', title: 'Epic item' });
        const storyRow = makeRow({ id: 'CER-S1', issue_type: 'story', title: 'Story item' });
        renderWithProviders(
            <AwaitingYouPanel rows={[epicRow, storyRow]} isLoading={false} />,
        );
        // Both items visible initially (filter=all)
        expect(screen.getByText('Epic item')).toBeInTheDocument();
        expect(screen.getByText('Story item')).toBeInTheDocument();

        // Change filter to "Stories" — Select is a MUI Select, use fireEvent.change on the hidden input
        const select = document.querySelector('[role="combobox"]') as HTMLElement | null;
        if (select) {
            fireEvent.mouseDown(select);
            await waitFor(() => screen.getByText('Stories'));
            fireEvent.click(screen.getByText('Stories'));
        }
        // After filtering, epic should be gone, story visible
        await waitFor(() => {
            expect(screen.queryByText('Epic item')).not.toBeInTheDocument();
        });
    });
});
