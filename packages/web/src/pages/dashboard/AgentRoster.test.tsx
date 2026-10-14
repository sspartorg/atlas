import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { makeAgent } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentRoster, fitRows } from './AgentRoster.js';

const STACKED = { fill: false, expanded: false, onToggleExpanded: () => {} };

function runs(list: Array<{ agent_id: string; status: string }>) {
    server.use(http.get('http://localhost:3000/api/run', () => HttpResponse.json(list)));
}

describe('AgentRoster', () => {
    it('groups active agents by category and hides inactive ones', () => {
        runs([]);
        renderWithProviders(
            <AgentRoster
                {...STACKED}
                agents={[
                    makeAgent({ id: 'a1', name: 'Coder', category: 'software-dev' }),
                    makeAgent({ id: 'a2', name: 'Copywriter', category: 'marketing' }),
                    makeAgent({
                        id: 'a3',
                        name: 'Retired',
                        category: 'marketing',
                        status: 'inactive',
                    }),
                ]}
            />
        );
        expect(screen.getByRole('heading', { name: 'Software dev' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Marketing' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Design' })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Coder/ })).toHaveAttribute('href', '/agents/a1');
        expect(screen.queryByText('Retired')).not.toBeInTheDocument();
    });

    it('lists working agents first and counts them', async () => {
        runs([{ agent_id: 'a2', status: 'in_progress' }]);
        renderWithProviders(
            <AgentRoster
                {...STACKED}
                agents={[
                    makeAgent({ id: 'a1', name: 'Alpha', category: 'software-dev' }),
                    makeAgent({ id: 'a2', name: 'Zulu', category: 'software-dev' }),
                ]}
            />
        );
        expect(await screen.findByText('1 of 2 working')).toBeInTheDocument();
        const names = within(screen.getByRole('list'))
            .getAllByRole('link')
            .map((l) => l.textContent);
        expect(names[0]).toContain('Zulu');
    });

    it('previews six agents when stacked and asks to expand', async () => {
        runs([]);
        const agents = Array.from({ length: 9 }, (_, i) =>
            makeAgent({ id: `a${i}`, name: `Agent ${i}`, category: 'software-dev' })
        );
        let toggled = 0;
        renderWithProviders(
            <AgentRoster {...STACKED} agents={agents} onToggleExpanded={() => toggled++} />
        );
        expect(screen.getAllByRole('listitem')).toHaveLength(6);
        await userEvent.click(screen.getByRole('button', { name: 'Show all 9' }));
        expect(toggled).toBe(1);
    });

    it('lists every agent when expanded', () => {
        runs([]);
        const agents = Array.from({ length: 9 }, (_, i) =>
            makeAgent({ id: `a${i}`, name: `Agent ${i}`, category: 'software-dev' })
        );
        renderWithProviders(<AgentRoster {...STACKED} expanded agents={agents} />);
        expect(screen.getAllByRole('listitem')).toHaveLength(9);
        expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
            'aria-expanded',
            'true'
        );
    });

    it('points to the Marketplace when there are no active agents', () => {
        runs([]);
        renderWithProviders(<AgentRoster {...STACKED} agents={[]} />);
        expect(
            screen.getByRole('link', { name: /Install agents from the Marketplace/ })
        ).toHaveAttribute('href', '/agents/marketplace');
    });
});

describe('fitRows', () => {
    it('fills the height group by group, header first', () => {
        // 300px: header 50 + 6 rows of 40 = 290 → the first group takes 6.
        expect(fitRows([10, 4], 300, Infinity, 40, 50)).toEqual([6, 0]);
        // Room for both groups: 50 + 2*40 + 50 + 3*40 = 300.
        expect(fitRows([2, 5], 300, Infinity, 40, 50)).toEqual([2, 3]);
    });

    it('never starts a group it cannot show a row of', () => {
        expect(fitRows([1, 5], 120, Infinity, 40, 50)).toEqual([1, 0]);
        expect(fitRows([3], 0, Infinity, 40, 50)).toEqual([0]);
    });

    it('caps the total rows', () => {
        expect(fitRows([4, 4], Infinity, 6, 40, 50)).toEqual([4, 2]);
    });
});
