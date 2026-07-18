import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IssueType } from '@atlas/shared';

// Detail pages read `related_links` from the composite `*-full` payload,
// not from the standalone `useIssueLinks` query — so a link create/delete
// has to invalidate BOTH or the just-added link won't show up until the
// next hard reload (or until staleTime expires).
const FULL_KEY: Record<IssueType, readonly [string, 'full']> = {
    epic: ['epics', 'full'],
    story: ['stories', 'full'],
    bug: ['bugs', 'full'],
    sub_task: ['sub-tasks', 'full'],
    sub_bug: ['sub-bugs', 'full'],
};

function invalidateLinkCaches(
    qc: QueryClient,
    fromType: IssueType,
    fromId: string,
    toType?: IssueType,
    toId?: string,
): void {
    // Standalone link list (used by direct useIssueLinks consumers).
    void qc.invalidateQueries({ queryKey: ['issue-links', fromType, fromId] });
    if (toType && toId) {
        void qc.invalidateQueries({ queryKey: ['issue-links', toType, toId] });
    }

    // Composite payload that detail pages actually render from. The cache
    // key shape is `[<plural>, id, 'full']`, so the invalidation has to
    // match that exact 3-element key — a 2-element `['stories', id]` would
    // miss it.
    const fromKey = FULL_KEY[fromType];
    void qc.invalidateQueries({ queryKey: [fromKey[0], fromId, fromKey[1]] });
    if (toType && toId) {
        const toKey = FULL_KEY[toType];
        void qc.invalidateQueries({ queryKey: [toKey[0], toId, toKey[1]] });
    }
}

export function useIssueLinks(
    issueType: IssueType,
    issueId: string,
    opts: { enabled?: boolean } = {}
) {
    const { enabled = true } = opts;
    return useQuery({
        queryKey: ['issue-links', issueType, issueId],
        queryFn: () => api.issueLinks.list(issueType, issueId),
        enabled: enabled && Boolean(issueId),
    });
}

export function useCreateIssueLink(issueType: IssueType, issueId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            toType,
            toId,
            relationType = 'relates_to',
        }: {
            toType: IssueType;
            toId: string;
            relationType?: 'relates_to' | 'depends_on' | 'tested_by';
        }) => api.issueLinks.create(issueType, issueId, toType, toId, relationType),
        onSuccess: (_data, variables) => {
            invalidateLinkCaches(qc, issueType, issueId, variables.toType, variables.toId);
        },
    });
}

export function useDeleteIssueLink(issueType: IssueType, issueId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (linkId: number) => api.issueLinks.delete(linkId),
        onSuccess: () => {
            // We don't know the to-side here (only linkId is in scope), so
            // only the from-side full cache is invalidated explicitly. The
            // to-side will refresh next time its detail page is visited via
            // refetchOnMount:'always' on the *Full hooks.
            invalidateLinkCaches(qc, issueType, issueId);
        },
    });
}
