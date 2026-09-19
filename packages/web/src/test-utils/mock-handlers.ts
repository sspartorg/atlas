import { http, HttpResponse, type DefaultBodyType, type HttpResponseResolver } from 'msw';
import type {
    IAgent,
    INotification,
    IProject,
    ISubTask,
    ITask,
    ITaskListItem,
    IWorkflowQueue,
} from '@atlas/shared';
import { makeProjectRepo } from './factories.js';

const BASE = 'http://localhost:3000/api';

// Sensible 200-OK defaults for the most common GET endpoints. Tests register
// per-spec overrides via `server.use(...)` from `test-setup.ts`. Mutation
// endpoints (POST/PATCH/DELETE) are not stubbed here — each test that needs
// one declares it explicitly so the assertion sees the intent.

function ok<T extends DefaultBodyType>(body: T): HttpResponseResolver {
    return () => HttpResponse.json(body);
}

export const defaultHandlers = [
    http.get(`${BASE}/projects`, ok<IProject[]>([])),
    http.get(`${BASE}/agents`, ok<IAgent[]>([])),
    http.get(`${BASE}/tasks`, ok<ITaskListItem[]>([])),
    http.get(`${BASE}/sub-tasks`, ok<ISubTask[]>([])),
    http.get(`${BASE}/notifications`, ok<INotification[]>([])),
    http.get(`${BASE}/settings`, ok({ id: 1, owner_name: 'Owner', onboarding_complete: 1 })),
    http.get(`${BASE}/counts`, ok({})),
    http.get(`${BASE}/dashboard`, ok({})),
    http.get(
        `${BASE}/issues/tree`,
        ok({ tree: [], projects: [], agents: [], tasks: [] }),
    ),
    // The Projects page calls `useEnabledSchedules` which hits this endpoint.
    // Returning an empty list keeps the page rendering without an unhandled-request
    // warning in MSW. Tests that need specific schedules override via `server.use(...)`.
    http.get(`${BASE}/schedules`, ok([])),
    // RelatedItemsCard's PR-link section calls
    // /api/issues/<type>/<id>/external-links when no pre-loaded array was
    // passed via props. Any test that exercises a detail page without
    // pre-supplying external_links would otherwise see an MSW
    // unhandled-request warning. Default to an empty list; tests that need
    // populated PR links override via server.use(...).
    http.get(`${BASE}/issues/:type/:id/external-links`, () => HttpResponse.json([])),
    // Agent surfaces warn when a CLI binary is missing; default to "nothing
    // known" so they render no warning unless a test opts in.
    http.get(`${BASE}/cli/availability`, () => HttpResponse.json([])),
    // The agent Overview tab's Quality checklist card loads this on mount.
    http.get(`${BASE}/agents/:id/checklists`, () => HttpResponse.json([])),
    // The Queue page.
    http.get(`${BASE}/workflow-queue`, ok<IWorkflowQueue>({ workflows: [], unassigned: [] })),
    // New Task, the Task rail and Project Detail read a project's repos
    // (ADR 0018). Default to the one repo the project factory describes;
    // tests that need several override via server.use(...).
    http.get(`${BASE}/projects/:id/repos`, () => HttpResponse.json([makeProjectRepo()])),
    // The projects list reads every repo in one round trip.
    http.get(`${BASE}/repos`, () => HttpResponse.json([makeProjectRepo()])),
];

// Convenience factories so tests can express "this endpoint returns X" in one line.
export const handlers = {
    listProjects: (rows: IProject[]) => http.get(`${BASE}/projects`, ok(rows)),
    getProject: (project: IProject) =>
        http.get(`${BASE}/projects/${project.id}`, ok(project)),
    listAgents: (rows: IAgent[]) => http.get(`${BASE}/agents`, ok(rows)),
    listTasks: (rows: ITaskListItem[]) => http.get(`${BASE}/tasks`, ok(rows)),
    getTask: (task: ITask) => http.get(`${BASE}/tasks/${task.id}`, ok(task)),
    listSubTasks: (rows: ISubTask[]) => http.get(`${BASE}/sub-tasks`, ok(rows)),
    workflowQueue: (queue: IWorkflowQueue) => http.get(`${BASE}/workflow-queue`, ok(queue)),
};
