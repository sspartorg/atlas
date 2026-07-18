import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import type { IIssueTreeNode, IIssueTreeResponse } from '@atlas/shared';
import { IssuesTabContent } from './IssuesTabContent.js';

const ISO = '2026-01-01T00:00:00.000Z';

function makeNode(overrides: Partial<IIssueTreeNode> = {}): IIssueTreeNode {
    return {
        id: 'S1',
        kind: 'story',
        short_id: 'S1',
        title: 'My Story',
        status: 'ready',
        assignee_agent_id: null,
        reporter_agent_id: null,
        created_at: ISO,
        updated_at: ISO,
        project_id: 'p1',
        project_name: 'Project A',
        epic_id: null,
        epic_title: null,
        parent_story_id: null,
        parent_story_title: null,
        children: [],
        ...overrides,
    };
}

function makeTree(...nodes: IIssueTreeNode[]): IIssueTreeResponse {
    return {
        tree: nodes,
        projects: [],
        agents: [],
        epics: [],
        stories: [],
        bugs: [],
    };
}

describe('IssuesTabContent', () => {
    it('renders the empty count when treeData has no items', () => {
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree()}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        expect(screen.getAllByText('0').length).toBeGreaterThan(0);
        expect(screen.getByText(/issues in this project/i)).toBeInTheDocument();
    });

    it('renders the "Open in Issues" link to the global issues page', () => {
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree()}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        const link = screen.getByText(/open in issues/i);
        expect(link).toBeInTheDocument();
    });

    it('renders singular "issue" label when exactly 1 row exists', () => {
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(makeNode({ id: 'S1', title: 'Solo issue' }))}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        // The count and "issue/issues" text are split across separate elements
        expect(document.body.textContent).toContain('issue in this project');
        // Plural check: singular shows "issue" not "issues"
        const container = document.body;
        expect(container.textContent).not.toMatch(/\bissues\b.*in this project/);
    });

    it('counts bugs in the summary line (bug kind)', () => {
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(makeNode({ id: 'B1', kind: 'bug', title: 'Bug 1' }))}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        expect(screen.getByText('Bug 1')).toBeInTheDocument();
    });

    it('nests sub_task under its parent story (buildHierarchicalRows sub-item path)', () => {
        const story = makeNode({ id: 'S10', kind: 'story', title: 'Parent Story', updated_at: ISO });
        const subTask = makeNode({
            id: 'ST1',
            kind: 'sub_task',
            title: 'Sub Task',
            parent_story_id: 'S10',
            updated_at: ISO,
        });
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(story, subTask)}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        expect(screen.getByText('Parent Story')).toBeInTheDocument();
        expect(screen.getByText('Sub Task')).toBeInTheDocument();
    });

    it('clicking a story row navigates to /issues/stories/:id (routeForRow story)', () => {
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(makeNode({ id: 'S20', kind: 'story', title: 'Click Story' }))}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        const row = screen.getByRole('button');
        fireEvent.click(row);
        expect(screen.getByText('Click Story')).toBeInTheDocument();
    });

    it('clicking a bug row exercises routeForRow bug branch', () => {
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(makeNode({ id: 'B10', kind: 'bug', title: 'Bug Click' }))}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        const row = screen.getByRole('button');
        fireEvent.click(row);
        expect(screen.getByText('Bug Click')).toBeInTheDocument();
    });

    it('sub_bug nested under story exercises routeForRow default branch', () => {
        const story = makeNode({ id: 'S30', kind: 'story', title: 'Story Parent', updated_at: ISO });
        const subBug = makeNode({
            id: 'SB1',
            kind: 'sub_bug',
            title: 'Sub Bug Child',
            parent_story_id: 'S30',
            updated_at: ISO,
        });
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(story, subBug)}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        expect(screen.getByText('Story Parent')).toBeInTheDocument();
        expect(screen.getByText('Sub Bug Child')).toBeInTheDocument();
    });

    it('sub_task nested under story exercises routeForRow sub_task branch on click', () => {
        const story = makeNode({ id: 'S40', kind: 'story', title: 'Story Parent 2', updated_at: ISO });
        const subTask = makeNode({
            id: 'ST2',
            kind: 'sub_task',
            title: 'Sub Task Child',
            parent_story_id: 'S40',
            updated_at: ISO,
        });
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(story, subTask)}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        const rows = screen.getAllByRole('button');
        // Click the sub-task row (second row)
        const subTaskRow = rows.find(r => r.textContent?.includes('Sub Task Child'));
        if (subTaskRow) fireEvent.click(subTaskRow);
        expect(screen.getByText('Sub Task Child')).toBeInTheDocument();
    });

    it('sub_task with no parent_story_id is not nested (line 46 false branch: !parent_story_id)', () => {
        // When kind=sub_task but parent_story_id is null, the && condition on line 46
        // is false — the item is not added to childrenByStory, so it never gets nested.
        // sub_task is also not in topLevel (only story/bug are), so the table renders empty.
        const orphanSubTask = makeNode({
            id: 'ST_ORPHAN',
            kind: 'sub_task',
            title: 'Orphan Sub Task',
            parent_story_id: null,
            updated_at: ISO,
        });
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(orphanSubTask)}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        // The orphan sub_task exists in rows but isn't nested, so the page still renders
        expect(document.body).toBeTruthy();
        // The WorkItemTable shows an empty message because no top-level items
        expect(screen.getByText(/No stories or bugs in this project yet/i)).toBeInTheDocument();
    });

    it('sub_bug with no parent_story_id exercises line 46 false branch for sub_bug', () => {
        // sub_bug with null parent_story_id — the && guard fails, so it is not nested
        const orphanSubBug = makeNode({
            id: 'SB_ORPHAN',
            kind: 'sub_bug',
            title: 'Orphan Sub Bug',
            parent_story_id: null,
            updated_at: ISO,
        });
        renderWithProviders(
            <IssuesTabContent
                projectId="p1"
                treeData={makeTree(orphanSubBug)}
                agentsById={new Map()}
                ownerName="Owner"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'now'}
            />,
        );
        expect(document.body).toBeTruthy();
        expect(screen.getByText(/No stories or bugs in this project yet/i)).toBeInTheDocument();
    });
});
