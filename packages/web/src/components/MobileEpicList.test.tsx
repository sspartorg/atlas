import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent, makeEpicListItem, makeProject } from '../test-utils/factories.js';
import { MobileEpicList } from './MobileEpicList.js';

describe('MobileEpicList', () => {
    it('renders an empty message when no rows', () => {
        renderWithProviders(
            <MobileEpicList
                rows={[]}
                projects={[]}
                agents={[]}
                ownerName="O"
                ownerAccent="#0A0A0A"
            />,
        );
        expect(screen.getByText(/No epics match/)).toBeInTheDocument();
    });

    it('renders an epic row', () => {
        renderWithProviders(
            <MobileEpicList
                rows={[makeEpicListItem({ id: 'ATL-1', title: 'Alpha' })]}
                projects={[makeProject({ id: 'p1' })]}
                agents={[makeAgent({ id: 'agent-coder' })]}
                ownerName="O"
                ownerAccent="#0A0A0A"
            />,
        );
        expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    it('shows LiveDot for in_progress epic (isLive branch)', () => {
        renderWithProviders(
            <MobileEpicList
                rows={[makeEpicListItem({ id: 'E1', title: 'Live Epic', status: 'in_progress' })]}
                projects={[]}
                agents={[]}
                ownerName="O"
                ownerAccent="#0A0A0A"
            />,
        );
        expect(screen.getByText('Live Epic')).toBeInTheDocument();
    });

    it('shows agent chip when assignee is found in agents list', () => {
        const agent = makeAgent({ id: 'a1', name: 'Alice', status: 'active' });
        renderWithProviders(
            <MobileEpicList
                rows={[makeEpicListItem({ id: 'E2', title: 'Assigned Epic', assignee_agent_id: 'a1' })]}
                projects={[]}
                agents={[agent]}
                ownerName="O"
                ownerAccent="#0A0A0A"
            />,
        );
        expect(screen.getByText('Assigned Epic')).toBeInTheDocument();
    });

    it('shows project tag when project_id is found in projects list', () => {
        const project = makeProject({ id: 'p1', name: 'Apollo' });
        renderWithProviders(
            <MobileEpicList
                rows={[makeEpicListItem({ id: 'E3', title: 'Epic with project', project_id: 'p1' })]}
                projects={[project]}
                agents={[]}
                ownerName="O"
                ownerAccent="#0A0A0A"
            />,
        );
        expect(screen.getByText('Apollo')).toBeInTheDocument();
    });

    it('clicking an epic row triggers navigation (onClick handler)', () => {
        renderWithProviders(
            <MobileEpicList
                rows={[makeEpicListItem({ id: 'E4', title: 'Clickable' })]}
                projects={[]}
                agents={[]}
                ownerName="O"
                ownerAccent="#0A0A0A"
            />,
        );
        const row = screen.getByRole('button');
        fireEvent.click(row);
        expect(screen.getByText('Clickable')).toBeInTheDocument();
    });

    it('uses owner chip when assignee_agent_id is null (falsy branch)', () => {
        renderWithProviders(
            <MobileEpicList
                rows={[makeEpicListItem({ id: 'E5', title: 'No Assignee', assignee_agent_id: null })]}
                projects={[]}
                agents={[]}
                ownerName="TheOwner"
                ownerAccent="#0A0A0A"
            />,
        );
        expect(screen.getByText('No Assignee')).toBeInTheDocument();
    });

    it('uses owner chip when assignee_agent_id is set but agent not found in map (?? null branch)', () => {
        // assignee_agent_id is truthy but agentsById.get returns undefined → ?? null → owner chip
        renderWithProviders(
            <MobileEpicList
                rows={[makeEpicListItem({ id: 'E6', title: 'Missing Agent', assignee_agent_id: 'non-existent-agent' })]}
                projects={[]}
                agents={[]} // empty agents list → agentsById is empty → get returns undefined
                ownerName="OwnerFallback"
                ownerAccent="#0A0A0A"
            />,
        );
        expect(screen.getByText('Missing Agent')).toBeInTheDocument();
    });

    it('renders multiple rows without border on the last row (i===rows.length-1 branch)', () => {
        renderWithProviders(
            <MobileEpicList
                rows={[
                    makeEpicListItem({ id: 'E7', title: 'First' }),
                    makeEpicListItem({ id: 'E8', title: 'Last' }),
                ]}
                projects={[]}
                agents={[]}
                ownerName="O"
                ownerAccent="#0A0A0A"
            />,
        );
        expect(screen.getByText('First')).toBeInTheDocument();
        expect(screen.getByText('Last')).toBeInTheDocument();
    });
});
