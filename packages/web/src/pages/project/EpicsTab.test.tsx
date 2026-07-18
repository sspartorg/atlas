import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeEpicListItem, makeProject } from '../../test-utils/factories.js';
import { EpicsTab } from './EpicsTab.js';

describe('EpicsTab', () => {
    it('renders the supplied epics and the row count summary', async () => {
        renderWithProviders(
            <EpicsTab
                projectId="p1"
                epics={[makeEpicListItem({ id: 'EPC-1', title: 'Epic one' })]}
                projects={[makeProject({ id: 'p1' })]}
                agents={[]}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
            />,
        );
        // After useDeferredMount flips ready the summary line interpolates
        // the actual row count (1).
        await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
        expect(screen.getByText(/epic in this project/)).toBeInTheDocument();
    });

    it('renders skeleton elements when epics is undefined', () => {
        const { container } = renderWithProviders(
            <EpicsTab
                projectId="p1"
                epics={undefined}
                projects={[]}
                agents={[]}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
            />,
        );
        // EpicsTabSkeleton renders MUI Skeleton components
        const skeletons = container.querySelectorAll('.MuiSkeleton-root');
        expect(skeletons.length).toBeGreaterThan(0);
    });
});
