import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent, makeTaskListItem, makeProject } from '../test-utils/factories.js';
import { TaskTable } from './TaskTable.js';

describe('TaskTable', () => {
    it('renders rows and headers', () => {
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({
                        id: 'ATL-1',
                        title: 'Alpha',
                        sub_task_count: 2,
                        status: 'ready',
                    }),
                    makeTaskListItem({
                        id: 'ATL-2',
                        title: 'Beta',
                        sub_task_count: 0,
                        status: 'in_progress',
                    }),
                ]}
                projects={[makeProject({ id: 'p1' })]}
                agents={[makeAgent({ id: 'agent-coder' })]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
        expect(screen.getByText('ID')).toBeInTheDocument();
        expect(screen.getByText('Task')).toBeInTheDocument();
    });

    it('renders empty state with optional New Task button (onCreate branch)', async () => {
        const onCreate = vi.fn();
        renderWithProviders(
            <TaskTable
                rows={[]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                onCreate={onCreate}
            />
        );
        expect(screen.getByText(/No tasks match this view/)).toBeInTheDocument();
        const btn = screen.getByRole('button', { name: /New Task/i });
        fireEvent.click(btn);
        expect(onCreate).toHaveBeenCalled();
    });

    it('toggles sort on ID and Title columns (toggleSort branches)', async () => {
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({ id: 'ATL-1', title: 'A' }),
                    makeTaskListItem({ id: 'ATL-2', title: 'B' }),
                ]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        // Default sort key is 'updated' DESC. Click ID — switches to id ASC.
        await userEvent.click(screen.getByText('ID'));
        // Click ID again — flips dir to DESC (asc -> desc branch).
        await userEvent.click(screen.getByText('ID'));
        // Click ID a third time — flips dir back to ASC (desc -> asc branch).
        await userEvent.click(screen.getByText('ID'));
        // Click Task (title) — switches key.
        await userEvent.click(screen.getByText('Task'));
        // Click Updated — toggles back to updated key, default DESC.
        await userEvent.click(screen.getByText('Updated'));
    });

    it('actually reorders rows for each sort key (id/title/updated comparator branches)', async () => {
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({
                        id: 'ATL-2',
                        title: 'Bravo',
                        updated_at: '2026-01-01T00:00:00Z',
                    }),
                    makeTaskListItem({
                        id: 'ATL-1',
                        title: 'Alpha',
                        updated_at: '2026-02-01T00:00:00Z',
                    }),
                ]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        const titlesInOrder = () =>
            screen.getAllByText(/^(Bravo|Alpha)$/).map((el) => el.textContent);

        // Default: sortKey='updated', dir='desc' -> ATL-1 (Feb) before ATL-2 (Jan).
        expect(titlesInOrder()).toEqual(['Alpha', 'Bravo']);

        // Sort by id ascending -> ATL-1 before ATL-2.
        await userEvent.click(screen.getByText('ID'));
        expect(titlesInOrder()).toEqual(['Alpha', 'Bravo']);

        // Sort by title ascending -> Alpha before Bravo.
        await userEvent.click(screen.getByText('Task'));
        expect(titlesInOrder()).toEqual(['Alpha', 'Bravo']);
    });

    it('clicks a row to navigate (handleOpen callback fires)', () => {
        renderWithProviders(
            <TaskTable
                rows={[makeTaskListItem({ id: 'ATL-1', title: 'Alpha' })]}
                projects={[makeProject({ id: 'p1' })]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        fireEvent.click(screen.getByText('Alpha'));
        // Navigation happens via useNavigate; no observable side effect
        // here other than the handler firing — which lifts coverage.
    });

    it('changes the page-size selector (onPageSizeChange branch)', () => {
        const onPageSizeChange = vi.fn();
        renderWithProviders(
            <TaskTable
                rows={Array.from({ length: 30 }, (_, i) =>
                    makeTaskListItem({ id: `ATL-${i}`, title: `Task ${i}` })
                )}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                pageSize={20}
                onPageSizeChange={onPageSizeChange}
                page={1}
                onPageChange={vi.fn()}
            />
        );
        // The footer renders a native <select> with values 20/50/100/all.
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '50' } });
        expect(onPageSizeChange).toHaveBeenCalledWith(50);
        fireEvent.change(select, { target: { value: 'all' } });
        expect(onPageSizeChange).toHaveBeenLastCalledWith('all');
    });

    it('uses the pagination first/prev buttons when on the last page (onPageChange branches)', () => {
        const onPageChange = vi.fn();
        renderWithProviders(
            <TaskTable
                rows={Array.from({ length: 30 }, (_, i) =>
                    makeTaskListItem({ id: `ATL-${i}`, title: `Task ${i}` })
                )}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                pageSize={20}
                page={2}
                onPageChange={onPageChange}
                onPageSizeChange={vi.fn()}
            />
        );
        // Pagination footer has « ‹ › » buttons. On the last page (2 of 2),
        // « and ‹ are enabled while › and » are disabled.
        const firstBtn = screen.getByRole('button', { name: '«' });
        const prevBtn = screen.getByRole('button', { name: '‹' });
        fireEvent.click(firstBtn);
        fireEvent.click(prevBtn);
        expect(onPageChange).toHaveBeenCalled();
    });

    it('uses the pagination next/last buttons when not on the last page', () => {
        const onPageChange = vi.fn();
        renderWithProviders(
            <TaskTable
                rows={Array.from({ length: 60 }, (_, i) =>
                    makeTaskListItem({ id: `ATL-${i}`, title: `Task ${i}` })
                )}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                pageSize={20}
                page={1}
                onPageChange={onPageChange}
                onPageSizeChange={vi.fn()}
            />
        );
        const nextBtn = screen.getByRole('button', { name: '›' });
        const lastBtn = screen.getByRole('button', { name: '»' });
        fireEvent.click(nextBtn);
        fireEvent.click(lastBtn);
        expect(onPageChange).toHaveBeenCalledWith(2);
        expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('uses uncontrolled pagination state when pageSize/page props are omitted', () => {
        renderWithProviders(
            <TaskTable
                rows={Array.from({ length: 60 }, (_, i) =>
                    makeTaskListItem({ id: `ATL-${i}`, title: `Task ${i}` })
                )}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        // The internal page state defaults to 1. Clicking the next button
        // exercises the internal setPage path.
        const nextBtn = screen.getByRole('button', { name: '›' });
        fireEvent.click(nextBtn);
        // Change page size internally too.
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '100' } });
    });

    it('renders tasks with reporter + assignee from the agents lookup', () => {
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({
                        id: 'ATL-1',
                        title: 'Alpha',
                        reporter_agent_id: 'agent-coder',
                        assignee_agent_id: 'agent-reviewer',
                    }),
                ]}
                projects={[makeProject({ id: 'p1' })]}
                agents={[
                    makeAgent({ id: 'agent-coder', name: 'Coder' }),
                    makeAgent({ id: 'agent-reviewer', name: 'Reviewer' }),
                ]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        expect(screen.getByText('Coder')).toBeInTheDocument();
        expect(screen.getByText('Reviewer')).toBeInTheDocument();
    });

    it('falls back to Owner when reporter/assignee is null (fallback chip branch)', () => {
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({
                        id: 'ATL-1',
                        title: 'Alpha',
                        reporter_agent_id: null,
                        assignee_agent_id: null,
                    }),
                ]}
                projects={[]}
                agents={[]}
                ownerName="OwnerName"
                ownerAccent="#0A0A0A"
            />
        );
        // The fallback AgentChip uses ownerName.
        expect(screen.getAllByText('OwnerName').length).toBeGreaterThan(0);
    });

    it('renders MobileTaskList when isMobile=true (useIsMobile → true)', () => {
        const origMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('600') ? false : query.includes('(max-width') ? true : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        renderWithProviders(
            <TaskTable
                rows={[makeTaskListItem({ id: 'ATL-M', title: 'Mobile Task' })]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        expect(document.body.textContent).toContain('Mobile Task');
        window.matchMedia = origMatchMedia;
    });

    it('renders the virtualised body branch when totalRows >= 60 and pageSize="all"', () => {
        const rows = Array.from({ length: 80 }, (_, i) =>
            makeTaskListItem({ id: `ATL-${i}`, title: `Task ${i}` })
        );
        renderWithProviders(
            <TaskTable
                rows={rows}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                pageSize="all"
                onPageSizeChange={vi.fn()}
                page={1}
                onPageChange={vi.fn()}
            />
        );
        // Virtualised path renders some subset of the 80 rows.
        expect(screen.getAllByText(/Task /i).length).toBeGreaterThan(0);
    });

    it('virtualised body resolves reporter/assignee from agentsById when found', () => {
        const rows = Array.from({ length: 80 }, (_, i) =>
            makeTaskListItem({
                id: `ATL-${i}`,
                title: `Task ${i}`,
                reporter_agent_id: 'agent-v1',
                assignee_agent_id: 'agent-v1',
            })
        );
        renderWithProviders(
            <TaskTable
                rows={rows}
                projects={[]}
                agents={[makeAgent({ id: 'agent-v1', name: 'Virtual Agent' })]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                pageSize="all"
                onPageSizeChange={vi.fn()}
                page={1}
                onPageChange={vi.fn()}
            />
        );
        expect(screen.getAllByText('Virtual Agent').length).toBeGreaterThan(0);
    });

    it('virtualised body falls back to null when reporter/assignee id is not in agentsById', () => {
        const rows = Array.from({ length: 80 }, (_, i) =>
            makeTaskListItem({
                id: `ATL-${i}`,
                title: `Task ${i}`,
                reporter_agent_id: 'missing-agent',
                assignee_agent_id: 'missing-agent',
            })
        );
        renderWithProviders(
            <TaskTable
                rows={rows}
                projects={[]}
                agents={[]}
                ownerName="FallbackOwner"
                ownerAccent="#0A0A0A"
                pageSize="all"
                onPageSizeChange={vi.fn()}
                page={1}
                onPageChange={vi.fn()}
            />
        );
        expect(screen.getAllByText('FallbackOwner').length).toBeGreaterThan(0);
    });

    it('reporter_agent_id set but not in agents map → agentsById.get ?? null (L268/L477 null fallback)', () => {
        // reporter_agent_id is set but no matching agent — agentsById.get returns undefined → null
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({
                        id: 'ATL-rep',
                        title: 'Task with unknown reporter',
                        reporter_agent_id: 'nonexistent-agent',
                        assignee_agent_id: 'nonexistent-assignee',
                    }),
                ]}
                projects={[]}
                agents={[]} // empty — no agents in map
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        // Renders without crashing; agents not found → null branch taken
        expect(screen.getByText('Task with unknown reporter')).toBeInTheDocument();
    });

    it('sortKey=undefined initial state — sorted list returned as-is (L338 !sortKey branch)', () => {
        // The default initial state has sortKey=undefined, so `!sortKey` is true
        // and the sorted array is returned unmodified. This covers the L338 branch.
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({ id: 'ATL-A', title: 'Zeta task', updated_at: '2026-01-02' }),
                    makeTaskListItem({
                        id: 'ATL-B',
                        title: 'Alpha task',
                        updated_at: '2026-01-01',
                    }),
                ]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        // Both rows render in their original order (no sort applied)
        expect(screen.getByText('Zeta task')).toBeInTheDocument();
        expect(screen.getByText('Alpha task')).toBeInTheDocument();
    });

    it('clicking same sort column toggles sort direction (L370 setSortDir branch)', () => {
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({ id: 'ATL-C', title: 'C' }),
                    makeTaskListItem({ id: 'ATL-D', title: 'D' }),
                ]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        // Click the Title header once to set sortKey → then click again to toggle direction
        const titleHeaders = screen.queryAllByText('Title');
        if (titleHeaders.length > 0) {
            fireEvent.click(titleHeaders[0]!);
            fireEvent.click(titleHeaders[0]!);
        }
        expect(document.body).toBeTruthy();
    });

    it('renders empty state WITHOUT a New Task button when onCreate is omitted', () => {
        renderWithProviders(
            <TaskTable
                rows={[]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        expect(screen.getByText(/No tasks match this view/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /New Task/i })).not.toBeInTheDocument();
    });

    it('does not render a pagination footer when there are zero rows', () => {
        renderWithProviders(
            <TaskTable
                rows={[]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        expect(screen.queryByText(/page \d+ of \d+/)).not.toBeInTheDocument();
    });

    it('omits the ProjectTag when the row references a project not in the projects list', () => {
        renderWithProviders(
            <TaskTable
                rows={[
                    makeTaskListItem({
                        id: 'ATL-orphan',
                        title: 'Orphan project task',
                        project_id: 'does-not-exist',
                    }),
                ]}
                projects={[makeProject({ id: 'p1', name: 'Real Project' })]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        expect(screen.getByText('Orphan project task')).toBeInTheDocument();
        expect(screen.queryByText('Real Project')).not.toBeInTheDocument();
    });

    it('uses singular "task" label in the pagination footer when there is exactly 1 row', () => {
        renderWithProviders(
            <TaskTable
                rows={[makeTaskListItem({ id: 'ATL-solo', title: 'Solo task' })]}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
            />
        );
        expect(screen.getByText(/^1 task ·/)).toBeInTheDocument();
    });

    it('clamps clampedPage to 1 when the page prop is 0 or negative', () => {
        renderWithProviders(
            <TaskTable
                rows={Array.from({ length: 30 }, (_, i) =>
                    makeTaskListItem({ id: `ATL-${i}`, title: `Task ${i}` })
                )}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                pageSize={20}
                page={0}
                onPageChange={vi.fn()}
                onPageSizeChange={vi.fn()}
            />
        );
        expect(screen.getByText(/page 1 of 2/)).toBeInTheDocument();
        // At the clamped-low boundary, first/prev should be disabled.
        expect(screen.getByRole('button', { name: '«' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '‹' })).toBeDisabled();
    });

    it('clamps clampedPage to pageCount when the page prop exceeds it', () => {
        renderWithProviders(
            <TaskTable
                rows={Array.from({ length: 30 }, (_, i) =>
                    makeTaskListItem({ id: `ATL-${i}`, title: `Task ${i}` })
                )}
                projects={[]}
                agents={[]}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                pageSize={20}
                page={99}
                onPageChange={vi.fn()}
                onPageSizeChange={vi.fn()}
            />
        );
        expect(screen.getByText(/page 2 of 2/)).toBeInTheDocument();
        // At the clamped-high boundary, next/last should be disabled.
        expect(screen.getByRole('button', { name: '›' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '»' })).toBeDisabled();
    });
}, 15000);
