import { useQuery } from '@tanstack/react-query';
import type { IIssueTreeNode, IIssueTreeResponse, IssueTreeKind } from '@atlas/shared';
import { api } from '../api/api.js';

// Type aliases for the row-list view of the issue tree.
export type IssueListKind = IssueTreeKind;
export type IIssueListRow = IIssueTreeNode;

// Issue ids are Jira-style human keys (e.g. CER-7); the displayed short id is
// the id itself. Stable indirection so the short-id derivation can change
// without rewriting call-sites.
export function makeShortId(_kind: IssueListKind, id: string): string {
    return id;
}

// Replaces the previous 6-call Promise.all fan-out (projects, epics,
// stories, bugs, sub-tasks, sub-bugs). One HTTP round-trip, tree assembled
// server-side via SQL IN-list reads.
export function useIssues(opts?: { projectId?: string | undefined; includeArchived?: boolean | undefined }) {
    const projectId = opts?.projectId ?? null;
    const includeArchived = opts?.includeArchived ?? false;
    return useQuery<IIssueTreeResponse>({
        queryKey: ['issues', 'tree', { projectId, includeArchived }],
        queryFn: () =>
            api.issues.tree({
                projectId: projectId ?? undefined,
                includeArchived: includeArchived || undefined,
            }),
    });
}

// Walks a tree response into a flat list (parents first, then children in
// place under each parent). Useful for the Issues table view where the
// existing render pipeline expects a single ordered array of rows.
export function flattenIssueTree(tree: IIssueTreeNode[]): IIssueTreeNode[] {
    const out: IIssueTreeNode[] = [];
    for (const node of tree) {
        out.push(node);
        for (const child of node.children) {
            out.push(child);
        }
    }
    return out;
}
