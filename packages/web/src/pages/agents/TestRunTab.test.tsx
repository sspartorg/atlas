import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import type { AgentView } from './agentViewModel.js';

// useDeferredMount is imported at module load time inside TestRunTab;
// we must mock it before importing TestRunTab so the mock is in place.
vi.mock('../../hooks/useDeferredMount.js', () => ({
    useDeferredMount: vi.fn().mockReturnValue(true),
}));

// Mock scrollTo for jsdom
if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = vi.fn();
}

import { TestRunTab } from './TestRunTab.js';

const _BASE = 'http://localhost:3000/api';

const view: AgentView = {
    slug: 'coder',
    glyph: 'developer_board',
    description: '',
    cadenceHours: 6,
    cadenceLabel: 'Every 6h',
    nextPassLabel: 'now',
    nextPassDelta: '0m',
    concurrentRuns: 1,
    concurrentMax: 3,
};

describe('TestRunTab', () => {
    it('renders TestRunTabSkeleton when useDeferredMount returns false (skeleton branch)', async () => {
        // Temporarily override mock to return false so TestRunTabSkeleton renders
        const deferredMountMod = await import('../../hooks/useDeferredMount.js');
        const mockedHook = vi.mocked(deferredMountMod.useDeferredMount);
        mockedHook.mockReturnValueOnce(false);
        server.use(...defaultHandlers);
        HTMLElement.prototype.scrollTo = vi.fn();
        const { container } = renderWithProviders(
            <TestRunTab agent={makeAgent()} view={view} />,
        );
        // TestRunTabSkeleton renders MUI Skeleton elements
        expect(container.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
    });

    it('renders TestRunTabContent since useDeferredMount always returns true', async () => {
        server.use(...defaultHandlers);
        HTMLElement.prototype.scrollTo = vi.fn();
        renderWithProviders(
            <TestRunTab agent={makeAgent()} view={view} />
        );
        // TestRunTabContent renders the "Live CLI test run" heading
        expect(await screen.findByText(/Live CLI test run/i)).toBeInTheDocument();
    });

    it('renders Run test button from TestRunTabContent', async () => {
        server.use(...defaultHandlers);
        HTMLElement.prototype.scrollTo = vi.fn();
        renderWithProviders(
            <TestRunTab agent={makeAgent()} view={view} />
        );
        expect(await screen.findByRole('button', { name: /Run test/i })).toBeInTheDocument();
    });
});
