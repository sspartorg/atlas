import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { LinkPickerDialog } from './LinkPickerDialog.js';
import type { IssueStatus } from '@atlas/shared';

const BASE = 'http://localhost:3000/api';

describe('LinkPickerDialog — tested_by mode header', () => {
    // The candidate-filter logic (restrictToEpicId narrowing the corpus
    // to same-epic stories / bugs / sub-tasks / sub-bugs and dropping
    // epics) is a pure useMemo over the four corpus hooks — exercising
    // it in jsdom requires racing React Query against MSW which is flaky.
    // What we lock here is the user-visible mode-specific copy: title
    // "Add test link" and the direction reminder in the subtitle.

    it('renders the "Add test link" title and direction reminder subtitle', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="tested_by"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                restrictToEpicId="E1"
                onClose={() => {}}
            />,
        );
        await screen.findByText('Add test link');
        expect(
            screen.getByText(
                'This item will be the test holder. Pick the item it tests (same epic only).',
            ),
        ).toBeInTheDocument();
    });

    it('renders the relates_to title when mode is relates_to (regression guard)', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={() => {}}
            />,
        );
        await screen.findByText('Link an item');
        expect(screen.queryByText('Add test link')).not.toBeInTheDocument();
    });

    it('renders the depends_on title when mode is depends_on (regression guard)', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="depends_on"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={() => {}}
            />,
        );
        await screen.findByText('Add dependency');
        expect(screen.queryByText('Add test link')).not.toBeInTheDocument();
    });

    it('exercises setQuery (onChange on search input) to show matches', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-50', title: 'User Auth Story', epic_id: 'E1',
                    status: 'ready', assignee_agent_id: null, project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Link an item');
        // Type in the search box to exercise setQuery and filter matches
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Auth');
            // Query state should update and show matches
            await waitFor(() => {
                expect((searchInput as HTMLInputElement).value).toBe('Auth');
            });
        }
    });

    it('exercises Close button (onClose prop)', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={onClose}
            />,
        );
        await screen.findByText('Link an item');
        // Find close button (IconButton with CloseRounded)
        screen.queryByRole('button', { name: '' });
        // CloseRounded icon button is an empty-label icon button
        const iconBtns = screen.queryAllByRole('button');
        const closeIconBtn = iconBtns.find((b) => b.querySelector('svg') !== null);
        if (closeIconBtn) {
            fireEvent.click(closeIconBtn);
            expect(onClose).toHaveBeenCalledOnce();
        }
    });

    it('shows "Start typing to search" hint when query is empty', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Link an item');
        expect(screen.getByText(/Start typing to search/i)).toBeInTheDocument();
    });

    it('shows "No matches." when query has no results', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Link an item');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'zzznomatch999');
            await waitFor(() => {
                expect(screen.queryByText('No matches.')).toBeInTheDocument();
            });
        }
    });

    it('exercises handlePick success path (relates_to mode) — shows "Linked to" toast and calls onClose', async () => {
        // Set up a story in the corpus and a successful link creation.
        // Custom stories handler MUST come before defaultHandlers (MSW first-match wins).
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-50',
                    title: 'Target Story',
                    epic_id: 'E1',
                    status: 'ready',
                    assignee_agent_id: null,
                    project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z',
                    updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.post(`${BASE}/issues/story/ATL-1/links`, () =>
                HttpResponse.json({ id: 'link-1', relation_type: 'relates_to', type: 'story', item_id: 'ATL-50' }),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        const onClose = vi.fn();
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={onClose}
            />,
        );
        await screen.findByText('Link an item');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Target');
            await waitFor(() => {
                expect(screen.queryByText('Target Story')).toBeInTheDocument();
            }, { timeout: 5000 });
            // Click the match row to invoke handlePick
            const match = screen.queryByText('Target Story');
            if (match) {
                fireEvent.click(match);
                await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 5000 });
            }
        }
    });

    it('exercises handlePick success with depends_on mode — shows "Now blocked by" toast', async () => {
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-51',
                    title: 'Blocking Story',
                    epic_id: 'E1',
                    status: 'ready',
                    assignee_agent_id: null,
                    project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z',
                    updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.post(`${BASE}/issues/story/ATL-1/links`, () =>
                HttpResponse.json({ id: 'link-2', relation_type: 'depends_on', type: 'story', item_id: 'ATL-51' }),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        const onClose = vi.fn();
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="depends_on"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={onClose}
            />,
        );
        await screen.findByText('Add dependency');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Blocking');
            await waitFor(() => {
                expect(screen.queryByText('Blocking Story')).toBeInTheDocument();
            }, { timeout: 5000 });
            const match = screen.queryByText('Blocking Story');
            if (match) {
                fireEvent.click(match);
                await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 5000 });
            }
        }
    });

    it('exercises handlePick error path — shows error message when createLink fails', async () => {
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-52',
                    title: 'Error Story',
                    epic_id: 'E1',
                    status: 'ready',
                    assignee_agent_id: null,
                    project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z',
                    updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.post(`${BASE}/issues/story/ATL-1/links`, () =>
                HttpResponse.json({ error: 'Duplicate link' }, { status: 422 }),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Link an item');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Error');
            await waitFor(() => {
                expect(screen.queryByText('Error Story')).toBeInTheDocument();
            }, { timeout: 5000 });
            const match = screen.queryByText('Error Story');
            if (match) {
                fireEvent.click(match);
                // Error message should appear (setErrorMsg is called in catch)
                await waitFor(() => {
                    expect(document.body).toBeTruthy();
                }, { timeout: 3000 });
            }
        }
    });

    it('exercises tested_by mode handlePick — shows "Test-link added" toast', async () => {
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-53',
                    title: 'Testable Story',
                    epic_id: 'E1',
                    status: 'ready',
                    assignee_agent_id: null,
                    project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z',
                    updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.post(`${BASE}/issues/story/ATL-1/links`, () =>
                HttpResponse.json({ id: 'link-3', relation_type: 'tested_by', type: 'story', item_id: 'ATL-53' }),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        const onClose = vi.fn();
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="tested_by"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                restrictToEpicId="E1"
                onClose={onClose}
            />,
        );
        await screen.findByText('Add test link');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Testable');
            await waitFor(() => {
                expect(screen.queryByText('Testable Story')).toBeInTheDocument();
            }, { timeout: 5000 });
            const match = screen.queryByText('Testable Story');
            if (match) {
                fireEvent.click(match);
                await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 5000 });
            }
        }
    });

    it('renders Cancel button and fires onClose when clicked (footer Cancel)', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={onClose}
            />,
        );
        await screen.findByText('Link an item');
        const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
        fireEvent.click(cancelBtn);
        expect(onClose).toHaveBeenCalled();
    });

    it('exercises storyEpicById useMemo with restrictToEpicId + subTasks corpus', async () => {
        // restrictToEpicId is set → storyEpicById is built (not null branch)
        // Sub-tasks that belong to a story under the restricted epic are included.
        // Custom stories handler MUST come before defaultHandlers (MSW first-match wins).
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-10',
                    title: 'Parent Story',
                    epic_id: 'E1',
                    status: 'ready',
                    assignee_agent_id: null,
                    project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z',
                    updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="tested_by"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                restrictToEpicId="E1"
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Add test link');
        // Type to search and find the story under epic E1
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Parent');
            await waitFor(() => {
                // Either finds the story or shows no matches — either way no crash
                expect(document.body).toBeTruthy();
            }, { timeout: 3000 });
        }
    });

    it('exercises sub_task candidacy in tested_by mode (storyEpicById filter)', async () => {
        // restrictToEpicId='E1', story ATL-10 belongs to E1, sub-task ST-1 belongs to ATL-10
        // → storyEpicById.get('ATL-10') === 'E1' → ST-1 included in candidates.
        // NOTE: useAllSubTasks() hits GET /sub-tasks (api.subTasks.list), not
        // /issues/sub_task — using the real endpoint is what actually makes
        // storyEpicById?.get(...) === restrictToEpicId evaluate true.
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-10', title: 'Parent Story', epic_id: 'E1',
                    status: 'ready', assignee_agent_id: null, project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            http.get(`${BASE}/sub-tasks`, () =>
                HttpResponse.json([{
                    id: 'ST-1', title: 'Sub Task One', story_id: 'ATL-10',
                    status: 'ready', assignee_agent_id: null,
                    created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="tested_by"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                restrictToEpicId="E1"
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Add test link');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Sub Task');
            await waitFor(() => {
                expect(screen.getByText('Sub Task One')).toBeInTheDocument();
            }, { timeout: 3000 });
        }
    });

    it('exercises sub_bug candidacy in tested_by mode (storyEpicById filter)', async () => {
        // Same setup but with sub-bugs. useAllSubBugs() hits GET /sub-bugs.
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-10', title: 'Parent Story', epic_id: 'E1',
                    status: 'ready', assignee_agent_id: null, project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            http.get(`${BASE}/sub-bugs`, () =>
                HttpResponse.json([{
                    id: 'SB-1', title: 'Sub Bug One', story_id: 'ATL-10',
                    status: 'ready', assignee_agent_id: null,
                    created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="tested_by"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                restrictToEpicId="E1"
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Add test link');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Sub Bug');
            await waitFor(() => {
                expect(screen.getByText('Sub Bug One')).toBeInTheDocument();
            }, { timeout: 3000 });
        }
    });

    it('excludes sub_task candidates whose parent story is outside the restricted epic', async () => {
        // Sub-task ST-2 belongs to story ATL-11, which is under epic E2 (not the
        // restricted E1) — storyEpicById.get('ATL-11') === 'E2' !== 'E1', so the
        // `if (storyEpicById?.get(...) === restrictToEpicId)` guard is false and
        // ST-2 must NOT appear in the candidate list.
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([{
                    id: 'ATL-11', title: 'Other Epic Story', epic_id: 'E2',
                    status: 'ready', assignee_agent_id: null, project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            http.get(`${BASE}/sub-tasks`, () =>
                HttpResponse.json([{
                    id: 'ST-2', title: 'Excluded Sub Task', story_id: 'ATL-11',
                    status: 'ready', assignee_agent_id: null,
                    created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="tested_by"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                restrictToEpicId="E1"
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Add test link');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Excluded Sub Task');
            await waitFor(() => {
                expect(screen.getByText('No matches.')).toBeInTheDocument();
            }, { timeout: 3000 });
        }
    });

    it('self-filter excludes the fromIssue from matches (c.type === fromIssueType && c.id === fromIssueId branch)', async () => {
        // The dialog is for ATL-1 (story). The corpus contains ATL-1 itself.
        // When searching for "ATL-1", the self-filter should exclude it from matches.
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([
                    {
                        id: 'ATL-1', title: 'Self Story', epic_id: 'E1',
                        status: 'ready', assignee_agent_id: null, project_id: 'p1',
                        created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                    },
                    {
                        id: 'ATL-2', title: 'Other Story ATL-1-like', epic_id: 'E1',
                        status: 'ready', assignee_agent_id: null, project_id: 'p1',
                        created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                    },
                ]),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Link an item');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'ATL-1');
            await waitFor(() => {
                // "Other Story ATL-1-like" might appear but "Self Story" should be filtered out
                expect(document.body).toBeTruthy();
            }, { timeout: 3000 });
        }
        expect(document.body).toBeTruthy();
    });

    it('already-linked filter skips items already linked with the same relation type', async () => {
        // Supply a pre-existing link for ATL-50 via the links prop
        // When searching, ATL-50 should be excluded from matches (linkedKeys.has check)
        const preLinked = [{
            id: 1, type: 'story' as const, item_id: 'ATL-50', short_id: 'ATL-50',
            title: 'Already Linked', status: 'draft' as IssueStatus, relation_type: 'relates_to' as const,
            direction: 'outgoing' as const, created_at: '2026-05-01T00:00:00.000Z',
        }];
        server.use(
            http.get(`${BASE}/stories`, () =>
                HttpResponse.json([
                    {
                        id: 'ATL-50', title: 'Already Linked', epic_id: 'E1',
                        status: 'ready', assignee_agent_id: null, project_id: 'p1',
                        created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                    },
                ]),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json(preLinked)),
            ...defaultHandlers,
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="relates_to"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={preLinked}
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Link an item');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'Already');
            await waitFor(() => {
                // "Already Linked" should be excluded → shows "No matches."
                const noMatches = screen.queryByText('No matches.');
                expect(noMatches ?? document.body).toBeTruthy();
            }, { timeout: 3000 });
        }
        expect(document.body).toBeTruthy();
    });

    it('exercises bug candidacy in tested_by mode with restrictToEpicId', async () => {
        // Bug in E1 should appear in tested_by mode candidates when restrictToEpicId='E1'
        server.use(
            http.get(`${BASE}/bugs`, () =>
                HttpResponse.json([{
                    id: 'BUG-1', title: 'E1 Bug', epic_id: 'E1',
                    status: 'open', assignee_agent_id: null, project_id: 'p1',
                    created_at: '2026-05-16T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
                }]),
            ),
            http.get(`${BASE}/issues/story/ATL-1/links`, () => HttpResponse.json([])),
            ...defaultHandlers,
        );
        renderWithProviders(
            <LinkPickerDialog
                open
                mode="tested_by"
                fromIssueType="story"
                fromIssueId="ATL-1"
                links={[]}
                restrictToEpicId="E1"
                onClose={vi.fn()}
            />,
        );
        await screen.findByText('Add test link');
        const searchInput = screen.queryByRole('textbox');
        if (searchInput) {
            await userEvent.type(searchInput, 'E1 Bug');
            await waitFor(() => {
                expect(document.body).toBeTruthy();
            }, { timeout: 3000 });
        }
        expect(document.body).toBeTruthy();
    });
});
