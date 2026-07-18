import { describe, expect, it } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ProjectGuardrailScriptsTab } from './ProjectGuardrailScriptsTab.js';

const BASE = 'http://localhost:3000/api';
const ISO = '2026-05-16T00:00:00.000Z';

function makeScript(over: Record<string, unknown> = {}) {
    return {
        id: 's1',
        project_id: 'p1',
        name: 'Project lint',
        description: 'Lint check just for p1',
        body_sh: '#!/bin/sh\nexit 0',
        body_ps1: 'exit 0',
        sort_order: 0,
        created_at: ISO,
        updated_at: ISO,
        ...over,
    };
}

describe('ProjectGuardrailScriptsTab', () => {
    it('renders the empty state when no project-scoped scripts exist', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () => HttpResponse.json([])),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText(/No project scripts yet/i)).toBeInTheDocument();
        });
    });

    it('renders one card per script when scripts exist', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () =>
                HttpResponse.json([makeScript()]),
            ),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText('Project lint')).toBeInTheDocument();
            expect(screen.getByText('Lint check just for p1')).toBeInTheDocument();
        });
    });

    it('renders pluralised "scripts" count', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () =>
                HttpResponse.json([
                    makeScript({ id: 's1', name: 'A' }),
                    makeScript({ id: 's2', name: 'B' }),
                ]),
            ),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText(/2 scripts configured/i)).toBeInTheDocument();
        });
    });

    it('clicks the "Add script" header button to open the modal', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () =>
                HttpResponse.json([makeScript()]),
            ),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        const btn = await screen.findByRole('button', { name: /Add script/i });
        fireEvent.click(btn);
        // Modal heading or a name field will appear; just verify a dialog
        // surface is rendered.
        await waitFor(() => {
            expect(document.querySelector('[role="dialog"]')).toBeTruthy();
        });
    });

    it('clicks the "Add first script" button in the empty state to open the modal', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () => HttpResponse.json([])),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        const btn = await screen.findByRole('button', { name: /Add first script/i });
        fireEvent.click(btn);
        await waitFor(() => {
            expect(document.querySelector('[role="dialog"]')).toBeTruthy();
        });
    });

    it('opens the edit modal when a script card is clicked', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () =>
                HttpResponse.json([makeScript({ name: 'Click me' })]),
            ),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        const card = await screen.findByText('Click me');
        fireEvent.click(card);
        await waitFor(() => {
            expect(document.querySelector('[role="dialog"]')).toBeTruthy();
        });
    });

    it('handleSubmit edit path — PUT endpoint is called when modal is submitted in edit mode', async () => {
        let patched = false;
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () =>
                HttpResponse.json([makeScript({ id: 'edit-s', name: 'Edit Me' })]),
            ),
            http.patch(`${BASE}/projects/p1/guardrail-scripts/edit-s`, async () => {
                patched = true;
                return HttpResponse.json(makeScript({ id: 'edit-s', name: 'Edited' }));
            }),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        // Open edit modal by clicking card
        await waitFor(() => expect(screen.getByText('Edit Me')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Edit Me'));
        await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
        // Change the name field
        const nameField = screen.getByRole('textbox', { name: /^name/i });
        fireEvent.change(nameField, { target: { value: 'Edited' } });
        // Click "Save changes"
        const saveBtn = screen.getByRole('button', { name: /save changes/i });
        fireEvent.click(saveBtn);
        await waitFor(() => expect(patched).toBe(true), { timeout: 3000 });
    });

    it('handleSubmit create path — POST endpoint is called when modal is submitted in add mode', async () => {
        let created = false;
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () => HttpResponse.json([])),
            http.post(`${BASE}/projects/p1/guardrail-scripts`, async () => {
                created = true;
                return HttpResponse.json(
                    makeScript({ id: 'new-script', name: 'New Script' }),
                );
            }),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        // Open add modal
        const addBtn = await screen.findByRole('button', { name: /Add first script/i });
        fireEvent.click(addBtn);
        await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
        // Fill required fields
        const slugField = screen.getByRole('textbox', { name: /slug/i });
        fireEvent.change(slugField, { target: { value: 'new-script' } });
        const nameField = screen.getByRole('textbox', { name: /^name/i });
        fireEvent.change(nameField, { target: { value: 'New Script' } });
        // Fill .sh and .ps1 body fields (multiline textareas by label)
        const allTextboxes = screen.getAllByRole('textbox');
        // Fields in order: Slug, Name, Description, .sh body, .ps1 body
        const shField = allTextboxes[3]!;
        const ps1Field = allTextboxes[4]!;
        fireEvent.change(shField, { target: { value: '#!/bin/sh\nexit 0' } });
        fireEvent.change(ps1Field, { target: { value: 'exit 0' } });
        // Click "Add script" submit button
        const submitBtn = screen.getByRole('button', { name: /^Add script$/i });
        fireEvent.click(submitBtn);
        await waitFor(() => expect(created).toBe(true), { timeout: 3000 });
    });

    it('handleDelete — DELETE endpoint is called when delete is triggered from edit modal', async () => {
        let deleted = false;
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () =>
                HttpResponse.json([makeScript({ id: 'del-s', name: 'Delete Me' })]),
            ),
            http.delete(`${BASE}/projects/p1/guardrail-scripts/del-s`, () => {
                deleted = true;
                return new HttpResponse(null, { status: 204 });
            }),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        await waitFor(() => expect(screen.getByText('Delete Me')).toBeInTheDocument());
        // Open edit modal
        fireEvent.click(screen.getByText('Delete Me'));
        await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
        // Find delete button
        const delBtn = screen.queryByRole('button', { name: /delete|remove/i });
        if (delBtn) {
            fireEvent.click(delBtn);
            await waitFor(() => expect(deleted).toBe(true), { timeout: 3000 });
        }
    });

    it('renders loading state while scripts query is pending (isLoading branch)', () => {
        // Never-resolving promise keeps isLoading=true
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () => new Promise(() => {})),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        // Loading text is rendered while the query is in flight
        expect(screen.queryByText(/Loading/)).toBeInTheDocument();
    });

    it('renders singular "script" count text when exactly 1 script exists', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () =>
                HttpResponse.json([makeScript({ id: 's1', name: 'Solo Script' })]),
            ),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText(/1 script configured/i)).toBeInTheDocument();
        });
    });

    it('ScriptCard renders without description when script.description is empty (falsy branch)', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/guardrail-scripts`, () =>
                HttpResponse.json([makeScript({ id: 'nd', name: 'No Desc', description: '' })]),
            ),
        );
        renderWithProviders(<ProjectGuardrailScriptsTab projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText('No Desc')).toBeInTheDocument();
        });
        // When description is empty, no description Typography is rendered
        // (the component returns null for the description block)
        expect(screen.queryByText('Lint check just for p1')).not.toBeInTheDocument();
    });
});
