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
        expect(loadViewMode('tasks')).toBe('table');
        expect(loadViewMode('tasks', 'kanban')).toBe('kanban');
    });

    it('round-trips through localStorage', () => {
        saveViewMode('tasks', 'kanban');
        expect(loadViewMode('tasks')).toBe('kanban');
    });

    it('ignores invalid stored values', () => {
        window.localStorage.setItem('atlas.viewMode.x', 'garbage');
        expect(loadViewMode('x')).toBe('table');
    });

    it('falls back instead of throwing when storage is blocked', () => {
        const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError');
        });
        const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError');
        });
        expect(loadViewMode('tasks', 'kanban')).toBe('kanban');
        expect(() => saveViewMode('tasks', 'table')).not.toThrow();
        get.mockRestore();
        set.mockRestore();
    });
});
