import { expect, type APIRequestContext } from '@playwright/test';

// Direct calls to the e2e API (global-setup.ts) for seeding what a spec needs.

export const API = 'http://127.0.0.1:6001';
// The e2e seed's only project (fixtures/run-seed.ts).
const PROJECT_ID = 'e2e-terminal-project';
export const PROJECT_NAME = 'E2E Terminal';

export async function apiPost<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
    const res = await request.post(`${API}${path}`, { data });
    expect(res.status(), `POST ${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
}

export async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
    const res = await request.get(`${API}${path}`);
    expect(res.status(), `GET ${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
}

/** Start → each step → End, joined by pass edges, top to bottom. */
export function chainGraph(...steps: Array<Record<string, unknown>>) {
    const nodes = [{ id: 'start', type: 'start' }, ...steps.map((s, i) => ({ id: `step-${i}`, ...s })), { id: 'end', type: 'end' }].map(
        (n, i) => ({ ...n, position: { x: 0, y: i * 130 } }),
    );
    const edges = nodes.slice(1).map((n, i) => ({ id: `e-${i}`, source: nodes[i]?.id, target: n.id, kind: 'pass' }));
    return { nodes, edges };
}

/** A manual Task workflow in the seeded project; AI is off in e2e, so agent steps are simulated passes. */
export function createWorkflow(
    request: APIRequestContext,
    name: string,
    graph: ReturnType<typeof chainGraph>,
    input_kind: 'item' | 'sub_task' = 'item',
) {
    return apiPost<{ id: string; name: string }>(request, '/api/workflows', {
        name,
        project_id: PROJECT_ID,
        status: 'active',
        input_kind,
        trigger: 'manual',
        use_worktree: true,
        push_code: false,
        raises_pr: false,
        graph,
    });
}

export function createTask(request: APIRequestContext, title: string) {
    return apiPost<{ id: string; status: string }>(request, '/api/tasks', { project_id: PROJECT_ID, title });
}
