import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { StepIndicator } from './StepIndicator.js';

describe('StepIndicator', () => {
    it('renders the in-progress step copy', () => {
        renderWithProviders(<StepIndicator current={1} />);
        expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    });

    it('renders the complete state', () => {
        renderWithProviders(<StepIndicator current={2} complete />);
        expect(screen.getByText('Setup complete')).toBeInTheDocument();
    });

    it('renders second step', () => {
        renderWithProviders(<StepIndicator current={2} />);
        expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    });
});
