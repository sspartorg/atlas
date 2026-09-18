import { describe, expect, it } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AwaitingYouPanel } from './AwaitingYouPanel.js';
import type { AwaitingItem } from '../../api/types.js';

const makeRow = (overrides: Partial<AwaitingItem> = {}): AwaitingItem => ({
    id: 'CER-7',
    issue_type: 'sub_task',
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

    it('filter dropdown: selecting "Sub-tasks" filters to only sub-task items (covers filter !== all branch)', async () => {
        const taskRow = makeRow({ id: 'CER-T1', issue_type: 'task', title: 'Task item' });
        const subTaskRow = makeRow({ id: 'CER-S1', issue_type: 'sub_task', title: 'Sub-task item' });
        renderWithProviders(
            <AwaitingYouPanel rows={[taskRow, subTaskRow]} isLoading={false} />,
        );
        // Both items visible initially (filter=all)
        expect(screen.getByText('Task item')).toBeInTheDocument();
        expect(screen.getByText('Sub-task item')).toBeInTheDocument();

        const select = document.querySelector('[role="combobox"]') as HTMLElement | null;
        if (select) {
            fireEvent.mouseDown(select);
            await waitFor(() => screen.getByText('Sub-tasks'));
            fireEvent.click(screen.getByText('Sub-tasks'));
        }
        // After filtering, the task should be gone, the sub-task visible
        await waitFor(() => {
            expect(screen.queryByText('Task item')).not.toBeInTheDocument();
        });
        expect(screen.getByText('Sub-task item')).toBeInTheDocument();
    });
});
