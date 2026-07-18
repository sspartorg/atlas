import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { LiveDot } from './LiveDot.js';

describe('LiveDot', () => {
    it('renders with the default label', () => {
        renderWithProviders(<LiveDot />);
        expect(screen.getByLabelText('In progress')).toBeInTheDocument();
    });

    it('honours a custom label', () => {
        renderWithProviders(<LiveDot label="Streaming" size={10} />);
        expect(screen.getByLabelText('Streaming')).toBeInTheDocument();
    });
});
