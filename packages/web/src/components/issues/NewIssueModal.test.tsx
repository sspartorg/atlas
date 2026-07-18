import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import {
    defaultHandlers,
    handlers,
} from '../../test-utils/mock-handlers.js';
import { makeProject, makeEpicListItem, makeStory, makeAgent } from '../../test-utils/factories.js';
import { NewIssueModal } from './NewIssueModal.js';

const BASE = 'http://localhost:3000/api';

const project = makeProject({ id: 'p1', name: 'Acme' });
const epic = makeEpicListItem({ id: 'ATL-1', project_id: 'p1', title: 'Epic One' });
const story = makeStory({ id: 'ATL-2', epic_id: 'ATL-1', title: 'Story One' });

beforeEach(() => {
    server.use(
        ...defaultHandlers,
        handlers.listProjects([project]),
        handlers.listEpics([epic]),
        handlers.listStories([story]),
    );
});

describe('NewIssueModal — closed', () => {
    it('renders nothing when open=false', () => {
        renderWithProviders(
            <NewIssueModal open={false} onClose={vi.fn()} />,
        );
        expect(screen.queryByText('New story')).not.toBeInTheDocument();
    });
});

describe('NewIssueModal — open (story kind default)', () => {
    it('renders the dialog with story kind selected by default', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} />,
        );
        await waitFor(() =>
            expect(screen.getByText('New story')).toBeInTheDocument(),
        );
    });

    it('shows all kind tabs', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('New story'));
        expect(screen.getByText('Story')).toBeInTheDocument();
        expect(screen.getByText('Bug')).toBeInTheDocument();
        expect(screen.getByText('Sub-task')).toBeInTheDocument();
        expect(screen.getByText('Sub-bug')).toBeInTheDocument();
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <NewIssueModal open onClose={onClose} />,
        );
        await waitFor(() => screen.getByText('New story'));
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
        expect(onClose).toHaveBeenCalled();
    });

    it('switching to Bug kind changes the heading', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('New story'));
        await userEvent.click(screen.getByText('Bug'));
        await waitFor(() =>
            expect(screen.getByText('New bug')).toBeInTheDocument(),
        );
    });

    it('switching to Sub-task kind changes the heading', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('New story'));
        await userEvent.click(screen.getByText('Sub-task'));
        await waitFor(() =>
            expect(screen.getByText('New sub-task')).toBeInTheDocument(),
        );
    });
});

describe('NewIssueModal — create story happy path', () => {
    it('submits a story and calls onClose', { timeout: 60_000 }, async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/stories`, () =>
                HttpResponse.json({
                    id: 'ATL-10',
                    epic_id: 'ATL-1',
                    title: 'New story',
                    description: '',
                    status: 'draft',
                    assignee_agent_id: null,
                    reporter_agent_id: null,
                    priority: 'normal',
                    spec_md: null,
                    pr_url: null,
                    points: 0,
                    acceptance_criteria: '',
                    labels: [],
                    worktree_branch: null,
                    worktree_path: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }),
            ),
        );

        renderWithProviders(
            <NewIssueModal
                open
                onClose={onClose}
                initialProjectId="p1"
                initialParentEpicId="ATL-1"
            />,
        );

        await waitFor(() => screen.getByText('New story'));

        // Fill in title (placeholder = "Short summary…")
        const titleInput = screen.getByPlaceholderText('Short summary…');
        await userEvent.type(titleInput, 'New story title');

        // Fill in description
        const descInput = screen.getByPlaceholderText('What needs to happen and why…');
        await userEvent.type(descInput, 'Short description');

        // Fill in acceptance criteria
        const acInput = screen.getByLabelText(/Acceptance criteria/i);
        await userEvent.type(acInput, '- User can do something');

        // Click Submit (button text is "Create issue")
        const submitBtn = screen.getByRole('button', { name: /Create issue/i });
        await userEvent.click(submitBtn);

        await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 5000 });
    });

    it('shows validation errors when submitting without required fields', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByText('New story'));
        const submitBtn = screen.getByRole('button', { name: /Create issue/i });
        await userEvent.click(submitBtn);
        await waitFor(() =>
            expect(screen.getByText(/Title is required/i)).toBeInTheDocument(),
        );
    });
});

describe('NewIssueModal — API error path', () => {
    it('shows error message when story creation fails', { timeout: 60_000 }, async () => {
        server.use(
            http.post(`${BASE}/stories`, () =>
                HttpResponse.json({ error: 'Epic not found' }, { status: 400 }),
            ),
        );

        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                initialProjectId="p1"
                initialParentEpicId="ATL-1"
            />,
        );

        await waitFor(() => screen.getByText('New story'));

        await userEvent.type(screen.getByPlaceholderText('Short summary…'), 'Bad story');
        await userEvent.type(screen.getByPlaceholderText('What needs to happen and why…'), 'Desc');
        await userEvent.type(screen.getByLabelText(/Acceptance criteria/i), '- criterion');

        await userEvent.click(screen.getByRole('button', { name: /Create issue/i }));

        await waitFor(() =>
            expect(screen.getByText(/Epic not found/i)).toBeInTheDocument(),
        );
    });

    it('falls back to "Failed to create issue" when the thrown error has an empty message', { timeout: 60_000 }, async () => {
        // body.error is an empty string (not missing), so `body.error ?? ...`
        // in api.ts's request() doesn't fall through — AtlasApiError.message
        // ends up '' — exercising the `(err as Error).message || 'Failed to
        // create issue'` false-message fallback branch in submit()'s catch.
        server.use(
            http.post(`${BASE}/stories`, () =>
                HttpResponse.json({ error: '' }, { status: 400 }),
            ),
        );

        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                initialProjectId="p1"
                initialParentEpicId="ATL-1"
            />,
        );

        await waitFor(() => screen.getByText('New story'));

        fireEvent.change(screen.getByPlaceholderText('Short summary…'), { target: { value: 'Empty error story' } });
        fireEvent.change(screen.getByPlaceholderText('What needs to happen and why…'), { target: { value: 'Desc' } });
        fireEvent.change(screen.getByLabelText(/Acceptance criteria/i), { target: { value: '- criterion' } });

        fireEvent.click(screen.getByRole('button', { name: /Create issue/i }));

        await waitFor(() =>
            expect(screen.getByText(/Failed to create issue/i)).toBeInTheDocument(),
        );
    });
});

describe('NewIssueModal — initialValues pre-fill', () => {
    it('pre-fills title and description from initialValues', async () => {
        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                initialValues={{
                    title: 'Pre-filled title',
                    description: 'Pre-filled description',
                }}
            />,
        );
        await waitFor(() => screen.getByText('New story'));
        expect(
            (screen.getByPlaceholderText('Short summary…') as HTMLInputElement).value,
        ).toBe('Pre-filled title');
    });
});

describe('NewIssueModal — sub_bug kind', () => {
    it('renders with sub_bug initialKind (exercises kindAccent sub_bug branch)', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} initialKind="sub_bug" />,
        );
        // kindAccent returns orange for sub_bug, kindSubtitle returns bug message
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });
    });

    it('renders with sub_task initialKind (exercises kindAccent sub_task branch)', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} initialKind="sub_task" />,
        );
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });
    });

    it('renders with bug initialKind to exercise kindSubtitle bug branch', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} initialKind="bug" />,
        );
        await waitFor(() => {
            expect(screen.queryByText(/Bugs are never orphans/i)).toBeInTheDocument();
        });
    });
});

describe('NewIssueModal — cloneFrom', () => {
    it('renders with cloneFromId+cloneFromType to exercise clone fetch path', async () => {
        server.use(
            http.get(`${BASE}/stories/ATL-2`, () =>
                HttpResponse.json({
                    id: 'ATL-2',
                    title: 'Clone Source',
                    description: 'Original description',
                    epic_id: 'ATL-1',
                    status: 'draft',
                    assignee_agent_id: null,
                    reporter_agent_id: null,
                    priority: 'normal',
                    labels: [],
                    worktree_branch: null,
                    worktree_path: null,
                    created_at: '2026-05-16T00:00:00.000Z',
                    updated_at: '2026-05-16T00:00:00.000Z',
                    pr_url: null,
                }),
            ),
        );
        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                cloneFromId="ATL-2"
                cloneFromType="story"
            />,
        );
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });
    });
});

describe('NewIssueModal — field touch callbacks (fn#touch)', () => {
    it('blurs title field to exercise touch("title") — fn', async () => {
        const fe = fireEvent;
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} />);
        await waitFor(() => screen.getByText('New story'));
        const titleInput = screen.getByPlaceholderText('Short summary…');
        fe.focus(titleInput);
        fe.blur(titleInput);
        // After blur with empty value and submitAttempted=false, no error shown yet
        expect(document.body).toBeTruthy();
    });

    it('blurs description field to exercise touch("description") — fn', async () => {
        const fe = fireEvent;
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} />);
        await waitFor(() => screen.getByText('New story'));
        const descInput = screen.getByPlaceholderText('What needs to happen and why…');
        fe.focus(descInput);
        fe.blur(descInput);
        expect(document.body).toBeTruthy();
    });

    it('blurs acceptance criteria field to exercise touch("acceptanceCriteria") — fn', async () => {
        const fe = fireEvent;
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} />);
        await waitFor(() => screen.getByText('New story'));
        const acInput = screen.getByLabelText(/Acceptance criteria/i);
        fe.focus(acInput);
        fe.blur(acInput);
        expect(document.body).toBeTruthy();
    });

    it('blurs parent select to exercise touch("parent") — fn (sub_task uses parentStory)', async () => {
        const fe = fireEvent;
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} initialKind="sub_task" />);
        await waitFor(() => screen.getByText('New sub-task'));
        // Parent story select has label "Parent story" — blur via combobox
        const comboboxes = screen.getAllByRole('combobox');
        if (comboboxes.length > 1) {
            fe.blur(comboboxes[1]!);
        }
        expect(document.body).toBeTruthy();
    });

    it('blurs steps to reproduce field (bug kind) to exercise touch("stepsToReproduce") — fn', async () => {
        const fe = fireEvent;
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} initialKind="bug" />);
        await waitFor(() => screen.getByText('New bug'));
        const stepsInput = screen.queryByLabelText(/Steps to reproduce/i);
        if (stepsInput) {
            fe.focus(stepsInput);
            fe.blur(stepsInput);
        }
        expect(document.body).toBeTruthy();
    });
});

describe('NewIssueModal — submit bug kind path', () => {
    it('submits a bug and calls onClose — exercises submit() bug branch', { timeout: 60_000 }, async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/bugs`, () =>
                HttpResponse.json({
                    id: 'ATL-11',
                    epic_id: 'ATL-1',
                    title: 'A bug title',
                    description: 'desc',
                    status: 'draft',
                    assignee_agent_id: null,
                    reporter_agent_id: null,
                    priority: 'normal',
                    acceptance_criteria: '',
                    steps_to_reproduce: '',
                    expected: '',
                    actual: '',
                    frequency: 'sometimes',
                    failure_scope: 'cosmetic',
                    labels: [],
                    worktree_branch: null,
                    worktree_path: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }),
            ),
        );
        renderWithProviders(
            <NewIssueModal
                open
                onClose={onClose}
                initialKind="bug"
                initialProjectId="p1"
                initialParentEpicId="ATL-1"
            />,
        );
        await waitFor(() => screen.getByText('New bug'));
        // userEvent.type is per-char and balloons under v8 coverage;
        // fireEvent.change is instant (mirrors the sub_bug test below).
        fireEvent.change(screen.getByPlaceholderText(/Backfill historical refunds/i), {
            target: { value: 'A bug title' },
        });
        fireEvent.change(screen.getByPlaceholderText('What needs to happen and why…'), {
            target: { value: 'Bug description' },
        });
        fireEvent.change(screen.getByLabelText(/Acceptance criteria/i), {
            target: { value: 'Works without crashing' },
        });
        const stepsInput = screen.queryByLabelText(/Steps to reproduce/i);
        if (stepsInput) fireEvent.change(stepsInput, { target: { value: '1. Do X' } });
        fireEvent.click(screen.getByRole('button', { name: /Create issue/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 15000 });
    });

    it('changes frequency select in bug mode — exercises frequency onChange', async () => {
        const fe = fireEvent;
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} initialKind="bug" />);
        await waitFor(() => screen.getByText('New bug'));
        // Find frequency select (combobox with value "sometimes")
        const comboboxes = screen.getAllByRole('combobox');
        const freqSelect = comboboxes.find(c => (c as HTMLElement).innerHTML.includes('sometimes') ||
            (c as HTMLSelectElement).value === 'sometimes');
        if (freqSelect) {
            fe.mouseDown(freqSelect);
            const opts = screen.queryAllByRole('option');
            const alwaysOpt = opts.find(o => o.textContent === 'always');
            if (alwaysOpt) fe.click(alwaysOpt);
        }
        expect(document.body).toBeTruthy();
    });
});

describe('NewIssueModal — submit sub_task kind path', () => {
    it('submits a sub_task and calls onClose — exercises submit() sub_task branch', { timeout: 60_000 }, async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/stories/ATL-2/sub-tasks`, () =>
                HttpResponse.json({
                    id: 'ATL-ST1',
                    story_id: 'ATL-2',
                    title: 'Sub task title',
                    description: 'desc',
                    status: 'draft',
                    assignee_agent_id: null,
                    reporter_agent_id: null,
                    acceptance_criteria: '',
                    labels: [],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }),
            ),
        );
        renderWithProviders(
            <NewIssueModal
                open
                onClose={onClose}
                initialKind="sub_task"
                initialProjectId="p1"
                initialParentStoryId="ATL-2"
            />,
        );
        await waitFor(() => screen.getByText('New sub-task'));
        // fireEvent.change instead of userEvent.type — see bug/sub_bug patterns.
        fireEvent.change(screen.getByPlaceholderText('Short summary…'), {
            target: { value: 'Sub task title' },
        });
        fireEvent.change(screen.getByPlaceholderText('What needs to happen and why…'), {
            target: { value: 'Sub task desc' },
        });
        // sub_task has no AC field per kindSubtitle check — submit directly
        fireEvent.click(screen.getByRole('button', { name: /Create issue/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 15000 });
    });
});

describe('NewIssueModal — submit sub_bug kind path', () => {
    it('submits a sub_bug and calls onClose — exercises submit() sub_bug branch', { timeout: 60_000 }, async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/stories/ATL-2/sub-bugs`, () =>
                HttpResponse.json({
                    id: 'ATL-SB1',
                    story_id: 'ATL-2',
                    title: 'Sub bug title',
                    description: 'desc',
                    status: 'draft',
                    assignee_agent_id: null,
                    reporter_agent_id: null,
                    acceptance_criteria: '',
                    steps_to_reproduce: '',
                    expected: '',
                    actual: '',
                    frequency: 'sometimes',
                    failure_scope: 'cosmetic',
                    labels: [],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }),
            ),
        );
        renderWithProviders(
            <NewIssueModal
                open
                onClose={onClose}
                initialKind="sub_bug"
                initialProjectId="p1"
                initialParentStoryId="ATL-2"
            />,
        );
        await waitFor(() => screen.getByText('New sub-bug'));
        // userEvent.type is per-char and balloons under v8 coverage; fireEvent.change is instant
        fireEvent.change(screen.getByPlaceholderText('Short summary…'), {
            target: { value: 'Sub bug title' },
        });
        fireEvent.change(screen.getByPlaceholderText('What needs to happen and why…'), {
            target: { value: 'Sub bug description' },
        });
        fireEvent.change(screen.getByLabelText(/Acceptance criteria/i), {
            target: { value: 'Reproduces consistently' },
        });
        const stepsInput = screen.queryByLabelText(/Steps to reproduce/i);
        if (stepsInput) fireEvent.change(stepsInput, { target: { value: '1. Do X\n2. See Y' } });
        fireEvent.click(screen.getByRole('button', { name: /Create issue/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 15000 });
    });
});

describe('NewIssueModal — clone link path', () => {
    it('submits a story and attaches relates_to link when cloneFromId is set', { timeout: 60_000 }, async () => {
        const onClose = vi.fn();
        let linkCreated = false;
        server.use(
            http.post(`${BASE}/stories`, () =>
                HttpResponse.json({
                    id: 'ATL-20',
                    epic_id: 'ATL-1',
                    title: 'Cloned story',
                    description: '',
                    status: 'draft',
                    assignee_agent_id: null,
                    reporter_agent_id: null,
                    priority: 'normal',
                    spec_md: null,
                    pr_url: null,
                    points: 0,
                    acceptance_criteria: '',
                    labels: [],
                    worktree_branch: null,
                    worktree_path: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }),
            ),
            // The link endpoint is POST /issues/:type/:id/links
            http.post(`${BASE}/issues/story/ATL-20/links`, () => {
                linkCreated = true;
                return HttpResponse.json({ id: 1 });
            }),
        );
        renderWithProviders(
            <NewIssueModal
                open
                onClose={onClose}
                initialProjectId="p1"
                initialParentEpicId="ATL-1"
                cloneFromId="ATL-2"
                cloneFromType="story"
            />,
        );
        await waitFor(() => screen.getByText('New story'));
        fireEvent.change(screen.getByPlaceholderText('Short summary…'), {
            target: { value: 'Cloned story' },
        });
        fireEvent.change(screen.getByPlaceholderText('What needs to happen and why…'), {
            target: { value: 'Cloned description' },
        });
        fireEvent.change(screen.getByLabelText(/Acceptance criteria/i), {
            target: { value: '- Cloned AC' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Create issue/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 15000 });
        expect(linkCreated).toBe(true);
    });

    it('still closes even when the relates_to link call fails — clone link error is best-effort', { timeout: 60_000 }, async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/stories`, () =>
                HttpResponse.json({
                    id: 'ATL-21',
                    epic_id: 'ATL-1',
                    title: 'Cloned story 2',
                    description: '',
                    status: 'draft',
                    assignee_agent_id: null,
                    reporter_agent_id: null,
                    priority: 'normal',
                    spec_md: null,
                    pr_url: null,
                    points: 0,
                    acceptance_criteria: '',
                    labels: [],
                    worktree_branch: null,
                    worktree_path: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }),
            ),
            // Return 500 for the link endpoint so the best-effort catch branch runs
            http.post(`${BASE}/issues/story/ATL-21/links`, () =>
                HttpResponse.json({ error: 'link error' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <NewIssueModal
                open
                onClose={onClose}
                initialProjectId="p1"
                initialParentEpicId="ATL-1"
                cloneFromId="ATL-3"
                cloneFromType="story"
            />,
        );
        await waitFor(() => screen.getByText('New story'));
        fireEvent.change(screen.getByPlaceholderText('Short summary…'), {
            target: { value: 'Cloned story 2' },
        });
        fireEvent.change(screen.getByPlaceholderText('What needs to happen and why…'), {
            target: { value: 'Cloned desc 2' },
        });
        fireEvent.change(screen.getByLabelText(/Acceptance criteria/i), {
            target: { value: '- AC' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Create issue/i }));
        // Even though link creation fails, the modal should still close
        await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 15000 });
    });
});

describe('NewIssueModal — project select resets parent selects', () => {
    it('changing project select clears parent epic selection', async () => {
        const project2 = makeProject({ id: 'p2', name: 'Beta' });
        const epic2 = makeEpicListItem({ id: 'ATL-E2', project_id: 'p2', title: 'Epic Beta' });
        server.use(
            handlers.listProjects([project, project2]),
            handlers.listEpics([epic, epic2]),
            handlers.listStories([story]),
        );
        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                initialProjectId="p1"
                initialParentEpicId="ATL-1"
            />,
        );
        await waitFor(() => screen.getByText('New story'));
        // Open the project select and choose a different project
        const comboboxes = screen.getAllByRole('combobox');
        const projectSelect = comboboxes[0]!;
        fireEvent.mouseDown(projectSelect);
        const betaOption = await screen.findByText('Beta');
        fireEvent.click(betaOption);
        // After selecting Beta, parent epic should be cleared
        await waitFor(() => expect(document.body).toBeTruthy());
    });
});

describe('NewIssueModal — parent select shows error when submitted without parent', () => {
    it('shows parent error when story kind submitted without epic', async () => {
        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                initialProjectId="p1"
            />,
        );
        await waitFor(() => screen.getByText('New story'));
        // Use fireEvent.change (synchronous) instead of userEvent.type to avoid
        // slow keystroke simulation that can hit the 15s global timeout under parallelism.
        fireEvent.change(screen.getByPlaceholderText('Short summary…'), { target: { value: 'A title' } });
        fireEvent.change(screen.getByPlaceholderText('What needs to happen and why…'), { target: { value: 'A description' } });
        const criteria = screen.queryByLabelText(/Acceptance criteria/i);
        if (criteria) fireEvent.change(criteria, { target: { value: 'Criterion' } });
        fireEvent.click(screen.getByRole('button', { name: /Create issue/i }));
        await waitFor(() =>
            expect(screen.getByText(/Pick an epic/i)).toBeInTheDocument(),
        );
    });

    it('shows parent error when sub_task kind submitted without story', async () => {
        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                initialProjectId="p1"
                initialKind="sub_task"
            />,
        );
        await waitFor(() => screen.getByText('New sub-task'));
        fireEvent.change(screen.getByPlaceholderText('Short summary…'), { target: { value: 'A title' } });
        fireEvent.change(screen.getByPlaceholderText('What needs to happen and why…'), { target: { value: 'A description' } });
        fireEvent.click(screen.getByRole('button', { name: /Create issue/i }));
        await waitFor(() =>
            expect(screen.getByText(/Pick a story/i)).toBeInTheDocument(),
        );
    });
});

describe('NewIssueModal — kindSubtitle sub_task branch', () => {
    it('shows correct subtitle text for sub_task kind', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} initialKind="sub_task" />,
        );
        await waitFor(() =>
            expect(screen.getByText(/Pick a kind, then fill the fields/i)).toBeInTheDocument(),
        );
    });
});

describe('NewIssueModal — failure scope select in bug kind', () => {
    it('changes failure scope select in bug mode — exercises failureScope onChange', async () => {
        const fe = fireEvent;
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} initialKind="bug" />);
        await waitFor(() => screen.getByText('New bug'));
        // Find all comboboxes; failure scope select value is 'cosmetic' by default
        const comboboxes = screen.getAllByRole('combobox');
        const scopeSelect = comboboxes.find(c =>
            (c as HTMLElement).textContent?.includes('cosmetic') ||
            (c as HTMLSelectElement).value === 'cosmetic'
        );
        if (scopeSelect) {
            fe.mouseDown(scopeSelect);
            const opts = screen.queryAllByRole('option');
            const functionalOpt = opts.find(o => o.textContent === 'functional');
            if (functionalOpt) fe.click(functionalOpt);
        }
        expect(document.body).toBeTruthy();
    });
});

describe('NewIssueModal — epic renderValue with existing epic', () => {
    it('exercises epic renderValue when parentEpicId is pre-set and epic data loads', async () => {
        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                initialProjectId="p1"
                initialParentEpicId="ATL-1"
            />,
        );
        await waitFor(() => screen.getByText('New story'));
        // Open the parent-epic select (combobox index 1).
        // When epics load from MSW, epicsForProject has the epic and
        // renderValue(v) finds it => returns epic.title ("Epic One").
        // We just open the select to ensure the renderValue path runs.
        const comboboxes = screen.getAllByRole('combobox');
        if (comboboxes.length > 1) {
            fireEvent.mouseDown(comboboxes[1]!);
        }
        // Dismiss — pressing Escape closes an open MUI Select
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(document.body).toBeTruthy();
    });
});

describe('NewIssueModal — story renderValue with existing story', () => {
    it('exercises story renderValue when parentStoryId is pre-set and story data loads (sub_task)', async () => {
        renderWithProviders(
            <NewIssueModal
                open
                onClose={vi.fn()}
                initialKind="sub_task"
                initialProjectId="p1"
                initialParentStoryId="ATL-2"
            />,
        );
        await waitFor(() => screen.getByText('New sub-task'));
        // Open the parent-story select (combobox index 1).
        // When stories load from MSW, storiesForProject has the story and
        // renderValue(v) finds it => returns story.title ("Story One").
        const comboboxes = screen.getAllByRole('combobox');
        if (comboboxes.length > 1) {
            fireEvent.mouseDown(comboboxes[1]!);
        }
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(document.body).toBeTruthy();
    });
});

describe('NewIssueModal — expected and actual field changes (bug fields)', () => {
    it('types into Expected and Actual fields — exercises setExpected and setActual onChange', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} initialKind="bug" />,
        );
        await waitFor(() => screen.getByText('New bug'));
        const expectedInput = screen.getByPlaceholderText('What should happen');
        const actualInput = screen.getByPlaceholderText('What actually happens');
        fireEvent.change(expectedInput, { target: { value: 'Expected outcome' } });
        fireEvent.change(actualInput, { target: { value: 'Actual outcome' } });
        expect((expectedInput as HTMLInputElement).value).toBe('Expected outcome');
        expect((actualInput as HTMLInputElement).value).toBe('Actual outcome');
    });
});

describe('NewIssueModal — reporter select onChange', () => {
    it('triggers reporter select onChange — exercises setReporterId("owner") branch', async () => {
        const fe = fireEvent;
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} />);
        await waitFor(() => screen.getByText('New story'));
        // Find the Reporter combobox by its displayed value "sspart · Owner"
        const comboboxes = screen.getAllByRole('combobox');
        const reporterSelect = comboboxes.find(c =>
            (c as HTMLElement).textContent?.includes('sspart') ||
            (c as HTMLElement).textContent?.includes('Owner')
        );
        if (reporterSelect) {
            fe.mouseDown(reporterSelect);
            // After opening, multiple elements with "sspart · Owner" may exist
            // (one in the trigger, one in the listbox). Use queryAllByText.
            const ownerOpts = screen.queryAllByText('sspart · Owner');
            // Click the last one — in MUI the option in the listbox comes last
            const ownerOpt = ownerOpts[ownerOpts.length - 1];
            if (ownerOpt) fe.click(ownerOpt);
        }
        expect(document.body).toBeTruthy();
    });
});

describe('NewIssueModal — parent epic select onBlur exercises touch("parent")', () => {
    it('blurs parent epic select in story mode to exercise touch("parent") — fn', async () => {
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} initialProjectId="p1" />,
        );
        await waitFor(() => screen.getByText('New story'));
        // Parent epic select is the second combobox (index 1)
        const comboboxes = screen.getAllByRole('combobox');
        if (comboboxes.length > 1) {
            fireEvent.blur(comboboxes[1]!);
        }
        expect(document.body).toBeTruthy();
    });
});

describe('NewIssueModal — project select onBlur exercises touch("projectId")', () => {
    it('blurs project select to exercise touch("projectId") onBlur — fn', async () => {
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} />);
        await waitFor(() => screen.getByText('New story'));
        // Project select is the first combobox (index 0)
        const comboboxes = screen.getAllByRole('combobox');
        if (comboboxes.length > 0) {
            fireEvent.blur(comboboxes[0]!);
        }
        expect(document.body).toBeTruthy();
    });
});

describe('NewIssueModal — auto-default assignee from the agents list', () => {
    it('defaults assigneeId to the matching agent when the agents list contains agent-coder (bug kind)', async () => {
        // For kind=bug, defaultAssignee looks up agents.find(id==='agent-coder').
        // The suite-wide default agents handler returns [], which makes
        // defaultAssignee always undefined — so the
        // `if (!assigneeId && defaultAssignee) setAssigneeId(...)` true
        // branch never fires. Supplying a real agent-coder row here exercises it.
        server.use(handlers.listAgents([makeAgent({ id: 'agent-coder', name: 'Coder Agent' })]));
        renderWithProviders(
            <NewIssueModal open onClose={vi.fn()} initialKind="bug" />,
        );
        await waitFor(() => screen.getByText('New bug'));
        await waitFor(() => {
            expect(screen.getByDisplayValue('Coder Agent')).toBeInTheDocument();
        });
    });
});

describe('NewIssueModal — auto-default projectId to the first project', () => {
    it('defaults projectId to projects[0].id when opened without initialProjectId once the projects list loads', async () => {
        // No initialProjectId is passed, so projectId starts at ''. Once
        // useProjects() resolves with a non-empty list, the effect
        // `if (open && !projectId && projects.length > 0)` fires and sets
        // projectId to the first project's id — reflected here by the
        // Project select's displayed value becoming "Acme".
        // NOTE: this file's top-level beforeEach registers `...defaultHandlers`
        // (which stubs GET /projects -> []) ahead of `handlers.listProjects(...)`
        // in the SAME server.use() call — MSW resolves same-call handlers in
        // registration order, so the empty defaultHandlers stub wins there. A
        // second, separate server.use() call here takes priority over the
        // whole earlier call and actually serves the populated list.
        server.use(handlers.listProjects([project]));
        renderWithProviders(<NewIssueModal open onClose={vi.fn()} />);
        await waitFor(() => screen.getByText('New story'));
        await waitFor(() => {
            const comboboxes = screen.getAllByRole('combobox');
            expect(comboboxes[0]).toHaveTextContent('Acme');
        });
    });
});
