import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject, makeTaskListItem } from '../../test-utils/factories.js';
import { TasksTabContent } from './TasksTabContent.js';
import type { IProject, IAgent } from '@atlas/shared';

const stubProject: IProject = makeProject({ id: 'proj-1', name: 'Test Project' });

const stubAgent: IAgent = {
    id: 'agent-1',
    name: 'Agent X',
    accent_color: '#22c55e',
} as IAgent;

describe('TasksTabContent', () => {
    it('shows singular "task" for a single item', () => {
        renderWithProviders(
            <TasksTabContent
                projectId="proj-1"
                tasks={[makeTaskListItem({ project_id: 'proj-1' })]}
                projects={[stubProject]}
                agents={[stubAgent]}
                ownerName="owner"
                ownerAccent="#3b82f6"
            />,
        );
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText(/\btask\b in this project/i)).toBeInTheDocument();
    });

    it('shows plural "tasks" for multiple items', () => {
        renderWithProviders(
            <TasksTabContent
                projectId="proj-1"
                tasks={[
                    makeTaskListItem({ id: 't1', project_id: 'proj-1' }),
                    makeTaskListItem({ id: 't2', project_id: 'proj-1' }),
                ]}
                projects={[stubProject]}
                agents={[stubAgent]}
                ownerName="owner"
                ownerAccent="#3b82f6"
            />,
        );
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText(/tasks in this project/i)).toBeInTheDocument();
    });

    it('shows zero tasks count', () => {
        renderWithProviders(
            <TasksTabContent
                projectId="proj-1"
                tasks={[]}
                projects={[stubProject]}
                agents={[stubAgent]}
                ownerName="owner"
                ownerAccent="#3b82f6"
            />,
        );
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.getByText(/tasks in this project/i)).toBeInTheDocument();
    });

    it('links to the Tasks page filtered by project name', () => {
        renderWithProviders(
            <TasksTabContent
                projectId="proj-1"
                tasks={[]}
                projects={[stubProject]}
                agents={[stubAgent]}
                ownerName="owner"
                ownerAccent="#3b82f6"
            />,
        );
        expect(screen.getByText('Open in Tasks').closest('a')).toHaveAttribute(
            'href',
            '/tasks?project=Test%20Project',
        );
    });
});
