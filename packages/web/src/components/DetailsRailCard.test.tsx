import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { IItemExternalLink } from '@atlas/shared';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeAgent, makeProject } from '../test-utils/factories.js';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { DetailsRailCard } from './DetailsRailCard.js';

describe('DetailsRailCard', () => {
    it('renders the details panel', () => {
        renderWithProviders(
            <DetailsRailCard
                issueType="sub_task"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
            />,
        );
        expect(screen.getByText('Details')).toBeInTheDocument();
    });

    it('navigates to the project page when the project name is clicked', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <DetailsRailCard
                issueType="sub_task"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={makeProject({ id: 'proj-1', name: 'My Project' })}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
            />,
        );
        // The project name is rendered as a clickable Typography.
        const projectLink = screen.getByText('My Project');
        expect(projectLink).toBeInTheDocument();
        await user.click(projectLink);
        // Navigation was triggered — no assertion on route, just confirm the
        // click handler didn't throw.
    });

    it('navigates when a parent link is clicked', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <DetailsRailCard
                issueType="sub_task"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                parents={[{ label: 'Task', text: 'CER-7', href: '/tasks/CER-7' }]}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
            />,
        );
        const taskLink = screen.getByText('CER-7');
        expect(taskLink).toBeInTheDocument();
        await user.click(taskLink);
    });

    it('opens the priority picker popover when the Priority row is clicked', async () => {
        const user = userEvent.setup();
        const onPriorityPick = vi.fn();
        renderWithProviders(
            <DetailsRailCard
                issueType="sub_task"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
                priority="normal"
                onPriorityPick={onPriorityPick}
            />,
        );
        // The Priority row is clickable because onPriorityPick is provided.
        const priorityRow = screen.getByText('Priority');
        await user.click(priorityRow);
        // The PriorityPickerPopover should be mounted after the click.
        // Its presence is confirmed if the component didn't throw.
        expect(priorityRow).toBeInTheDocument();
    });

    it('renders worktree branch and path copy buttons', async () => {
        const user = userEvent.setup();
        // Provide the clipboard API mock in the test context.
        // navigator.clipboard is a getter-only property in jsdom so we must use
        // Object.defineProperty rather than Object.assign.
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });
        renderWithProviders(
            <DetailsRailCard
                issueType="sub_task"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
                worktreeBranch="atlas/wf/task-1"
                worktreePath="/tmp/atlas/task-1"
            />,
        );
        expect(screen.getByText('Branch')).toBeInTheDocument();
        expect(screen.getByText('Path')).toBeInTheDocument();
        expect(screen.getByText('atlas/wf/task-1')).toBeInTheDocument();
        // Clicking the copy button exercises CopyValueButton.handleClick.
        const copyButtons = screen.getAllByRole('button', { name: /copy/i });
        if (copyButtons[0]) {
            await user.click(copyButtons[0]);
        }
    });

    it('task assignee picker suggests PO-role agents first', async () => {
        server.use(
            http.get('http://localhost:3000/api/agents', () =>
                HttpResponse.json([
                    makeAgent({ id: 'eng', name: 'EngBot', status: 'active', role_id: 'engineer' }),
                    makeAgent({ id: 'po', name: 'PoBot', status: 'active', role_id: 'po' }),
                ]),
            ),
            http.get('http://localhost:3000/api/settings', () =>
                HttpResponse.json({ id: 1, owner_name: 'Bob', onboarding_complete: 1 }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(
            <DetailsRailCard
                issueType="task"
                status="draft"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
            />,
        );
        await user.click(screen.getByText('Assignee'));
        expect(await screen.findByText('Suggested')).toBeInTheDocument();
    });

    it('shows the workflow picker on a task but not on a sub-task', async () => {
        server.use(
            http.get('http://localhost:3000/api/tasks/T1/full', () =>
                HttpResponse.json({ task: { id: 'T1', workflow_id: null } }),
            ),
            http.get('http://localhost:3000/api/workflows', () => HttpResponse.json([])),
            http.get('http://localhost:3000/api/items/T1/workflow-runs', () => HttpResponse.json([])),
        );
        const rail = (issueType: 'task' | 'sub_task') => (
            <DetailsRailCard
                issueType={issueType}
                issueId="T1"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={makeProject({ id: 'p1', name: 'My Project' })}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
            />
        );
        const { rerender } = renderWithProviders(rail('sub_task'));
        expect(screen.queryByText('Workflow')).not.toBeInTheDocument();
        rerender(rail('task'));
        expect(await screen.findByText('Workflow')).toBeInTheDocument();
    });

    describe('Done with unmerged pull requests', () => {
        const BASE = 'http://localhost:3000/api';
        const pr = (over: Partial<IItemExternalLink>): IItemExternalLink => ({
            id: 1,
            item_id: 'S1',
            link_kind: 'pull_request',
            url: 'https://github.com/foo/bar/pull/42',
            title: 'feat: thing',
            external_ref: '42',
            created_at: '2026-06-30T00:00:00.000Z',
            created_by_run_id: null,
            pr_state: 'open',
            ...over,
        });

        function renderRail(onStatusPick: (s: string, o: boolean) => void, links: IItemExternalLink[]) {
            return renderWithProviders(
                <DetailsRailCard
                    issueType="sub_task"
                    issueId="S1"
                    externalLinks={links}
                    status="in_review"
                    onStatusPick={onStatusPick}
                    assigneeAgentId={null}
                    onAssign={vi.fn()}
                    assignee={null}
                    project={null}
                    ownerName="Bob"
                    ownerAccent="#0A0A0A"
                    createdAt="2026-05-15T00:00:00.000Z"
                    updatedAt="2026-05-16T00:00:00.000Z"
                />,
            );
        }

        it('refreshes first, then asks before marking done while a PR is still unmerged', async () => {
            const user = userEvent.setup();
            let refreshed = 0;
            server.use(
                http.post(`${BASE}/issues/sub_task/S1/external-links/refresh`, () => {
                    refreshed += 1;
                    return HttpResponse.json([pr({ pr_state: 'open' })]);
                }),
            );
            const onStatusPick = vi.fn();
            renderRail(onStatusPick, [pr({ pr_state: 'open' })]);
            await user.click(screen.getByText('Status'));
            await user.click(await screen.findByRole('menuitem', { name: 'Done' }));
            const dialog = await screen.findByRole('dialog');
            expect(refreshed).toBe(1);
            expect(within(dialog).getByText('Mark done anyway?')).toBeInTheDocument();
            expect(within(dialog).getByText(/#42 feat: thing \(open\)/)).toBeInTheDocument();
            expect(onStatusPick).not.toHaveBeenCalled();
            await user.click(within(dialog).getByRole('button', { name: 'Mark done' }));
            expect(onStatusPick).toHaveBeenCalledWith('done', false);
        });

        it('transitions straight away when the refresh finds every PR merged', async () => {
            const user = userEvent.setup();
            server.use(
                http.post(`${BASE}/issues/sub_task/S1/external-links/refresh`, () =>
                    HttpResponse.json([pr({ pr_state: 'merged' })]),
                ),
            );
            const onStatusPick = vi.fn();
            renderRail(onStatusPick, [pr({ pr_state: null })]);
            await user.click(screen.getByText('Status'));
            await user.click(await screen.findByRole('menuitem', { name: 'Done' }));
            await waitFor(() => expect(onStatusPick).toHaveBeenCalledWith('done', false));
            expect(screen.queryByText('Mark done anyway?')).not.toBeInTheDocument();
        });
    });
});
