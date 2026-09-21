import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { Toast } from '../../components/Toast.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makePublishedWorkflow, makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { WorkflowHeader } from './WorkflowHeader.js';

function mount(dirty: boolean) {
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
