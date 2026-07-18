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
                    open_epics: 3,
                    epics_ready: 1,
                    stories_in_flight: 5,
                    stories_waiting_info: 2,
                    open_bugs: 2,
                    bugs_ready: 0,
                }}
                projectId="p1"
                onJumpToHistory={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });
});
