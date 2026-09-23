import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { Toast } from '../../components/Toast.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makePublishedWorkflow, makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { WorkflowHeader } from './WorkflowHeader.js';

function mount(dirty: boolean, extra: Partial<Parameters<typeof WorkflowHeader>[0]> = {}) {
    renderWithProviders(
        <>
            <Toast />
            <WorkflowHeader
                workflow={makeWorkflow()}
                projectName="Atlas"
                dirty={dirty}
                saveDisabled={!dirty}
                saving={false}
                runDisabledReason={null}
                onSave={vi.fn()}
                onRun={vi.fn()}
                onDelete={vi.fn()}
                {...extra}
            />
        </>
    );
}

describe('WorkflowHeader Export', () => {
    it('downloads the saved workflow as a bundle', () => {
        mount(false);
        const link = screen.getByRole('link', { name: /export/i });
        expect(link).toHaveAttribute('href', '/api/workflows/wf-1/export');
        expect(link).not.toHaveAttribute('aria-disabled');
    });

    it('is disabled while there are unsaved changes', () => {
        mount(true);
        expect(screen.getByRole('link', { name: /export/i })).toHaveAttribute(
            'aria-disabled',
            'true'
        );
    });
});

// Setting a cadence used to mean opening the canvas and selecting the Start
// node, so workflows sat on `manual` and the schedule was invisible.
describe('WorkflowHeader schedule', () => {
    it('opens the schedule from the header without touching the canvas', async () => {
        const onScheduleChange = vi.fn();
        mount(false, { onScheduleChange });

        await userEvent.click(screen.getByRole('button', { name: /on item ready/i }));
        expect(await screen.findByRole('dialog', { name: /schedule/i })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('combobox', { name: /trigger/i }));
        await userEvent.click(screen.getByRole('option', { name: 'Scheduled' }));

        // A schedule trigger with no preset is rejected by the API, so the
        // control seeds one.
        expect(onScheduleChange).toHaveBeenCalledWith(
            expect.objectContaining({ trigger: 'schedule', schedule_preset: 'daily' })
        );
    });

    it('reads flat with no draft to edit', () => {
        mount(false);
        expect(screen.queryByRole('button', { name: /on item ready/i })).not.toBeInTheDocument();
        expect(screen.getByText(/on item ready/i)).toBeInTheDocument();
    });
});

describe('WorkflowHeader Publish', () => {
    const BASE = 'http://localhost:3000/api';

    it.each([
        ['the first time', '2026-09-14T10:00:00.000Z', 'Published to the marketplace'],
        ['again', '2026-09-15T08:00:00.000Z', 'Updated in the marketplace'],
    ])('publishes the saved workflow %s', async (_when, updatedAt, toast) => {
        let hit = false;
        server.use(
            http.post(`${BASE}/workflows/wf-1/publish`, () => {
                hit = true;
                return HttpResponse.json(makePublishedWorkflow({ updated_at: updatedAt }));
            })
        );
        mount(false);
        await userEvent.click(screen.getByRole('button', { name: /publish/i }));
        expect(await screen.findByText(toast)).toBeInTheDocument();
        expect(hit).toBe(true);
    });

    it('is disabled while there are unsaved changes', () => {
        mount(true);
        expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled();
    });
});

// Upgrading replaces the graph, so it is an explicit button rather than
// something import does silently. Both outcomes were untested: a silent
// failure here leaves the Owner believing they are on the newer version.
describe('WorkflowHeader Upgrade', () => {
    const BASE = 'http://localhost:3000/api';

    it('shows the button only when the marketplace source is ahead', () => {
        mount(false);
        expect(
            screen.queryByRole('button', { name: /upgrade available/i })
        ).not.toBeInTheDocument();

        mount(false, { workflow: makeWorkflow({ upgrade_available: true }) });
        expect(screen.getByRole('button', { name: /upgrade available/i })).toBeInTheDocument();
    });

    it('upgrades from the marketplace and says so', async () => {
        let hit = false;
        server.use(
            http.post(`${BASE}/workflows/wf-1/upgrade`, () => {
                hit = true;
                return HttpResponse.json(makeWorkflow({ upgrade_available: false }));
            })
        );
        mount(false, { workflow: makeWorkflow({ upgrade_available: true }) });
        await userEvent.click(screen.getByRole('button', { name: /upgrade available/i }));
        expect(await screen.findByText('Upgraded from the marketplace')).toBeInTheDocument();
        expect(hit).toBe(true);
    });

    it('surfaces the reason when the upgrade fails', async () => {
        server.use(
            http.post(`${BASE}/workflows/wf-1/upgrade`, () =>
                HttpResponse.json({ error: 'Catalog entry is gone' }, { status: 404 })
            )
        );
        mount(false, { workflow: makeWorkflow({ upgrade_available: true }) });
        await userEvent.click(screen.getByRole('button', { name: /upgrade available/i }));
        expect(await screen.findByText('Could not upgrade workflow')).toBeInTheDocument();
        expect(await screen.findByText(/Catalog entry is gone/)).toBeInTheDocument();
    });
});
