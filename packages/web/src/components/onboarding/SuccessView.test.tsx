import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { SuccessView } from './SuccessView.js';

describe('SuccessView', () => {
    it('renders the success heading + loading sub-text', () => {
        renderWithProviders(<SuccessView />);
        expect(screen.getByText("You're all set.")).toBeInTheDocument();
        expect(screen.getByText('Loading your dashboard…')).toBeInTheDocument();
    });

    it('renders a CheckCircle icon', () => {
        const { container } = renderWithProviders(<SuccessView />);
        // MUI emits the icon's testid via the SVG data-testid attribute.
        expect(container.querySelector('[data-testid="CheckCircleIcon"]')).not.toBeNull();
    });

    it('accepts a custom durationMs prop without crashing', () => {
        renderWithProviders(<SuccessView durationMs={1500} />);
        expect(screen.getByText("You're all set.")).toBeInTheDocument();
    });
});
