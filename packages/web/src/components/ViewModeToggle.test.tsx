import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { ViewModeToggle, loadViewMode, saveViewMode } from './ViewModeToggle.js';

describe('ViewModeToggle', () => {
    it('renders both toggle buttons and fires onChange', async () => {
        const onChange = vi.fn();
        renderWithProviders(<ViewModeToggle value="table" onChange={onChange} />);
        await userEvent.click(screen.getByRole('button', { name: /Kanban/i }));
        expect(onChange).toHaveBeenCalledWith('kanban');
    });

    it('does not call onChange when the same active button is clicked (next=null branch)', async () => {
        // MUI ToggleButtonGroup exclusive mode passes null when the current value is re-selected
        const onChange = vi.fn();
        renderWithProviders(<ViewModeToggle value="table" onChange={onChange} />);
        // Clicking the already-selected Table button → next is null → onChange NOT called
        await userEvent.click(screen.getByRole('button', { name: /Table/i }));
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('loadViewMode + saveViewMode', () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(() => window.localStorage.clear());

    it('returns the fallback when no key', () => {
        expect(loadViewMode('epics')).toBe('table');
        expect(loadViewMode('epics', 'kanban')).toBe('kanban');
    });

    it('round-trips through localStorage', () => {
        saveViewMode('epics', 'kanban');
        expect(loadViewMode('epics')).toBe('kanban');
    });

    it('ignores invalid stored values', () => {
        window.localStorage.setItem('atlas.viewMode.x', 'garbage');
        expect(loadViewMode('x')).toBe('table');
    });
});
