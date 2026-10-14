import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { makeAgent } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { FleetStrip } from './FleetStrip.js';

function runs(list: Array<{ agent_id: string; status: string }>) {
    server.use(http.get('http://localhost:3000/api/run', () => HttpResponse.json(list)));
}

const agents = (n: number) =>
    Array.from({ length: n }, (_, i) => makeAgent({ id: `a${i}`, name: `Agent ${i}` }));

describe('FleetStrip', () => {
    it('reads idle: every agent a quiet dot, no live runs, the month spend', () => {
        runs([]);
        renderWithProviders(
            <FleetStrip
                agents={agents(3)}
                liveCount={0}
                spend={{ usd: 14.99, runs: 75, tokens: 16_900_000 }}
            />
        );
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: '0 of 3 agents working' })).toBeInTheDocument();
        expect(screen.getByText('all idle')).toBeInTheDocument();
        expect(screen.getByText('runs live')).toBeInTheDocument();
        expect(screen.getByText('All quiet right now')).toBeInTheDocument();
        expect(screen.getByText('$14.99')).toBeInTheDocument();
        expect(screen.getByText('75 runs, 16.9M tokens')).toBeInTheDocument();
    });

    it('lights working agents and the live count', async () => {
        runs([{ agent_id: 'a1', status: 'in_progress' }]);
        renderWithProviders(<FleetStrip agents={agents(3)} liveCount={1} spend={null} />);
        expect(await screen.findByText('1 working')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: '1 of 3 agents working' })).toBeInTheDocument();
        expect(screen.getByText('run live')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: '1 live' })).toBeInTheDocument();
        expect(screen.getByText('—')).toBeInTheDocument();
        expect(screen.getByText('No spend yet this month')).toBeInTheDocument();
    });

    it('caps the dot row and counts the rest', () => {
        runs([]);
        renderWithProviders(<FleetStrip agents={agents(45)} liveCount={0} spend={null} />);
        expect(screen.getByText('+5')).toBeInTheDocument();
    });
});
