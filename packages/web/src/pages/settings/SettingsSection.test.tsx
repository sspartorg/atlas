import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { SettingsSection } from './SettingsSection.js';

describe('SettingsSection', () => {
    it('renders title and children', () => {
        renderWithProviders(
            <SettingsSection title="Profile" subtitle="your info">
                <div>child</div>
            </SettingsSection>,
        );
        expect(screen.getByText('Profile')).toBeInTheDocument();
        expect(screen.getByText('your info')).toBeInTheDocument();
        expect(screen.getByText('child')).toBeInTheDocument();
    });

    it('renders rightAdornment when provided', () => {
        renderWithProviders(
            <SettingsSection title="X" rightAdornment={<button>edit</button>}>
                body
            </SettingsSection>,
        );
        expect(screen.getByRole('button', { name: 'edit' })).toBeInTheDocument();
    });
});
