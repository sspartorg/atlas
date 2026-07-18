import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentCategorySection } from './AgentCategorySection.js';

describe('AgentCategorySection', () => {
    it('renders the section label', () => {
        renderWithProviders(
            <AgentCategorySection label="Software dev" count={3}>
                <div>child</div>
            </AgentCategorySection>,
        );
        expect(screen.getByText('Software dev')).toBeTruthy();
    });

    it('renders the count', () => {
        renderWithProviders(
            <AgentCategorySection label="Marketing" count={5}>
                <div>child</div>
            </AgentCategorySection>,
        );
        expect(screen.getByText('5')).toBeTruthy();
    });

    it('renders children', () => {
        renderWithProviders(
            <AgentCategorySection label="Content" count={2}>
                <div data-testid="child-card">Card</div>
            </AgentCategorySection>,
        );
        expect(screen.getByTestId('child-card')).toBeTruthy();
    });

    it('renders count of 0', () => {
        renderWithProviders(
            <AgentCategorySection label="Design" count={0}>
                <span />
            </AgentCategorySection>,
        );
        expect(screen.getByText('0')).toBeTruthy();
    });
});
