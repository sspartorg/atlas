import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IssueType } from '@atlas/shared';

export function useActivity(
    issueType: IssueType,
    issueId: string,
    opts: { enabled?: boolean } = {}
) {
    const { enabled = true } = opts;
    return useQuery({
        queryKey: ['activity', issueType, issueId],
        queryFn: () => api.activity.get(issueType, issueId),
        enabled: enabled && Boolean(issueId),
    });
}
