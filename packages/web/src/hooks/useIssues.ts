import { useQuery } from '@tanstack/react-query';
import type { IIssueTreeNode, IIssueTreeResponse, IssueType } from '@atlas/shared';
import { api } from '../api/api.js';

// Type aliases for the row-list view of the issue tree.
export type IssueListKind = IssueType;

// Issue ids are Jira-style human keys (e.g. CER-7); the displayed short id is
// the id itself. Stable indirection so the short-id derivation can change
// without rewriting call-sites.
export function makeShortId(_kind: IssueListKind, id: string): string {
    return id;
}

// One HTTP round-trip: Tasks with their Sub-tasks nested, plus the project
// and agent dictionaries, assembled server-side.
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
// place under each parent).
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
