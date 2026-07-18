import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { KpiTile } from './KpiTile.js';

describe('KpiTile', () => {
    it('renders label, value, and caption', () => {
        renderWithProviders(
            <KpiTile
                label="Throughput"
                dotColor="#0A0A0A"
                value={42}
                caption="last 24h"
                captionTitle="Total runs in last 24 hours"
            />,
        );
        expect(screen.getByText('Throughput')).toBeInTheDocument();
        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('last 24h')).toBeInTheDocument();
    });
});
