import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeTaskListItem, makeProject } from '../../test-utils/factories.js';
import { TasksTab } from './TasksTab.js';

describe('TasksTab', () => {
    it('renders the supplied tasks and the row count summary', async () => {
        renderWithProviders(
            <TasksTab
                projectId="p1"
                tasks={[makeTaskListItem({ id: 'TSK-1', title: 'Task one' })]}
                projects={[makeProject({ id: 'p1' })]}
                agents={[]}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
            />
        );
        // After useDeferredMount flips ready the summary line interpolates
        // the actual row count (1).
        await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
        expect(screen.getByText(/task in this project/)).toBeInTheDocument();
    });

    it('renders skeleton elements when tasks is undefined', () => {
        const { container } = renderWithProviders(
            <TasksTab
                projectId="p1"
                tasks={undefined}
                projects={[]}
                agents={[]}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
            />
        );
        const skeletons = container.querySelectorAll('.MuiSkeleton-root');
        expect(skeletons.length).toBeGreaterThan(0);
    });
});
