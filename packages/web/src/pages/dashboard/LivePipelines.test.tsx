import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeRunDetail } from '../../test-utils/workflowFixtures.js';
import { LivePipelines, elapsed } from './LivePipelines.js';

const run = (overrides: Parameters<typeof makeRunDetail>[0] = {}) => ({
    ...makeRunDetail(overrides),
    workflow_name: 'Development',
});

describe('elapsed', () => {
    it('reads minutes, then hours and minutes', () => {
        const now = Date.parse('2026-10-14T12:00:00Z');
        expect(elapsed('2026-10-14T11:59:30Z', now)).toBe('just started');
        expect(elapsed('2026-10-14T11:48:00Z', now)).toBe('12m');
        expect(elapsed('2026-10-14T10:17:00Z', now)).toBe('1h 43m');
    });
});

describe('LivePipelines', () => {
    it('shows the idle line when nothing runs, also for an older API without pipelines', () => {
        renderWithProviders(<LivePipelines pipelines={undefined} agents={[]} />);
        expect(screen.getByText('Nothing is running.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open queue' })).toHaveAttribute('href', '/queue');
        expect(screen.queryByText(/Up next/)).not.toBeInTheDocument();
    });

    it('draws a running task at its current step and links to the run', () => {
        renderWithProviders(
            <LivePipelines
                pipelines={{
                    runs: [run({ current_node_id: 'review' })],
                    queued: [{ workflow_id: 'wf-1', workflow_name: 'Development', count: 2 }],
                    unassigned: 0,
                }}
                agents={[]}
            />
        );
        expect(screen.getByRole('link', { name: 'Add login' })).toHaveAttribute(
            'href',
            '/workflows/wf-1/runs/wfr-1'
        );
        expect(screen.getByRole('img', { name: 'Step 2 of 2: Reviewer' })).toBeInTheDocument();
        expect(screen.getByText('1 task')).toBeInTheDocument();
        expect(screen.getByText(/Up next:/)).toHaveTextContent('Up next: 2 in Development.');
    });

    it('flags a run parked on the Owner with its reason', () => {
        renderWithProviders(
            <LivePipelines
                pipelines={{
                    runs: [
                        run({
                            status: 'waiting_for_owner',
                            parked_node_id: 'coder',
                            park_reason: 'Which store?',
                        }),
                    ],
                    queued: [],
                    unassigned: 1,
                }}
                agents={[]}
            />
        );
        expect(screen.getByText(/Needs you: Which store\?/)).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Step 1 of 2: Coder' })).toBeInTheDocument();
        expect(screen.getByText('1 ready task has no workflow.')).toBeInTheDocument();
    });

    it('says starting up when the current step cannot be placed', () => {
        renderWithProviders(
            <LivePipelines
                pipelines={{
                    runs: [run({ current_node_id: 'nowhere' })],
                    queued: [],
                    unassigned: 0,
                }}
                agents={[]}
            />
        );
        expect(screen.getAllByText('Starting up').length).toBeGreaterThan(0);
    });
});
