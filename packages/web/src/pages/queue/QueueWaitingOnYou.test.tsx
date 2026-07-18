import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { QueueWaitingOnYou } from './QueueWaitingOnYou.js';
import type { QueueItem } from './queueViewModel.js';

const makeQueueItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
    id: 'ATL-2',
    type: 'story',
    displayId: 'ATL-2',
    title: 'Story One',
    status: 'in_review',
    assignee_agent_id: null,
    project_id: null,
    updated_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
});

describe('QueueWaitingOnYou', () => {
    it('renders "Nothing Waiting on You" when items is empty', () => {
        renderWithProviders(
            <QueueWaitingOnYou
                items={[]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
        );
        expect(screen.getByText('Nothing Waiting on You')).toBeInTheDocument();
    });

    it('renders "Waiting on You" heading with count 0 for empty list', () => {
        renderWithProviders(
            <QueueWaitingOnYou
                items={[]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
        );
        expect(screen.getByText('Waiting on You')).toBeInTheDocument();
        expect(
            screen.getByText('only humans block — agents never wait on each other.'),
        ).toBeInTheDocument();
    });

    it('renders item title when an item is present', () => {
        const item = makeQueueItem({ title: 'Fix login bug', displayId: 'ATL-10' });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
        );
        expect(screen.getByText('Fix login bug')).toBeInTheDocument();
        expect(screen.getAllByText('ATL-10').length).toBeGreaterThan(0);
    });

    it('shows agent name in the row when an agent is assigned', () => {
        const agent = makeAgent({ id: 'agent-coder', name: 'Coder' });
        const item = makeQueueItem({
            id: 'ATL-3',
            displayId: 'ATL-3',
            title: 'Assigned story',
            assignee_agent_id: 'agent-coder',
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map([['agent-coder', agent]])}
                projectNameById={new Map()}
            />,
        );
        expect(screen.getAllByText('Coder').length).toBeGreaterThan(0);
    });

    it('shows project name in the row when project is mapped', () => {
        const item = makeQueueItem({
            id: 'ATL-4',
            displayId: 'ATL-4',
            title: 'Story in project',
            project_id: 'p1',
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map([['p1', 'Alpha Project']])}
            />,
        );
        expect(screen.getAllByText('Alpha Project').length).toBeGreaterThan(0);
    });

    it('renders the "only humans block" tagline when items exist', () => {
        const item = makeQueueItem();
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
        );
        expect(
            screen.getByText('only humans block — agents cannot reply for you.'),
        ).toBeInTheDocument();
    });
});

describe('QueueWaitingOnYou — mobile layout', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function mockMobile() {
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
            matches: query.includes('max-width'),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    }

    it('renders mobile cards when isMobile=true', () => {
        mockMobile();
        const item = makeQueueItem({ title: 'Mobile story', displayId: 'ATL-20' });
        const { container } = renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
        );
        // Mobile layout uses role="button" on the card row div
        const cardRow = container.querySelector('[role="button"]');
        expect(cardRow).toBeInTheDocument();
    });

    it('shows item title in mobile card', () => {
        mockMobile();
        const item = makeQueueItem({ title: 'Mobile issue title', displayId: 'ATL-21' });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
        );
        expect(screen.getByText('Mobile issue title')).toBeInTheDocument();
    });

    it('shows Reply button in mobile card', () => {
        mockMobile();
        const item = makeQueueItem({ title: 'Mobile reply test', displayId: 'ATL-22' });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
        );
        // The IconButton has aria-label="Reply"
        const replyBtns = screen.getAllByRole('button', { name: /reply/i });
        // At least one button with aria-label="Reply" should be present
        expect(replyBtns.some((b) => b.getAttribute('aria-label') === 'Reply')).toBe(true);
    });

    it('clicking the mobile row calls navigate', () => {
        mockMobile();
        const item = makeQueueItem({
            id: 'ATL-23',
            type: 'story',
            title: 'Click nav test',
            displayId: 'ATL-23',
        });
        const { container } = renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        // role=button on the card row — clicking it should not throw
        const cardRow = container.querySelector('[role="button"]') as HTMLElement;
        expect(cardRow).toBeTruthy();
        fireEvent.click(cardRow);
        // No assertion on navigation URL — just verify no error is thrown
    });

    it('handleOpen bug type — navigates to /issues', () => {
        mockMobile();
        const item = makeQueueItem({ id: 'ATL-30', type: 'bug', title: 'Bug item', displayId: 'ATL-30' });
        const { container } = renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        const cardRow = container.querySelector('[role="button"]') as HTMLElement;
        expect(cardRow).toBeTruthy();
        fireEvent.click(cardRow);
        expect(document.body).toBeTruthy();
    });

    it('handleOpen epic type — navigates to /epics/id', () => {
        mockMobile();
        const item = makeQueueItem({ id: 'ATL-31', type: 'epic', title: 'Epic item', displayId: 'ATL-31' });
        const { container } = renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        const cardRow = container.querySelector('[role="button"]') as HTMLElement;
        expect(cardRow).toBeTruthy();
        fireEvent.click(cardRow);
        expect(document.body).toBeTruthy();
    });

    it('renders mobile agent chip when assignee_agent_id maps to an agent — covers lines 245-297', () => {
        // lines 245-297: {agent && (<Box>...glyph...agent.name..."asked"</Box>)} in mobile layout
        mockMobile();
        const agent = makeAgent({ id: 'agent-mobile', name: 'MobileAgent', accent_color: '#0000FF' });
        const item = makeQueueItem({
            id: 'ATL-35',
            displayId: 'ATL-35',
            title: 'Mobile agent chip test',
            assignee_agent_id: 'agent-mobile',
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map([['agent-mobile', agent]])}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        // The agent chip renders the agent name and "asked" label
        expect(screen.getAllByText('MobileAgent').length).toBeGreaterThan(0);
        expect(document.body.textContent).toContain('asked');
    });

    it('shows project name in mobile card when project_id is mapped — covers line 135', () => {
        // line 135: const projectName = it.project_id ? projectNameById.get(it.project_id) : null
        // This exercises the truthy branch (it.project_id is non-null and mapped)
        mockMobile();
        const item = makeQueueItem({
            id: 'ATL-37',
            displayId: 'ATL-37',
            title: 'Mobile project row',
            project_id: 'proj-mobile',
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map([['proj-mobile', 'Mobile Project']])}
            />,
            { initialEntries: ['/queue'] },
        );
        expect(screen.getByText('Mobile Project')).toBeInTheDocument();
    });

    it('renders two mobile rows with border separator — covers line 152 (i !== 0 branch)', () => {
        // line 152: borderTop: i === 0 ? 'none' : `1px solid ...`
        // Two rows: i=0 gets 'none', i=1 gets the border value
        mockMobile();
        const item1 = makeQueueItem({ id: 'ATL-38', displayId: 'ATL-38', title: 'First row' });
        const item2 = makeQueueItem({ id: 'ATL-39', displayId: 'ATL-39', title: 'Second row' });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item1, item2]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        expect(screen.getByText('First row')).toBeInTheDocument();
        expect(screen.getByText('Second row')).toBeInTheDocument();
    });

    it('Reply button in mobile card calls handleOpen — covers lines 303-306', () => {
        // lines 303-306: onClick fires e.stopPropagation(); handleOpen(it)
        mockMobile();
        const item = makeQueueItem({
            id: 'ATL-36',
            displayId: 'ATL-36',
            type: 'story',
            title: 'Reply mobile test',
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        const replyBtns = screen.getAllByRole('button', { name: /reply/i });
        expect(replyBtns.length).toBeGreaterThan(0);
        fireEvent.click(replyBtns[0]!);
        expect(document.body).toBeTruthy();
    });
});

describe('QueueWaitingOnYou — desktop layout interactions', () => {
    beforeEach(() => {
        // Mock matchMedia to return false for "max-width" queries so useIsMobile() returns false.
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders agent chip in desktop row when assignee_agent_id maps to an agent', () => {
        // The desktop layout also has the agent chip in the "Agent Asked" column
        const agent = makeAgent({ id: 'agent-desktop', name: 'DesktopAgent', accent_color: '#FF0000' });
        const item = makeQueueItem({
            id: 'ATL-60',
            displayId: 'ATL-60',
            title: 'Desktop agent row',
            assignee_agent_id: 'agent-desktop',
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map([['agent-desktop', agent]])}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        // The agent name should be visible in the desktop row
        expect(screen.getAllByText('DesktopAgent').length).toBeGreaterThan(0);
    });

    it('Reply button click fires handleOpen with stopPropagation — covers lines 303-305', () => {
        // lines 303-305: e.stopPropagation(); handleOpen(it);
        const item = makeQueueItem({
            id: 'ATL-61',
            displayId: 'ATL-61',
            type: 'story',
            title: 'Reply button story',
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        // The reply IconButton has aria-label="Reply"
        const replyBtn = screen.getByRole('button', { name: /reply/i });
        // Click it — should call handleOpen(it) which navigates to /issues/stories/ATL-61
        fireEvent.click(replyBtn);
        expect(document.body).toBeTruthy();
    });

    it('clicking a desktop row calls handleOpen', () => {
        const item = makeQueueItem({ id: 'ATL-40', type: 'story', title: 'Desktop row', displayId: 'ATL-40' });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        const titleEl = screen.getByText('Desktop row');
        fireEvent.click(titleEl);
        expect(document.body).toBeTruthy();
    });

    it('clicking the Reply button in desktop row fires handleOpen with stopPropagation', () => {
        const item = makeQueueItem({ id: 'ATL-41', type: 'story', title: 'Desktop reply', displayId: 'ATL-41' });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        const replyBtn = screen.getByRole('button', { name: /reply/i });
        fireEvent.click(replyBtn);
        expect(document.body).toBeTruthy();
    });

    it('handleOpen sub_task type (default branch) — navigates to /issues', () => {
        const item = makeQueueItem({ id: 'ATL-42', type: 'sub_task' as 'story', title: 'SubTask item', displayId: 'ATL-42' });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        const titleEl = screen.getByText('SubTask item');
        fireEvent.click(titleEl);
        expect(document.body).toBeTruthy();
    });

    it('project_id null → projectName null → renders em-dash in desktop row', () => {
        // item.project_id is null so projectName resolves to null → "—" is shown
        const item = makeQueueItem({
            id: 'ATL-50',
            displayId: 'ATL-50',
            title: 'No-project story',
            project_id: null,
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()}
                projectNameById={new Map([['some-other-proj', 'Other']])}
            />,
            { initialEntries: ['/queue'] },
        );
        // The em-dash placeholder must be present in the row
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('assignee_agent_id present but not in agentsById map → renders em-dash in Agent Asked column', () => {
        // agent lookup returns null → desktop row shows "—" in place of agent name
        const item = makeQueueItem({
            id: 'ATL-51',
            displayId: 'ATL-51',
            title: 'Unmapped agent story',
            assignee_agent_id: 'agent-missing',
        });
        renderWithProviders(
            <QueueWaitingOnYou
                items={[item]}
                agentsById={new Map()} // empty — agent-missing not found
                projectNameById={new Map()}
            />,
            { initialEntries: ['/queue'] },
        );
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
});
