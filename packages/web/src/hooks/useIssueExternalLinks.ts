import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IssueType } from '@atlas/shared';

// Detail pages read `external_links` from the composite `*-full` payload,
// not from this standalone query — so a create/delete has to invalidate
// BOTH or the new row won't show up until staleTime expires. Mirrors the
// useIssueLinks invalidation pattern.
const FULL_KEY: Record<IssueType, readonly [string, 'full']> = {
    epic: ['epics', 'full'],
    story: ['stories', 'full'],
    bug: ['bugs', 'full'],
    sub_task: ['sub-tasks', 'full'],
    sub_bug: ['sub-bugs', 'full'],
};

function invalidateExternalLinkCaches(
    qc: QueryClient,
    issueType: IssueType,
    issueId: string,
): void {
    void qc.invalidateQueries({ queryKey: ['issue-external-links', issueType, issueId] });
    const key = FULL_KEY[issueType];
    void qc.invalidateQueries({ queryKey: [key[0], issueId, key[1]] });
}

export function useIssueExternalLinks(
    issueType: IssueType,
    issueId: string,
    opts: { enabled?: boolean } = {},
) {
    const { enabled = true } = opts;
    return useQuery({
        queryKey: ['issue-external-links', issueType, issueId],
        queryFn: () => api.issueExternalLinks.list(issueType, issueId),
        enabled: enabled && Boolean(issueId),
    });
}

export function useCreateIssueExternalLink(issueType: IssueType, issueId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: { url: string; title?: string | null }) =>
            api.issueExternalLinks.create(issueType, issueId, {
                url: input.url,
                link_kind: 'pull_request',
                title: input.title ?? null,
            }),
        onSuccess: () => {
            invalidateExternalLinkCaches(qc, issueType, issueId);
        },
    });
}

export function useDeleteIssueExternalLink(issueType: IssueType, issueId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (linkId: number) => api.issueExternalLinks.delete(linkId),
        onSuccess: () => {
            invalidateExternalLinkCaches(qc, issueType, issueId);
        },
    });
}
