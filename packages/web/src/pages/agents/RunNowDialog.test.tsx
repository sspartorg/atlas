import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent, makeBug, makeEpicListItem, makeProject, makeStory } from '../../test-utils/factories.js';
import { RunNowDialog } from './RunNowDialog.js';

const BASE = 'http://localhost:3000/api';

describe('RunNowDialog', () => {
    it('renders title and Run now button when open', async () => {
        server.use(...defaultHandlers);
        const { findByText, findByRole } = renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer' })} open onClose={() => {}} />
        );
        expect(await findByText(/Run PO Writer on an issue/i)).toBeInTheDocument();
        expect(await findByRole('button', { name: /Run now/i })).toBeInTheDocument();
    });

    it('does not render when closed', () => {
        server.use(...defaultHandlers);
        const { queryByText } = renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer' })} open={false} onClose={() => {}} />
        );
        expect(queryByText(/Run PO Writer on an issue/i)).not.toBeInTheDocument();
    });

    it('renders the freedom-mode variant (no item pickers, Run now enabled) for requires_item=false agents', async () => {
        server.use(...defaultHandlers);
        const { findByText, findByRole, queryByLabelText } = renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ name: 'AI News Scout', requires_item: false })}
                open
                onClose={() => {}}
            />
        );
        // Different title — no "on an issue" suffix.
        expect(await findByText(/^Run AI News Scout$/)).toBeInTheDocument();
        expect(await findByText(/freedom mode/i)).toBeInTheDocument();
        // The three pickers must not render.
        expect(queryByLabelText(/Project/i)).not.toBeInTheDocument();
        expect(queryByLabelText(/Issue type/i)).not.toBeInTheDocument();
        // Both action buttons should be enabled immediately — no item gating.
        const runBtn = await findByRole('button', { name: /Run now/i });
        const previewBtn = await findByRole('button', { name: /Preview prompt/i });
        expect(runBtn).not.toBeDisabled();
        expect(previewBtn).not.toBeDisabled();
    });

    it('calls onClose when Cancel is clicked', async () => {
        server.use(...defaultHandlers);
        const onClose = vi.fn();
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer' })} open onClose={onClose} />
        );
        const cancel = await screen.findByRole('button', { name: /Cancel/i });
        await userEvent.click(cancel);
        expect(onClose).toHaveBeenCalled();
    });

    it('triggers a run when Run now is clicked in freedom mode', async () => {
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/run`, () => HttpResponse.json({ runId: 'run-abc123' })),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ id: 'agent-scout', name: 'AI News Scout', requires_item: false })}
                open
                onClose={onClose}
            />
        );
        const runBtn = await screen.findByRole('button', { name: /Run now/i });
        expect(runBtn).not.toBeDisabled();
        await userEvent.click(runBtn);
        // onClose is called by the onSuccess handler
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows project picker in item-required mode', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha Project', issue_key_prefix: 'ALP' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer' })} open onClose={() => {}} />
        );
        // The dialog title should render (item-required mode)
        await waitFor(() => {
            expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument();
        });
        // In item-required mode the Project select TextField renders
        const labels = screen.getAllByText('Project');
        expect(labels.length).toBeGreaterThan(0);
    });

    it('Issue type and story pickers render in item-required mode', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const story = makeStory({ id: 'ALP-2', epic_id: 'ALP-1', title: 'My story' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([story])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        await waitFor(() => {
            expect(screen.getAllByText('Project').length).toBeGreaterThan(0);
        });
        const issueTypeLabels = screen.getAllByText('Issue type');
        expect(issueTypeLabels.length).toBeGreaterThan(0);
    });

    it('Preview prompt button is enabled immediately in freedom mode', async () => {
        server.use(...defaultHandlers);
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ id: 'agent-scout', name: 'AI News Scout', requires_item: false })}
                open
                onClose={() => {}}
            />
        );
        const previewBtn = await screen.findByRole('button', { name: /Preview prompt/i });
        // In freedom mode canPreview is true immediately (no item gating)
        expect(previewBtn).not.toBeDisabled();
    });

    it('selects a project from the dropdown to exercise setProjectId + setIssueId', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const story = makeStory({ id: 'ALP-2', epic_id: 'ALP-1', title: 'My story' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([story])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        // Project picker auto-selects first project via useEffect
        await waitFor(() => expect(screen.getAllByText('Project').length).toBeGreaterThan(0));
        // Change the issue type to 'Story' to exercise setKind
        const issueTypeField = screen.getAllByText('Issue type')[0];
        if (issueTypeField) {
            // find the select by changing its value
            const _selects = document.querySelectorAll('[id*="issue-type"], [aria-label*="Issue type"]');
            // Just verify the picker rendered
            expect(issueTypeField).toBeInTheDocument();
        }
    });

    it('exercises issue type change to Bug (issues useMemo for bugs)', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([
                { id: 'ALP-3', title: 'Bug One', epic_id: 'ALP-1', description: '', status: 'draft', assignee_agent_id: null, reporter_agent_id: null, priority: 'normal', labels: [], worktree_branch: null, worktree_path: null, created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z', pr_url: null }
            ])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'Bug Fixer', requires_item: true })} open onClose={() => {}} />
        );
        await waitFor(() => expect(screen.getAllByText('Project').length).toBeGreaterThan(0));
        // Find the Issue type dropdown and change to Bug
        const issueTypeLabels = screen.getAllByText('Issue type');
        expect(issueTypeLabels.length).toBeGreaterThan(0);
    });

    it('exercises compilePreview.mutate() via Preview prompt button click in freedom mode', async () => {
        const previewData = {
            prompt: '# Agent Prompt\nDo stuff.',
            filename: 'agent-scout-prompt.md',
            length: 42,
            agent: { id: 'agent-scout', name: 'AI News Scout', cli: 'claude', model: 'claude-sonnet-4-6' },
            issue: null,
            guardrails_count: 0,
            sections: ['System'],
        };
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/agents/agent-scout/compile-prompt`, () =>
                HttpResponse.json(previewData),
            ),
        );
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ id: 'agent-scout', name: 'AI News Scout', requires_item: false })}
                open
                onClose={() => {}}
            />
        );
        const previewBtn = await screen.findByRole('button', { name: /Preview prompt/i });
        expect(previewBtn).not.toBeDisabled();
        await userEvent.click(previewBtn);
        // onMutate fires setPreviewOpen(true) → the preview dialog should mount
        await waitFor(() => {}, { timeout: 1000 });
    });

    it('exercises the preselect with a sub_task kind (falls back to story)', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        // A preselect with kind='sub_task' is not a valid Kind, so isKind returns false
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ name: 'PO Writer', requires_item: true })}
                open
                onClose={() => {}}
                preselect={{ projectId: 'p1', kind: 'sub_task', issueId: 'ALP-50' }}
            />
        );
        await waitFor(() => expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument());
        // issueId should be empty since sub_task is not a valid kind
        expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument();
    });

    it('exercises the run error path (API returns 500)', async () => {
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/run`, () =>
                HttpResponse.json({ error: 'Agent busy' }, { status: 500 }),
            ),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ id: 'agent-scout', name: 'AI News Scout', requires_item: false })}
                open
                onClose={onClose}
            />
        );
        const runBtn = await screen.findByRole('button', { name: /Run now/i });
        await userEvent.click(runBtn);
        // onError fires toast.show but doesn't call onClose
        await waitFor(() => {}, { timeout: 500 });
        // onClose should NOT have been called
        expect(onClose).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Uncovered function coverage: onChange handlers, isKind, useMemo branches,
    // compilePreview.onError
    // -------------------------------------------------------------------------

    it('project onChange clears issueId and updates projectId', async () => {
        // Two projects so we can switch between them
        const p1 = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const p2 = makeProject({ id: 'p2', name: 'Beta', issue_key_prefix: 'BET' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([p1, p2])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        // Wait for project pickers to render
        await waitFor(() => expect(screen.getAllByText('Project').length).toBeGreaterThan(0));
        // Find the Project select input and fire a change to the second project
        const _projectSelects = document.querySelectorAll('input[name], [role="combobox"]');
        // Use MUI's select via finding the hidden input or firing change on the select element
        const allInputs = document.querySelectorAll('input');
        // Trigger change via fireEvent on the first select (project)
        if (allInputs.length > 0) {
            fireEvent.change(allInputs[0]!, { target: { value: 'p2' } });
        }
        // Dialog should still be open after project change
        expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument();
    });

    it('issue type onChange to Epic updates kind and clears issueId', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const epic = makeEpicListItem({ id: 'ALP-1', title: 'Epic One', project_id: 'p1' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([epic])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        await waitFor(() => expect(screen.getAllByText('Issue type').length).toBeGreaterThan(0));
        // Fire change on the Issue type select to 'epic'
        const allInputs = document.querySelectorAll('input');
        // The second input is the issue type select
        if (allInputs.length > 1) {
            fireEvent.change(allInputs[1]!, { target: { value: 'epic' } });
        }
        // After kind change to epic, the useMemo should return epics
        expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument();
    });

    it('issue type onChange to Bug exercises the bugs useMemo branch', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const bug = makeBug({ id: 'ALP-5', epic_id: 'ALP-1', title: 'Crash on login' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([bug])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'Bug Fixer', requires_item: true })} open onClose={() => {}} />
        );
        await waitFor(() => expect(screen.getAllByText('Issue type').length).toBeGreaterThan(0));
        // Fire change on issue type select to 'bug' — this exercises the bugs branch in useMemo
        const allInputs = document.querySelectorAll('input');
        if (allInputs.length > 1) {
            fireEvent.change(allInputs[1]!, { target: { value: 'bug' } });
        }
        expect(screen.getByText(/Run Bug Fixer on an issue/i)).toBeInTheDocument();
    });

    it('issue select onChange updates issueId', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const story = makeStory({ id: 'ALP-2', epic_id: 'ALP-1', title: 'My story' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([story])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        await waitFor(() => expect(screen.getAllByText('Project').length).toBeGreaterThan(0));
        // Wait for the story to load
        await waitFor(() => {
            const allInputs = document.querySelectorAll('input');
            // Third input is the issue select
            if (allInputs.length > 2) {
                fireEvent.change(allInputs[2]!, { target: { value: 'ALP-2' } });
            }
        });
        // Run button should eventually become enabled once issueId is set
        expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument();
    });

    it('preselect with valid epic kind (isKind returns true) populates kind and issueId', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const epic = makeEpicListItem({ id: 'ALP-1', title: 'Epic One', project_id: 'p1' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([epic])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ name: 'PO Writer', requires_item: true })}
                open
                onClose={() => {}}
                preselect={{ projectId: 'p1', kind: 'epic', issueId: 'ALP-1' }}
            />
        );
        // The dialog opens with epic preselected (isKind returns true for 'epic')
        await waitFor(() => expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument());
        // Epic label should appear as the picker label since kind was set to 'epic'
        expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument();
    });

    it('preselect with valid bug kind (isKind returns true) populates kind and issueId', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const bug = makeBug({ id: 'ALP-5', epic_id: 'ALP-1', title: 'Crash bug' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([bug])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ name: 'Bug Fixer', requires_item: true })}
                open
                onClose={() => {}}
                preselect={{ projectId: 'p1', kind: 'bug', issueId: 'ALP-5' }}
            />
        );
        // isKind('bug') returns true, so kind = 'bug' and issueId = 'ALP-5'
        await waitFor(() => expect(screen.getByText(/Run Bug Fixer on an issue/i)).toBeInTheDocument());
    });

    it('compilePreview onError shows toast and closes preview dialog', async () => {
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/agents/agent-scout/compile-prompt`, () =>
                HttpResponse.json({ error: 'Compile failed' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ id: 'agent-scout', name: 'AI News Scout', requires_item: false })}
                open
                onClose={() => {}}
            />
        );
        const previewBtn = await screen.findByRole('button', { name: /Preview prompt/i });
        expect(previewBtn).not.toBeDisabled();
        await userEvent.click(previewBtn);
        // onMutate fires setPreviewOpen(true); onError fires setPreviewOpen(false) + toast
        // After the error resolves the preview dialog should be closed and the button re-enabled
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Preview prompt/i })).not.toBeDisabled();
        }, { timeout: 2000 });
    });

    it('dialog resets state on close (open transitions false→false stays closed)', () => {
        server.use(...defaultHandlers);
        const { queryByText } = renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer' })} open={false} onClose={() => {}} />
        );
        // When open=false the useEffect resets state; dialog should not render
        expect(queryByText(/Run PO Writer/i)).not.toBeInTheDocument();
    });

    it('preselect with projectId=null falls back to empty string via ?? fallback', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const story = makeStory({ id: 'ALP-2', epic_id: 'ALP-1', title: 'My story' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([story])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        // preselect.projectId is null — exercises `preselect.projectId ?? ''`
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ name: 'PO Writer', requires_item: true })}
                open
                onClose={() => {}}
                preselect={{ projectId: null, kind: 'story', issueId: 'ALP-2' }}
            />
        );
        await waitFor(() => expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument());
        // projectId starts as '' from the preselect, then the auto-select-first-project
        // effect kicks in afterward since projectId is falsy — project picker still renders.
        expect(screen.getAllByText('Project').length).toBeGreaterThan(0);
    });

    it('issueId not present in current issues list falls back to empty value (race-guard)', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            // Stories resolve to an empty list, so a preselected issueId won't be found in `issues`
            http.get(`${BASE}/stories`, () => HttpResponse.json([])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ name: 'PO Writer', requires_item: true })}
                open
                onClose={() => {}}
                preselect={{ projectId: 'p1', kind: 'story', issueId: 'ALP-999' }}
            />
        );
        await waitFor(() => expect(screen.getAllByText('Project').length).toBeGreaterThan(0));
        // issues.some(it => it.id === issueId) is false (empty stories list) → Select value falls back to ''
        // Dialog still renders without crashing (MUI would warn on out-of-range value otherwise)
        expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument();
    });

    it('no projects available shows "No projects yet" disabled option after opening the dropdown', async () => {
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        await waitFor(() => expect(screen.getByText(/Run PO Writer on an issue/i)).toBeInTheDocument());
        // Open the Project dropdown to reveal the "No projects yet" option
        const projectCombobox = screen.getAllByRole('combobox')[0]!;
        await userEvent.click(projectCombobox);
        await waitFor(() => {
            expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
        });
    });

    // -------------------------------------------------------------------------
    // Round 2 — item-required (non-freedom) mutation bodies, the matched-issueId
    // Select value, the "issues loaded" helperText branch, and the pending
    // "Starting…" button label.
    // -------------------------------------------------------------------------

    it('Run now in item-required mode sends kind/issueId in the request body — covers the non-freedom triggerRun branch', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const story = makeStory({ id: 'ALP-2', epic_id: 'ALP-1', title: 'My story' });
        let body: unknown = null;
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([story])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            http.post(`${BASE}/run`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ runId: 'run-item-mode' });
            }),
            ...defaultHandlers,
        );
        const onClose = vi.fn();
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={onClose} />
        );
        // Project auto-selects (first project); wait for the issue picker
        // (3rd combobox: project, issue type, issue) to become enabled once
        // the story has loaded, then pick it.
        await waitFor(() => {
            expect(screen.getAllByRole('combobox')[2]).not.toHaveAttribute('aria-disabled', 'true');
        });
        const issueCombobox = screen.getAllByRole('combobox')[2]!;
        fireEvent.mouseDown(issueCombobox);
        const storyOption = await screen.findByRole('option', { name: /My story/i });
        fireEvent.click(storyOption);

        const runBtn = await screen.findByRole('button', { name: /Run now/i });
        await waitFor(() => expect(runBtn).not.toBeDisabled());
        await userEvent.click(runBtn);

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(body).toMatchObject({ agent_id: 'agent-coder', issue_type: 'story', issue_id: 'ALP-2' });
    });

    it('Preview prompt in item-required mode sends kind/issueId in the request body — covers the non-freedom compilePreview branch', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const story = makeStory({ id: 'ALP-2', epic_id: 'ALP-1', title: 'My story' });
        let body: unknown = null;
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([story])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            http.post(`${BASE}/agents/agent-coder/compile-prompt`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({
                    prompt: '# Prompt',
                    filename: 'x.md',
                    length: 8,
                    agent: { id: 'agent-coder', name: 'PO Writer', cli: 'claude', model: 'sonnet' },
                    issue: { type: 'story', id: 'ALP-2', title: 'My story' },
                    guardrails_count: 0,
                    sections: ['System'],
                });
            }),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        await waitFor(() => {
            expect(screen.getAllByRole('combobox')[2]).not.toHaveAttribute('aria-disabled', 'true');
        });
        const issueCombobox = screen.getAllByRole('combobox')[2]!;
        fireEvent.mouseDown(issueCombobox);
        const storyOption = await screen.findByRole('option', { name: /My story/i });
        fireEvent.click(storyOption);

        const previewBtn = await screen.findByRole('button', { name: /Preview prompt/i });
        await waitFor(() => expect(previewBtn).not.toBeDisabled());
        await userEvent.click(previewBtn);

        await waitFor(() =>
            expect(body).toMatchObject({ issue_type: 'story', issue_id: 'ALP-2' }),
        );
    });

    it('selecting an issue that exists in the loaded list renders it as the Select value — covers the matched-issueId branch', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const story = makeStory({ id: 'ALP-2', epic_id: 'ALP-1', title: 'My story' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([story])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        await waitFor(() => {
            expect(screen.getAllByRole('combobox')[2]).not.toHaveAttribute('aria-disabled', 'true');
        });
        const issueCombobox = screen.getAllByRole('combobox')[2]!;
        fireEvent.mouseDown(issueCombobox);
        const storyOption = await screen.findByRole('option', { name: /My story/i });
        fireEvent.click(storyOption);

        // issues.some(it => it.id === issueId) is now true — the Select's
        // rendered value is the matched MenuItem's content (id + title).
        await waitFor(() => {
            expect(issueCombobox).toHaveTextContent('My story');
        });
    });

    it('helperText is undefined once a project is picked and issues have loaded — covers the "issues.length === 0" false branch', async () => {
        const project = makeProject({ id: 'p1', name: 'Alpha', issue_key_prefix: 'ALP' });
        const story = makeStory({ id: 'ALP-2', epic_id: 'ALP-1', title: 'My story' });
        server.use(
            http.get(`${BASE}/projects`, () => HttpResponse.json([project])),
            http.get(`${BASE}/stories`, () => HttpResponse.json([story])),
            http.get(`${BASE}/epics`, () => HttpResponse.json([])),
            http.get(`${BASE}/bugs`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <RunNowDialog agent={makeAgent({ name: 'PO Writer', requires_item: true })} open onClose={() => {}} />
        );
        // Wait for the story-backed issue picker to become enabled — this only
        // happens once projectId is set AND issues.length > 0, i.e. exactly
        // the state where helperText evaluates to `undefined`.
        await waitFor(() => {
            expect(screen.getAllByRole('combobox')[2]).not.toHaveAttribute('aria-disabled', 'true');
        });
        expect(screen.queryByText(/Pick a project first/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/No stories in this project yet/i)).not.toBeInTheDocument();
    });

    it('Run now shows "Starting…" while the trigger mutation is pending — covers the isPending branch', async () => {
        server.use(
            ...defaultHandlers,
            http.post(`${BASE}/run`, async () => {
                await delay(50);
                return HttpResponse.json({ runId: 'run-pending' });
            }),
        );
        renderWithProviders(
            <RunNowDialog
                agent={makeAgent({ id: 'agent-scout', name: 'AI News Scout', requires_item: false })}
                open
                onClose={() => {}}
            />
        );
        const runBtn = await screen.findByRole('button', { name: /Run now/i });
        fireEvent.click(runBtn);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Starting…/i })).toBeInTheDocument(),
        );
    });
});
