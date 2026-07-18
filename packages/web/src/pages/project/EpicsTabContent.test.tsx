import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { EpicsTabContent } from './EpicsTabContent.js';
import type { IEpicListItem, IProject, IAgent } from '@atlas/shared';

function makeEpic(overrides: Partial<IEpicListItem> = {}): IEpicListItem {
    return {
        id: 'epic-1',
        project_id: 'proj-1',
        title: 'Epic One',
        status: 'draft',
        priority: 'medium',
        agent_id: null,
        story_count: 0,
        bug_count: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        ...overrides,
    } as IEpicListItem;
}

const stubProject: IProject = makeProject({ id: 'proj-1', name: 'Test Project' });

const stubAgent: IAgent = {
    id: 'agent-1',
    name: 'Agent X',
    accent_color: '#22c55e',
} as IAgent;

describe('EpicsTabContent', () => {
    it('shows singular "epic" for a single item', () => {
        renderWithProviders(
            <EpicsTabContent
                projectId="proj-1"
                epics={[makeEpic()]}
                projects={[stubProject]}
                agents={[stubAgent]}
                ownerName="owner"
                ownerAccent="#3b82f6"
            />,
        );
        expect(screen.getByText('1')).toBeInTheDocument();
        // singular
        expect(screen.getByText(/\bepic\b in this project/i)).toBeInTheDocument();
    });

    it('shows plural "epics" for multiple items', () => {
        renderWithProviders(
            <EpicsTabContent
                projectId="proj-1"
                epics={[makeEpic({ id: 'e1' }), makeEpic({ id: 'e2' })]}
                projects={[stubProject]}
                agents={[stubAgent]}
                ownerName="owner"
                ownerAccent="#3b82f6"
            />,
        );
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText(/epics in this project/i)).toBeInTheDocument();
    });

    it('shows zero epics count (0 as span, epics as text)', () => {
        renderWithProviders(
            <EpicsTabContent
                projectId="proj-1"
                epics={[]}
                projects={[stubProject]}
                agents={[stubAgent]}
                ownerName="owner"
                ownerAccent="#3b82f6"
            />,
        );
        // Count "0" is in a child <span>, the word "epics" is outside it
        // Use getAllByText and check the parent contains both
        const countSpan = screen.getByText('0');
        expect(countSpan).toBeInTheDocument();
        // The containing text includes "epics"
        expect(screen.getByText(/epics in this project/i)).toBeInTheDocument();
    });

    it('shows Open in Epics link', () => {
        renderWithProviders(
            <EpicsTabContent
                projectId="proj-1"
                epics={[]}
                projects={[stubProject]}
                agents={[stubAgent]}
                ownerName="owner"
                ownerAccent="#3b82f6"
            />,
        );
        expect(screen.getByText('Open in Epics')).toBeInTheDocument();
    });
});
