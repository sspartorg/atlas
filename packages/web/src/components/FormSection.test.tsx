import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { FormSection, FormRow } from './FormSection.js';

describe('FormSection', () => {
    it('renders label and children', () => {
        renderWithProviders(
            <FormSection label="Profile">
                <FormRow label="Name">
                    <input aria-label="name" />
                </FormRow>
            </FormSection>,
        );
        expect(screen.getByText('Profile')).toBeInTheDocument();
        expect(screen.getByText('Name')).toBeInTheDocument();
        expect(screen.getByLabelText('name')).toBeInTheDocument();
    });
});
