import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { TrendSparkline } from './TrendSparkline.js';

describe('TrendSparkline', () => {
    it('draws a line and reads every value out to a screen reader', () => {
        const { container } = renderWithProviders(<TrendSparkline label="Steps by week" values={[3, null, 5]} />);
        expect(screen.getByRole('img', { name: 'Steps by week: 3, none, 5' })).toBeInTheDocument();
        expect(container.querySelector('svg')).not.toBeNull();
    });

    // One point is not a trend; a lone dot would read as a flat line.
    it('says so in words below two weeks', () => {
        const { rerender } = renderWithProviders(<TrendSparkline label="Steps" values={[4]} />);
        expect(screen.getByText('one week so far')).toHaveAttribute('title', 'Steps: 4');
        rerender(<TrendSparkline label="Steps" values={[]} />);
        expect(screen.getByText('no weeks yet')).toBeInTheDocument();
    });
});
