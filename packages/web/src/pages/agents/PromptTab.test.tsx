import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';

vi.mock('../../hooks/useDeferredMount.js', () => ({
    useDeferredMount: vi.fn(),
}));

vi.mock('./PromptTabContent.js', () => ({
    PromptTabContent: ({ agent }: { agent: { name: string } }) => (
        <div data-testid="prompt-content">{agent.name}</div>
    ),
}));

import { useDeferredMount } from '../../hooks/useDeferredMount.js';
const mockMount = vi.mocked(useDeferredMount);

import { PromptTab } from './PromptTab.js';

describe('PromptTab', () => {
    it('renders the skeleton when useDeferredMount returns false', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(false);
        renderWithProviders(<PromptTab agent={makeAgent()} />);
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('prompt-content')).not.toBeInTheDocument();
    });

    it('renders PromptTabContent with agent when useDeferredMount returns true', () => {
        server.use(...defaultHandlers);
        mockMount.mockReturnValue(true);
        renderWithProviders(<PromptTab agent={makeAgent({ name: 'Spec Writer' })} />);
        expect(screen.getByTestId('prompt-content')).toHaveTextContent('Spec Writer');
    });
});
