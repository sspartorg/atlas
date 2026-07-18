import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { SearchTextInput } from './SearchTextInput.js';

describe('SearchTextInput', () => {
    it('fires onChange when the user types', async () => {
        const onChange = vi.fn();
        renderWithProviders(<SearchTextInput value="" onChange={onChange} />);
        const tb = screen.getByRole('textbox');
        await userEvent.type(tb, 'a');
        expect(onChange).toHaveBeenCalled();
    });
});
