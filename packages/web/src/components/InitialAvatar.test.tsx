import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { InitialAvatar } from './InitialAvatar.js';

describe('InitialAvatar', () => {
    it('takes the first letter, upper-cased', () => {
        renderWithProviders(<InitialAvatar name="alice" color="#0A0A0A" />);
        expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('falls back to "?" for empty names', () => {
        renderWithProviders(<InitialAvatar name="" color="#0A0A0A" />);
        expect(screen.getByText('?')).toBeInTheDocument();
    });

    it('honors size + fg + fontSize overrides', () => {
        renderWithProviders(
            <InitialAvatar
                name="Bob"
                color="#fff"
                fg="#0A0A0A"
                size={32}
                fontSize={20}
                fontWeight={500}
            />,
        );
        expect(screen.getByText('B')).toBeInTheDocument();
    });
});
