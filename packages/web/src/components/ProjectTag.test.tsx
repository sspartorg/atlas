import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { ProjectTag } from './ProjectTag.js';

describe('ProjectTag', () => {
    it('renders name', () => {
        renderWithProviders(<ProjectTag name="Acme" />);
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it('handles clickable variant without crashing', async () => {
        renderWithProviders(<ProjectTag name="Acme" projectId="p1" clickable size="md" />);
        await userEvent.click(screen.getByText('Acme'));
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });
});
