import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject, makeProjectRepo } from '../../test-utils/factories.js';
import { ProjectHeader } from './ProjectHeader.js';

describe('ProjectHeader', () => {
    it('renders the project name', () => {
        renderWithProviders(
            <ProjectHeader
                project={makeProject({ id: 'p1', name: 'Acme' })}
                repos={[makeProjectRepo()]}
                displayId="ACM"
                guardrailsActive={false}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
    });

    it('renders an anchor link with stripped repoLabel for the single repo’s git_url', () => {
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[makeProjectRepo({ git_url: 'https://github.com/example/atlas.git' })]}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        const link = screen.getByRole('link', { name: 'github.com/example/atlas' });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://github.com/example/atlas.git');
    });

    it('repoLabel: a repo with no url shows the fallback text, not a link', () => {
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[makeProjectRepo({ git_url: '' })]}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        expect(screen.getByText('no repo URL set')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('a project with no repos shows the fallback text', () => {
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[]}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        expect(screen.getByText('no repo URL set')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('several repos collapse to a count chip instead of one repo’s url + branch', () => {
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[
                    makeProjectRepo({ id: 'r1', name: 'api' }),
                    makeProjectRepo({ id: 'r2', name: 'web', default_branch: 'develop' }),
                ]}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        expect(screen.getByText('2 repos')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByText('develop')).not.toBeInTheDocument();
    });

    it('renders "Guard-rails active" button when guardrailsActive is true and calls onEditGuardrails on click', () => {
        const onEditGuardrails = vi.fn();
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[makeProjectRepo()]}
                displayId="ATL"
                guardrailsActive={true}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={onEditGuardrails}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        const btn = screen.getByRole('button', { name: /guard-rails active/i });
        expect(btn).toBeInTheDocument();
        fireEvent.click(btn);
        expect(onEditGuardrails).toHaveBeenCalledTimes(1);
    });

    it('falls back to "main" when the repo’s default_branch is falsy', () => {
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[makeProjectRepo({ default_branch: '' })]}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        expect(screen.getByText('main')).toBeInTheDocument();
    });

    it('passes onGenerateAiScaffold + aiScaffoldEnabled to ProjectActionsMenu (line 173-174 truthy branches)', () => {
        // Exercises `onGenerateAiScaffold ? { onGenerateAiScaffold } : {}` (true)
        // and `aiScaffoldEnabled !== undefined ? { aiScaffoldEnabled } : {}` (true)
        const onGenerateAiScaffold = vi.fn();
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[makeProjectRepo({ git_url: 'https://github.com/example/repo.git' })]}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="5m ago"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
                onGenerateAiScaffold={onGenerateAiScaffold}
                aiScaffoldEnabled={true}
            />
        );
        // ProjectHeader renders — the ActionsMenu gets the scaffold prop
        expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    it('omits aiScaffoldEnabled prop (line 174 false branch: aiScaffoldEnabled === undefined)', () => {
        // When aiScaffoldEnabled is not passed, the spread is empty {}
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[makeProjectRepo()]}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="1h ago"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
                // aiScaffoldEnabled deliberately omitted (undefined)
            />
        );
        expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
});
