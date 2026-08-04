import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { DiffToolbar } from './DiffToolbar.js';

function renderToolbar(overrides: Partial<React.ComponentProps<typeof DiffToolbar>> = {}) {
    const props: React.ComponentProps<typeof DiffToolbar> = {
        viewMode: 'split',
        onViewModeChange: vi.fn(),
        wrap: true,
        onWrapChange: vi.fn(),
        splitDisabled: false,
        stats: { files: 3, additions: 12, deletions: 4 },
        ...overrides,
    };
    renderWithProviders(<DiffToolbar {...props} />);
    return props;
}

describe('DiffToolbar', () => {
    it('renders the stats line', () => {
        renderToolbar();
        expect(screen.getByText(/3/)).toBeInTheDocument();
        expect(screen.getByText('+12')).toBeInTheDocument();
        expect(screen.getByText('−4')).toBeInTheDocument();
    });

    it('singularises a one-file stat', () => {
        renderToolbar({ stats: { files: 1, additions: 1, deletions: 0 } });
        expect(screen.getByText(/file/)).toBeInTheDocument();
        expect(screen.queryByText(/files/)).not.toBeInTheDocument();
    });

    it('marks the active view mode', () => {
        renderToolbar();
        expect(screen.getByRole('button', { name: /split/i })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByRole('button', { name: /unified/i })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('fires onViewModeChange when switching', () => {
        const props = renderToolbar();
        fireEvent.click(screen.getByRole('button', { name: /unified/i }));
        expect(props.onViewModeChange).toHaveBeenCalledWith('unified');
    });

    // MUI's ToggleButtonGroup emits null when the active button is clicked
    // again; the group must never end up with no selection.
    it('ignores a click on the already-active mode', () => {
        const props = renderToolbar();
        fireEvent.click(screen.getByRole('button', { name: /split/i }));
        expect(props.onViewModeChange).not.toHaveBeenCalled();
    });

    it('disables split when there is no room for it', () => {
        renderToolbar({ splitDisabled: true });
        expect(screen.getByRole('button', { name: /split/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /unified/i })).not.toBeDisabled();
    });

    it('reflects and toggles the wrap switch', () => {
        const props = renderToolbar();
        const sw = screen.getByLabelText('Wrap long lines');
        expect(sw).toBeChecked();
        fireEvent.click(sw);
        expect(props.onWrapChange).toHaveBeenCalledWith(false);
    });

    it('shows wrap as off when disabled', () => {
        renderToolbar({ wrap: false });
        expect(screen.getByLabelText('Wrap long lines')).not.toBeChecked();
    });
});
