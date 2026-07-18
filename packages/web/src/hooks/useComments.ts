import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IssueType } from '@atlas/shared';

// Detail pages render comments + activity from the composite `*-full`
// payload, not from the standalone `useComments` / `useActivity` queries.
// A comment create or update therefore has to invalidate the matching
// `[<plural>, id, 'full']` cache as well, or the new/edited row won't
// appear until the next hard reload.
const FULL_KEY: Record<IssueType, readonly [string, 'full']> = {
    epic: ['epics', 'full'],
    story: ['stories', 'full'],
    bug: ['bugs', 'full'],
    sub_task: ['sub-tasks', 'full'],
    sub_bug: ['sub-bugs', 'full'],
};

function invalidateCommentCaches(qc: QueryClient, issueType: IssueType, issueId: string): void {
    void qc.invalidateQueries({ queryKey: ['comments', issueType, issueId] });
    // Unified activity feed — drives the standalone ActivityCard render path
    // when the parent didn't pre-supply `activity`.
    void qc.invalidateQueries({ queryKey: ['activity', issueType, issueId] });
    // Composite payload that detail pages actually render from.
    const fullKey = FULL_KEY[issueType];
    void qc.invalidateQueries({ queryKey: [fullKey[0], issueId, fullKey[1]] });
}

export function useComments(issueType: IssueType, issueId: string) {
    return useQuery({
        queryKey: ['comments', issueType, issueId],
        queryFn: () => api.comments.list(issueType, issueId),
        enabled: Boolean(issueId),
    });
}

export function useCreateComment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            author: 'owner' | 'agent';
            issue_type: IssueType;
            issue_id: string;
            body: string;
            agent_id?: string;
        }) => api.comments.create(data),
        onSuccess: (_c, vars) => {
            invalidateCommentCaches(qc, vars.issue_type, vars.issue_id);
        },
    });
}

export function useUpdateComment(issueType: IssueType, issueId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, body }: { id: number; body: string }) =>
            api.comments.update(id, body),
        onSuccess: () => {
            invalidateCommentCaches(qc, issueType, issueId);
        },
    });
}
