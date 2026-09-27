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
            <ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd="" />
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders empty agents message when activeAgents is empty (line 96)', () => {
        renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd="" />);
        expect(screen.getByText(/No agents assigned to this project yet/i)).toBeInTheDocument();
    });

    it('renders agent chips when activeAgents is non-empty (lines 100-132)', () => {
        const agent = makeAgent({ name: 'Coder', designation: 'Software Dev' });
        renderWithProviders(
            <ProjectRightRail projectId="p1" activeAgents={[agent]} guardrailsMd="" />
        );
        // AgentChip renders in the active agents list
        expect(screen.getByText('Coder')).toBeInTheDocument();
    });

    it('shows "No rules set yet" when guardrailsMd is empty (line 165-168)', () => {
        renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd="" />);
        expect(screen.getByText(/No rules set yet/i)).toBeInTheDocument();
    });

    it('shows headingPreview when guardrailsMd has ## headings (lines 170-184)', () => {
        const guardrailsMd = '## Be concise\n## Stay focused\nSome content below.';
        renderWithProviders(
            <ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd={guardrailsMd} />
        );
        // headingPreview is "## Be concise  ## Stay focused"
        expect(screen.getByText(/Be concise/)).toBeInTheDocument();
    });

    it('shows "Editor open in the Guard-rails tab" when guardrailsMd has content but no ## headings (lines 185-190)', () => {
        // hasGuardrails = true, headingPreview = '' (no ## lines)
        const guardrailsMd = 'Some guardrail content without headings.';
        renderWithProviders(
            <ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd={guardrailsMd} />
        );
        expect(screen.getByText(/Editor open in the Guard-rails tab/i)).toBeInTheDocument();
    });

    it('calls onEditGuardrails when "Edit" button is clicked (line 142)', () => {
        const onEditGuardrails = vi.fn();
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                guardrailsMd=""
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
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd="" />);
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
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd="" />);
            expect(await screen.findByText('No workflow runs in the last 30 days.')).toBeInTheDocument();
            expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
        });

        it('says "run" for a single run', async () => {
            serve({ ...HEALTH, runs: 1 });
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd="" />);
            expect(await screen.findByText('From 1 workflow run started in the last 30 days.')).toBeInTheDocument();
        });

        it('shows a dash for escalations before the park history existed', async () => {
            serve({ ...HEALTH, escalations: { items: 0, pauses: 0, since: null } });
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd="" />);
            await screen.findByText('3 of 5');
            const row = screen.getByText('Tasks that needed you').parentElement as HTMLElement;
            expect(row).toHaveTextContent('—');
        });

        it('says so when the numbers could not load', async () => {
            serve(null);
            renderWithProviders(<ProjectRightRail projectId="p1" activeAgents={[]} guardrailsMd="" />);
            expect(await screen.findByText(/Could not load/)).toBeInTheDocument();
        });
    });
});
