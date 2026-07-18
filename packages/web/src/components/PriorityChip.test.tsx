import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { PriorityChip } from './PriorityChip.js';

describe('PriorityChip', () => {
    it.each([
        ['low', 'Low'],
        ['normal', 'Normal'],
        ['high', 'High'],
        ['urgent', 'Urgent'],
    ] as const)('renders the %s priority label', (priority, label) => {
        renderWithProviders(<PriorityChip priority={priority} />);
        expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('honors the md size variant', () => {
        renderWithProviders(<PriorityChip priority="urgent" size="md" />);
        expect(screen.getByText('Urgent')).toBeInTheDocument();
    });
});
