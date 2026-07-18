import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';

vi.mock('../../hooks/useDeferredMount.js', () => ({
    useDeferredMount: vi.fn(),
}));

vi.mock('./HandoffsTabContent.js', () => ({
    HandoffsTabContent: ({ agent }: { agent: { id: string } }) => (
        <div data-testid="handoffs-content">{agent.id}</div>
    ),
}));

import { useDeferredMount } from '../../hooks/useDeferredMount.js';
const mockMount = vi.mocked(useDeferredMount);

import { HandoffsTab } from './HandoffsTab.js';

describe('HandoffsTab', () => {
    it('renders the skeleton when useDeferredMount returns false', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(false);
        renderWithProviders(<HandoffsTab agent={makeAgent()} />);
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('handoffs-content')).not.toBeInTheDocument();
    });

    it('renders HandoffsTabContent when useDeferredMount returns true', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(true);
        renderWithProviders(<HandoffsTab agent={makeAgent({ id: 'agent-coder' })} />);
        expect(screen.getByTestId('handoffs-content')).toHaveTextContent('agent-coder');
    });
});
