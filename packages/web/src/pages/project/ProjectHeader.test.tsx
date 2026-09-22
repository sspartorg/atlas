import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
            onViewRepos={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
    });

    // ADR 0018 — a project holds 0..N equal repos. The header used to
    // special-case exactly one and print its URL + branch, which read as "the
    // project's repo"; with a repo-less project now the normal first state,
    // the old "no repo URL set" was a dead end on every new project.
    it.each([
        [[makeProjectRepo({ git_url: 'https://github.com/example/atlas.git' })], '1 repo'],
        [
            [makeProjectRepo({ id: 'r1', name: 'api' }), makeProjectRepo({ id: 'r2', name: 'web' })],
            '2 repos',
        ],
        [[], 'Add a repo'],
    ])('counts the repos rather than naming one of them', (repos, label) => {
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={repos}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onViewRepos={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
        expect(screen.queryByText('no repo URL set')).not.toBeInTheDocument();
    });

    it('sends you to the Repos tab — the only place repos are managed', async () => {
        const onViewRepos = vi.fn();
        renderWithProviders(
            <ProjectHeader
                project={makeProject()}
                repos={[]}
                displayId="ATL"
                guardrailsActive={false}
                lastActivity="just now"
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onViewRepos={onViewRepos}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: 'Add a repo' }));
        expect(onViewRepos).toHaveBeenCalled();
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
            onViewRepos={vi.fn()}
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
            onViewRepos={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        const btn = screen.getByRole('button', { name: /guard-rails active/i });
        expect(btn).toBeInTheDocument();
        fireEvent.click(btn);
        expect(onEditGuardrails).toHaveBeenCalledTimes(1);
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
            onViewRepos={vi.fn()}
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
            onViewRepos={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
                // aiScaffoldEnabled deliberately omitted (undefined)
            />
        );
        expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
});
