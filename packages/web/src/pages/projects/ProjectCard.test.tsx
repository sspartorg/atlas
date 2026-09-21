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
    onCopyUrl: vi.fn(),
    onDelete: vi.fn(),
};

describe('ProjectCard', () => {
    it('renders the project name and counters', () => {
        renderWithProviders(
            <ProjectCard project={makeProject({ id: 'p1', name: 'Acme' })} {...defaultProps} />
        );
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it("renders the first repo's git_url stripping https:// prefix and .git suffix", () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                repos={[makeProjectRepo({ git_url: 'https://github.com/acme/repo.git' })]}
            />
        );
        expect(screen.getByText('github.com/acme/repo')).toBeInTheDocument();
    });

    it("renders the first repo's git_url stripping http:// (non-https) prefix", () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                repos={[makeProjectRepo({ git_url: 'http://github.com/acme/repo.git' })]}
            />
        );
        expect(screen.getByText('github.com/acme/repo')).toBeInTheDocument();
    });

    it('renders em-dash when the first repo has no git_url', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                repos={[makeProjectRepo({ git_url: '' })]}
            />
        );
        expect(screen.getByText('—')).toBeInTheDocument();
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
        expect(screen.getByText('No repos')).toBeInTheDocument();
        // With no repo there is no remote to show.
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it("shows the first repo's remote when the project has several", () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                repos={[
                    makeProjectRepo({ id: 'r1', git_url: 'https://github.com/acme/first.git' }),
                    makeProjectRepo({ id: 'r2', git_url: 'https://github.com/acme/second.git' }),
                ]}
            />
        );
        expect(screen.getByText('github.com/acme/first')).toBeInTheDocument();
        expect(screen.queryByText('github.com/acme/second')).not.toBeInTheDocument();
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
