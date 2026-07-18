import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ProjectCostBars } from './_ProjectCostBars.js';

describe('ProjectCostBars', () => {
    it('renders one row per project, with name and combined cost', () => {
        renderWithProviders(
            <ProjectCostBars
                byProject={[
                    { project_id: 'p1', project_name: 'Atlas', total_cost_usd: 4.5, run_count: 12 },
                    { project_id: 'p2', project_name: 'Other', total_cost_usd: 1.25, run_count: 4 },
                ]}
                terminalByProject={[]}
                topProjectMax={4.5}
            />,
        );
        expect(screen.getByText('Atlas')).toBeInTheDocument();
        expect(screen.getByText('Other')).toBeInTheDocument();
        expect(screen.getByText(/12 runs?/)).toBeInTheDocument();
    });

    it('handles a project with null project_id (renders but not as a link)', () => {
        renderWithProviders(
            <ProjectCostBars
                byProject={[
                    { project_id: null, project_name: 'Unattached', total_cost_usd: 1.5, run_count: 0 },
                ]}
                terminalByProject={[]}
                topProjectMax={1.5}
            />,
        );
        expect(screen.getByText('Unattached')).toBeInTheDocument();
        // No <a> link because isClickable is false.
        const cells = screen.queryAllByRole('link');
        expect(cells.length).toBe(0);
    });

    it('singularizes the sub-text for one project', () => {
        renderWithProviders(
            <ProjectCostBars
                byProject={[
                    { project_id: 'p1', project_name: 'Atlas', total_cost_usd: 1, run_count: 1 },
                ]}
                terminalByProject={[]}
                topProjectMax={1}
            />,
        );
        expect(screen.getByText(/1 project /)).toBeInTheDocument();
    });

    it('merges terminal-only projects (no agent runs) into the bar list', () => {
        // Project p3 has zero agent cost but non-zero terminal cost.
        // The component should still surface it (with a terminal-only bar)
        // because the user spent money there this month.
        renderWithProviders(
            <ProjectCostBars
                byProject={[]}
                terminalByProject={[
                    { project_id: 'p3', project_name: 'TerminalOnly', total_cost_usd: 2.5, session_count: 3 },
                ]}
                topProjectMax={0}
            />,
        );
        expect(screen.getByText('TerminalOnly')).toBeInTheDocument();
        // Session count surfaced in the sub-text.
        expect(screen.getByText(/3 term/)).toBeInTheDocument();
    });

    it('renders the empty-state when both byProject and terminalByProject are empty', () => {
        renderWithProviders(
            <ProjectCostBars
                byProject={[]}
                terminalByProject={[]}
                topProjectMax={0}
            />,
        );
        expect(screen.getByText(/No project spend this month/i)).toBeInTheDocument();
    });

    it('shows combined cost when a project has both agent + terminal spend', () => {
        renderWithProviders(
            <ProjectCostBars
                byProject={[
                    { project_id: 'p1', project_name: 'Atlas', total_cost_usd: 4.0, run_count: 8 },
                ]}
                terminalByProject={[
                    { project_id: 'p1', project_name: 'Atlas', total_cost_usd: 1.5, session_count: 2 },
                ]}
                topProjectMax={4.0}
            />,
        );
        // Combined total = 4 + 1.5 = 5.50
        expect(screen.getByText('$5.50')).toBeInTheDocument();
        // Sub-text now mentions both runs and terminal sessions.
        expect(screen.getByText(/8 runs/)).toBeInTheDocument();
        expect(screen.getByText(/2 term/)).toBeInTheDocument();
    });

    it('merges terminal-only project with null project_id via name key', () => {
        // When terminal project has project_id=null, mergeByProject falls
        // back to a __name: key — the null-coalescing branch on line 55.
        // Render with a byProject entry that has a different name so there
        // is no key collision; the terminal-only null-id project must still
        // surface as a separate bar.
        renderWithProviders(
            <ProjectCostBars
                byProject={[
                    { project_id: 'p1', project_name: 'AgentOnly', total_cost_usd: 2.0, run_count: 5 },
                ]}
                terminalByProject={[
                    { project_id: null, project_name: 'NoIdTerminal', total_cost_usd: 1.0, session_count: 2 },
                ]}
                topProjectMax={2.0}
            />,
        );
        // Both bars must render.
        expect(screen.getByText('AgentOnly')).toBeInTheDocument();
        expect(screen.getByText('NoIdTerminal')).toBeInTheDocument();
        // Terminal-only row shows session count, not run count.
        expect(screen.getByText(/2 term/)).toBeInTheDocument();
    });
});
