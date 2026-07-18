import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AccentColorPicker } from './AccentColorPicker.js';

describe('AccentColorPicker', () => {
    it('renders swatches', () => {
        const onChange = vi.fn();
        renderWithProviders(<AccentColorPicker value="#000000" onChange={onChange} />);
        expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    it('calls onChange when a swatch is clicked', async () => {
        const onChange = vi.fn();
        renderWithProviders(<AccentColorPicker value="#000000" onChange={onChange} />);
        const buttons = screen.getAllByRole('button');
        await userEvent.click(buttons[0]!);
        expect(onChange).toHaveBeenCalled();
    });

    it('shows hex + name label when value matches a swatch (selected truthy branch)', () => {
        // #7C3AED is the first BRAND_SECONDARY_ACCENT swatch ('Violet')
        const onChange = vi.fn();
        renderWithProviders(<AccentColorPicker value="#7C3AED" onChange={onChange} />);
        // When selected is truthy, the label shows `${hex} · ${name}`
        expect(screen.getByText(/Violet/)).toBeInTheDocument();
        expect(screen.getByText(/#7C3AED · Violet/i)).toBeInTheDocument();
    });

    it('shows normalized hex when value is not in swatches (selected null branch)', () => {
        const onChange = vi.fn();
        renderWithProviders(<AccentColorPicker value="#abcdef" onChange={onChange} />);
        // normalized = '#ABCDEF', no matching swatch → shows the hex string
        expect(screen.getByText('#ABCDEF')).toBeInTheDocument();
    });
});
