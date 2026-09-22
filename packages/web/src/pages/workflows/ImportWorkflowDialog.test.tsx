import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { IWorkflowImportResult } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { ImportWorkflowDialog, importDetail } from './ImportWorkflowDialog.js';

const BASE = 'http://localhost:3000/api';

function mount(onClose = vi.fn()) {
    server.use(
        http.get(`${BASE}/projects`, () =>
            HttpResponse.json([makeProject({ id: 'p1', name: 'Atlas' })])
        )
    );
    renderWithProviders(
        <Routes>
            <Route path="/workflows" element={<ImportWorkflowDialog open onClose={onClose} />} />
            <Route path="/workflows/:id" element={<p>Builder page</p>} />
        </Routes>,
        { initialEntries: ['/workflows'] }
    );
    return onClose;
}

async function fill() {
    await userEvent.click(await screen.findByRole('combobox', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Atlas' }));
    const file = new File(['zip'], 'delivery.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByTestId('workflow-zip-input'), { target: { files: [file] } });
}

describe('ImportWorkflowDialog', () => {
    // An import can upgrade a stale agent and can decline to touch an edited
    // one. Both have to be visible: silently changing the Owner's agents, or
    // silently not changing them, are each their own kind of surprise.
    it('names upgraded agents and the edited ones it deliberately left alone', () => {
        const detail = importDetail({
            workflow: makeWorkflow({ id: 'wf-1', name: 'Delivery' }),
            sub_workflows: [],
            installed_agents: [],
            reused_agents: [],
            agents: {
                installed: [],
                upgraded: ['agent-coder'],
                skipped_edited: ['agent-qa-writer'],
                unchanged: [],
            },
        });
        expect(detail).toContain('Upgraded agent-coder');
        expect(detail).toContain('Kept your edits to agent-qa-writer');
    });

    it('needs a project and a file, uploads them, then opens the imported workflow', async () => {
        const result: IWorkflowImportResult = {
            workflow: makeWorkflow({ id: 'wf-new', name: 'Delivery' }),
            sub_workflows: [],
            installed_agents: ['agent-coder'],
            reused_agents: [],
            agents: { installed: ['agent-coder'], upgraded: [], skipped_edited: [], unchanged: [] },
        };
        let hit = false;
        server.use(
            http.post(`${BASE}/workflows/import`, () => {
                hit = true;
                return HttpResponse.json(result, { status: 201 });
            })
        );
        const onClose = mount();
        const importButton = screen.getByRole('button', { name: 'Import' });
        expect(importButton).toBeDisabled();

        await fill();
        expect(screen.getByText('delivery.zip')).toBeInTheDocument();
        expect(importButton).toBeEnabled();
        await userEvent.click(importButton);

        expect(await screen.findByText('Builder page')).toBeInTheDocument();
        expect(hit).toBe(true);
        expect(onClose).toHaveBeenCalled();
    });

    it('shows why an import was rejected', async () => {
        server.use(
            http.post(`${BASE}/workflows/import`, () =>
                HttpResponse.json(
                    { error: 'Workflow bundle: missing workflow.json', kind: 'validation_error' },
                    { status: 400 }
                )
            )
        );
        mount();
        await fill();
        await userEvent.click(screen.getByRole('button', { name: 'Import' }));
        expect(
            await screen.findByText('Workflow bundle: missing workflow.json')
        ).toBeInTheDocument();
    });
});
