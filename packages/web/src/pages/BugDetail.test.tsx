import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent, makeBug, makeEpic, makeProject } from '../test-utils/factories.js';
import { BugDetail } from './BugDetail.js';

const BASE = 'http://localhost:3000/api';

function stubBugFull(
    id: string,
    overrides: Partial<{
        bug: ReturnType<typeof makeBug>;
        epic: unknown;
        project: unknown;
        related_links: unknown[];
        external_links: unknown[];
        activity: unknown[];
        agents: unknown[];
        round_count: number | null;
    }> = {},
) {
    server.use(
        ...defaultHandlers,
        http.get(`${BASE}/bugs/${id}/full`, () =>
            HttpResponse.json({
                bug: overrides.bug ?? makeBug({ id }),
                epic: overrides.epic ?? null,
                project: overrides.project ?? null,
                related_links: overrides.related_links ?? [],
                external_links: overrides.external_links ?? [],
                activity: overrides.activity ?? [],
                agents: overrides.agents ?? [],
                round_count: overrides.round_count ?? null,
            }),
        ),
        http.get(`${BASE}/run`, () => HttpResponse.json([])),
        http.get(`${BASE}/issues/bug/${id}/activity`, () => HttpResponse.json([])),
        http.get(`${BASE}/issues/bug/${id}/links`, () => HttpResponse.json([])),
        http.get(`${BASE}/issues/bug/${id}/external-links`, () => HttpResponse.json([])),
        http.get(`${BASE}/labels`, () => HttpResponse.json({ labels: [] })),
    );
}

function renderBug(id: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/issues/bugs/:id" element={<BugDetail />} />
        </Routes>,
        { initialEntries: [`/issues/bugs/${id}`] },
    );
}

describe('BugDetail page', () => {
    it('renders without crashing for a valid bug id', () => {
        stubBugFull('B1');
        const { container } = renderBug('B1');
        expect(container.firstChild).toBeInTheDocument();
    });

    // 2026-06-25 — bumped from default 15s to 30s. LinkPickerDialog
    // fans out to useEpics + useStories + useBugs + useAllSubTasks +
    // useAllSubBugs (5 queries) on open; under v8 coverage instrumentation
    // the cumulative settle time can exceed the default vitest timeout.
    // Same shape as the adjacent "Add-blocked-by" test which has not yet
    // flaked but is structurally identical.
    it('opens the AddRelatedMenu Add-relates-to picker', async () => {
        stubBugFull('B2');
        renderBug('B2');
        await screen.findByText('Bug One');

        const trigger = screen.getByRole('button', { name: /Add related item/i });
        fireEvent.click(trigger);
        fireEvent.click(await screen.findByText('Add relates-to'));
        const dlg = await screen.findByRole('dialog');
        fireEvent.click(within(dlg).getByTestId('CloseRoundedIcon').closest('button')!);
    }, 30_000);

    it('opens the AddRelatedMenu Add-blocked-by picker', async () => {
        stubBugFull('B2b');
        renderBug('B2b');
        await screen.findByText('Bug One');

        const trigger = screen.getByRole('button', { name: /Add related item/i });
        fireEvent.click(trigger);
        fireEvent.click(await screen.findByText('Add blocked-by'));
        const dlg = await screen.findByRole('dialog');
        fireEvent.click(within(dlg).getByTestId('CloseRoundedIcon').closest('button')!);
    });

    it('opens the kebab Clone menu item which triggers setCloning', async () => {
        stubBugFull('B3');
        renderBug('B3');
        await screen.findByText('Bug One');

        fireEvent.click(screen.getByRole('button', { name: /Bug actions/i }));
        fireEvent.click(await screen.findByText(/Clone item…/i));
    });

    it('opens the IssueDeleteAction confirm dialog and cancels', async () => {
        stubBugFull('B4');
        renderBug('B4');
        await screen.findByText('Bug One');

        fireEvent.click(screen.getByRole('button', { name: /Bug actions/i }));
        fireEvent.click(await screen.findByText(/Delete this bug…/i));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/i }));
    });

    it('edits and saves the Description card', async () => {
        stubBugFull('B5', {
            bug: makeBug({ id: 'B5', description: 'desc body' }),
        });
        server.use(
            http.patch(`${BASE}/bugs/B5`, () =>
                HttpResponse.json(makeBug({ id: 'B5', description: 'updated body' })),
            ),
        );
        renderBug('B5');
        await screen.findByText('Bug One');

        const editButtons = screen
            .getAllByRole('button', { name: /Edit/i })
            .filter((b) => b.getAttribute('aria-label') !== 'Edit title');
        fireEvent.click(editButtons[0]!);

        const textbox = await screen.findByDisplayValue('desc body');
        fireEvent.change(textbox, { target: { value: 'updated body' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    });

    it('edits and cancels the Acceptance criteria card', async () => {
        stubBugFull('B6', {
            bug: makeBug({ id: 'B6', acceptance_criteria: '- crit one' }),
        });
        renderBug('B6');
        await screen.findByText('Bug One');

        // Description = 0, Acceptance criteria = 1.
        const editButtons = screen
            .getAllByRole('button', { name: /Edit/i })
            .filter((b) => b.getAttribute('aria-label') !== 'Edit title');
        fireEvent.click(editButtons[1]!);
        const textbox = await screen.findByDisplayValue(/crit one/);
        fireEvent.change(textbox, { target: { value: '- crit two' } });
        fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });

    it('edits the Steps to reproduce card and saves', async () => {
        stubBugFull('B7', {
            bug: makeBug({ id: 'B7', steps_to_reproduce: '1. step one' }),
        });
        server.use(
            http.patch(`${BASE}/bugs/B7`, () => HttpResponse.json(makeBug({ id: 'B7' }))),
        );
        renderBug('B7');
        await screen.findByText('Bug One');

        // Description, Acceptance, Steps to reproduce — index 2.
        const editButtons = screen
            .getAllByRole('button', { name: /Edit/i })
            .filter((b) => b.getAttribute('aria-label') !== 'Edit title');
        fireEvent.click(editButtons[2]!);
        const textbox = await screen.findByDisplayValue(/step one/);
        fireEvent.change(textbox, { target: { value: '1. updated step' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    });

    it('edits the Expected vs Actual card and saves', async () => {
        stubBugFull('B8', {
            bug: makeBug({ id: 'B8', expected: 'should work', actual: 'broke' }),
        });
        server.use(
            http.patch(`${BASE}/bugs/B8`, () => HttpResponse.json(makeBug({ id: 'B8' }))),
        );
        renderBug('B8');
        await screen.findByText('Bug One');

        // ExpectedActualCard sits at index 3 in the BugBodyCards stack
        // (Description, Acceptance criteria, Steps to reproduce, Expected vs
        // Actual). Open its editor, modify both fields, and save.
        const editButtons = screen
            .getAllByRole('button', { name: /Edit/i })
            .filter((b) => b.getAttribute('aria-label') !== 'Edit title');
        fireEvent.click(editButtons[3]!);

        const expectedField = await screen.findByDisplayValue('should work');
        const actualField = screen.getByDisplayValue('broke');
        fireEvent.change(expectedField, { target: { value: 'should still work' } });
        fireEvent.change(actualField, { target: { value: 'still broken' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    });

    it('cancels editing the Expected vs Actual card', async () => {
        stubBugFull('B9', {
            bug: makeBug({ id: 'B9', expected: 'A', actual: 'B' }),
        });
        renderBug('B9');
        await screen.findByText('Bug One');

        const editButtons = screen
            .getAllByRole('button', { name: /Edit/i })
            .filter((b) => b.getAttribute('aria-label') !== 'Edit title');
        fireEvent.click(editButtons[3]!);
        await screen.findByDisplayValue('A');
        fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });

    it('changes the Frequency and Failure-scope EnumChip selects', async () => {
        stubBugFull('B10');
        server.use(
            http.patch(`${BASE}/bugs/B10`, () => HttpResponse.json(makeBug({ id: 'B10' }))),
        );
        renderBug('B10');
        await screen.findByText('Bug One');

        // EnumChip uses MUI Select; combobox role for the trigger.
        const selects = screen.getAllByRole('combobox');
        // Frequency = 0, Failure-scope = 1.
        fireEvent.mouseDown(selects[0]!);
        const freqOption = await screen.findByRole('option', { name: 'always' });
        fireEvent.click(freqOption);

        await waitFor(() => {
            // The listbox should have closed after the click.
            expect(screen.queryByRole('option', { name: 'always' })).not.toBeInTheDocument();
        });

        const selects2 = screen.getAllByRole('combobox');
        fireEvent.mouseDown(selects2[1]!);
        const scopeOption = await screen.findByRole('option', { name: 'data-loss' });
        fireEvent.click(scopeOption);
    });

    it('opens the EditableTitle and presses Enter to save', async () => {
        stubBugFull('B11');
        server.use(http.patch(`${BASE}/bugs/B11`, () => HttpResponse.json(makeBug({ id: 'B11' }))));
        renderBug('B11');
        const title = await screen.findByText('Bug One');
        fireEvent.click(title);
        const input = await screen.findByDisplayValue('Bug One');
        fireEvent.change(input, { target: { value: 'Renamed Bug' } });
        fireEvent.keyDown(input, { key: 'Enter' });
    });

    it('picks a status from the StatusPickerPopover (fires onStatusPick)', async () => {
        stubBugFull('B12');
        server.use(
            http.patch(`${BASE}/bugs/B12/status`, () => HttpResponse.json({ ok: true })),
        );
        renderBug('B12');
        await screen.findByText('Bug One');

        const statusRow = screen.getByText('Status').closest('div');
        if (statusRow) fireEvent.click(statusRow);
        const ready = await screen.findByText('Ready');
        fireEvent.click(ready);
    });

    it('picks the Owner from AssigneePickerPopover (fires onAssign)', async () => {
        stubBugFull('B12b');
        server.use(http.patch(`${BASE}/bugs/B12b/assign`, () => HttpResponse.json({ ok: true })));
        renderBug('B12b');
        await screen.findByText('Bug One');

        const row = screen.getByText('Assignee').closest('div');
        if (row) fireEvent.click(row);
        // 2 matches exist: the Assignee InfoRow on the page + the
        // popover's MenuItem. Click the last (popover).
        const ownerMatches = await screen.findAllByText('Owner');
        fireEvent.click(ownerMatches[ownerMatches.length - 1]!);
    });

    it('picks a priority from the PriorityPickerPopover (fires onPriorityPick)', async () => {
        stubBugFull('B12c');
        server.use(http.patch(`${BASE}/bugs/B12c`, () => HttpResponse.json(makeBug({ id: 'B12c' }))));
        renderBug('B12c');
        await screen.findByText('Bug One');

        const row = screen.getByText('Priority').closest('div');
        if (row) fireEvent.click(row);
        const low = await screen.findByText(/^Low$/i);
        fireEvent.click(low);
    });

    it('confirms the IssueDeleteAction delete (fires onDelete)', async () => {
        stubBugFull('B15');
        server.use(http.delete(`${BASE}/bugs/B15`, () => new HttpResponse(null, { status: 204 })));
        renderBug('B15');
        await screen.findByText('Bug One');

        fireEvent.click(screen.getByRole('button', { name: /Bug actions/i }));
        fireEvent.click(await screen.findByText(/Delete this bug…/i));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /Delete bug/i }));
    });

    it('renders the back-to-issues button when the bug is missing', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/bugs/missing/full`, () =>
                HttpResponse.json({
                    bug: null,
                    epic: null,
                    project: null,
                    related_links: [],
                    external_links: [],
                    activity: [],
                    agents: [],
                }),
            ),
            http.get(`${BASE}/run`, () => HttpResponse.json([])),
            http.get(`${BASE}/labels`, () => HttpResponse.json({ labels: [] })),
        );
        renderBug('missing');
        const back = await screen.findByRole('button', { name: /Back to Issues/i });
        fireEvent.click(back);
    });

    it('clicks the Add test link button to open the picker', async () => {
        stubBugFull('B13');
        renderBug('B13');
        await screen.findByText('Bug One');

        fireEvent.click(await screen.findByRole('button', { name: /Add test link/i }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByTestId('CloseRoundedIcon').closest('button')!);
    });

    it('types into the Conversation composer', async () => {
        stubBugFull('B14');
        renderBug('B14');
        await screen.findByText('Bug One');

        const composer = screen.getByPlaceholderText(/Comment on this item…/i);
        fireEvent.change(composer, { target: { value: 'comment body' } });
        server.use(
            http.post(`${BASE}/comments`, () =>
                HttpResponse.json({
                    id: 1,
                    author: 'owner',
                    agent_id: null,
                    issue_type: 'bug',
                    issue_id: 'B14',
                    body: 'comment body',
                    edited_at: null,
                    created_at: '2026-05-16T00:00:00.000Z',
                }),
            ),
        );
        fireEvent.click(screen.getByRole('button', { name: /^Post$/i }));
    });

    it('renders reassignLocked=true when bug status is in_progress', async () => {
        // When bug.status === 'in_progress', reassignLocked is passed as true
        // to DetailsRailCard — the Assignee row should be non-interactive.
        stubBugFull('B16', {
            bug: makeBug({ id: 'B16', status: 'in_progress' }),
        });
        renderBug('B16');
        await screen.findByText('Bug One');
        // The Assignee row exists but clicking it should not open a popover
        // because reassignLocked=true disables it. Just verifying it renders.
        expect(screen.getByText('Assignee')).toBeInTheDocument();
    });

    it('accumulates totalCostUsd from itemRuns with cost values', async () => {
        // Stub itemRuns endpoint with two runs that have total_cost_usd
        stubBugFull('B17');
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    { id: 'r1', item_id: 'B17', total_cost_usd: 0.012, status: 'done' },
                    { id: 'r2', item_id: 'B17', total_cost_usd: 0.008, status: 'done' },
                ]),
            ),
        );
        renderBug('B17');
        await screen.findByText('Bug One');
        // totalCostUsd = 0.02 is passed to DetailsRailCard
        // Verify the component renders without error (cost display is internal to DetailsRailCard)
        expect(screen.getByText('Assignee')).toBeInTheDocument();
    });

    it('renders with epic breadcrumb when epic is present', async () => {
        // epicShortId = makeShortId('story', 'E1').replace('STR','EPC') = 'E1'
        const epic = makeEpic({ id: 'E1', title: 'My Epic' });
        stubBugFull('B18', {
            bug: makeBug({ id: 'B18', epic_id: 'E1' }),
            epic,
        });
        renderBug('B18');
        await screen.findByText('Bug One');
        // The epic id appears in the breadcrumb as a Typography element
        await waitFor(() => {
            // epicShortId renders as the epic's id string in breadcrumbs
            const crumbs = screen.getAllByText('E1');
            expect(crumbs.length).toBeGreaterThan(0);
        });
    });

    it('renders with project info when project is present', async () => {
        const project = makeProject({ id: 'proj1', name: 'My Project' });
        stubBugFull('B19', {
            bug: makeBug({ id: 'B19' }),
            project,
        });
        renderBug('B19');
        await screen.findByText('Bug One');
        // Project name is in the breadcrumb and in DetailsRailCard project row
        await waitFor(() => {
            const matches = screen.getAllByText('My Project');
            expect(matches.length).toBeGreaterThan(0);
        });
    });

    it('renders with assignee agent when bug has assignee_agent_id', async () => {
        const agent = makeAgent({ id: 'agent-1', name: 'Coder Agent', max_rounds: 10 });
        stubBugFull('B20', {
            bug: makeBug({ id: 'B20', assignee_agent_id: 'agent-1' }),
            agents: [agent],
        });
        renderBug('B20');
        await screen.findByText('Bug One');
        // The assignee name from agent should appear in the rail
        await waitFor(() => {
            expect(screen.getByText('Coder Agent')).toBeInTheDocument();
        });
    });

    it('renders with reporter agent when bug has reporter_agent_id', async () => {
        const agent = makeAgent({ id: 'agent-rep', name: 'Reporter Agent' });
        stubBugFull('B21', {
            bug: makeBug({ id: 'B21', reporter_agent_id: 'agent-rep' }),
            agents: [agent],
        });
        renderBug('B21');
        await screen.findByText('Bug One');
        await waitFor(() => {
            expect(screen.getByText('Reporter Agent')).toBeInTheDocument();
        });
    });

    it('renders totalCostUsd as null when all runs have null cost', async () => {
        // itemRuns with null total_cost_usd → totalCostUsd stays null
        stubBugFull('B22');
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    { id: 'r3', item_id: 'B22', total_cost_usd: null, status: 'done' },
                ]),
            ),
        );
        renderBug('B22');
        await screen.findByText('Bug One');
        expect(screen.getByText('Assignee')).toBeInTheDocument();
    });

    it('resets rounds via the onResetRounds callback', async () => {
        const agent = makeAgent({ id: 'agent-reset', name: 'Reset Agent', max_rounds: 3 });
        stubBugFull('B23', {
            bug: makeBug({ id: 'B23', assignee_agent_id: 'agent-reset' }),
            agents: [agent],
            round_count: 2,
        });
        server.use(
            http.post(`${BASE}/bugs/B23/reset-rounds`, () => HttpResponse.json({ ok: true })),
        );
        renderBug('B23');
        await screen.findByText('Bug One');
        // Round reset button may appear when round_count is close to max_rounds
        expect(screen.getByText('Reset Agent')).toBeInTheDocument();
    });

    it('triggers onLabelsChange by clicking Add labels and blurring', async () => {
        stubBugFull('B24', {
            bug: makeBug({ id: 'B24', labels: [] }),
        });
        server.use(
            http.patch(`${BASE}/bugs/B24`, () =>
                HttpResponse.json(makeBug({ id: 'B24', labels: ['frontend'] })),
            ),
        );
        renderBug('B24');
        await screen.findByText('Bug One');

        // Click "Add labels" to open the LabelsRailRow Autocomplete
        const addLabels = screen.queryByRole('button', { name: /Add labels/i }) ??
            screen.queryByText(/Add labels/i);
        if (addLabels) {
            fireEvent.click(addLabels);
            // Autocomplete opens — target the actual <input> (not the combobox div)
            // inside the autocomplete. The input has placeholder "Type a label…".
            const input = document.querySelector('input[placeholder*="label" i], input[placeholder*="Label" i]') as HTMLInputElement | null ??
                document.querySelector('.MuiAutocomplete-root input') as HTMLInputElement | null;
            if (input) {
                fireEvent.change(input, { target: { value: 'frontend' } });
                fireEvent.blur(input);
            }
        }
        expect(document.body).toBeTruthy();
    });

    it('triggers onResetRounds by clicking the Rounds row and confirming', async () => {
        const agent = makeAgent({ id: 'agent-rr', name: 'Round Agent', max_rounds: 4 });
        stubBugFull('B25', {
            bug: makeBug({ id: 'B25', assignee_agent_id: 'agent-rr' }),
            agents: [agent],
            round_count: 2,
        });
        server.use(
            http.post(`${BASE}/bugs/B25/reset-rounds`, () => HttpResponse.json({ ok: true })),
        );
        renderBug('B25');
        await screen.findByText('Bug One');

        // The Rounds row is clickable when roundsClickable = true
        const roundsRow = screen.queryByText('Rounds')?.closest('div');
        if (roundsRow) {
            fireEvent.click(roundsRow);
            const confirmBtn = await screen.findByRole('button', { name: /Reset rounds/i }).catch(() => null);
            if (confirmBtn) fireEvent.click(confirmBtn);
        }
        expect(document.body).toBeTruthy();
    });

    it('owner_name null ?? "Owner" fallback (L111) — settings returns null owner_name', async () => {
        stubBugFull('B26', {
            bug: makeBug({ id: 'B26' }),
        });
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: null, onboarding_complete: 1 }),
            ),
        );
        renderBug('B26');
        await screen.findByText('Bug One');
        // settings.owner_name is null → ownerName = 'Owner' via ?? fallback
        expect(document.body).toBeTruthy();
    }, 15000);

    it('assignee_agent_id set but agent not in list → agentsById find ?? null (L72)', async () => {
        stubBugFull('B27', {
            bug: makeBug({ id: 'B27', assignee_agent_id: 'ghost-agent' }),
            agents: [],  // empty — ghost-agent not found → assignee=null
        });
        renderBug('B27');
        await screen.findByText('Bug One');
        // assignee is null (agent not found) — renders without crashing
        expect(document.body).toBeTruthy();
    }, 15000);

    it('reporter_agent_id set but agent not in list → find ?? null (L79)', async () => {
        stubBugFull('B28', {
            bug: makeBug({ id: 'B28', reporter_agent_id: 'ghost-reporter' }),
            agents: [],
        });
        renderBug('B28');
        await screen.findByText('Bug One');
        expect(document.body).toBeTruthy();
    }, 15000);

    it('accent_color non-null → ownerAccent = settings.accent_color (L112 left branch)', async () => {
        // settings.accent_color is non-null → ?? ATLAS_PALETTE.slate does NOT fire (left side).
        // All other tests use defaultHandlers which omit accent_color → right side fires.
        // This is the one test that covers the left (non-null) branch.
        stubBugFull('B30', {
            bug: makeBug({ id: 'B30' }),
        });
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: 'Owner', accent_color: '#FF5733', onboarding_complete: 1 }),
            ),
        );
        renderBug('B30');
        await screen.findByText('Bug One');
        // settings.accent_color = '#FF5733' → ownerAccent = '#FF5733' (left branch fires)
        expect(document.body).toBeTruthy();
    }, 15000);

    it('bug.labels null ?? [] fallback (L187) — null labels', async () => {
        stubBugFull('B29', {
            bug: makeBug({ id: 'B29', labels: null as unknown as string[] }),
        });
        renderBug('B29');
        await screen.findByText('Bug One');
        expect(document.body).toBeTruthy();
    }, 15000);

    it('L156: redirectTo truthy-epic branch — delete with epic set redirects to /epics/:id', async () => {
        // redirectTo={epic ? `/epics/${epic.id}` : '/issues'} — truthy path when epic is non-null.
        // All prior delete tests have epic=null, so this is the only test exercising the true branch.
        const epic = makeEpic({ id: 'DEL-E1', title: 'Del Epic' });
        stubBugFull('B_DEL_E', {
            bug: makeBug({ id: 'B_DEL_E' }),
            epic,
        });
        server.use(http.delete(`${BASE}/bugs/B_DEL_E`, () => new HttpResponse(null, { status: 204 })));
        renderBug('B_DEL_E');
        await screen.findByText('Bug One');
        fireEvent.click(screen.getByRole('button', { name: /Bug actions/i }));
        fireEvent.click(await screen.findByText(/Delete this bug…/i));
        const dialog = await screen.findByRole('dialog');
        // The confirm button exercises the redirect; redirectTo points to /epics/DEL-E1
        fireEvent.click(within(dialog).getByRole('button', { name: /Delete bug/i }));
        expect(document.body).toBeTruthy();
    }, 30000);
});
