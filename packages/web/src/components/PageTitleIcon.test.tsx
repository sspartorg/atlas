import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import Typography from '@mui/material/Typography';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { PageTitleIcon } from './PageTitleIcon.js';

describe('PageTitleIcon', () => {
    it('adds a hidden glyph that stays out of the heading name', () => {
        renderWithProviders(
            <Typography variant="h1">
                <PageTitleIcon name="flag" />
                Tasks
            </Typography>
        );
        expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
        const glyph = screen.getByText('flag');
        expect(glyph).toHaveAttribute('aria-hidden', 'true');
        expect(glyph).toHaveClass('material-symbols-rounded');
    });
});
