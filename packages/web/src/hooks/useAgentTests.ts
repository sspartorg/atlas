import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/api.js';
import type { AgentTestExpectations, AgentTestItemTemplate } from '../api/types.js';

// Agent tests (ADR 0023). A customer installing an agent from the marketplace
// does it on trust, and one they wrote themselves cannot be qualified at all —
// these are what make "does this agent work?" answerable from the UI.

export function useAgentTests(agentId: string) {
    return useQuery({
        queryKey: ['agent-tests', agentId],
        queryFn: () => api.agentTests.list(agentId),
        enabled: Boolean(agentId),
    });
}

/** What one run of this agent is likely to cost, shown before the button. */
export function useAgentCostEstimate(agentId: string) {
    return useQuery({
        queryKey: ['agent-cost-estimate', agentId],
        queryFn: () => api.agentTests.costEstimate(agentId),
        enabled: Boolean(agentId),
    });
}

export function useAgentTestRuns(testId: string, enabled = true) {
    return useQuery({
        queryKey: ['agent-test-runs', testId],
        queryFn: () => api.agentTests.runs(testId),
        enabled: Boolean(testId) && enabled,
        // A dispatch is asynchronous and judged when read, so an open test
        // polls until nothing is still running.
        refetchInterval: (query) =>
            (query.state.data ?? []).some((r) => r.verdict === 'running') ? 5000 : false,
    });
}

export function useCreateAgentTest(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: {
            project_id: string;
            repo_id?: string | null;
            name: string;
            item_template: AgentTestItemTemplate;
            expectations?: AgentTestExpectations;
        }) => api.agentTests.create(agentId, body),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['agent-tests', agentId] }),
    });
}

export function useDeleteAgentTest(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (testId: string) => api.agentTests.remove(testId),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['agent-tests', agentId] }),
    });
}

export function useRunAgentTest() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (testId: string) => api.agentTests.run(testId),
        onSuccess: (_r, testId) => void qc.invalidateQueries({ queryKey: ['agent-test-runs', testId] }),
    });
}
