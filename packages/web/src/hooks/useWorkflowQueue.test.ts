import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useWorkflowQueue } from './useWorkflowQueue.js';

describe('useWorkflowQueue', () => {
    it('fetches the whole queue, or one project’s', async () => {
        const searches: string[] = [];
        server.use(
            http.get('http://localhost:3000/api/workflow-queue', ({ request }) => {
                searches.push(new URL(request.url).search);
                return HttpResponse.json({ workflows: [], unassigned: [] });
            }),
        );
        const all = renderHook(() => useWorkflowQueue(), { wrapper: makeWrapper() });
        await waitFor(() => expect(all.result.current.data).toEqual({ workflows: [], unassigned: [] }));
        const one = renderHook(() => useWorkflowQueue('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(one.result.current.isSuccess).toBe(true));
        expect(searches).toEqual(['', '?project_id=p1']);
    });
});
