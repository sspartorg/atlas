import { test, expect } from '@playwright/test';

// Item-level run lock — verifies the DB unique partial index
// `agent_runs_one_live_per_item` (status IN queued,in_progress) is enforced
// at the API layer via `findLiveRunOnItem`.
//
// Seed guarantees:
//   - agent-po-writer installed (active, requires_item=true)
//   - ETM-1 (epic, project e2e-terminal-project, status=in_progress)
//
// All calls are Node-side (request fixture, no browser navigation).

const API = 'http://127.0.0.1:6001';

test.describe('Item-lock conflict', () => {
    // Track run IDs created so afterEach can cancel them, keeping the
    // shared e2e DB tidy for subsequent specs.
    const createdRunIds: string[] = [];

    test.afterEach(async ({ request }) => {
        for (const id of createdRunIds.splice(0)) {
            // POST /api/run/:id/stop flips status to cancelled.
            // Ignore errors — the run may already be terminal.
            await request.post(`${API}/api/run/${id}/stop`).catch(() => undefined);
        }
    });

    test('second dispatch on the same item returns 409 while a run is live', async ({ request }) => {
        // First dispatch — must succeed (202).
        const first = await request.post(`${API}/api/run`, {
            data: {
                agent_id: 'agent-po-writer',
                issue_type: 'epic',
                issue_id: 'ETM-1',
            },
        });
        expect(first.status()).toBe(202);
        const firstBody = await first.json() as { runId: string };
        expect(typeof firstBody.runId).toBe('string');
        createdRunIds.push(firstBody.runId);

        // Second dispatch on the same item — findLiveRunOnItem blocks it with 409.
        const second = await request.post(`${API}/api/run`, {
            data: {
                agent_id: 'agent-po-writer',
                issue_type: 'epic',
                issue_id: 'ETM-1',
            },
        });
        expect(second.status()).toBe(409);
        const secondBody = await second.json() as { error: string; kind: string };
        expect(secondBody.kind).toBe('conflict');
        expect(secondBody.error).toMatch(/already has an active run/i);
    });

    test('second dispatch succeeds after the first run is stopped', async ({ request }) => {
        // First dispatch — must succeed (202).
        const first = await request.post(`${API}/api/run`, {
            data: {
                agent_id: 'agent-po-writer',
                issue_type: 'epic',
                issue_id: 'ETM-1',
            },
        });
        expect(first.status()).toBe(202);
        const firstBody = await first.json() as { runId: string };
        const firstRunId = firstBody.runId;

        // Stop the first run — clears the live-lock on ETM-1.
        const stop = await request.post(`${API}/api/run/${firstRunId}/stop`);
        expect(stop.status()).toBe(200);
        const stopBody = await stop.json() as { status: string };
        expect(stopBody.status).toBe('cancelled');

        // Second dispatch — lock is cleared, must now succeed.
        const second = await request.post(`${API}/api/run`, {
            data: {
                agent_id: 'agent-po-writer',
                issue_type: 'epic',
                issue_id: 'ETM-1',
            },
        });
        expect(second.status()).toBe(202);
        const secondBody = await second.json() as { runId: string };
        expect(typeof secondBody.runId).toBe('string');
        createdRunIds.push(secondBody.runId);
    });
});
