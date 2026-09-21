import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import type { CreateWorkflowInput, IWorkflow } from '@atlas/shared';
import { server } from '../test-setup.js';
import { makeRunDetail, makeWorkflow } from '../test-utils/workflowFixtures.js';
import { useCreateWorkflow, useStopWorkflowRun, useWorkflows, useWorkflowRun } from './useWorkflows.js';

const BASE = 'http://localhost:3000/api';

function harness() {
    const qc = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
        },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: qc }, children);
    return { qc, wrapper };
}

describe('useCreateWorkflow', () => {
    it('posts the input and makes the new workflow visible without a reload', async () => {
        // Every workflow query sits under the `workflows` prefix precisely so
        // one invalidation refreshes them all. If that invalidation is lost,
        // the Owner creates a workflow and lands back on a list that does not
        // contain it — which reads as "the save failed".
        const rows: IWorkflow[] = [];
        let sent: unknown = null;
        server.use(
            http.get(`${BASE}/workflows`, () => HttpResponse.json(rows)),
            http.post(`${BASE}/workflows`, async ({ request }) => {
                sent = await request.json();
                const created = makeWorkflow({ id: 'wf-new', name: 'Release' });
                rows.push(created);
                return HttpResponse.json(created, { status: 201 });
            }),
        );
        const { wrapper } = harness();
        const { result } = renderHook(
            () => ({ list: useWorkflows(), create: useCreateWorkflow() }),
            { wrapper },
        );
        await waitFor(() => expect(result.current.list.data).toEqual([]));

        const input = {
            name: 'Release',
            project_id: 'p1',
            input_kind: 'item',
            trigger: 'manual',
            graph: { nodes: [], edges: [] },
        } as unknown as CreateWorkflowInput;
        await result.current.create.mutateAsync(input);

        expect(sent).toMatchObject({ name: 'Release', project_id: 'p1' });
        await waitFor(() =>
            expect(result.current.list.data?.map((w) => w.id)).toEqual(['wf-new']),
        );
    });
});

describe('useStopWorkflowRun', () => {
    it('writes the stopped run straight into the detail cache', async () => {
        // Stop is the Owner's kill switch. Seeding the response into
        // ['workflow-run', id] is what flips the detail page out of "running"
        // immediately; without it the page keeps claiming the run is live
        // until the next poll, and the Owner clicks Stop again.
        const running = makeRunDetail({ id: 'run-1', status: 'running' });
        const stopped = { ...running, status: 'stopped' as const };
        server.use(
            http.get(`${BASE}/workflow-runs/run-1`, () => HttpResponse.json(running)),
            http.post(`${BASE}/workflow-runs/run-1/stop`, () => HttpResponse.json(stopped)),
        );
        const { wrapper } = harness();
        const { result } = renderHook(
            () => ({ run: useWorkflowRun('run-1'), stop: useStopWorkflowRun() }),
            { wrapper },
        );
        await waitFor(() => expect(result.current.run.data?.status).toBe('running'));

        await result.current.stop.mutateAsync('run-1');
        await waitFor(() => expect(result.current.run.data?.status).toBe('stopped'));
    });
});
