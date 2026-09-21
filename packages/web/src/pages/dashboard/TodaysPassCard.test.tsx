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
    issue_type: 'sub_task',
    issue_id: 'ATL-12',
    completed_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
});

const COLOR = { border: '#A5B4FC', fg: '#312E81' };

describe('TodaysPassCard', () => {
    it('renders empty state', () => {
        renderWithProviders(<TodaysPassCard label="Dev" color={COLOR} icon="code" items={[]} />);
        expect(screen.getByText(/No outputs yet today/)).toBeInTheDocument();
    });

    // The pale border shade fails WCAG contrast as 11px text; the label
    // uses the palette's fg shade instead.
    it('draws the label in the readable fg shade', () => {
        renderWithProviders(<TodaysPassCard label="Dev" color={COLOR} icon="code" items={[]} />);
        expect(screen.getByText('Dev')).toHaveStyle({ color: '#312E81' });
    });

    it.each([
        ['sub_task', 'SDB-4'],
        ['task', 'ATL-99'],
    ] as const)('renders the real %s id %s', (issue_type, issue_id) => {
        renderWithProviders(
            <TodaysPassCard
                label="Dev"
                color={COLOR}
                icon="code"
                items={[makeItem({ issue_type, issue_id })]}
            />
        );
        expect(screen.getByText(/Coder/)).toBeInTheDocument();
        expect(screen.getByText(issue_id)).toBeInTheDocument();
    });
});
