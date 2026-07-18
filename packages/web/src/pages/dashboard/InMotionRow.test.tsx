import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { InMotionRow } from './InMotionRow.js';
import { makeAgent } from '../../test-utils/factories.js';

describe('InMotionRow', () => {
    it('renders title with agent', () => {
        renderWithProviders(
            <InMotionRow
                agent={makeAgent({ name: 'Coder' })}
                row={{
                    id: 'CER-1',
                    issue_type: 'story',
                    title: 'Build login',
                    status: 'in_progress',
                    updated_at: new Date(Date.now() - 60_000).toISOString(),
                    assignee_agent_id: 'agent-coder',
                    agent_name: 'Coder',
                    accent_color: '#0A0A0A',
                }}
            />,
        );
        expect(screen.getByText('Build login')).toBeInTheDocument();
    });

    it('falls back to row.agent_name when agent is undefined', () => {
        renderWithProviders(
            <InMotionRow
                agent={undefined}
                row={{
                    id: 'CER-2',
                    issue_type: 'bug',
                    title: 'Fallback name',
                    status: 'in_progress',
                    updated_at: new Date(Date.now() - 60_000).toISOString(),
                    assignee_agent_id: null,
                    agent_name: 'Unknown Agent',
                    accent_color: null,
                }}
            />,
        );
        expect(screen.getByText('Fallback name')).toBeInTheDocument();
        expect(screen.getByText('Unknown Agent')).toBeInTheDocument();
    });

    it('shows "Unassigned" when neither agent nor agent_name is present', () => {
        renderWithProviders(
            <InMotionRow
                agent={undefined}
                row={{
                    id: 'CER-3',
                    issue_type: 'epic',
                    title: 'No assignee',
                    status: 'in_progress',
                    updated_at: new Date(Date.now() - 60_000).toISOString(),
                    assignee_agent_id: null,
                    agent_name: null,
                    accent_color: null,
                }}
            />,
        );
        expect(screen.getByText('Unassigned')).toBeInTheDocument();
    });

    it('clicks the row to fire the navigate path (story)', () => {
        renderWithProviders(
            <InMotionRow
                agent={makeAgent()}
                row={{
                    id: 'ATL-9',
                    issue_type: 'story',
                    title: 'Clickable',
                    status: 'in_progress',
                    updated_at: new Date(Date.now() - 60_000).toISOString(),
                    assignee_agent_id: 'agent-coder',
                    agent_name: 'Coder',
                    accent_color: '#0A0A0A',
                }}
            />,
        );
        const title = screen.getByText('Clickable');
        fireEvent.click(title);
    });

    it('clicks the row to fire the navigate path (epic + sub_task + sub_bug + bug)', () => {
        const issueTypes = ['epic', 'sub_task', 'sub_bug', 'bug'] as const;
        for (const t of issueTypes) {
            const { unmount } = renderWithProviders(
                <InMotionRow
                    agent={makeAgent()}
                    row={{
                        id: `route-${t}`,
                        issue_type: t,
                        title: `Route ${t}`,
                        status: 'in_progress',
                        updated_at: new Date(Date.now() - 60_000).toISOString(),
                        assignee_agent_id: 'agent-coder',
                        agent_name: 'Coder',
                        accent_color: '#0A0A0A',
                    }}
                />,
            );
            const el = screen.getByText(`Route ${t}`);
            fireEvent.click(el);
            unmount();
        }
    });

    it('renders hour-level duration string', () => {
        renderWithProviders(
            <InMotionRow
                agent={makeAgent()}
                row={{
                    id: 'H-1',
                    issue_type: 'story',
                    title: 'Long runner',
                    status: 'in_progress',
                    updated_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
                    assignee_agent_id: 'agent-coder',
                    agent_name: 'Coder',
                    accent_color: '#0A0A0A',
                }}
            />,
        );
        expect(screen.getByText(/3 h running/)).toBeInTheDocument();
    });

    it('renders day-level duration string', () => {
        renderWithProviders(
            <InMotionRow
                agent={makeAgent()}
                row={{
                    id: 'D-1',
                    issue_type: 'story',
                    title: 'Day runner',
                    status: 'in_progress',
                    updated_at: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
                    assignee_agent_id: 'agent-coder',
                    agent_name: 'Coder',
                    accent_color: '#0A0A0A',
                }}
            />,
        );
        expect(screen.getByText(/2 d running/)).toBeInTheDocument();
    });

    it('handles invalid updated_at without crashing', () => {
        renderWithProviders(
            <InMotionRow
                agent={makeAgent()}
                row={{
                    id: 'X-1',
                    issue_type: 'story',
                    title: 'Bad date',
                    status: 'in_progress',
                    updated_at: 'invalid',
                    assignee_agent_id: 'agent-coder',
                    agent_name: 'Coder',
                    accent_color: '#0A0A0A',
                }}
            />,
        );
        expect(screen.getByText('Bad date')).toBeInTheDocument();
    });

    it('uses fallback glyph for unknown agent names', () => {
        renderWithProviders(
            <InMotionRow
                agent={makeAgent({ name: 'Unknown Glyph' })}
                row={{
                    id: 'X-2',
                    issue_type: 'story',
                    title: 'Glyphless',
                    status: 'in_progress',
                    updated_at: new Date(Date.now() - 60_000).toISOString(),
                    assignee_agent_id: 'agent-coder',
                    agent_name: 'Unknown Glyph',
                    accent_color: '#0A0A0A',
                }}
            />,
        );
        // The fallback glyph is 'smart_toy'.
        expect(screen.getByText('smart_toy')).toBeInTheDocument();
    });
});
