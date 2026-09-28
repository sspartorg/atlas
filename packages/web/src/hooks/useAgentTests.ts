import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/api.js';
import type { AgentTestExpectations, AgentTestItemTemplate, FleetWindowDays } from '../api/types.js';

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

/**
 * What this is about to cost, shown before the button.
 *
 * Keyed on `nRuns` too: sampling multiplies the bill, and ADR 0023's "spend is
 * shown before it happens" is why this tab exists at all.
 */
export function useAgentCostEstimate(agentId: string, nRuns = 1) {
    return useQuery({
        queryKey: ['agent-cost-estimate', agentId, nRuns],
        queryFn: () => api.agentTests.costEstimate(agentId, nRuns),
        enabled: Boolean(agentId),
    });
}

/**
 * A test's history, folded into the batches the Owner pressed.
 *
 * One sample is a coin flip — the verdict worth reading is the batch's.
 */
export function useAgentTestBatches(testId: string, enabled = true) {
    return useQuery({
        queryKey: ['agent-test-batches', testId],
        queryFn: () => api.agentTests.batches(testId),
        enabled: Boolean(testId) && enabled,
        // Dispatches are asynchronous, so an open test polls until every
        // sample of every batch has landed.
        refetchInterval: (query) =>
            (query.state.data ?? []).some((b) => b.running > 0) ? 5000 : false,
    });
}

export function useCreateAgentTest(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: {
            project_id?: string | null;
            repo_id?: string | null;
            name: string;
            item_template: AgentTestItemTemplate;
            expectations?: AgentTestExpectations;
        }) => api.agentTests.create(agentId, body),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['agent-tests', agentId] }),
    });
}

export function useUpdateAgentTest(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ testId, body }: { testId: string; body: Parameters<typeof api.agentTests.update>[1] }) =>
            api.agentTests.update(testId, body),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['agent-tests', agentId] });
            // An edited assertion can flip the verdict the header shows.
            void qc.invalidateQueries({ queryKey: ['agent-qualification'] });
        },
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
        mutationFn: ({
            testId,
            n_runs,
            label,
            project_id,
            repo_id,
            sandbox,
        }: {
            testId: string;
            n_runs?: number;
            label?: string;
            /** Migration 021 — a fixture binds to a project when it runs. */
            project_id?: string;
            repo_id?: string | null;
            /** Run in the Tests sandbox project, whatever the fixture is pinned to. */
            sandbox?: boolean;
        }) =>
            api.agentTests.run(testId, {
                ...(n_runs !== undefined ? { n_runs } : {}),
                ...(label !== undefined ? { label } : {}),
                ...(project_id !== undefined ? { project_id } : {}),
                ...(repo_id !== undefined ? { repo_id } : {}),
                ...(sandbox !== undefined ? { sandbox } : {}),
            }),
        onSuccess: (_r, { testId }) => {
            void qc.invalidateQueries({ queryKey: ['agent-test-batches', testId] });
            void qc.invalidateQueries({ queryKey: ['agent-qualification'] });
        },
    });
}

/** ATL-140 — what this agent's own runs already prove. */
export function useAgentPerformance(agentId: string) {
    return useQuery({
        queryKey: ['agent-performance', agentId],
        queryFn: () => api.agentTests.performance(agentId),
        enabled: Boolean(agentId),
    });
}

/** The fleet page: every agent side by side, plus what the fleet delivered. */
export function useFleetPerformance(days: FleetWindowDays) {
    return useQuery({
        queryKey: ['fleet-performance', days],
        queryFn: () => api.agentTests.fleetPerformance(days),
    });
}

/** ADR 0023 phase 4 — the tests this agent ships with, as templates. */
export function useStarterTests(agentId: string) {
    return useQuery({
        queryKey: ['agent-starter-tests', agentId],
        queryFn: () => api.agentTests.starter(agentId),
        enabled: Boolean(agentId),
    });
}

/**
 * The suite verdict for one agent, or for every installed agent.
 *
 * Polled while anything is running, for the same reason the batch hook is: a
 * suite run is asynchronous and the header has to stop saying "running" by
 * itself.
 */
export function useAgentQualification(agentId?: string) {
    return useQuery({
        queryKey: ['agent-qualification', agentId ?? 'all'],
        queryFn: () => api.agentTests.qualification(agentId),
        refetchInterval: (query) =>
            (query.state.data ?? []).some((q) => q.verdict === 'running') ? 5000 : false,
    });
}

/** Run every fixture this agent has, under one label. */
export function useRunAgentSuite(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: { n_runs?: number; project_id?: string; repo_id?: string | null; sandbox?: boolean }) =>
            api.agentTests.runSuite(agentId, body),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['agent-tests', agentId] });
            // Both keys: this agent's header and the fleet's badges.
            void qc.invalidateQueries({ queryKey: ['agent-qualification'] });
            void qc.invalidateQueries({ queryKey: ['agent-test-batches'] });
        },
    });
}
