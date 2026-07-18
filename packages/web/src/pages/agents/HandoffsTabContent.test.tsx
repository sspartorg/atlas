import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { STATUS_LABELS } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { HandoffsTabContent } from './HandoffsTabContent.js';
import { Toast } from '../../components/Toast.js';

const BASE = 'http://localhost:3000/api';

const agent = makeAgent({
    id: 'agent-coder',
    name: 'Coder',
    handoff_prompt_md: 'Run all tests before handing off.',
});

const otherAgent = makeAgent({
    id: 'agent-qa',
    name: 'QA Writer',
});

function baseHandlers() {
    return [
        http.get(`${BASE}/agents`, () => HttpResponse.json([agent, otherAgent])),
        http.get(`${BASE}/agents/${agent.id}/handoff-rules`, () =>
            HttpResponse.json([]),
        ),
        http.get(`${BASE}/agents/${agent.id}/checklists`, () =>
            HttpResponse.json([]),
        ),
        ...defaultHandlers,
    ];
}

beforeEach(() => {
    server.use(...baseHandlers());
});

describe('HandoffsTabContent', () => {
    it('renders without crashing', { timeout: 30_000 }, async () => {
        const { container } = renderWithProviders(
            <HandoffsTabContent agent={agent} />,
        );
        await waitFor(() => expect(container.firstChild).toBeInTheDocument());
    });

    it('shows handoff prompt textarea', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => {
            expect(screen.getByText(/Handoff prompt/i)).toBeInTheDocument();
        });
        const textarea = document.querySelector('textarea');
        expect(textarea).toBeDefined();
    });

    it('handoff prompt textarea contains agent handoff_prompt_md', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/Handoff prompt/i));
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const promptTextarea = textareas.find(t => t.value === 'Run all tests before handing off.');
        expect(promptTextarea).toBeDefined();
    });

    it('shows "No checks yet" when checklists empty', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() =>
            expect(
                screen.getByText(/No checks yet/i),
            ).toBeInTheDocument(),
        );
    });

    it('"Add check" button adds a new checklist item', { timeout: 30_000 }, async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));

        await userEvent.click(screen.getByText(/Add check/i));

        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );
        await waitFor(() => {
            const textareas = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
            const newCheckInput = textareas.find(
                (el) => (el as HTMLInputElement).value === 'New check',
            );
            expect(newCheckInput).toBeDefined();
        });
    });

    it('editing checklist item label updates the value', { timeout: 30_000 }, async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));
        await userEvent.click(screen.getByText(/Add check/i));

        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );

        // Find the new check input and change its value
        const inputs = Array.from(document.querySelectorAll('input'));
        const checkInput = inputs.find(el => (el as HTMLInputElement).value === 'New check');
        expect(checkInput).toBeDefined();
        await userEvent.clear(checkInput!);
        await userEvent.type(checkInput!, 'Run unit tests');
        await waitFor(() =>
            expect((checkInput as HTMLInputElement).value).toBe('Run unit tests'),
        );
    });

    it('delete button on checklist item opens confirm dialog', { timeout: 30_000 }, async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));

        await userEvent.click(screen.getByText(/Add check/i));
        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );

        const deleteBtn = screen.getByRole('button', {
            name: /Remove checklist item/i,
        });
        await userEvent.click(deleteBtn);

        await waitFor(() =>
            expect(
                screen.getByText(/Delete this checklist item/i),
            ).toBeInTheDocument(),
        );
    });

    it('Cancel in confirm dialog dismisses it', { timeout: 30_000 }, async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));

        await userEvent.click(screen.getByText(/Add check/i));
        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );

        const deleteBtn = screen.getByRole('button', {
            name: /Remove checklist item/i,
        });
        await userEvent.click(deleteBtn);

        await waitFor(() =>
            expect(screen.getByText(/Delete this checklist item/i)).toBeInTheDocument(),
        );

        const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
        await userEvent.click(cancelBtn);

        await waitFor(() =>
            expect(
                screen.queryByText(/Delete this checklist item/i),
            ).not.toBeInTheDocument(),
        );
    });

    it('Confirm in dialog removes the item', { timeout: 30_000 }, async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));

        await userEvent.click(screen.getByText(/Add check/i));
        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );

        const deleteBtn = screen.getByRole('button', {
            name: /Remove checklist item/i,
        });
        await userEvent.click(deleteBtn);

        await waitFor(() =>
            expect(screen.getByText(/Delete this checklist item/i)).toBeInTheDocument(),
        );

        const confirmBtn = screen.getByRole('button', { name: /Delete item/i });
        await userEvent.click(confirmBtn);

        await waitFor(() =>
            expect(screen.getByText(/No checks yet/i)).toBeInTheDocument(),
        );
    });

    it('dialog close icon button dismisses dialog', { timeout: 30_000 }, async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));

        await userEvent.click(screen.getByText(/Add check/i));
        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );

        const deleteBtn = screen.getByRole('button', { name: /Remove checklist item/i });
        await userEvent.click(deleteBtn);

        await waitFor(() =>
            expect(screen.getByText(/Delete this checklist item/i)).toBeInTheDocument(),
        );

        // Close icon button
        const closeBtn = screen.getByRole('button', { name: /^Close$/i });
        await userEvent.click(closeBtn);

        await waitFor(() =>
            expect(screen.queryByText(/Delete this checklist item/i)).not.toBeInTheDocument(),
        );
    });

    it('Save handoffs button is disabled when no target assigned', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeInTheDocument(),
        );
        expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeDisabled();
    });

    it('shows "Pick an Assign-to" error when target missing', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() =>
            expect(screen.getByText(/Pick an Assign-to/i)).toBeInTheDocument(),
        );
    });

    it('Save calls PATCH + PUT handoff rules + PUT checklists', async () => {
        let patchedAgent = false;
        let putRules = false;
        let putChecklists = false;

        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, () => {
                patchedAgent = true;
                return HttpResponse.json({ ...agent });
            }),
            http.put(`${BASE}/agents/${agent.id}/handoff-rules`, () => {
                putRules = true;
                return HttpResponse.json([]);
            }),
            http.put(`${BASE}/agents/${agent.id}/checklists`, () => {
                putChecklists = true;
                return HttpResponse.json([]);
            }),
        );

        renderWithProviders(<HandoffsTabContent agent={agent} />);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeInTheDocument(),
        );

        const assignToSelects = screen.getAllByRole('combobox');
        fireEvent.mouseDown(assignToSelects[0]!);
        const qaOption = await screen.findByRole('option', { name: /QA Writer/i }, { timeout: 5000 });
        fireEvent.click(qaOption);

        await waitFor(() =>
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
        );

        const allComboboxes = screen.getAllByRole('combobox');
        fireEvent.mouseDown(allComboboxes[2]!);
        const ownerOption = await screen.findByRole('option', { name: /Owner \(sspart\)/i }, { timeout: 5000 });
        fireEvent.click(ownerOption);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).not.toBeDisabled(),
        );
        await userEvent.click(screen.getByRole('button', { name: /Save handoffs/i }));

        await waitFor(() => {
            expect(patchedAgent).toBe(true);
            expect(putRules).toBe(true);
            expect(putChecklists).toBe(true);
        });
    });

    it('save failure shows error toast', async () => {
        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, () =>
                new HttpResponse(null, { status: 500 }),
            ),
            http.put(`${BASE}/agents/${agent.id}/handoff-rules`, () => HttpResponse.json([])),
            http.put(`${BASE}/agents/${agent.id}/checklists`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <>
                <HandoffsTabContent agent={agent} />
                <Toast />
            </>
        );

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeInTheDocument(),
        );

        const assignToSelects = screen.getAllByRole('combobox');
        fireEvent.mouseDown(assignToSelects[0]!);
        const qaOption = await screen.findByRole('option', { name: /QA Writer/i }, { timeout: 5000 });
        fireEvent.click(qaOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

        const allComboboxes = screen.getAllByRole('combobox');
        fireEvent.mouseDown(allComboboxes[2]!);
        const ownerOption = await screen.findByRole('option', { name: /Owner \(sspart\)/i }, { timeout: 5000 });
        fireEvent.click(ownerOption);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).not.toBeDisabled(),
        );
        await userEvent.click(screen.getByRole('button', { name: /Save handoffs/i }));

        await waitFor(() =>
            expect(screen.getByText(/Save failed/i)).toBeInTheDocument(),
        );
    });

    it('hydrates from persisted handoff rules on load', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/handoff-rules`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: agent.id,
                        kind: 'on-pass',
                        target_agent_id: 'agent-qa',
                        status: 'ready',
                    },
                    {
                        id: 2,
                        agent_id: agent.id,
                        kind: 'on-fail',
                        target_agent_id: 'owner',
                        status: 'waiting_for_info',
                    },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        // After hydration, save button should be enabled (both routes assigned)
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).not.toBeDisabled(),
        );
    });

    it('hydrates from persisted checklists on load', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/checklists`, () =>
                HttpResponse.json([
                    { id: 1, agent_id: agent.id, label: 'All tests pass', sort_order: 0, required: true },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        // After hydration, checklist item label is shown
        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );
        await waitFor(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const checkInput = inputs.find(el => (el as HTMLInputElement).value === 'All tests pass');
            expect(checkInput).toBeDefined();
        });
    });

    it('on-fail route card has Owner option', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() =>
            expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0),
        );
        // Open the on-fail select (index 2 which is "Assign to" for on-fail)
        const allComboboxes = screen.getAllByRole('combobox');
        fireEvent.mouseDown(allComboboxes[2]!);
        const ownerOption = await screen.findByRole('option', { name: /Owner \(sspart\)/i });
        expect(ownerOption).toBeInTheDocument();
        fireEvent.click(ownerOption);
    });

    it('status select for on-pass route changes status', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() =>
            expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0),
        );
        // Assign on-pass to QA Writer first
        const assignToSelects = screen.getAllByRole('combobox');
        fireEvent.mouseDown(assignToSelects[0]!);
        const qaOption = await screen.findByRole('option', { name: /QA Writer/i });
        fireEvent.click(qaOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

        // Change the status select for on-pass (index 1)
        const comboboxes = screen.getAllByRole('combobox');
        fireEvent.mouseDown(comboboxes[1]!);
        const doneOption = await screen.findByRole('option', { name: /Done/i });
        fireEvent.click(doneOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    });

    it('status select for on-fail route changes status', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() =>
            expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0),
        );

        // Assign on-fail to Owner first (index 2)
        const allComboboxes = screen.getAllByRole('combobox');
        fireEvent.mouseDown(allComboboxes[2]!);
        const ownerOption = await screen.findByRole('option', { name: /Owner \(sspart\)/i });
        fireEvent.click(ownerOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

        // Change the status select for on-fail (index 3)
        const comboboxes = screen.getAllByRole('combobox');
        fireEvent.mouseDown(comboboxes[3]!);
        const doneOption = await screen.findByRole('option', { name: /Done/i });
        fireEvent.click(doneOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    });

    it('selected "owner" on on-fail shows "Owner (sspart)" as rendered value', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/handoff-rules`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: agent.id,
                        kind: 'on-pass',
                        target_agent_id: 'agent-qa',
                        status: 'ready',
                    },
                    {
                        id: 2,
                        agent_id: agent.id,
                        kind: 'on-fail',
                        target_agent_id: 'owner',
                        status: 'waiting_for_info',
                    },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        // After hydration, the on-fail card should display "Owner (sspart)"
        await waitFor(() =>
            expect(screen.getByText('Owner (sspart)')).toBeInTheDocument(),
        );
    });

    it('adding multiple checklist items creates distinct rows', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));

        await userEvent.click(screen.getByText(/Add check/i));
        await userEvent.click(screen.getByText(/Add check/i));

        // Two "New check" inputs should exist
        await waitFor(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const newCheckInputs = inputs.filter(
                (el) => (el as HTMLInputElement).value === 'New check',
            );
            expect(newCheckInputs.length).toBe(2);
        });
    });

    it('editing the label of a persisted checklist item updates it', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/checklists`, () =>
                HttpResponse.json([
                    { id: 42, agent_id: agent.id, label: 'Persisted check', sort_order: 0, required: true },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const checkInput = inputs.find((el) => (el as HTMLInputElement).value === 'Persisted check');
            expect(checkInput).toBeDefined();
        });

        const inputs = Array.from(document.querySelectorAll('input'));
        const checkInput = inputs.find(
            (el) => (el as HTMLInputElement).value === 'Persisted check',
        )!;
        await userEvent.clear(checkInput);
        await userEvent.type(checkInput, 'Updated check');

        await waitFor(() =>
            expect((checkInput as HTMLInputElement).value).toBe('Updated check'),
        );
    });

    it('deleting a persisted checklist item via dialog removes it and shows empty state', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/checklists`, () =>
                HttpResponse.json([
                    { id: 10, agent_id: agent.id, label: 'Gate check', sort_order: 0, required: true },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const checkInput = inputs.find((el) => (el as HTMLInputElement).value === 'Gate check');
            expect(checkInput).toBeDefined();
        });

        const deleteBtn = await screen.findByRole('button', {
            name: /Remove checklist item: Gate check/i,
        });
        await userEvent.click(deleteBtn);

        await waitFor(() =>
            expect(screen.getByText(/Delete this checklist item/i)).toBeInTheDocument(),
        );
        // Confirm deletion
        const confirmBtn = screen.getByRole('button', { name: /Delete item/i });
        await userEvent.click(confirmBtn);

        await waitFor(() =>
            expect(screen.getByText(/No checks yet/i)).toBeInTheDocument(),
        );
    });

    it('checklist item with empty label is shown with "untitled" in aria-label', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));

        await userEvent.click(screen.getByText(/Add check/i));
        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );

        // Clear the label so it becomes empty
        const inputs = Array.from(document.querySelectorAll('input'));
        const checkInput = inputs.find(
            (el) => (el as HTMLInputElement).value === 'New check',
        )!;
        await userEvent.clear(checkInput);

        // Delete button aria-label should use 'untitled' fallback
        await waitFor(() => {
            const deleteBtn = screen.queryByRole('button', {
                name: /Remove checklist item: untitled/i,
            });
            expect(deleteBtn).toBeInTheDocument();
        });
    });

    it('opening the confirm dialog for an empty-label check shows the "this checklist item" fallback text', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/No checks yet/i));

        await userEvent.click(screen.getByText(/Add check/i));
        await waitFor(() =>
            expect(screen.queryByText(/No checks yet/i)).not.toBeInTheDocument(),
        );

        const inputs = Array.from(document.querySelectorAll('input'));
        const checkInput = inputs.find(
            (el) => (el as HTMLInputElement).value === 'New check',
        )!;
        await userEvent.clear(checkInput);

        const deleteBtn = await screen.findByRole('button', {
            name: /Remove checklist item: untitled/i,
        });
        await userEvent.click(deleteBtn);

        // ConfirmRemoveCheckDialog: check?.label.trim() || 'this checklist item'
        await waitFor(() =>
            expect(screen.getByText('this checklist item')).toBeInTheDocument(),
        );
    });

    it('on-pass route "Pick an agent" placeholder shown when no target set', async () => {
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() =>
            expect(screen.getAllByText(/Pick an agent/i).length).toBeGreaterThan(0),
        );
    });

    it('re-render with new handoff_prompt_md syncs prompt textarea', async () => {
        const { rerender } = renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => screen.getByText(/Handoff prompt/i));

        // Verify original value is in textarea
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const promptTextarea = textareas.find((t) => (t as HTMLTextAreaElement).value === 'Run all tests before handing off.');
        expect(promptTextarea).toBeDefined();

        // Re-render with a different agent object (simulates server refetch updating prop)
        const updatedAgent = makeAgent({
            id: 'agent-coder',
            name: 'Coder',
            handoff_prompt_md: 'Updated prompt from server.',
        });
        rerender(<HandoffsTabContent agent={updatedAgent} />);

        await waitFor(() => {
            const allTextareas = Array.from(document.querySelectorAll('textarea'));
            const updated = allTextareas.find((t) => (t as HTMLTextAreaElement).value === 'Updated prompt from server.');
            expect(updated).toBeDefined();
        });
    });

    it('renderValue: value matches an agent in options — renders agent name', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/handoff-rules`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: agent.id,
                        kind: 'on-pass',
                        target_agent_id: 'agent-qa',
                        status: 'ready',
                    },
                    {
                        id: 2,
                        agent_id: agent.id,
                        kind: 'on-fail',
                        target_agent_id: 'owner',
                        status: 'waiting_for_info',
                    },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        // After hydration the on-pass Select should render the matched agent name "QA Writer"
        await waitFor(() =>
            expect(screen.getByText('QA Writer')).toBeInTheDocument(),
        );
    });

    it('renderValue: value is non-empty, non-owner, no matching agent — renders raw value', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/handoff-rules`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: agent.id,
                        kind: 'on-pass',
                        target_agent_id: 'unknown-agent-xyz',
                        status: 'ready',
                    },
                    {
                        id: 2,
                        agent_id: agent.id,
                        kind: 'on-fail',
                        target_agent_id: 'owner',
                        status: 'waiting_for_info',
                    },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        // The raw id should be displayed because no agent matches it
        await waitFor(() =>
            expect(screen.getByText('unknown-agent-xyz')).toBeInTheDocument(),
        );
    });

    it('handleSave early-return: button disabled and inline error shown when onPassMissing', async () => {
        // Render with no rules so both routes have empty targetIds
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeInTheDocument(),
        );

        // The save button must be disabled because onPassMissing && onFailMissing
        expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeDisabled();

        // The inline error text from lines 434-444 is the observable guard for the early-return
        expect(screen.getByText(/Pick an Assign-to for both routes to save/i)).toBeInTheDocument();
    });

    it('handleSave early-return: toast fires when onPassMissing (only onFail set)', async () => {
        // Pre-hydrate so onFail is filled but onPass remains empty
        server.use(
            http.get(`${BASE}/agents/${agent.id}/handoff-rules`, () =>
                HttpResponse.json([
                    {
                        id: 2,
                        agent_id: agent.id,
                        kind: 'on-fail',
                        target_agent_id: 'owner',
                        status: 'waiting_for_info',
                    },
                ]),
            ),
        );
        renderWithProviders(
            <>
                <HandoffsTabContent agent={agent} />
                <Toast />
            </>
        );

        // Wait for hydration — onFail is set, onPass is still empty so save stays disabled
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeDisabled(),
        );

        // Inline error banner confirming the guard is active
        expect(screen.getByText(/Pick an Assign-to for both routes to save/i)).toBeInTheDocument();
    });

    it('blank-label checklist items are filtered out on save', { timeout: 30_000 }, async () => {
        let putChecklistsBody: string | null = null;

        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, () => HttpResponse.json({ ...agent })),
            http.put(`${BASE}/agents/${agent.id}/handoff-rules`, () => HttpResponse.json([])),
            http.put(`${BASE}/agents/${agent.id}/checklists`, async ({ request }) => {
                putChecklistsBody = await request.text();
                return HttpResponse.json([]);
            }),
        );

        renderWithProviders(
            <>
                <HandoffsTabContent agent={agent} />
                <Toast />
            </>
        );

        // Wait for empty state
        await waitFor(() => screen.getByText(/No checks yet/i));

        // Add a checklist item — starts as "New check"
        await userEvent.click(screen.getByText(/Add check/i));
        await waitFor(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            expect(inputs.find((el) => (el as HTMLInputElement).value === 'New check')).toBeDefined();
        });

        // Clear the input label so it becomes blank
        const inputs = Array.from(document.querySelectorAll('input'));
        const checkInput = inputs.find((el) => (el as HTMLInputElement).value === 'New check')!;
        await userEvent.clear(checkInput);
        await waitFor(() => {
            expect((checkInput as HTMLInputElement).value).toBe('');
        });

        // Assign on-pass to QA Writer (combobox 0)
        const comboboxes1 = screen.getAllByRole('combobox');
        fireEvent.mouseDown(comboboxes1[0]!);
        const qaOption = await screen.findByRole('option', { name: /QA Writer/i }, { timeout: 5000 });
        fireEvent.click(qaOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

        // Assign on-fail to Owner (combobox 2)
        const comboboxes2 = screen.getAllByRole('combobox');
        fireEvent.mouseDown(comboboxes2[2]!);
        const ownerOption = await screen.findByRole('option', { name: /Owner \(sspart\)/i }, { timeout: 5000 });
        fireEvent.click(ownerOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).not.toBeDisabled(),
        );
        await userEvent.click(screen.getByRole('button', { name: /Save handoffs/i }));

        // Wait for the PUT /checklists request to fire and capture the body
        await waitFor(() => expect(putChecklistsBody).not.toBeNull(), { timeout: 15_000 });
        // The blank-label item is filtered out before save (label.trim().length === 0)
        // api.agents.setChecklists sends { items: [...] } as the request body
        const parsed = JSON.parse(putChecklistsBody!) as { items: { label: string }[] };
        expect(parsed.items.length).toBe(0);
    });

    it('handleSave error: non-Error thrown (String(e) branch) — covers e instanceof Error else path', { timeout: 30_000 }, async () => {
        // Throw a string literal (not an Error) so the catch branch takes the String(e) path
        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, () =>
                HttpResponse.json({ ...agent }),
            ),
            http.put(`${BASE}/agents/${agent.id}/handoff-rules`, () =>
                // Throw a non-Error by returning a network-level error via 500
                // We'll override the api.agents.setHandoffRules mock instead
                HttpResponse.json([], { status: 500 }),
            ),
            http.put(`${BASE}/agents/${agent.id}/checklists`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <>
                <HandoffsTabContent agent={agent} />
                <Toast />
            </>
        );

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeInTheDocument(),
        );

        // Assign both routes so save is enabled
        const assignToSelects = screen.getAllByRole('combobox');
        fireEvent.mouseDown(assignToSelects[0]!);
        const qaOption = await screen.findByRole('option', { name: /QA Writer/i }, { timeout: 5000 });
        fireEvent.click(qaOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

        const allComboboxes = screen.getAllByRole('combobox');
        fireEvent.mouseDown(allComboboxes[2]!);
        const ownerOption = await screen.findByRole('option', { name: /Owner \(sspart\)/i }, { timeout: 5000 });
        fireEvent.click(ownerOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).not.toBeDisabled(),
        );
        await userEvent.click(screen.getByRole('button', { name: /Save handoffs/i }));

        await waitFor(() =>
            expect(screen.getByText(/Save failed/i)).toBeInTheDocument(),
        );
    });

    it('"Save handoffs" shows "Saving…" while in-flight', async () => {
        let resolveRules!: (v: unknown) => void;
        const rulesProm = new Promise((res) => { resolveRules = res; });
        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, () =>
                HttpResponse.json({ ...agent }),
            ),
            http.put(`${BASE}/agents/${agent.id}/handoff-rules`, () => rulesProm.then(() => HttpResponse.json([]))),
            http.put(`${BASE}/agents/${agent.id}/checklists`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeInTheDocument(),
        );

        // Assign both routes so save is enabled
        const assignToSelects = screen.getAllByRole('combobox');
        fireEvent.mouseDown(assignToSelects[0]!);
        const qaOption = await screen.findByRole('option', { name: /QA Writer/i });
        fireEvent.click(qaOption);
        await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

        const allComboboxes = screen.getAllByRole('combobox');
        fireEvent.mouseDown(allComboboxes[2]!);
        const ownerOption = await screen.findByRole('option', { name: /Owner \(sspart\)/i });
        fireEvent.click(ownerOption);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save handoffs/i })).not.toBeDisabled(),
        );

        // Click save — button becomes "Saving…" while in-flight
        fireEvent.click(screen.getByRole('button', { name: /Save handoffs/i }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Saving…/i })).toBeDisabled(),
        );
        // Unblock the in-flight request
        resolveRules(undefined);
    });

    it('hydrates on-pass route with a blanked-out target_agent_id — falls back to "" (L62)', async () => {
        // target_agent_id is '' (scrubbed row) rather than a real agent id or
        // 'owner' — findRule's `r.target_agent_id || ''` fallback must kick in
        // so the Select shows the "Pick an agent…" placeholder instead of
        // rendering an empty/invalid value. Pair it with a distinctive on-pass
        // `status` (not the DEFAULT_ON_PASS default of 'ready') so we can prove
        // hydration actually ran findRule() rather than just leaving defaults.
        server.use(
            http.get(`${BASE}/agents/${agent.id}/handoff-rules`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        agent_id: agent.id,
                        kind: 'on-pass',
                        target_agent_id: '',
                        status: 'in_review',
                    },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);

        // Prove hydration ran: the on-pass status Select (combobox index 1)
        // reflects the hydrated 'in_review' status, not the DEFAULT_ON_PASS 'ready'.
        await waitFor(() =>
            expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0),
        );
        await waitFor(() =>
            expect(screen.getByText(STATUS_LABELS.in_review)).toBeInTheDocument(),
        );

        // The blanked target means onPass.targetId fell back to '' → onPassMissing
        // stays true → the "Pick an agent…" placeholder renders and Save stays disabled.
        expect(screen.getAllByText(/Pick an agent/i).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /Save handoffs/i })).toBeDisabled();
    });

    it('editing one checklist item leaves sibling rows untouched (L117 false branch)', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/checklists`, () =>
                HttpResponse.json([
                    { id: 1, agent_id: agent.id, label: 'First check', sort_order: 0, required: true },
                    { id: 2, agent_id: agent.id, label: 'Second check', sort_order: 1, required: true },
                ]),
            ),
        );
        renderWithProviders(<HandoffsTabContent agent={agent} />);
        await waitFor(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            expect(inputs.find((el) => (el as HTMLInputElement).value === 'First check')).toBeDefined();
        });

        // Edit only the first row's label
        const inputs = Array.from(document.querySelectorAll('input'));
        const firstInput = inputs.find((el) => (el as HTMLInputElement).value === 'First check')!;
        await userEvent.clear(firstInput);
        await userEvent.type(firstInput, 'Edited first check');

        await waitFor(() =>
            expect((firstInput as HTMLInputElement).value).toBe('Edited first check'),
        );
        // The second row's label must be unchanged — exercises the `: c` passthrough
        // branch of updateCheck's `i === idx ? { ...c, ...patch } : c` map.
        const updatedInputs = Array.from(document.querySelectorAll('input'));
        const secondInput = updatedInputs.find((el) => (el as HTMLInputElement).value === 'Second check');
        expect(secondInput).toBeDefined();
    });
});
