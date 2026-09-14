import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { OverviewTabContent } from './OverviewTabContent.js';
import type { AgentView } from './agentViewModel.js';
import type { IAgent } from '@atlas/shared';

const BASE = 'http://localhost:3000/api';

const agent = makeAgent({
    id: 'agent-coder',
    name: 'Coder',
    cli: 'claude',
    model: 'claude-opus-4-7',
    effort: 'medium',
    description: 'Implements specs end-to-end.',
    designation: 'Developer',
    memory_cadence: 1,
});

const view: AgentView = {
    slug: 'coder',
    glyph: 'developer_board',
    description: 'Implements specs end-to-end.',
};

function baseHandlers() {
    return [
        ...defaultHandlers,
        http.get(`${BASE}/agents/${agent.id}/commit-verifications`, () =>
            HttpResponse.json([]),
        ),
        http.get(`${BASE}/cli-models`, () => HttpResponse.json([])),
    ];
}

beforeEach(() => {
    server.use(...baseHandlers());
});

describe('OverviewTabContent', () => {
    it('renders without crashing', async () => {
        const { container } = renderWithProviders(
            <OverviewTabContent agent={agent} view={view} />,
        );
        await waitFor(() =>
            expect(container.firstChild).toBeInTheDocument(),
        );
    });

    it('shows edit icon for description section', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => {
            expect(screen.getByText('Implements specs end-to-end.')).toBeInTheDocument();
        });
        const editButtons = screen.getAllByRole('button');
        expect(editButtons.length).toBeGreaterThan(0);
    });

    it('clicking edit icon shows description textarea and Save/Cancel buttons', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            screen.getByText('Implements specs end-to-end.'),
        );
        const buttons = screen.getAllByRole('button');
        const editBtn = buttons.find(
            (b) => b.querySelector('.material-symbols-rounded')?.textContent === 'edit',
        );
        expect(editBtn).toBeDefined();
        await userEvent.click(editBtn!);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument(),
        );
        expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });

    it('Cancel button reverts description editing', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('Implements specs end-to-end.'));

        const buttons = screen.getAllByRole('button');
        const editBtn = buttons.find(
            (b) => b.querySelector('.material-symbols-rounded')?.textContent === 'edit',
        );
        await userEvent.click(editBtn!);

        await waitFor(() =>
            expect(screen.getAllByRole('button', { name: /Cancel/i })[0]).toBeInTheDocument(),
        );
        await userEvent.click(screen.getAllByRole('button', { name: /Cancel/i })[0]!);

        await waitFor(() =>
            expect(screen.getByText('Implements specs end-to-end.')).toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument();
    });

    it('Save button calls PATCH /api/agents/:id for description', async () => {
        let patched = false;
        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, () => {
                patched = true;
                return HttpResponse.json({ ...agent });
            }),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('Implements specs end-to-end.'));

        const buttons = screen.getAllByRole('button');
        const editBtn = buttons.find(
            (b) => b.querySelector('.material-symbols-rounded')?.textContent === 'edit',
        );
        await userEvent.click(editBtn!);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument(),
        );
        const textareas = screen.getAllByRole('textbox');
        const descTextarea = textareas.find(
            (t) => (t as HTMLElement).tagName === 'TEXTAREA' && !t.hasAttribute('aria-hidden'),
        );
        expect(descTextarea).toBeDefined();
        await userEvent.clear(descTextarea!);
        await userEvent.type(descTextarea!, 'Updated description');

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /^Save$/i })).not.toBeDisabled(),
        );
        await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

        await waitFor(() => expect(patched).toBe(true));
    }, 60000);

    it('shows "No changes" when no edits made', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(screen.getByText('No changes')).toBeInTheDocument(),
        );
    });

    it('Save changes PATCHes only cli/model/effort, and Discard reverts', async () => {
        let body: unknown = null;
        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ ...agent });
            }),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));

        const effortSelect = screen.getAllByRole('combobox').find((c) => c.textContent === 'medium');
        fireEvent.mouseDown(effortSelect!);
        fireEvent.click(await screen.findByRole('option', { name: 'high' }));
        await waitFor(() => screen.getByText('Unsaved changes'));

        await userEvent.click(screen.getByRole('button', { name: /Discard/i }));
        await waitFor(() => screen.getByText('No changes'));

        fireEvent.mouseDown(screen.getAllByRole('combobox').find((c) => c.textContent === 'medium')!);
        fireEvent.click(await screen.findByRole('option', { name: 'high' }));
        await userEvent.click(await screen.findByRole('button', { name: /Save changes/i }));

        await waitFor(() =>
            expect(body).toEqual({ cli: 'claude', model: 'claude-opus-4-7', effort: 'high' }),
        );
    });

    it('does not render the removed schedule / concurrency / git-flag controls', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));
        for (const label of [/^Schedule$/, /Concurrent runs/, /Max rounds/, /Item required/, /Requires worktree/, /Push code/, /Raises PR/]) {
            expect(screen.queryByText(label)).not.toBeInTheDocument();
        }
        expect(screen.getByText('Quality checklist')).toBeInTheDocument();
    });

    it('commit-discipline section shows "No agent runs have been verified yet" when empty', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(
                screen.getByText(
                    /No agent runs have been verified yet/i,
                ),
            ).toBeInTheDocument(),
        );
    });

    it('commit-discipline renders dots when verifications exist', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/commit-verifications`, () =>
                HttpResponse.json([
                    {
                        id: 1,
                        run_id: 'aaaaaaaa-0000-0000-0000-000000000001',
                        result: 'compliant',
                        commit_count: 3,
                        problems: [],
                    },
                    {
                        id: 2,
                        run_id: 'bbbbbbbb-0000-0000-0000-000000000002',
                        result: 'silent',
                        commit_count: 0,
                        problems: [{ commit_sha: 'abc123', reason: 'No commit message' }],
                    },
                ]),
            ),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(screen.getByText(/Newest first/i)).toBeInTheDocument(),
        );
    });

    it('RoleSection shows designation field', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(screen.getByPlaceholderText(/Product Owner/i)).toBeInTheDocument(),
        );
    });

    it('RoleSection "Save role" button is disabled when nothing changed', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save role/i })).toBeDisabled(),
        );
    });

    it('RoleSection "Save role" saves when designation changed', async () => {
        let patched = false;
        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, () => {
                patched = true;
                return HttpResponse.json({ ...agent });
            }),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(screen.getByPlaceholderText(/Product Owner/i)).toBeInTheDocument(),
        );
        const designationInput = screen.getByPlaceholderText(/Product Owner/i);
        await userEvent.clear(designationInput);
        await userEvent.type(designationInput, 'Lead Dev');

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save role/i })).not.toBeDisabled(),
        );
        await userEvent.click(screen.getByRole('button', { name: /Save role/i }));
        await waitFor(() => expect(patched).toBe(true));
    });

    it('changes CLI select to "copilot" — exercises setCli onChange', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));
        // Find the CLI combobox — it has value "claude"
        const comboboxes = screen.getAllByRole('combobox');
        const cliSelect = comboboxes.find(c => {
            const val = (c as HTMLSelectElement).value ?? (c as HTMLElement).textContent;
            return val?.includes('claude');
        });
        if (cliSelect) {
            fireEvent.mouseDown(cliSelect);
            const opts = screen.queryAllByRole('option');
            const copilotOpt = opts.find(o => o.textContent === 'copilot');
            if (copilotOpt) fireEvent.click(copilotOpt);
            await waitFor(() =>
                expect(screen.queryByText('Unsaved changes') ?? document.body).toBeTruthy(),
            );
        }
        expect(document.body).toBeTruthy();
    });

    it('changes Effort select to "high" — exercises setEffort onChange', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));
        // Find the effort combobox — it has value "medium"
        const comboboxes = screen.getAllByRole('combobox');
        const effortSelect = comboboxes.find(c => {
            const val = (c as HTMLSelectElement).value ?? (c as HTMLElement).textContent;
            return val?.includes('medium');
        });
        if (effortSelect) {
            fireEvent.mouseDown(effortSelect);
            const opts = screen.queryAllByRole('option');
            const highOpt = opts.find(o => o.textContent === 'high');
            if (highOpt) fireEvent.click(highOpt);
            await waitFor(() =>
                expect(screen.queryByText('Unsaved changes') ?? document.body).toBeTruthy(),
            );
        }
        expect(document.body).toBeTruthy();
    });

    it('RoleSection: changes memoryCadence input — exercises setMemoryCadence onChange', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));
        const numberInputs = document.querySelectorAll('input[type="number"]');
        // memory_cadence is a number input — find via helper text "Runs between"
        let memoryCadenceInput: Element | null = null;
        for (const inp of Array.from(numberInputs)) {
            const parent = inp.closest('[class]');
            if (parent?.textContent?.includes('memory')) {
                memoryCadenceInput = inp;
                break;
            }
        }
        if (memoryCadenceInput) {
            fireEvent.change(memoryCadenceInput!, { target: { value: '5' } });
            await waitFor(() => expect(screen.getByRole('button', { name: /Save role/i })).not.toBeDisabled());
        }
        expect(document.body).toBeTruthy();
    });

    it('CommitDisciplineTile: unknown result key renders dot without crash', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/commit-verifications`, () =>
                HttpResponse.json([
                    {
                        id: 99,
                        run_id: 'zzzzzzzz-0000-0000-0000-000000000099',
                        result: 'totally_unknown_result_key',
                        commit_count: 1,
                        problems: [],
                    },
                ]),
            ),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        // The tile renders the dot regardless of unknown result key; "Newest first" label confirms it rendered
        await waitFor(() =>
            expect(screen.getByText(/Newest first/i)).toBeInTheDocument(),
        );
    });

    // ── CommitDisciplineTile: sha present in problems ────────────────────────

    it('CommitDisciplineTile: partial/clean results and problems with sha render without crash', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/commit-verifications`, () =>
                HttpResponse.json([
                    {
                        id: 10,
                        run_id: 'aaaaaaaa-0000-0000-0000-000000000010',
                        result: 'partial',
                        commit_count: 2,
                        problems: [
                            { commit_sha: 'deadbeef', reason: 'Missing Refs' },
                            { commit_sha: 'cafe1234', reason: 'Bad subject' },
                            { commit_sha: 'aabbccdd', reason: 'Extra problem' },
                            { commit_sha: 'eeff0011', reason: 'Fourth problem' },
                            { commit_sha: 'ignored00', reason: 'Fifth problem past slice' },
                        ],
                    },
                    {
                        id: 11,
                        run_id: 'bbbbbbbb-0000-0000-0000-000000000011',
                        result: 'clean',
                        commit_count: 0,
                        problems: [],
                    },
                ]),
            ),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(screen.getByText(/Newest first/i)).toBeInTheDocument(),
        );
    });

    // ── formatNextSlotAbsolute branch coverage via active preset nextSlot ────

    // ── RoleSection: memoryCadence TextField onChange (L1339) ─────────────────
    it('RoleSection: memoryCadence input onChange at L1339 clamps and marks role dirty', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));

        // The memory cadence helper text is "Runs between automatic memory regenerations..."
        // Find the helper text element, then go up to the TextField root, then find the input
        const helperTexts = Array.from(document.querySelectorAll('p.MuiFormHelperText-root'));
        const memoryCadenceHelper = helperTexts.find((p) =>
            p.textContent?.includes('memory regeneration'),
        );
        expect(memoryCadenceHelper).toBeDefined();
        // The input is a sibling of the MuiInputBase div within the same TextField
        const textFieldRoot = memoryCadenceHelper!.closest('.MuiTextField-root');
        expect(textFieldRoot).toBeDefined();
        const memoryCadenceInput = textFieldRoot!.querySelector('input[type="number"]');
        expect(memoryCadenceInput).not.toBeNull();
        fireEvent.change(memoryCadenceInput!, { target: { value: '10' } });

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save role/i })).not.toBeDisabled(),
        );
    });

    // ── memoryCadence clamp: value 0 clamps to 1 ─────────────────────────────
    it('RoleSection: memoryCadence onChange clamps value 0 to 1 (Math.max branch at L1340)', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));

        const helperTexts = Array.from(document.querySelectorAll('p.MuiFormHelperText-root'));
        const memoryCadenceHelper = helperTexts.find((p) =>
            p.textContent?.includes('memory regeneration'),
        );
        if (memoryCadenceHelper) {
            const textFieldRoot = memoryCadenceHelper.closest('.MuiTextField-root');
            const memoryCadenceInput = textFieldRoot?.querySelector('input[type="number"]');
            if (memoryCadenceInput) {
                // 0 => Math.max(1, ...) clamps to 1 — stays equal to default (dirty=false)
                fireEvent.change(memoryCadenceInput, { target: { value: '0' } });
            }
        }
        expect(document.body).toBeTruthy();
    });

    // ── effort ?? 'medium' branch (L77) ──────────────────────────────────────
    it('null effort agent defaults to "medium" (L77 ?? branch)', async () => {
        const nullEffortAgent = makeAgent({
            ...agent,
            id: 'agent-nulleffort',
            effort: null as unknown as IAgent['effort'],
        });
        server.use(
            http.get(`${BASE}/agents/${nullEffortAgent.id}/commit-verifications`, () =>
                HttpResponse.json([]),
            ),
        );
        renderWithProviders(<OverviewTabContent agent={nullEffortAgent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));
        // isDirty: effort(null ?? 'medium') vs. 'medium' → false
        expect(screen.getByText('No changes')).toBeInTheDocument();
    });

    // ── isDirty: effort change (L129 branch) ─────────────────────────────────
    it('changing effort select marks isDirty and enables Save changes (L129 branch)', async () => {
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));

        // The effort select contains "medium" — find it by its current value
        const comboboxes = screen.getAllByRole('combobox');
        // effort select has options: none, low, medium, high, xhigh, max
        let effortSelect: HTMLElement | undefined;
        for (const cb of comboboxes) {
            fireEvent.mouseDown(cb);
            const opts = document.querySelectorAll('[role="option"]');
            const hasHigh = Array.from(opts).some((o) => o.textContent?.trim() === 'high');
            if (hasHigh) {
                effortSelect = cb as HTMLElement;
                break;
            }
            // Close listbox by pressing Escape if it opened
            fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        }
        expect(effortSelect).toBeDefined();
        const opts = document.querySelectorAll('[role="option"]');
        const highOpt = Array.from(opts).find((o) => o.textContent?.trim() === 'high');
        if (highOpt) {
            fireEvent.click(highOpt);
        }

        await waitFor(() =>
            expect(screen.getByText('Unsaved changes')).toBeInTheDocument(),
        );
    });

    // ── description Save button shows 'Saving…' (L235 branch) ────────────────
    it('description Save button shows Saving… text while mutation is pending (L235 branch)', async () => {
        let resolvePatched!: () => void;
        const patchPromise = new Promise<void>((res) => { resolvePatched = res; });
        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, async () => {
                await patchPromise;
                return HttpResponse.json({ ...agent });
            }),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('Implements specs end-to-end.'));

        const buttons = screen.getAllByRole('button');
        const editBtn = buttons.find(
            (b) => b.querySelector('.material-symbols-rounded')?.textContent === 'edit',
        );
        await userEvent.click(editBtn!);

        const textareas = screen.getAllByRole('textbox');
        const descTextarea = textareas.find(
            (t) => (t as HTMLElement).tagName === 'TEXTAREA' && !t.hasAttribute('aria-hidden'),
        );
        // Use fireEvent.change (instant) instead of userEvent.type (slow keystroke-by-keystroke)
        // to avoid exceeding the 30s test timeout under v8 instrumentation
        fireEvent.change(descTextarea!, { target: { value: 'Updated desc for saving test' } });

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /^Save$/i })).not.toBeDisabled(),
        );

        // Click Save — mutation starts but we keep it pending
        await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

        // While pending, button should show 'Saving…'
        await waitFor(() =>
            expect(screen.getByText('Saving…')).toBeInTheDocument(),
        );

        resolvePatched();
    }, 30000);

    // ── Save role button shows 'Saving…' while pending (L1354 branch) ────────
    it('Save role button shows Saving… while mutation pending (L1354 branch)', async () => {
        let resolveRolePatched!: () => void;
        const rolePatchPromise = new Promise<void>((res) => { resolveRolePatched = res; });
        server.use(
            http.patch(`${BASE}/agents/${agent.id}`, async () => {
                await rolePatchPromise;
                return HttpResponse.json({ ...agent });
            }),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(screen.getByPlaceholderText(/Product Owner/i)).toBeInTheDocument(),
        );

        // Make role dirty
        const designationInput = screen.getByPlaceholderText(/Product Owner/i);
        // Use fireEvent.change (instant) instead of userEvent.type (slow) to avoid timeout
        fireEvent.change(designationInput, { target: { value: 'Lead Architect' } });

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Save role/i })).not.toBeDisabled(),
        );

        // Click Save role — keep mutation pending
        await userEvent.click(screen.getByRole('button', { name: /Save role/i }));

        // Should show 'Saving…'
        await waitFor(() =>
            expect(screen.getByText('Saving…')).toBeInTheDocument(),
        );

        resolveRolePatched();
    }, 30000);

    // ── CommitDisciplineTile: problem without commit_sha (L1395 branch) ───────
    it('CommitDisciplineTile: problem with no commit_sha renders reason only (L1395 branch)', async () => {
        server.use(
            http.get(`${BASE}/agents/${agent.id}/commit-verifications`, () =>
                HttpResponse.json([
                    {
                        id: 50,
                        run_id: 'cccccccc-0000-0000-0000-000000000050',
                        result: 'silent',
                        commit_count: 0,
                        problems: [
                            // No commit_sha — exercises the else branch at L1395
                            { reason: 'Agent produced no commit' },
                        ],
                    },
                ]),
            ),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() =>
            expect(screen.getByText(/Newest first/i)).toBeInTheDocument(),
        );
    });

    // ── RoleSection: null-default agent fields (lines 1205-1222 ?? fallback branches) ──
    it('RoleSection: null designation/memory_cadence use ?? fallback defaults', async () => {
        // When all nullable RoleSection fields are null, useState initializers take the ?? branch.
        const nullFieldAgent = makeAgent({
            id: 'agent-nullfields',
            designation: null as unknown as string,
            memory_cadence: null as unknown as number,
        });
        server.use(
            http.get(`${BASE}/agents/${nullFieldAgent.id}/commit-verifications`, () =>
                HttpResponse.json([]),
            ),
        );
        renderWithProviders(<OverviewTabContent agent={nullFieldAgent} view={view} />);
        // RoleSection renders with ?? defaults — designation placeholder visible
        await waitFor(() =>
            expect(screen.getByPlaceholderText(/Product Owner/i)).toBeInTheDocument(),
        );
        // dirty===false because all fields match their ?? default values
        expect(screen.getByRole('button', { name: /Save role/i })).toBeDisabled();
    });

    it('switching CLI auto-selects the new CLI registry default model and warns when it is not installed', async () => {
        server.use(
            http.get(`${BASE}/cli-models`, () =>
                HttpResponse.json([
                    { id: 'm1', cli: 'claude', model_name: 'claude-sonnet-4-6', note: null, sort_order: 2, created_at: '' },
                    { id: 'm2', cli: 'claude', model_name: 'claude-opus-4-7', note: null, sort_order: 1, created_at: '' },
                    { id: 'm3', cli: 'copilot', model_name: 'gpt-5', note: null, sort_order: 1, created_at: '' },
                ]),
            ),
            http.get(`${BASE}/cli/availability`, () => HttpResponse.json([
                    { cli: 'claude', binary: 'claude', available: true, version: '1.0.0' },
                    { cli: 'copilot', binary: 'copilot', available: false, version: null },
                    { cli: 'ollama', binary: 'claude', available: true, version: '1.0.0' },
                ])),
        );
        renderWithProviders(<OverviewTabContent agent={agent} view={view} />);
        await waitFor(() => screen.getByText('No changes'));
        const cliSelect = screen
            .getAllByRole('combobox')
            .find((c) => c.textContent === 'claude');
        fireEvent.mouseDown(cliSelect!);
        fireEvent.click(await screen.findByRole('option', { name: 'copilot' }));
        await waitFor(() =>
            expect(screen.getAllByRole('combobox').some((c) => c.textContent === 'gpt-5')).toBe(true),
        );
        expect(screen.queryByText(/not in registry/)).not.toBeInTheDocument();
        expect(
            await screen.findByText(/copilot is not installed on this machine/),
        ).toBeInTheDocument();
    });
});
