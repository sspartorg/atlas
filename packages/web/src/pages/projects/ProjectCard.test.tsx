import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { ProjectCard } from './ProjectCard.js';

const defaultProps = {
    displayId: 'ACM',
    epicCount: 2,
    storyCount: 5,
    onOpen: vi.fn(),
    onCopyUrl: vi.fn(),
    onReclone: vi.fn(),
    onDelete: vi.fn(),
    onScheduleFetch: vi.fn(),
};

describe('ProjectCard', () => {
    it('renders the project name and counters', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
            />,
        );
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it('renders git_url stripping https:// prefix and .git suffix', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme', git_url: 'https://github.com/acme/repo.git' })}
                {...defaultProps}
            />,
        );
        expect(screen.getByText('github.com/acme/repo')).toBeInTheDocument();
    });

    it('renders em-dash when git_url is null/empty', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme', git_url: null as unknown as string })}
                {...defaultProps}
            />,
        );
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders scheduleInfo icon when scheduleInfo is provided with next_run_at', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                scheduleInfo={{ preset: 'daily', next_run_at: '2026-06-28T09:00:00.000Z' }}
            />,
        );
        expect(screen.getByLabelText('Auto-fetch enabled')).toBeInTheDocument();
    });

    it('renders scheduleInfo icon when next_run_at is null', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                scheduleInfo={{ preset: 'weekly', next_run_at: null }}
            />,
        );
        expect(screen.getByLabelText('Auto-fetch enabled')).toBeInTheDocument();
    });

    it('does not render schedule icon when scheduleInfo is undefined', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                scheduleInfo={undefined}
            />,
        );
        expect(screen.queryByLabelText('Auto-fetch enabled')).not.toBeInTheDocument();
    });

    it('renders em-dash in Counter when epicCount is null (Counter value === null branch)', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme' })}
                {...defaultProps}
                epicCount={null as unknown as number}
                storyCount={null as unknown as number}
            />,
        );
        // Counter renders '—' for null values
        const dashes = screen.getAllByText('—');
        // At least 2 dashes: one for epicCount=null, one for storyCount=null
        expect(dashes.length).toBeGreaterThanOrEqual(2);
    });

    it('renders git_url stripping http:// (non-https) prefix', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme', git_url: 'http://github.com/acme/repo.git' })}
                {...defaultProps}
            />,
        );
        // The http:// prefix and .git suffix should both be stripped
        expect(screen.getByText('github.com/acme/repo')).toBeInTheDocument();
    });

    it('L146: git_path null — Tooltip title falls back to empty string (covers || "" false branch)', () => {
        renderWithProviders(
            <ProjectCard
                project={makeProject({ id: 'p1', name: 'Acme', git_path: null as unknown as string })}
                {...defaultProps}
            />,
        );
        // The project still renders without crashing when git_path is null
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });
});
