import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { IAgentRun } from '@atlas/shared';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';

vi.mock('../../hooks/useDeferredMount.js', () => ({
    useDeferredMount: vi.fn(),
}));

vi.mock('./RunsTabContent.js', () => ({
    RunsTabContent: ({ runs }: { agent: unknown; runs: IAgentRun[] }) => (
        <div data-testid="runs-content">count={runs.length}</div>
    ),
}));

import { useDeferredMount } from '../../hooks/useDeferredMount.js';
const mockMount = vi.mocked(useDeferredMount);

import { RunsTab } from './RunsTab.js';

describe('RunsTab', () => {
    it('renders five skeleton rows when useDeferredMount returns false', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(false);
        renderWithProviders(<RunsTab agent={makeAgent()} runs={[]} />);
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBe(5);
        expect(screen.queryByTestId('runs-content')).not.toBeInTheDocument();
    });

    it('renders RunsTabContent when useDeferredMount returns true', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(true);
        renderWithProviders(<RunsTab agent={makeAgent()} runs={[]} />);
        expect(screen.getByTestId('runs-content')).toHaveTextContent('count=0');
    });

    it('passes runs to RunsTabContent', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(true);
        const fakeRuns = [{ id: 'r1' }, { id: 'r2' }] as IAgentRun[];
        renderWithProviders(<RunsTab agent={makeAgent()} runs={fakeRuns} />);
        expect(screen.getByTestId('runs-content')).toHaveTextContent('count=2');
    });
});
