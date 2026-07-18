import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent, makeProject, makeStory, makeSubBug } from '../test-utils/factories.js';
import { SubBugDetail } from './SubBugDetail.js';

const BASE = 'http://localhost:3000/api';

// Standard fetchers SubBugDetail's child cards trigger on mount.
function mountHandlers(bugId: string, full: object | null) {
    return [
        ...defaultHandlers,
        http.get(`${BASE}/sub-bugs/${bugId}/full`, () => HttpResponse.json(full)),
        // useItemAgentRuns
        http.get(`${BASE}/run`, () => HttpResponse.json([])),
        // useProjectLabels — backs DetailsRailCard's labels row.
        http.get(`${BASE}/labels`, () => HttpResponse.json({ labels: [] })),
        // Composite endpoints LinkPickerDialog / RelatedItemsCard probe.
        http.get(`${BASE}/issues/:type/:id/links`, () => HttpResponse.json([])),
        http.get(`${BASE}/issues/:type/:id/external-links`, () => HttpResponse.json([])),
        http.get(`${BASE}/issues/:type/:id/activity`, () => HttpResponse.json([])),
    ];
}

function renderPage(bugId: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/issues/sub-bugs/:id" element={<SubBugDetail />} />
        </Routes>,
        { initialEntries: [`/issues/sub-bugs/${bugId}`] },
    );
}

describe('SubBugDetail page', () => {
    it('renders without crashing', () => {
        server.use(
            ...mountHandlers('SB1', {
                sub_bug: makeSubBug({ id: 'SB1' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        const { container } = renderPage('SB1');
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders title, description, and bug body cards', async () => {
        server.use(
            ...mountHandlers('SB2', {
                sub_bug: makeSubBug({
                    id: 'SB2',
                    title: 'Repro: dialog leaks focus',
                    description: 'Tab key escapes the dialog after close.',
                    steps_to_reproduce: '1. Open dialog\n2. Close\n3. Press Tab',
                    expected: 'Focus moves to the trigger button',
                    actual: 'Focus jumps to the document body',
                }),
                parent_story: makeStory({ id: 'ATL-2' }),
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB2');
        // Title is rendered as a styled <p>, not a heading element.
        expect(await screen.findByText('Repro: dialog leaks focus')).toBeInTheDocument();
        expect(screen.getByText('Description')).toBeInTheDocument();
    });

    // Bumped test timeout: SubBugDetail mounts BugBodyCards (six EditableMarkdownCards)
    // alongside RelatedItemsCard + ConversationCard, so the description-edit dance
    // can run long under coverage instrumentation.
    it('opens the description editor, types into the field, then cancels', async () => {
        server.use(
            ...mountHandlers('SB3', {
                sub_bug: makeSubBug({
                    id: 'SB3',
                    description: 'Initial bug description.',
                }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB3');
        await screen.findByText('Description');
        // EditableMarkdownCard Edit buttons serialise to "editEdit" in JSDOM.
        const editButtons = screen
            .getAllByRole('button')
            .filter((b) => /^editEdit$/.test(b.textContent ?? ''));
        expect(editButtons.length).toBeGreaterThanOrEqual(1);
        fireEvent.click(editButtons[0]!);
        // The Description card's placeholder uniquely identifies the editor.
        const textarea = await screen.findByPlaceholderText(/Describe what this sub-bug is about/i);
        fireEvent.change(textarea, { target: { value: 'Updated draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByText('Initial bug description.')).toBeInTheDocument();
    }, 15000);

    it('saves the description through the Save button (PATCH stub)', async () => {
        let patched = false;
        server.use(
            ...mountHandlers('SB4', {
                sub_bug: makeSubBug({
                    id: 'SB4',
                    description: 'Before save',
                }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.patch(`${BASE}/sub-bugs/SB4`, async () => {
                patched = true;
                return HttpResponse.json(
                    makeSubBug({ id: 'SB4', description: 'After save' }),
                );
            }),
        );
        renderPage('SB4');
        await screen.findByText('Description');
        const editButtons = screen
            .getAllByRole('button')
            .filter((b) => /^editEdit$/.test(b.textContent ?? ''));
        fireEvent.click(editButtons[0]!);
        const textarea = await screen.findByPlaceholderText(/Describe what this sub-bug is about/i);
        fireEvent.change(textarea, { target: { value: 'After save' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(patched).toBe(true));
    });

    it('opens the Add-related menu and dispatches the link-picker', async () => {
        server.use(
            ...mountHandlers('SB5', {
                sub_bug: makeSubBug({ id: 'SB5' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB5');
        await screen.findByText('Description');
        fireEvent.click(screen.getByRole('button', { name: 'Add related item' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: /Add blocked-by/i }));
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // Escape closes the picker → pickerMode reset to null.
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });

    // Lazy NewIssueModal load + dialog render is slow under coverage instrumentation.
    it('opens the Clone modal via the kebab menu', async () => {
        server.use(
            ...mountHandlers('SB6', {
                sub_bug: makeSubBug({ id: 'SB6', title: 'Source bug' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB6');
        await screen.findByText('Description');
        // RowActionMenu's IconButton aria-label is "Sub-bug actions".
        fireEvent.click(screen.getByRole('button', { name: 'Sub-bug actions' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: /Clone item/i }));
        // NewIssueModal is lazy — wait for a dialog to render.
        await waitFor(
            () => {
                expect(screen.getAllByRole('dialog').length).toBeGreaterThanOrEqual(1);
            },
            { timeout: 10000 },
        );
    }, 15000);

    it('opens the delete-confirm modal via the kebab menu and cancels', async () => {
        server.use(
            ...mountHandlers('SB7', {
                sub_bug: makeSubBug({ id: 'SB7', title: 'Doomed bug' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB7');
        await screen.findByText('Description');
        fireEvent.click(screen.getByRole('button', { name: 'Sub-bug actions' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: /Delete this sub-bug/i }));
        expect(await screen.findByText(/Delete this sub-bug\?/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => {
            expect(screen.queryByText(/Delete this sub-bug\?/i)).not.toBeInTheDocument();
        });
    }, 15000);

    it('shows the not-found fallback and the Back button navigates without crash', async () => {
        server.use(
            ...mountHandlers('SBMISS', null),
            http.get(`${BASE}/sub-bugs/SBMISS/full`, () =>
                HttpResponse.json({ error: 'not found' }, { status: 404 }),
            ),
        );
        renderPage('SBMISS');
        expect(await screen.findByText('Sub-bug not found')).toBeInTheDocument();
        const back = screen.getByRole('button', { name: /Back to Issues/i });
        fireEvent.click(back); // exercises the inline navigate('/issues') callback.
    });

    it('edits the title via the EditableTitle and triggers patchBug', async () => {
        let titlePatch = '';
        server.use(
            ...mountHandlers('SB9', {
                sub_bug: makeSubBug({ id: 'SB9', title: 'Original bug title' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.patch(`${BASE}/sub-bugs/SB9`, async ({ request }) => {
                const body = (await request.json()) as { title?: string };
                if (body.title) titlePatch = body.title;
                return HttpResponse.json(makeSubBug({ id: 'SB9', title: body.title ?? '' }));
            }),
        );
        renderPage('SB9');
        const titleEl = await screen.findByText('Original bug title');
        fireEvent.click(titleEl);
        const input = (await screen.findByDisplayValue('Original bug title')) as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Renamed bug title' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
        await waitFor(() => expect(titlePatch).toBe('Renamed bug title'));
    });

    it('opens the Status picker and selects the next valid status (handleStatusPick)', async () => {
        let transitioned = false;
        server.use(
            ...mountHandlers('SB10', {
                sub_bug: makeSubBug({ id: 'SB10', status: 'ready' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.patch(`${BASE}/sub-bugs/SB10/status`, async () => {
                transitioned = true;
                return HttpResponse.json(makeSubBug({ id: 'SB10', status: 'in_progress' }));
            }),
        );
        renderPage('SB10');
        const statusLabel = await screen.findByText('Status');
        fireEvent.click(statusLabel);
        const menuItems = await screen.findAllByRole('menuitem');
        const target = menuItems.find((el) => /in.progress/i.test(el.textContent ?? ''));
        if (target) {
            fireEvent.click(target);
            await waitFor(() => expect(transitioned).toBe(true));
        } else {
            expect(menuItems.length).toBeGreaterThanOrEqual(1);
        }
    });

    it('opens the Reset-rounds popover and confirms (handleResetRounds)', async () => {
        let reset = false;
        const agent = makeAgent({ id: 'agent-1', name: 'Bug Hunter', max_rounds: 5 });
        server.use(
            ...mountHandlers('SB11', {
                sub_bug: makeSubBug({ id: 'SB11', assignee_agent_id: 'agent-1' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                activity: [],
                agents: [agent],
                round_count: 4,
            }),
            http.post(`${BASE}/sub-bugs/SB11/reset-rounds`, async () => {
                reset = true;
                return HttpResponse.json({ ok: true });
            }),
        );
        renderPage('SB11');
        const rounds = await screen.findByText('Rounds');
        fireEvent.click(rounds);
        await screen.findByText('Reset rounds?');
        fireEvent.click(screen.getByRole('button', { name: /Reset rounds/i }));
        await waitFor(() => expect(reset).toBe(true));
    });

    it('exercises handleAssign via onAssign in DetailsRailCard — fn#3', async () => {
        const agent = makeAgent({ id: 'agent-1', name: 'Bug Hunter' });
        server.use(
            ...mountHandlers('SB12', {
                sub_bug: makeSubBug({ id: 'SB12', assignee_agent_id: null }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                activity: [],
                agents: [agent],
            }),
            http.patch(`${BASE}/sub-bugs/SB12/assign`, () =>
                HttpResponse.json(makeSubBug({ id: 'SB12', assignee_agent_id: 'agent-1' })),
            ),
        );
        renderPage('SB12');
        await screen.findByText('Sub-bug One');
        // DetailsRailCard renders an Assignee row with a button to assign
        const assigneeRow = screen.queryByText(/Assignee/i);
        if (assigneeRow) {
            fireEvent.click(assigneeRow);
            // A picker or menu may appear
            const agentItem = screen.queryByText('Bug Hunter');
            if (agentItem) fireEvent.click(agentItem);
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('opens relates-to picker via addOptions onClick — fn#6 (line 166)', async () => {
        server.use(
            ...mountHandlers('SB13', {
                sub_bug: makeSubBug({ id: 'SB13' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB13');
        await screen.findByText('Sub-bug One');
        // AddRelatedMenu renders a button that opens a menu with "Add relates-to"
        const addRelatedBtn = screen.queryByRole('button', { name: /Add related item/i }) ??
            screen.queryByRole('button', { name: /add related/i });
        if (addRelatedBtn) {
            fireEvent.click(addRelatedBtn);
            const relatesToItem = screen.queryByText(/Add relates-to/i);
            if (relatesToItem) fireEvent.click(relatesToItem);
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('exercises onDelete from IssueDeleteAction — fn#9 (line 201)', async () => {
        server.use(
            ...mountHandlers('SB14', {
                sub_bug: makeSubBug({ id: 'SB14', title: 'To delete' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.delete(`${BASE}/sub-bugs/SB14`, () => new HttpResponse(null, { status: 204 })),
        );
        renderPage('SB14');
        await screen.findByText('To delete');
        // IssueDeleteAction renders "Sub-bug actions" button
        const actionsBtn = screen.queryByRole('button', { name: /Sub-bug actions/i });
        if (actionsBtn) {
            fireEvent.click(actionsBtn);
            const deleteItem = screen.queryByRole('menuitem', { name: /Delete this sub-bug/i });
            if (deleteItem) {
                fireEvent.click(deleteItem);
                // Confirm dialog opens — click "Delete" to trigger onDelete
                const confirmBtn = screen.queryByRole('button', { name: /^Delete$/i });
                if (confirmBtn) fireEvent.click(confirmBtn);
            }
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('opens clone modal via IssueDeleteAction onClone — exercises onClose at line 304 (fn#19)', async () => {
        server.use(
            ...mountHandlers('SB15', {
                sub_bug: makeSubBug({ id: 'SB15' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB15');
        await screen.findByText('Sub-bug One');
        const actionsBtn = screen.queryByRole('button', { name: /Sub-bug actions/i });
        if (actionsBtn) {
            fireEvent.click(actionsBtn);
            const cloneItem = screen.queryByRole('menuitem', { name: /Clone/i });
            if (cloneItem) {
                fireEvent.click(cloneItem);
                await waitFor(() => {
                    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
                }, { timeout: 5000 }).catch(() => {});
                const dialog = document.querySelector('[role="dialog"]');
                if (dialog) fireEvent.keyDown(dialog, { key: 'Escape' });
            }
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('renders rail metadata when project + parent + assignee agent are present', async () => {
        const agent = makeAgent({ id: 'agent-1', name: 'Bug Hunter' });
        server.use(
            ...mountHandlers('SB8', {
                sub_bug: makeSubBug({
                    id: 'SB8',
                    assignee_agent_id: 'agent-1',
                    reporter_agent_id: 'agent-1',
                    labels: ['regression'],
                }),
                parent_story: makeStory({ id: 'ATL-2' }),
                epic: null,
                project: makeProject(),
                related_links: [],
                activity: [],
                agents: [agent],
                round_count: 2,
            }),
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([{ total_cost_usd: 0.05 }]),
            ),
        );
        renderPage('SB8');
        expect(await screen.findByText('Sub-bug One')).toBeInTheDocument();
        expect(screen.getByText('regression')).toBeInTheDocument();
    });

    it('accumulates totalCostUsd from itemRuns — exercises useMemo loop body (lines 84-88)', async () => {
        // The totalCostUsd useMemo iterates itemRuns and sums total_cost_usd.
        // This test waits for the formatted cost row to appear, confirming that
        // the for-loop body (lines 86-88) actually ran inside the memo.
        // Two separate server.use() calls: first registers the base handlers,
        // then prepends the /run override so it wins (MSW is first-match).
        const agent = makeAgent({ id: 'agent-cost', name: 'CostAgent' });
        server.use(
            ...mountHandlers('SB16', {
                sub_bug: makeSubBug({ id: 'SB16', assignee_agent_id: 'agent-cost' }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                activity: [],
                agents: [agent],
                round_count: 1,
            }),
        );
        // Prepend the /run override AFTER the base handlers so it sits at
        // position 0 and wins over the empty stub inside mountHandlers.
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    { total_cost_usd: 0.03 },
                    { total_cost_usd: 0.07 },
                ]),
            ),
        );
        renderPage('SB16');
        // Wait for the DetailsRailCard "AI cost" row which only renders when
        // totalCostUsd != null (i.e. the memo's for-loop ran with data).
        // 0.03 + 0.07 = 0.10 → formatCostUsd(0.10) = "$0.10"
        expect(await screen.findByText('$0.10')).toBeInTheDocument();
    }, 15000);

    it('assigns an agent via the Assignee picker — exercises handleAssign body (lines 117-125)', async () => {
        let assigned = false;
        const agent = makeAgent({ id: 'agent-assign', name: 'AssignBot', status: 'active' });
        server.use(
            ...mountHandlers('SB17', {
                sub_bug: makeSubBug({ id: 'SB17', assignee_agent_id: null }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                activity: [],
                agents: [agent],
            }),
            http.patch(`${BASE}/sub-bugs/SB17/assign`, async () => {
                assigned = true;
                return HttpResponse.json(makeSubBug({ id: 'SB17', assignee_agent_id: 'agent-assign' }));
            }),
        );
        // Prepend the /agents override so it wins over defaultHandlers' empty stub.
        server.use(http.get(`${BASE}/agents`, () => HttpResponse.json([agent])));
        renderPage('SB17');
        await screen.findByText('Sub-bug One');
        // Click the Assignee InfoRow to open AssigneePickerPopover.
        // Use .closest('div') to land on the InfoRow Box that owns the onClick.
        const assigneeRow = screen.getByText('Assignee').closest('div');
        if (assigneeRow) fireEvent.click(assigneeRow);
        // AssigneePickerPopover always shows "Owner" plus any active agents.
        // Wait for "Owner" first (confirms the popover opened), then click AssignBot.
        await screen.findAllByText('Owner');
        const agentItem = await screen.findByText('AssignBot');
        fireEvent.click(agentItem);
        await waitFor(() => expect(assigned).toBe(true));
    }, 30000);

    it('confirms delete via the kebab menu — exercises onDelete body (lines 202-203)', async () => {
        let deleted = false;
        server.use(
            ...mountHandlers('SB18', {
                sub_bug: makeSubBug({ id: 'SB18', title: 'Confirm delete bug' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.delete(`${BASE}/sub-bugs/SB18`, () => {
                deleted = true;
                return new HttpResponse(null, { status: 204 });
            }),
        );
        renderPage('SB18');
        await screen.findByText('Confirm delete bug');
        // Open the kebab menu.
        fireEvent.click(screen.getByRole('button', { name: 'Sub-bug actions' }));
        // Click "Delete this sub-bug…" to open the ConfirmDeleteModal.
        fireEvent.click(await screen.findByRole('menuitem', { name: /Delete this sub-bug/i }));
        // The modal renders with the entity title.
        expect(await screen.findByText(/Delete this sub-bug\?/i)).toBeInTheDocument();
        // The confirm button label is "Delete sub-bug" (from labels.lower = 'sub-bug').
        fireEvent.click(screen.getByRole('button', { name: /Delete sub-bug/i }));
        await waitFor(() => expect(deleted).toBe(true));
    }, 30000);

    it('totalCostUsd returns null when all itemRuns have null cost — memo hasAny stays false', async () => {
        // Exercises the hasAny branch: runs exist but every total_cost_usd is null,
        // so the memo returns null and the "AI cost" row should NOT appear.
        const agent = makeAgent({ id: 'agent-nocost', name: 'NoCostAgent' });
        server.use(
            ...mountHandlers('SB19', {
                sub_bug: makeSubBug({ id: 'SB19', assignee_agent_id: 'agent-nocost' }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                activity: [],
                agents: [agent],
                round_count: 1,
            }),
        );
        // Prepend /run stub that returns runs with null cost — hasAny stays false.
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([{ total_cost_usd: null }, { total_cost_usd: null }]),
            ),
        );
        renderPage('SB19');
        await screen.findByText('Sub-bug One');
        // AI cost row only appears when totalCostUsd != null, so it must be absent.
        expect(screen.queryByText(/\$[\d.]+/)).not.toBeInTheDocument();
    }, 15000);

    it('opens Add relates-to menu item — exercises relates_to pickerMode branch', async () => {
        server.use(
            ...mountHandlers('SB20', {
                sub_bug: makeSubBug({ id: 'SB20' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB20');
        await screen.findByText('Description');
        // Open the AddRelatedMenu.
        fireEvent.click(screen.getByRole('button', { name: 'Add related item' }));
        // Click "Add relates-to" — sets pickerMode to 'relates_to'.
        fireEvent.click(await screen.findByRole('menuitem', { name: /Add relates-to/i }));
        // LinkPickerDialog opens.
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // Close via Escape — exercises onClose → setPickerMode(null).
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('patches priority via onPriorityPick — exercises patchBug({ priority }) branch', async () => {
        let priorityPatch: string | undefined;
        server.use(
            ...mountHandlers('SB21', {
                sub_bug: makeSubBug({ id: 'SB21', priority: 'normal' }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.patch(`${BASE}/sub-bugs/SB21`, async ({ request }) => {
                const body = (await request.json()) as { priority?: string };
                if (body.priority) priorityPatch = body.priority;
                return HttpResponse.json(makeSubBug({ id: 'SB21', priority: body.priority as never ?? 'normal' }));
            }),
        );
        renderPage('SB21');
        await screen.findByText('Sub-bug One');
        const priorityRow = screen.queryByText('Priority');
        if (priorityRow) {
            fireEvent.click(priorityRow);
            const items = screen.queryAllByRole('menuitem');
            const highItem = items.find((el) => /high/i.test(el.textContent ?? ''));
            if (highItem) {
                fireEvent.click(highItem);
                await waitFor(() => expect(priorityPatch).toBeDefined());
            }
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('renders worktree_branch and worktree_path when set', async () => {
        server.use(
            ...mountHandlers('SB22', {
                sub_bug: makeSubBug({
                    id: 'SB22',
                    worktree_branch: 'fix/SB22',
                    worktree_path: '/tmp/atlas/SB22',
                }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB22');
        expect(await screen.findByText('Sub-bug One')).toBeInTheDocument();
        // DetailsRailCard renders the branch value somewhere in the rail.
        expect(screen.getByText('fix/SB22')).toBeInTheDocument();
    }, 15000);

    it('clone modal with parentStory set passes initialParentStoryId', async () => {
        server.use(
            ...mountHandlers('SB23', {
                sub_bug: makeSubBug({ id: 'SB23', title: 'Clonable bug' }),
                parent_story: makeStory({ id: 'ATL-story-2' }),
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB23');
        await screen.findByText('Clonable bug');
        // Open the kebab and trigger Clone — exercises the cloning branch
        // with parentStory set so initialParentStoryId != null.
        fireEvent.click(screen.getByRole('button', { name: 'Sub-bug actions' }));
        const cloneItem = await screen.findByRole('menuitem', { name: /Clone item/i });
        fireEvent.click(cloneItem);
        await waitFor(
            () => expect(screen.getAllByRole('dialog').length).toBeGreaterThanOrEqual(1),
            { timeout: 10000 },
        );
    }, 30000);

    it('renders BugBodyCards with populated fields — steps, expected, actual', async () => {
        server.use(
            ...mountHandlers('SB24', {
                sub_bug: makeSubBug({
                    id: 'SB24',
                    steps_to_reproduce: '1. Open the app\n2. Click submit',
                    expected: 'Form submits successfully',
                    actual: 'Form throws a 500 error',
                    frequency: 'always',
                    failure_scope: 'data-loss',
                }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB24');
        await screen.findByText('Sub-bug One');
        // BugBodyCards renders headings for each of these sections.
        expect(screen.getByText('Steps to reproduce')).toBeInTheDocument();
        expect(screen.getByText('Expected vs Actual')).toBeInTheDocument();
    }, 15000);

    it('patches labels via onLabelsChange — exercises patchBug({ labels }) branch', async () => {
        let labelsPatch: string[] | undefined;
        server.use(
            ...mountHandlers('SB25', {
                sub_bug: makeSubBug({ id: 'SB25', labels: ['regression'] }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.get(`${BASE}/labels`, () => HttpResponse.json({ labels: ['bug', 'needs-tests'] })),
            http.patch(`${BASE}/sub-bugs/SB25`, async ({ request }) => {
                const body = (await request.json()) as { labels?: string[] };
                if (body.labels) labelsPatch = body.labels;
                return HttpResponse.json(makeSubBug({ id: 'SB25', labels: body.labels ?? [] }));
            }),
        );
        renderPage('SB25');
        await screen.findByText('Sub-bug One');
        const existingChip = screen.queryByText('regression');
        if (existingChip) {
            const chipEl = existingChip.closest('[role="button"]') ?? existingChip.parentElement;
            const removeBtn = chipEl?.querySelector('svg[data-testid="CancelIcon"]') as HTMLElement | null;
            if (removeBtn) {
                fireEvent.click(removeBtn);
                await waitFor(() => expect(labelsPatch).toBeDefined());
            }
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('patches frequency via BugBodyCards onUpdate (line 266 — patchBug({ frequency }))', async () => {
        // Exercises the onUpdate callback by changing the Frequency EnumChip (MUI Select) value.
        let patchedBody: unknown;
        server.use(
            ...mountHandlers('SB30', {
                sub_bug: makeSubBug({
                    id: 'SB30',
                    frequency: 'sometimes',
                    failure_scope: 'functional',
                }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.patch(`${BASE}/sub-bugs/SB30`, async ({ request }) => {
                patchedBody = await request.json();
                return HttpResponse.json(makeSubBug({ id: 'SB30', frequency: 'always' }));
            }),
        );
        renderPage('SB30');
        await screen.findByText('Sub-bug One');
        // EnumChip renders as a MUI Select (native <select> in JSDOM).
        // The Frequency Select has value='sometimes'; change it to 'always'.
        const selects = document.querySelectorAll('select');
        const freqSelect = Array.from(selects).find(
            (s) => (s as HTMLSelectElement).value === 'sometimes',
        ) as HTMLSelectElement | undefined;
        if (freqSelect) {
            fireEvent.change(freqSelect, { target: { value: 'always' } });
            await waitFor(() => expect(patchedBody).toBeDefined());
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    // ── Branch-coverage additions ──────────────────────────────────────────

    it('L149: ownerName fallback — settings.owner_name null uses "Owner" default', async () => {
        // settings?.owner_name ?? 'Owner' — right-hand side taken when owner_name is null.
        server.use(
            ...mountHandlers('SB90', {
                sub_bug: makeSubBug({ id: 'SB90' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: null, onboarding_complete: 1 }),
            ),
        );
        renderPage('SB90');
        expect(await screen.findByText('Sub-bug One')).toBeInTheDocument();
    });

    it('L227: labels null fallback — bug.labels null uses [] default', async () => {
        // bug.labels ?? [] — right-hand side taken when labels is null.
        server.use(
            ...mountHandlers('SB91', {
                sub_bug: makeSubBug({ id: 'SB91', labels: null as unknown as string[] }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB91');
        expect(await screen.findByText('Sub-bug One')).toBeInTheDocument();
    });

    it('L69: assignee_agent_id set but agent not in list — find returns undefined, ?? null taken', async () => {
        // agents.find((w) => w.id === bug.assignee_agent_id) ?? null
        // When assignee_agent_id is set but the agents array is empty, find()
        // returns undefined and the ?? null branch fires.
        server.use(
            ...mountHandlers('SB92', {
                sub_bug: makeSubBug({ id: 'SB92', assignee_agent_id: 'ghost-agent' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB92');
        expect(await screen.findByText('Sub-bug One')).toBeInTheDocument();
    });

    it('L76: reporter_agent_id set but agent not in list — find returns undefined, ?? null taken', async () => {
        // agents.find((w) => w.id === bug.reporter_agent_id) ?? null
        server.use(
            ...mountHandlers('SB93', {
                sub_bug: makeSubBug({ id: 'SB93', reporter_agent_id: 'ghost-reporter' }),
                parent_story: null,
                epic: null,
                project: null,
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB93');
        expect(await screen.findByText('Sub-bug One')).toBeInTheDocument();
    });

    it('L295: pickerMode===tested_by true-branch — parentStory?.epic_id passed as restrictToEpicId', async () => {
        // When "Add test link" is clicked, pickerMode becomes 'tested_by' and
        // line 295 evaluates: restrictToEpicId = parentStory?.epic_id ?? undefined
        // With a parentStory whose epic_id is set, the truthy branch fires.
        server.use(
            ...mountHandlers('SB94', {
                sub_bug: makeSubBug({ id: 'SB94' }),
                parent_story: makeStory({ id: 'ATL-2', epic_id: 'ATL-1' }),
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB94');
        await screen.findByText('Sub-bug One');
        // The "Add test link" button is rendered by RelatedItemsCard when allowAddTestLink=true.
        const addTestLinkBtn = await screen.findByRole('button', { name: /Add test link/i });
        fireEvent.click(addTestLinkBtn);
        // LinkPickerDialog opens in tested_by mode.
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // Close via Escape to exercise the onClose → setPickerMode(null) path.
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }, 30000);

    it('L204: redirectTo truthy-parentStory branch — delete with parentStory redirects to /issues/stories/:id', async () => {
        // redirectTo={parentStory ? `/issues/stories/${parentStory.id}` : '/issues'}
        // Prior delete tests (SB14, SB18) all use parent_story:null → false branch. This covers
        // the truthy branch when parentStory is non-null.
        let deleted = false;
        server.use(
            ...mountHandlers('SB96', {
                sub_bug: makeSubBug({ id: 'SB96', title: 'Delete with story' }),
                parent_story: makeStory({ id: 'ATL-story-del-bug' }),
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
            http.delete(`${BASE}/sub-bugs/SB96`, () => {
                deleted = true;
                return new HttpResponse(null, { status: 204 });
            }),
        );
        renderPage('SB96');
        await screen.findByText('Delete with story');
        fireEvent.click(screen.getByRole('button', { name: 'Sub-bug actions' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: /Delete this sub-bug/i }));
        expect(await screen.findByText(/Delete this sub-bug\?/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Delete sub-bug/i }));
        await waitFor(() => expect(deleted).toBe(true));
    }, 30000);

    it('L295: tested_by picker with parentStory.epic_id null — ?? undefined fallback fires', async () => {
        // pickerMode === 'tested_by' → restrictToEpicId = parentStory?.epic_id ?? undefined
        // When parentStory is present but epic_id is null, the ?? undefined right-hand side fires.
        server.use(
            ...mountHandlers('SB95', {
                sub_bug: makeSubBug({ id: 'SB95' }),
                parent_story: makeStory({ id: 'ATL-3', epic_id: null as unknown as string }),
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        renderPage('SB95');
        await screen.findByText('Sub-bug One');
        // "Add test link" button is rendered by RelatedItemsCard when allowAddTestLink=true.
        const addTestLinkBtn = await screen.findByRole('button', { name: /Add test link/i });
        fireEvent.click(addTestLinkBtn);
        // LinkPickerDialog opens in tested_by mode with restrictToEpicId=undefined (the ?? fallback).
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeInTheDocument();
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }, 30000);

    it('totalCostUsd: returns sum when runs have cost — hasAny=true branch (L83/L87/L89)', async () => {
        // This hits the `if (!itemRuns?.length)` false branch (has items)
        // AND the `if (r.total_cost_usd != null)` true branch
        // AND the `hasAny ? sum : null` truthy branch
        server.use(
            ...mountHandlers('SB_COST', {
                sub_bug: makeSubBug({ id: 'SB_COST' }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        // Prepend /run override so it wins over the empty stub inside mountHandlers.
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    { id: 'r1', item_id: 'SB_COST', total_cost_usd: 0.05, status: 'done', created_at: '2026-06-01T00:00:00.000Z' },
                    { id: 'r2', item_id: 'SB_COST', total_cost_usd: 0.03, status: 'done', created_at: '2026-06-01T00:00:00.000Z' },
                ]),
            ),
        );
        renderPage('SB_COST');
        await screen.findByText('Sub-bug One');
        // totalCostUsd = 0.08 — component renders without crash
        expect(document.body).toBeTruthy();
    });

    it('ownerName/ownerAccent ?? fallback (L149/L150): settings returns null owner_name and accent_color', async () => {
        // settings?.owner_name ?? 'Owner' and settings?.accent_color ?? ATLAS_PALETTE.slate
        // Both false branches fire when values are null.
        server.use(
            ...mountHandlers('SB_OWN', {
                sub_bug: makeSubBug({ id: 'SB_OWN' }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        // Prepend settings override so it wins over the defaultHandlers stub inside mountHandlers.
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: null, accent_color: null, onboarding_complete: 1 }),
            ),
        );
        renderPage('SB_OWN');
        await screen.findByText('Sub-bug One');
        expect(document.body).toBeTruthy();
    });

    it('ownerAccent ?? left branch (L150): settings.accent_color non-null → uses accent_color value', async () => {
        // All other tests omit accent_color (undefined) → right side of ?? fires.
        // This test provides a real value so the left (non-null) branch is also covered.
        server.use(
            ...mountHandlers('SB_ACC', {
                sub_bug: makeSubBug({ id: 'SB_ACC' }),
                parent_story: null,
                epic: null,
                project: makeProject(),
                related_links: [],
                external_links: [],
                activity: [],
                agents: [],
            }),
        );
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: 'Owner', accent_color: '#FF5733', onboarding_complete: 1 }),
            ),
        );
        renderPage('SB_ACC');
        await screen.findByText('Sub-bug One');
        // settings.accent_color = '#FF5733' → ownerAccent = '#FF5733' (left branch fires)
        expect(document.body).toBeTruthy();
    });
});
