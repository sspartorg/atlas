import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import type { ProjectHealth } from '../../api/types.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { ProjectRightRail } from './ProjectRightRail.js';

describe('ProjectRightRail', () => {
    it('mounts without crashing', () => {
        const { container } = renderWithProviders(
            <ProjectRightRail projectId="p1" activeAgents={[]} activeRuleTitles={[]} />
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders empty agents message when activeAgents is empty (line 96)', () => {
        renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} activeRuleTitles={[]} />);
        expect(screen.getByText(/No agents assigned to this project yet/i)).toBeInTheDocument();
    });

    it('renders agent chips when activeAgents is non-empty (lines 100-132)', () => {
        const agent = makeAgent({ name: 'Coder', designation: 'Software Dev' });
        renderWithProviders(
            <ProjectRightRail projectId="p1" activeAgents={[agent]} activeRuleTitles={[]} />
        );
        // AgentChip renders in the active agents list
        expect(screen.getByText('Coder')).toBeInTheDocument();
    });

    it('says there are no active rules when the project has none', () => {
        renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} activeRuleTitles={[]} />);
        expect(screen.getByText('No active rules.')).toBeInTheDocument();
    });

    it("lists the project's active rule titles, not the legacy guardrails_md", () => {
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                activeRuleTitles={['Be concise', 'Stay focused']}
            />
        );
        expect(screen.getByText('Be concise · Stay focused')).toBeInTheDocument();
        expect(screen.queryByText(/No active rules/)).toBeNull();
        expect(screen.queryByText(/Editor open/)).toBeNull();
    });

    it('calls onEditGuardrails when "Edit" button is clicked (line 142)', () => {
        const onEditGuardrails = vi.fn();
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                activeRuleTitles={[]}
                onEditGuardrails={onEditGuardrails}
            />
        );
        const editBtn = screen.getByText(/Edit/);
        fireEvent.click(editBtn);
        expect(onEditGuardrails).toHaveBeenCalled();
    });
    describe('Health card', () => {
        const BASE = 'http://localhost:3000/api';
        const HEALTH: ProjectHealth = {
            window: { since: '2026-08-28T00:00:00Z' },
            runs: 6,
            prs_opened: 5,
            prs_merged: 3,
            tasks_merged: 2,
            median_s_to_pr: 1800,
            specs: { reviewed: 4, accepted_first_try: 1 },
            escalations: { items: 2, pauses: 3, since: '2026-09-27T00:00:00Z' },
        };
        const serve = (body: ProjectHealth | null) =>
            server.use(
                http.get(`${BASE}/projects/p1/health`, () =>
                    body ? HttpResponse.json(body) : HttpResponse.json({ error: 'boom' }, { status: 500 })
                )
            );

        it('shows the numbers with their denominators, and no stub marker', async () => {
            serve(HEALTH);
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} activeRuleTitles={[]} />);
            expect(await screen.findByText('3 of 5')).toBeInTheDocument();
            expect(screen.getByText('1 of 4')).toBeInTheDocument();
            expect(screen.getByText('30m')).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
            expect(screen.getByText('From 6 workflow runs started in the last 30 days.')).toBeInTheDocument();
            expect(screen.queryByText(/stubbed/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/%/)).not.toBeInTheDocument();
        });

        it('says a quiet project had no runs, with dashes rather than zeros of zero', async () => {
            serve({ ...HEALTH, runs: 0, prs_opened: 0, prs_merged: 0, median_s_to_pr: null, specs: { reviewed: 0, accepted_first_try: 0 } });
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} activeRuleTitles={[]} />);
            expect(await screen.findByText('No workflow runs in the last 30 days.')).toBeInTheDocument();
            expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
        });

        it('says "run" for a single run', async () => {
            serve({ ...HEALTH, runs: 1 });
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} activeRuleTitles={[]} />);
            expect(await screen.findByText('From 1 workflow run started in the last 30 days.')).toBeInTheDocument();
        });

        it('shows a dash for escalations before the park history existed', async () => {
            serve({ ...HEALTH, escalations: { items: 0, pauses: 0, since: null } });
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} activeRuleTitles={[]} />);
            await screen.findByText('3 of 5');
            const row = screen.getByText('Tasks that needed you').parentElement as HTMLElement;
            expect(row).toHaveTextContent('—');
        });

        it('says so when the numbers could not load', async () => {
            serve(null);
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} activeRuleTitles={[]} />);
            expect(await screen.findByText(/Could not load/)).toBeInTheDocument();
        });
    });
});
