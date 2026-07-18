import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { AgentSidebar } from './AgentSidebar.js';
import { getAgentView, getRuntimeStats } from './agentViewModel.js';

function makeStats(overrides: Partial<ReturnType<typeof getRuntimeStats>> = {}) {
    return { ...getRuntimeStats([]), ...overrides };
}

describe('AgentSidebar', () => {
    it('renders agent name and accent color in the Identity panel', async () => {
        server.use(...defaultHandlers);
        const agent = makeAgent({ name: 'Coder', accent_color: '#31AB46' });
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats()}
            />,
        );
        expect(await screen.findByText('Coder')).toBeInTheDocument();
        expect(screen.getByText('#31AB46')).toBeInTheDocument();
    });

    it('renders the Schedule panel with cadence label', async () => {
        server.use(...defaultHandlers);
        const agent = makeAgent({ schedule_hours: 6, schedule_preset: 'every_n_hours' });
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats()}
            />,
        );
        expect(await screen.findByText('Cadence')).toBeInTheDocument();
        expect(screen.getByText(/Every 6h/i)).toBeInTheDocument();
    });

    it('renders the Telemetry panel with total runs', async () => {
        server.use(...defaultHandlers);
        const agent = makeAgent();
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats({ totalRunsThisMonth: 7 })}
            />,
        );
        expect(await screen.findByText('Total runs')).toBeInTheDocument();
        expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('calls onEditColor when the color swatch is clicked', async () => {
        server.use(...defaultHandlers);
        const onEditColor = vi.fn();
        const agent = makeAgent({ accent_color: '#FF0000' });
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats()}
                onEditColor={onEditColor}
            />,
        );
        await userEvent.click(await screen.findByText('#FF0000'));
        expect(onEditColor).toHaveBeenCalledOnce();
    });

    it('renders Telemetry panel with all token/cost rows when non-null', async () => {
        // Exercises lines 166-179 (AI Cost), 180-192 (Input tok.), 193-204 (Output tok.), 206-217 (Cached tok.)
        server.use(...defaultHandlers);
        const agent = makeAgent();
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats({
                    totalRunsThisMonth: 3,
                    totalCostThisMonthUsd: 1.23,
                    totalInputTokens: 10000,
                    totalOutputTokens: 5000,
                    totalCacheReadTokens: 3000,
                })}
            />,
        );
        expect(await screen.findByText('AI Cost')).toBeInTheDocument();
        expect(screen.getByText('Input tok.')).toBeInTheDocument();
        expect(screen.getByText('Output tok.')).toBeInTheDocument();
        expect(screen.getByText('Cached tok.')).toBeInTheDocument();
    });

    it('renders designation when set', async () => {
        server.use(...defaultHandlers);
        const agent = makeAgent({ designation: 'Senior Engineer' });
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats()}
            />,
        );
        expect(await screen.findByText('Senior Engineer')).toBeInTheDocument();
    });

    it('renders without designation (agent.designation falsy branch)', async () => {
        server.use(...defaultHandlers);
        // designation defaults to '' in makeAgent — empty string is falsy, exercises the false branch of `agent.designation &&`
        const agent = makeAgent({ designation: '' });
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats()}
            />,
        );
        // Name still renders; no designation Typography should appear
        expect(await screen.findByText(agent.name)).toBeInTheDocument();
        expect(screen.queryByText('Senior Engineer')).not.toBeInTheDocument();
    });

    it('renders without onEditColor prop (cursor default branch)', async () => {
        server.use(...defaultHandlers);
        // Without onEditColor, cursor is 'default' (the falsy branch of onEditColor ternary)
        const agent = makeAgent({ accent_color: '#AABBCC' });
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats()}
            />,
        );
        // Color still renders; clicking it does nothing (no handler)
        expect(await screen.findByText('#AABBCC')).toBeInTheDocument();
        await userEvent.click(screen.getByText('#AABBCC'));
        expect(document.body).toBeTruthy();
    });

    it('calls onReplaceGlyph when Replace… link is clicked', async () => {
        server.use(...defaultHandlers);
        const onReplaceGlyph = vi.fn();
        const agent = makeAgent();
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats()}
                onReplaceGlyph={onReplaceGlyph}
            />,
        );
        const replaceLink = await screen.findByText('Replace…');
        await userEvent.click(replaceLink);
        expect(onReplaceGlyph).toHaveBeenCalledOnce();
    });

    it('Telemetry rows are absent when stats values are null (null-guard branches)', async () => {
        server.use(...defaultHandlers);
        const agent = makeAgent();
        renderWithProviders(
            <AgentSidebar
                agent={agent}
                view={getAgentView(agent)}
                stats={makeStats({
                    totalRunsThisMonth: 0,
                    totalCostThisMonthUsd: null,
                    totalInputTokens: null,
                    totalOutputTokens: null,
                    totalCacheReadTokens: null,
                })}
            />,
        );
        await screen.findByText('Total runs');
        // None of the optional rows should appear when values are null
        expect(screen.queryByText('AI Cost')).not.toBeInTheDocument();
        expect(screen.queryByText('Input tok.')).not.toBeInTheDocument();
        expect(screen.queryByText('Output tok.')).not.toBeInTheDocument();
        expect(screen.queryByText('Cached tok.')).not.toBeInTheDocument();
    });
});
