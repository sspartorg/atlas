import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { OverviewTab } from './OverviewTab.js';

describe('Project OverviewTab', () => {
    it('mounts without crashing', () => {
        const { container } = renderWithProviders(
            <OverviewTab counts={undefined} projectId="p1"
                onJumpToHistory={vi.fn()} />,
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders KPI values from the supplied counts prop', async () => {
        renderWithProviders(
            <OverviewTab
                counts={{
                    open_tasks: 3,
                    tasks_ready: 1,
                    tasks_in_flight: 5,
                    tasks_waiting_info: 2,
                }}
                projectId="p1"
                onJumpToHistory={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('2 waiting info')).toBeInTheDocument();
    });
});
