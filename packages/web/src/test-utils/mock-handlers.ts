import { http, HttpResponse, type DefaultBodyType, type HttpResponseResolver } from 'msw';
import type {
    IAgent,
    IBug,
    IEpic,
    IEpicListItem,
    INotification,
    IProject,
    IStory,
    ISubBug,
    ISubTask,
} from '@atlas/shared';

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
    http.get(`${BASE}/epics`, ok<IEpicListItem[]>([])),
    http.get(`${BASE}/stories`, ok<IStory[]>([])),
    http.get(`${BASE}/bugs`, ok<IBug[]>([])),
    http.get(`${BASE}/sub-tasks`, ok<ISubTask[]>([])),
    http.get(`${BASE}/sub-bugs`, ok<ISubBug[]>([])),
    http.get(`${BASE}/notifications`, ok<INotification[]>([])),
    http.get(`${BASE}/settings`, ok({ id: 1, owner_name: 'Owner', onboarding_complete: 1 })),
    http.get(`${BASE}/counts`, ok({})),
    http.get(`${BASE}/dashboard`, ok({})),
    http.get(
        `${BASE}/issues/tree`,
        ok({ tree: [], projects: [], agents: [], epics: [], stories: [], bugs: [] }),
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
];

// Convenience factories so tests can express "this endpoint returns X" in one line.
export const handlers = {
    listProjects: (rows: IProject[]) => http.get(`${BASE}/projects`, ok(rows)),
    getProject: (project: IProject) =>
        http.get(`${BASE}/projects/${project.id}`, ok(project)),
    listAgents: (rows: IAgent[]) => http.get(`${BASE}/agents`, ok(rows)),
    listEpics: (rows: IEpicListItem[]) => http.get(`${BASE}/epics`, ok(rows)),
    getEpic: (epic: IEpic) => http.get(`${BASE}/epics/${epic.id}`, ok(epic)),
    listStories: (rows: IStory[]) => http.get(`${BASE}/stories`, ok(rows)),
    getStory: (story: IStory) => http.get(`${BASE}/stories/${story.id}`, ok(story)),
    listSubTasks: (rows: ISubTask[]) => http.get(`${BASE}/sub-tasks`, ok(rows)),
    listSubBugs: (rows: ISubBug[]) => http.get(`${BASE}/sub-bugs`, ok(rows)),
    listBugs: (rows: IBug[]) => http.get(`${BASE}/bugs`, ok(rows)),
};
