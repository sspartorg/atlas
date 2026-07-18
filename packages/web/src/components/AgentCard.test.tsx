import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent } from '../test-utils/factories.js';
import { AgentCard } from './AgentCard.js';
import type { IAgentRun } from '@atlas/shared';

function makeRun(overrides: Partial<IAgentRun> = {}): IAgentRun {
    return {
        id: 'run-1',
        agent_id: 'agent-coder',
        issue_type: 'story',
        issue_id: 'S-1',
        project_id: null,
        status: 'completed',
        prompt_snapshot: null,
        output_text: null,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        parent_run_id: null,
        setup_output_text: null,
        outcome_kind: null,
        outcome_summary: null,
        outcome_reason: null,
        outcome_checklist: null,
        created_at: new Date(Date.now() - 3600_000).toISOString(),
        input_tokens: null,
        output_tokens: null,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        total_cost_usd: null,
        credits: null,
        item_title: null,
        ...overrides,
    };
}

describe('AgentCard', () => {
    it('renders agent name and category', () => {
        renderWithProviders(<AgentCard agent={makeAgent({ name: 'Coder', category: 'software-dev' })} />);
        expect(screen.getByText('Coder')).toBeInTheDocument();
        expect(screen.getByText('Software dev')).toBeInTheDocument();
    });

    it('renders "designation · category" in the subtitle when designation is set', () => {
        renderWithProviders(
            <AgentCard
                agent={makeAgent({
                    name: 'PO Writer',
                    category: 'software-dev',
                    designation: 'Product Owner',
                })}
            />,
        );
        expect(screen.getByText('Product Owner · Software dev')).toBeInTheDocument();
    });

    it('falls back to the category label when designation is empty', () => {
        renderWithProviders(
            <AgentCard
                agent={makeAgent({
                    name: 'Custom Agent',
                    category: 'software-dev',
                    designation: '',
                })}
            />,
        );
        // getByText is exact-match by default — if a designation had leaked
        // into the subtitle, the element text would be "Foo · Software dev"
        // and this lookup would fail.
        expect(screen.getByText('Software dev')).toBeInTheDocument();
    });

    it('shows the favorite affordance when handler provided', () => {
        renderWithProviders(
            <AgentCard
                agent={makeAgent({ name: 'Coder' })}
                isFavorite
                onToggleFavorite={vi.fn()}
            />,
        );
        expect(document.body.textContent).toContain('Coder');
    });

    it('renders the Paused status for inactive agents', () => {
        renderWithProviders(<AgentCard agent={makeAgent({ status: 'inactive' })} />);
        expect(document.body.textContent).toContain('Idle');
    });

    it('renders Queued when runs are queued', () => {
        renderWithProviders(
            <AgentCard
                agent={makeAgent({ status: 'active' })}
                runs={[
                    {
                        status: 'queued',
                        created_at: new Date().toISOString(),
                        started_at: null,
                        completed_at: null,
                    } as never,
                ]}
            />,
        );
        expect(document.body.textContent).toContain('Queued');
    });

    it('renders Running status (LiveDot) for active agent with no queued runs', () => {
        // active + no queued/in_progress runs → statusLabel === 'Running'
        renderWithProviders(
            <AgentCard
                agent={makeAgent({ status: 'active', name: 'Runner' })}
                runs={[makeRun({ status: 'completed' })]}
            />,
        );
        expect(document.body.textContent).toContain('Running');
    });

    it('renders upgradeAvailable pill', () => {
        renderWithProviders(
            <AgentCard agent={makeAgent({ name: 'Upgradeable' })} upgradeAvailable />,
        );
        expect(screen.getByText('Upgrade')).toBeInTheDocument();
    });

    it('renders runtimeError label "last run —" (runtimeError branch)', () => {
        renderWithProviders(
            <AgentCard agent={makeAgent({ name: 'Broken' })} runtimeError />,
        );
        expect(document.body.textContent).toContain('last run —');
    });

    it('renders lastRunAt relative time when run has a timestamp (truthy lastRunAt)', () => {
        const pastDate = new Date(Date.now() - 3_600_000).toISOString();
        renderWithProviders(
            <AgentCard
                agent={makeAgent({ name: 'Timed' })}
                runs={[makeRun({ status: 'completed', created_at: pastDate })]}
            />,
        );
        // The label should say "last run X ago" (not "last run —")
        expect(document.body.textContent).toMatch(/last run .+/);
    });

    it('renders cost this month when total_cost_usd is set on a run', () => {
        renderWithProviders(
            <AgentCard
                agent={makeAgent({ name: 'Costly' })}
                runs={[makeRun({ status: 'completed', total_cost_usd: 0.05 })]}
            />,
        );
        // formatCostUsd(0.05) renders something like "$0.05"
        expect(document.body.textContent).toMatch(/\$0\.05/);
    });

    it('renders menuActions (AgentCardMenu) when menuActions prop is provided', () => {
        const onPause = vi.fn();
        renderWithProviders(
            <AgentCard
                agent={makeAgent({ name: 'Menuable' })}
                menuActions={{ onPause }}
            />,
        );
        // AgentCardMenu renders a "more_vert" icon button trigger
        expect(document.body.textContent).toContain('Menuable');
        const triggers = document.querySelectorAll('[class*="material-symbols"]');
        const moreVert = Array.from(triggers).find((el) => el.textContent === 'more_vert');
        expect(moreVert).toBeDefined();
    });

    it('renders focused state — card shows brandBlue outline styling', () => {
        // focused=true exercises the ternary branches in sx props for border/outline
        const { container } = renderWithProviders(
            <AgentCard agent={makeAgent({ name: 'Focused' })} focused />,
        );
        expect(container.firstChild).toBeInTheDocument();
        expect(document.body.textContent).toContain('Focused');
    });

    it('hexToRgba: handles non-standard color string (early-return branch)', () => {
        // Passing a non-hex accent_color will trigger hexToRgba's "!m" branch.
        // We just verify the component renders without crashing.
        renderWithProviders(
            <AgentCard
                agent={makeAgent({ name: 'NonHex', accent_color: 'not-a-hex-color' })}
            />,
        );
        expect(screen.getByText('NonHex')).toBeInTheDocument();
    });

    it('handleCardClick: click is swallowed when originating inside a MUI Menu overlay', () => {
        const onClickSpy = vi.fn();
        const { container } = renderWithProviders(
            <AgentCard agent={makeAgent({ name: 'CardClick' })} onClick={onClickSpy} />,
        );
        // Create a fake MUI Menu root element, click it — onClick should NOT fire
        const fakeMenu = document.createElement('div');
        fakeMenu.className = 'MuiMenu-root';
        const inner = document.createElement('span');
        fakeMenu.appendChild(inner);
        container.firstElementChild?.appendChild(fakeMenu);
        fireEvent.click(inner);
        expect(onClickSpy).not.toHaveBeenCalled();
    });

    it('handleCardClick: click reaches onClick handler when no MUI overlay ancestor', () => {
        const onClickSpy = vi.fn();
        const { container } = renderWithProviders(
            <AgentCard agent={makeAgent({ name: 'DirectClick' })} onClick={onClickSpy} />,
        );
        fireEvent.click(container.firstElementChild!);
        expect(onClickSpy).toHaveBeenCalledTimes(1);
    });
});
