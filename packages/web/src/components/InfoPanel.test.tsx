import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { InfoPanel, InfoRow } from './InfoPanel.js';

describe('InfoPanel + InfoRow', () => {
    it('renders panel label and rows', () => {
        renderWithProviders(
            <InfoPanel label="Details">
                <InfoRow label="Status">Open</InfoRow>
                <InfoRow label="Owner">Bob</InfoRow>
            </InfoPanel>,
        );
        expect(screen.getByText('Details')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Open')).toBeInTheDocument();
        expect(screen.getByText('Owner')).toBeInTheDocument();
    });

    it('renders headerRight slot', () => {
        renderWithProviders(
            <InfoPanel label="X" headerRight={<button>add</button>}>
                <div>child</div>
            </InfoPanel>,
        );
        expect(screen.getByRole('button', { name: 'add' })).toBeInTheDocument();
    });
});
