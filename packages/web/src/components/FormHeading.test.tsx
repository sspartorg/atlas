import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { FormHeading } from './FormHeading.js';

describe('FormHeading', () => {
    it('renders the children', () => {
        renderWithProviders(<FormHeading>Section title</FormHeading>);
        expect(screen.getByText('Section title')).toBeInTheDocument();
    });
});
