import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IssueType } from '@atlas/shared';

// P11 — TanStack mutation around DELETE /api/comments/:id. Mirrors the
// cache-invalidation contract used by `useCreateComment` /
// `useUpdateComment` so the activity feed + composite `*-full` queries
// refresh once the soft-delete settles.

const FULL_KEY: Record<IssueType, readonly [string, 'full']> = {
    epic: ['epics', 'full'],
    story: ['stories', 'full'],
    bug: ['bugs', 'full'],
    sub_task: ['sub-tasks', 'full'],
    sub_bug: ['sub-bugs', 'full'],
};

function invalidateCommentCaches(qc: QueryClient, issueType: IssueType, issueId: string): void {
    void qc.invalidateQueries({ queryKey: ['comments', issueType, issueId] });
    void qc.invalidateQueries({ queryKey: ['activity', issueType, issueId] });
    const fullKey = FULL_KEY[issueType];
    void qc.invalidateQueries({ queryKey: [fullKey[0], issueId, fullKey[1]] });
}

export function useDeleteComment(issueType: IssueType, issueId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id }: { id: number }) => api.comments.delete(id),
        onSuccess: () => {
            invalidateCommentCaches(qc, issueType, issueId);
        },
    });
}
