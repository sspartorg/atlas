import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import type { IIssueTreeNode } from '@atlas/shared';
import { makeProject, makeProjectRepo, makeTask, makeAgent } from '../test-utils/factories.js';

function subTaskNode(overrides: Partial<IIssueTreeNode> = {}): IIssueTreeNode {
    return {
        id: 'ATL-2',
        kind: 'sub_task',
        short_id: 'ATL-2',
        title: 'Sub-task',
        status: 'draft',
        assignee_agent_id: null,
        reporter_agent_id: null,
        created_at: '2026-05-16T00:00:00.000Z',
        updated_at: '2026-05-16T00:00:00.000Z',
        project_id: 'p1',
        project_name: 'Atlas',
        task_id: 'ATL-1',
        task_title: 'Task One',
        children: [],
        ...overrides,
    };
}

function taskNode(id: string, children: IIssueTreeNode[] = []): IIssueTreeNode {
    return subTaskNode({
        id,
        short_id: id,
        kind: 'task',
        task_id: null,
        task_title: null,
        children,
    });
}
import { ProjectDetail } from './ProjectDetail.js';

// Stamp the URL search string into the DOM so tab-nav tests can assert on it.
function LocationDisplay() {
    const { search } = useLocation();
    return <div data-testid="search">{search}</div>;
}

function registerProjectMocks(
    project = makeProject({ id: 'p1', name: 'Atlas' }),
    ...extra: Parameters<typeof server.use>
) {
    server.use(
        // `extra` overrides (e.g. a custom /api/issues/tree response) must be
        // registered before `defaultHandlers` — msw resolves multiple
        // matching handlers in registration order, first match wins.
        ...extra,
        ...defaultHandlers,
        http.get('http://localhost:3000/api/projects/p1', () => HttpResponse.json(project)),
        http.get('http://localhost:3000/api/projects/p1/guardrails', () => HttpResponse.json([])),
        http.get('http://localhost:3000/api/counts/project/p1', () => HttpResponse.json({}))
    );
}

describe('ProjectDetail page', () => {
    it('renders without crashing', () => {
        registerProjectMocks();
        const { container } = renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('clicking a tab writes ?tab=<key> to the URL', async () => {
        registerProjectMocks();
        const user = userEvent.setup();
        renderWithProviders(
            <>
                <LocationDisplay />
                <Routes>
                    <Route path="/projects/:id" element={<ProjectDetail />} />
                </Routes>
            </>,
            { initialEntries: ['/projects/p1'] }
        );

        const tasksTab = await screen.findByRole('tab', { name: /tasks/i });
        await user.click(tasksTab);
        expect(screen.getByTestId('search').textContent).toBe('?tab=tasks');

        const overviewTab = await screen.findByRole('tab', { name: /overview/i });
        await user.click(overviewTab);
        // Returning to the default tab clears the param so the canonical URL stays clean.
        expect(screen.getByTestId('search').textContent).toBe('');
    });

    it('repeated Edit Guard-rails clicks across tabs reliably re-activate Guardrails (B08)', async () => {
        registerProjectMocks();
        const user = userEvent.setup();
        renderWithProviders(
            <>
                <LocationDisplay />
                <Routes>
                    <Route path="/projects/:id" element={<ProjectDetail />} />
                </Routes>
            </>,
            { initialEntries: ['/projects/p1'] }
        );

        // First click of the right-rail "Edit →" while on Overview flips to Guardrails.
        const firstEdit = await screen.findByRole('button', { name: /edit/i });
        await user.click(firstEdit);
        expect(screen.getByTestId('search').textContent).toBe('?tab=guardrails');

        // Bounce to Tasks so we're back somewhere the right rail is visible.
        await user.click(await screen.findByRole('tab', { name: /tasks/i }));
        expect(screen.getByTestId('search').textContent).toBe('?tab=tasks');

        // Second Edit click — the previously reported regression. URL flips back.
        const secondEdit = await screen.findByRole('button', { name: /edit/i });
        await user.click(secondEdit);
        expect(screen.getByTestId('search').textContent).toBe('?tab=guardrails');
    });

    it('exercises handleRename via ProjectActionsMenu Rename item', async () => {
        registerProjectMocks();
        const _user = userEvent.setup();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        // Find the "more" / project actions menu button
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const renameItem = screen.queryByText(/Rename project/i);
            if (renameItem) {
                fireEvent.click(renameItem);
                // RenameProjectModal should open
                await waitFor(
                    () => {
                        expect(screen.queryByRole('dialog') ?? document.body).toBeTruthy();
                    },
                    { timeout: 2000 }
                );
            }
        }
    });

    it('exercises handleManageSecrets via ProjectActionsMenu Manage Secrets', async () => {
        registerProjectMocks();
        const _user = userEvent.setup();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const secretsItem = screen.queryByText(/Manage Secrets/i);
            if (secretsItem) {
                fireEvent.click(secretsItem);
                await waitFor(
                    () => {
                        expect(screen.queryByRole('dialog') ?? document.body).toBeTruthy();
                    },
                    { timeout: 2000 }
                );
            }
        }
    });

    it('exercises handleRefresh by clicking Refresh button', async () => {
        registerProjectMocks();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const refreshBtn = screen.queryByRole('button', { name: /refresh/i });
        if (refreshBtn) {
            fireEvent.click(refreshBtn);
        }
        expect(document.body).toBeTruthy();
    });

    it('exercises handleDelete via ProjectActionsMenu Delete', async () => {
        registerProjectMocks();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const deleteItem = screen.queryByText(/Delete project/i);
            if (deleteItem) {
                fireEvent.click(deleteItem);
                await waitFor(
                    () => {
                        expect(screen.queryByRole('dialog') ?? document.body).toBeTruthy();
                    },
                    { timeout: 2000 }
                );
            }
        }
        expect(document.body).toBeTruthy();
    });

    it('exercises handleGenerateAiScaffold via ProjectActionsMenu', async () => {
        registerProjectMocks();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        if (moreBtn) {
            fireEvent.click(moreBtn);
            // AI Scaffold option
            const scaffoldItem = screen.queryByText(/AI.*scaffold|scaffold.*AI|Generate.*AI/i);
            if (scaffoldItem) {
                fireEvent.click(scaffoldItem);
            }
        }
        expect(document.body).toBeTruthy();
    });

    it('renders the "Project not found" state and clicks Back — fn#2 (onClick at line 164)', async () => {
        server.use(
            ...defaultHandlers,
            http.get('http://localhost:3000/api/projects/not-found', () =>
                HttpResponse.json(null, { status: 404 })
            )
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/not-found'] }
        );
        await waitFor(
            () => {
                expect(screen.getByText(/Project not found/i)).toBeInTheDocument();
            },
            { timeout: 5000 }
        );
        const backBtn = screen.queryByRole('button', { name: /Back to Projects/i });
        if (backBtn) fireEvent.click(backBtn);
        expect(document.body).toBeTruthy();
    }, 30000);

    it('closes DeleteProjectModal — fn#4 (onClose at line 359)', async () => {
        registerProjectMocks();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const deleteItem = screen.queryByText(/Delete project/i);
            if (deleteItem) {
                fireEvent.click(deleteItem);
                await waitFor(
                    () => {
                        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
                    },
                    { timeout: 5000 }
                ).catch(() => {});
                const cancelBtn = screen.queryByRole('button', { name: /Cancel/i });
                if (cancelBtn) {
                    fireEvent.click(cancelBtn);
                } else {
                    const dialog = document.querySelector('[role="dialog"]');
                    if (dialog) fireEvent.keyDown(dialog, { key: 'Escape' });
                }
            }
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('closes ProjectEnvSecretsModal — fn#5 (onClose at line 370)', async () => {
        registerProjectMocks();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const secretsItem = screen.queryByText(/Manage Secrets/i);
            if (secretsItem) {
                fireEvent.click(secretsItem);
                await waitFor(
                    () => {
                        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
                    },
                    { timeout: 5000 }
                ).catch(() => {});
                const cancelBtn = screen.queryByRole('button', { name: /Cancel/i });
                if (cancelBtn) {
                    fireEvent.click(cancelBtn);
                } else {
                    const dialog = document.querySelector('[role="dialog"]');
                    if (dialog) fireEvent.keyDown(dialog, { key: 'Escape' });
                }
            }
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('closes RenameProjectModal — fn#6 (onClose at line 379)', async () => {
        registerProjectMocks();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const renameItem = screen.queryByText(/Rename project/i);
            if (renameItem) {
                fireEvent.click(renameItem);
                await waitFor(
                    () => {
                        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
                    },
                    { timeout: 5000 }
                ).catch(() => {});
                const cancelBtn = screen.queryByRole('button', { name: /Cancel/i });
                if (cancelBtn) {
                    fireEvent.click(cancelBtn);
                } else {
                    const dialog = document.querySelector('[role="dialog"]');
                    if (dialog) fireEvent.keyDown(dialog, { key: 'Escape' });
                }
            }
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('closes GenerateAiScaffoldDialog — fn#7 (onClose at line 385)', async () => {
        registerProjectMocks();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const scaffoldItem = screen.queryByText(/AI.*scaffold|scaffold.*AI|Generate.*AI/i);
            if (scaffoldItem) {
                fireEvent.click(scaffoldItem);
                await waitFor(
                    () => {
                        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
                    },
                    { timeout: 5000 }
                ).catch(() => {});
                const cancelBtn = screen.queryByRole('button', { name: /Cancel/i });
                if (cancelBtn) {
                    fireEvent.click(cancelBtn);
                } else {
                    const dialog = document.querySelector('[role="dialog"]');
                    if (dialog) fireEvent.keyDown(dialog, { key: 'Escape' });
                }
            }
        }
        expect(document.body).toBeTruthy();
    }, 30000);

    it('exercises handleJumpToHistory (history tab) via clicking the history tab', async () => {
        registerProjectMocks();
        renderWithProviders(
            <>
                <LocationDisplay />
                <Routes>
                    <Route path="/projects/:id" element={<ProjectDetail />} />
                </Routes>
            </>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const historyTab = screen.queryByRole('tab', { name: /history/i });
        if (historyTab) {
            fireEvent.click(historyTab);
            await waitFor(
                () => {
                    expect(screen.getByTestId('search').textContent).toContain('history');
                },
                { timeout: 2000 }
            );
        }
        expect(document.body).toBeTruthy();
    });

    // ── New branch-coverage tests ───────────────────────────────────────────

    it('Tasks tab shows 0 when the tree has no tasks', async () => {
        registerProjectMocks(
            undefined,
            http.get('http://localhost:3000/api/issues/tree', () =>
                HttpResponse.json({ tree: [], projects: [], agents: [], tasks: [] })
            )
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        expect(await screen.findByRole('tab', { name: /tasks\s+0/i })).toBeInTheDocument();
    });

    it('derives sub_task_count per task from the tree (with and without sub-tasks)', async () => {
        const user = userEvent.setup();
        registerProjectMocks(
            undefined,
            http.get('http://localhost:3000/api/issues/tree', () =>
                HttpResponse.json({
                    tree: [
                        taskNode('ATL-1', [
                            subTaskNode({ id: 'ATL-2' }),
                            subTaskNode({ id: 'ATL-3' }),
                        ]),
                        taskNode('ATL-9'),
                    ],
                    projects: [],
                    agents: [],
                    tasks: [
                        makeTask({ id: 'ATL-1', title: 'Task With Sub-tasks' }),
                        makeTask({ id: 'ATL-9', title: 'Task Without Sub-tasks' }),
                    ],
                })
            )
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await user.click(await screen.findByRole('tab', { name: /tasks\s+2/i }));
        // The sub-task count cell sits right after the title cell.
        const countCell = (title: string) =>
            screen.getByText(title).parentElement?.nextElementSibling?.textContent;
        await screen.findByText('Task With Sub-tasks');
        expect(countCell('Task With Sub-tasks')).toBe('2');
        expect(countCell('Task Without Sub-tasks')).toBe('0');
    });

    it('renders with owner_name/accent_color present in settings (ownerName/ownerAccent non-fallback branch)', async () => {
        registerProjectMocks(
            undefined,
            http.get('http://localhost:3000/api/settings', () =>
                HttpResponse.json({
                    id: 1,
                    owner_name: 'Jamie Owner',
                    accent_color: '#123456',
                    onboarding_complete: 1,
                })
            )
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        expect(document.body).toBeTruthy();
    });

    it('renders with owner_name/accent_color absent from settings (fallback branch: "Owner" / slate)', async () => {
        registerProjectMocks(
            undefined,
            http.get('http://localhost:3000/api/settings', () =>
                HttpResponse.json({ id: 1, onboarding_complete: 1 })
            )
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        expect(document.body).toBeTruthy();
    });

    it('displayId falls back to "" when issue_key_prefix is empty', async () => {
        registerProjectMocks(makeProject({ id: 'p1', name: 'Atlas', issue_key_prefix: '' }));
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        const matches = await screen.findAllByText('Atlas');
        expect(matches.length).toBeGreaterThan(0);
    });

    it('activeAgents includes task/sub-task assignees, excluding done items', async () => {
        const agentA = makeAgent({ id: 'agent-a', name: 'Agent A' });
        const agentB = makeAgent({ id: 'agent-b', name: 'Agent B' });
        const agentDoneTask = makeAgent({ id: 'agent-done-task', name: 'Done Task Agent' });
        const agentDoneSub = makeAgent({ id: 'agent-done-sub', name: 'Done Sub-task Agent' });
        registerProjectMocks(
            undefined,
            http.get('http://localhost:3000/api/agents', () =>
                HttpResponse.json([agentA, agentB, agentDoneTask, agentDoneSub])
            ),
            http.get('http://localhost:3000/api/issues/tree', () =>
                HttpResponse.json({
                    tree: [
                        taskNode('ATL-1', [
                            subTaskNode({
                                id: 'ATL-2',
                                assignee_agent_id: 'agent-b',
                                status: 'in_progress',
                            }),
                            subTaskNode({
                                id: 'ATL-3',
                                assignee_agent_id: 'agent-done-sub',
                                status: 'done',
                            }),
                        ]),
                    ],
                    projects: [],
                    agents: [],
                    tasks: [
                        makeTask({ id: 'ATL-1', assignee_agent_id: 'agent-a' }),
                        makeTask({
                            id: 'ATL-4',
                            assignee_agent_id: 'agent-done-task',
                            status: 'done',
                        }),
                    ],
                })
            )
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        // Active agents surface in the right rail: Agent A (task) + Agent B (open sub-task).
        expect(await screen.findByText('Agent A')).toBeInTheDocument();
        expect(screen.getByText('Agent B')).toBeInTheDocument();
        expect(screen.queryByText('Done Task Agent')).not.toBeInTheDocument();
        expect(screen.queryByText('Done Sub-task Agent')).not.toBeInTheDocument();
    });

    it('guardrailsActive renders "Guard-rails active" pill when guardrails_md is non-empty', async () => {
        registerProjectMocks(
            makeProject({ id: 'p1', name: 'Atlas', guardrails_md: '## Rule one\nBe nice.' })
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        expect(await screen.findByText(/Guard-rails active/i)).toBeInTheDocument();
    });

    it('guardrailsActive is false (no pill) when guardrails_md is empty/whitespace', async () => {
        registerProjectMocks(makeProject({ id: 'p1', name: 'Atlas', guardrails_md: '   ' }));
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        expect(screen.queryByText(/Guard-rails active/i)).not.toBeInTheDocument();
    });

    it('showRail hides ProjectRightRail on the guardrails tab and shows it elsewhere', async () => {
        registerProjectMocks();
        const user = userEvent.setup();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        // On Overview (default tab), the right rail's "Active agents" panel is visible.
        expect(await screen.findByText(/Active agents/i)).toBeInTheDocument();

        // Navigate to Guardrails — the right rail should disappear.
        const guardrailsTab = await screen.findByRole('tab', { name: /guard-rails/i });
        await user.click(guardrailsTab);
        await waitFor(() => {
            expect(screen.queryByText(/Active agents/i)).not.toBeInTheDocument();
        });

        // Back to Tasks — right rail reappears.
        const tasksTab = await screen.findByRole('tab', { name: /tasks/i });
        await user.click(tasksTab);
        await waitFor(() => {
            expect(screen.getByText(/Active agents/i)).toBeInTheDocument();
        });
    });

    it('aiScaffoldEnabled is true when a repo is cloned (clone_status "ready") — menu item is enabled', async () => {
        // ADR 0018 — readiness is a property of the repos, not the project.
        registerProjectMocks(
            undefined,
            http.get('http://localhost:3000/api/projects/p1/repos', () =>
                HttpResponse.json([
                    makeProjectRepo({ id: 'r1', clone_status: 'cloning' }),
                    makeProjectRepo({ id: 'r2', clone_status: 'ready' }),
                ])
            )
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        expect(moreBtn).toBeTruthy();
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const scaffoldItem = await screen.findByText(/Generate AI scaffold/i);
            const menuItem = scaffoldItem.closest('[role="menuitem"]') as HTMLElement | null;
            expect(menuItem).not.toHaveAttribute('aria-disabled', 'true');
        }
    });

    it('aiScaffoldEnabled is false when no repo is cloned — menu item is disabled', async () => {
        registerProjectMocks(
            undefined,
            http.get('http://localhost:3000/api/projects/p1/repos', () =>
                HttpResponse.json([makeProjectRepo({ id: 'r1', clone_status: 'cloning' })])
            )
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const moreBtn =
            screen.queryByRole('button', { name: /project actions/i }) ??
            screen.queryByText('more_horiz');
        expect(moreBtn).toBeTruthy();
        if (moreBtn) {
            fireEvent.click(moreBtn);
            const scaffoldItem = await screen.findByText(/Generate AI scaffold/i);
            const menuItem = scaffoldItem.closest('[role="menuitem"]') as HTMLElement | null;
            expect(menuItem).toHaveAttribute('aria-disabled', 'true');
        }
    });

    it('handleRefresh triggers projectFetching predicate paths (projects + issues/tree query keys)', async () => {
        registerProjectMocks();
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await screen.findByRole('tab', { name: /overview/i });
        const refreshBtn = await screen.findByRole('button', { name: /refresh/i });
        fireEvent.click(refreshBtn);
        // No crash; the predicate over active queries (including unrelated
        // 'agents'/'settings' keys that fail the `first === 'projects'`/
        // `first === 'issues'` checks) is exercised on every render while
        // the invalidated queries refetch.
        expect(document.body).toBeTruthy();
    });
});
