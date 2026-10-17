import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ProjectsEmptyState } from './ProjectsEmptyState.js';


describe('ProjectsEmptyState', () => {
    it('renders and fires the New Project CTA', async () => {
        const onNewProject = vi.fn();
        renderWithProviders(<ProjectsEmptyState onNewProject={onNewProject} />);
        expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /New Project/ }));
        expect(onNewProject).toHaveBeenCalled();
    });

    it('describes the current create flow, not the old paste-a-URL clone', () => {
        renderWithProviders(<ProjectsEmptyState onNewProject={vi.fn()} />);
        expect(screen.queryByText(/Paste a GitHub/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Point Atlas at a git URL/)).not.toBeInTheDocument();
        expect(screen.getByText(/You.ll add its repos/)).toBeInTheDocument();
    });

    it('"Settings → Credentials" is a real, focusable link', () => {
        renderWithProviders(<ProjectsEmptyState onNewProject={vi.fn()} />);
        expect(screen.getByRole('link', { name: 'Settings → Credentials' })).toHaveAttribute(
            'href',
            '/settings/credentials'
        );
    });
});
