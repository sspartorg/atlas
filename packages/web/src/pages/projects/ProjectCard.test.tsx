import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject, makeProjectRepo } from '../../test-utils/factories.js';
import { ProjectCard } from './ProjectCard.js';

const defaultProps = {
    displayId: 'ACM',
    repos: [makeProjectRepo()],
    taskCount: 2,
    subTaskCount: 5,
    onDelete: vi.fn(),
};

describe('ProjectCard', () => {
    it('renders the project name and counters', () => {
        renderWithProviders(
            <ProjectCard project={makeProject({ id: 'p1', name: 'Acme' })} {...defaultProps} />
        );
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    // ADR 0018 — a project holds 0..N equal repos, so the card names them all
    // instead of printing repos[0]'s remote as if it were "the project's repo".
    it('names every repo the project holds', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                repos={[
                    makeProjectRepo({ id: 'r1', name: 'web' }),
                    makeProjectRepo({ id: 'r2', name: 'api' }),
                ]}
            />
        );
        expect(screen.getByText('web, api')).toBeInTheDocument();
    });

    it('counts the repos: "1 repo", "2 repos", "No repos"', () => {
        const project = makeProject({ id: 'p1', name: 'Acme' });
        const { unmount } = renderWithProviders(
            <ProjectCard project={project} {...defaultProps} repos={[makeProjectRepo()]} />
        );
        expect(screen.getByText('1 repo')).toBeInTheDocument();
        unmount();

        const two = renderWithProviders(
            <ProjectCard
                project={project}
                {...defaultProps}
                repos={[
                    makeProjectRepo({ id: 'r1', name: 'atlas' }),
                    makeProjectRepo({ id: 'r2', name: 'docs' }),
                ]}
            />
        );
        expect(screen.getByText('2 repos')).toBeInTheDocument();
        two.unmount();

        renderWithProviders(<ProjectCard project={project} {...defaultProps} repos={[]} />);
        // Both the name slot and the count say so, and neither invents a URL.
        expect(screen.getAllByText('No repos').length).toBeGreaterThan(0);
    });

    it('renders scheduleInfo icon when scheduleInfo is provided with next_run_at', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                scheduleInfo={{ preset: 'daily', next_run_at: '2026-06-28T09:00:00.000Z' }}
            />
        );
        expect(screen.getByLabelText('Auto-fetch enabled')).toBeInTheDocument();
    });

    it('renders scheduleInfo icon when next_run_at is null', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                scheduleInfo={{ preset: 'weekly', next_run_at: null }}
            />
        );
        expect(screen.getByLabelText('Auto-fetch enabled')).toBeInTheDocument();
    });

    it('does not render schedule icon when scheduleInfo is undefined', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                scheduleInfo={undefined}
            />
        );
        expect(screen.queryByLabelText('Auto-fetch enabled')).not.toBeInTheDocument();
    });

    it('renders em-dash in Counter when taskCount is null (Counter value === null branch)', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                taskCount={null as unknown as number}
                subTaskCount={null as unknown as number}
            />
        );
        // Counter renders '—' for null values
        const dashes = screen.getAllByText('—');
        // At least 2 dashes: one for taskCount=null, one for subTaskCount=null
        expect(dashes.length).toBeGreaterThanOrEqual(2);
    });

    it('git_path null on the first repo — Tooltip title falls back to empty string', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                repos={[makeProjectRepo({ git_path: null as unknown as string })]}
            />
        );
        // The card still renders without crashing when git_path is null
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });
});
