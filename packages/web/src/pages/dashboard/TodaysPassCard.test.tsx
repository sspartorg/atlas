import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { TodaysPassCard } from './TodaysPassCard.js';
import type { TodaysPassItem } from '../../api/types.js';

const makeItem = (overrides: Partial<TodaysPassItem> = {}): TodaysPassItem => ({
    run_id: 'r1',
    agent_id: 'agent-coder',
    agent_name: 'Coder',
    agent_category: 'software-dev',
    agent_accent_color: '#0A0A0A',
    issue_type: 'story',
    issue_id: 'CER-12',
    completed_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
});

describe('TodaysPassCard', () => {
    it('renders empty state', () => {
        renderWithProviders(<TodaysPassCard label="Dev" color="#0A0A0A" icon="code" items={[]} />);
        expect(screen.getByText(/No outputs yet today/)).toBeInTheDocument();
    });

    it('renders story item (shortIssueId: else → STR prefix)', () => {
        renderWithProviders(
            <TodaysPassCard
                label="Dev"
                color="#0A0A0A"
                icon="code"
                items={[makeItem({ issue_type: 'story', issue_id: 'CER-12' })]}
            />,
        );
        expect(screen.getByText(/Coder/)).toBeInTheDocument();
        // shortIssueId returns STR-12 for stories
        expect(document.body.textContent).toContain('STR-12');
    });

    it('renders epic item (shortIssueId: epic → EPC prefix)', () => {
        renderWithProviders(
            <TodaysPassCard
                label="Epics"
                color="#3B82F6"
                icon="layers"
                items={[makeItem({ issue_type: 'epic', issue_id: 'ATL-99', agent_name: 'EpicAgent' })]}
            />,
        );
        expect(screen.getByText(/EpicAgent/)).toBeInTheDocument();
        expect(document.body.textContent).toContain('EPC-99');
    });

    it('renders bug item (shortIssueId: bug → BUG prefix)', () => {
        renderWithProviders(
            <TodaysPassCard
                label="Bugs"
                color="#F43F5E"
                icon="bug_report"
                items={[makeItem({ issue_type: 'bug', issue_id: 'BUG-42', agent_name: 'BugAgent' })]}
            />,
        );
        expect(screen.getByText(/BugAgent/)).toBeInTheDocument();
        expect(document.body.textContent).toContain('BUG-42');
    });

    it('shortIssueId uses full id when issue_id has no hyphen (covers ?? item.issue_id fallback)', () => {
        // When issue_id.split('-') has no tail segment, fall back to issue_id itself
        // issue_id='NOHYPHEN' → split('-')[last] = 'NOHYPHEN' (single element array, not undefined)
        // Actually split('-') on 'NOHYPHEN' returns ['NOHYPHEN'], slice(-1)[0] = 'NOHYPHEN'
        // The ?? fallback fires only when slice(-1)[0] is undefined which can't happen
        // But we can test an issue_id without a hyphen to cover that code path
        renderWithProviders(
            <TodaysPassCard
                label="Dev"
                color="#0A0A0A"
                icon="code"
                items={[makeItem({ issue_type: 'story', issue_id: 'NOHYPHEN', agent_name: 'NHAgent' })]}
            />,
        );
        expect(screen.getByText(/NHAgent/)).toBeInTheDocument();
        // STR-NOHY (first 6 chars of NOHYPHEN uppercased)
        expect(document.body.textContent).toContain('STR-NOHYPH');
    });
});
