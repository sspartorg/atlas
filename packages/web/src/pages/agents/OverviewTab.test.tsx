import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';

// Mock useDeferredMount so we can test both skeleton and content paths.
vi.mock('../../hooks/useDeferredMount.js', () => ({
    useDeferredMount: vi.fn(),
}));

// Mock the heavy content child so this test only exercises the wrapper.
vi.mock('./OverviewTabContent.js', () => ({
    OverviewTabContent: ({ agent }: { agent: { name: string } }) => (
        <div data-testid="overview-content">{agent.name}</div>
    ),
}));

import { useDeferredMount } from '../../hooks/useDeferredMount.js';
const mockMount = vi.mocked(useDeferredMount);

import { OverviewTab } from './OverviewTab.js';

describe('OverviewTab', () => {
    it('renders the skeleton when useDeferredMount returns false', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(false);
        renderWithProviders(
            <OverviewTab agent={makeAgent()} view={{} as never} />,
        );
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('overview-content')).not.toBeInTheDocument();
    });

    it('renders OverviewTabContent when useDeferredMount returns true', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(true);
        renderWithProviders(
            <OverviewTab agent={makeAgent({ name: 'Coder' })} view={{} as never} />,
        );
        expect(screen.getByTestId('overview-content')).toHaveTextContent('Coder');
    });
});
