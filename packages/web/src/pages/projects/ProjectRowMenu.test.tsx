import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ProjectRowMenu } from './ProjectRowMenu.js';

describe('ProjectRowMenu', () => {
    it('shows the menu and fires Delete', async () => {
        const onDelete = vi.fn();
        renderWithProviders(<ProjectRowMenu onCopyUrl={vi.fn()} onDelete={onDelete} />);
        await userEvent.click(screen.getByRole('button', { name: /Project actions/i }));
        await userEvent.click(await screen.findByText(/Delete project/));
        expect(onDelete).toHaveBeenCalled();
    });

    it('fires Copy repo URL', async () => {
        const onCopyUrl = vi.fn();
        renderWithProviders(<ProjectRowMenu onCopyUrl={onCopyUrl} onDelete={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: /Project actions/i }));
        await userEvent.click(await screen.findByText(/Copy repo URL/));
        expect(onCopyUrl).toHaveBeenCalled();
    });

    it('offers only the project-wide actions — per-repo ones moved to Project Detail', async () => {
        renderWithProviders(<ProjectRowMenu onCopyUrl={vi.fn()} onDelete={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: /Project actions/i }));
        const labels = (await screen.findAllByRole('menuitem')).map((i) => i.textContent ?? '');
        expect(labels.some((l) => l.includes('Copy repo URL'))).toBe(true);
        expect(labels.some((l) => l.includes('Delete project'))).toBe(true);
        // A repo-scoped action can't pick its repo from here (ADR 0018).
        expect(labels.some((l) => l.includes('Open project'))).toBe(false);
        expect(labels.some((l) => l.includes('Re-clone from remote'))).toBe(false);
        expect(labels.some((l) => l.includes('Auto-fetch schedule'))).toBe(false);
    });
});
