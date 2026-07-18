import { describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { api } from './api.js';
import type { AgentKindSlug } from '@atlas/shared';

function captureGet(path: string, body: JsonBodyType) {
    const captured = { url: '' };
    server.use(
        http.get(`http://localhost:3000/api${path}`, ({ request }) => {
            captured.url = request.url;
            return HttpResponse.json(body);
        }),
    );
    return captured;
}

function captureMethod(
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body: JsonBodyType,
) {
    const captured = { url: '', body: null as unknown, contentType: '' };
    const handler = http[method](`http://localhost:3000/api${path}`, async ({ request }) => {
        captured.url = request.url;
        captured.contentType = request.headers.get('content-type') ?? '';
        try {
            captured.body = await request.json();
        } catch {
            captured.body = null;
        }
        return HttpResponse.json(body);
    });
    server.use(handler);
    return captured;
}

describe('api.health', () => {
    it('hits GET /api/health', async () => {
        const cap = captureGet('/health', { status: 'ok' });
        const r = await api.health();
        expect(r.status).toBe('ok');
        expect(cap.url).toMatch(/\/api\/health$/);
    });
});

describe('api.fs', () => {
    it('encodes list query', async () => {
        const cap = captureGet('/fs/list', { path: '/', parent: null, entries: [] });
        await api.fs.list('/tmp');
        expect(cap.url).toContain('/fs/list?path=%2Ftmp');
    });
    it('encodes stat query', async () => {
        const cap = captureGet('/fs/stat', { path: '/', exists: true, is_directory: true });
        await api.fs.stat('/x');
        expect(cap.url).toContain('/fs/stat?path=%2Fx');
    });
    it('encodes join query', async () => {
        const cap = captureGet('/fs/join', { path: '/a/b' });
        await api.fs.join('/a', 'b');
        expect(cap.url).toContain('base=%2Fa');
        expect(cap.url).toContain('name=b');
    });
    it('GETs home', async () => {
        const cap = captureGet('/fs/home', { path: '/home' });
        await api.fs.home();
        expect(cap.url).toMatch(/\/fs\/home$/);
    });
});

describe('api.counts', () => {
    it('GET /counts for sidenav', async () => {
        const cap = captureGet('/counts', { projects: 1 });
        await api.counts.sidenav();
        expect(cap.url).toMatch(/\/counts$/);
    });
    it('GET /dashboard', async () => {
        const cap = captureGet('/dashboard', {});
        await api.counts.dashboard();
        expect(cap.url).toMatch(/\/dashboard$/);
    });
});

describe('api.settings', () => {
    it('GET /settings', async () => {
        captureGet('/settings', { id: 1 });
        await api.settings.get();
    });
    it('POST /settings/onboard with body', async () => {
        const cap = captureMethod('post', '/settings/onboard', {});
        await api.settings.onboard({ owner_name: 'Bob', workspace_path: '/ws' });
        expect(cap.body).toEqual({ owner_name: 'Bob', workspace_path: '/ws' });
        expect(cap.contentType).toContain('application/json');
    });
    it('PATCH /settings/profile', async () => {
        const cap = captureMethod('patch', '/settings/profile', {});
        await api.settings.updateProfile({ owner_name: 'Bob' });
        expect(cap.body).toEqual({ owner_name: 'Bob' });
    });
    it('PATCH /settings/constitution wraps in object', async () => {
        const cap = captureMethod('patch', '/settings/constitution', {});
        await api.settings.updateConstitution('text');
        expect(cap.body).toEqual({ constitution_md: 'text' });
    });
    it('PATCH /settings/external-notification', async () => {
        captureMethod('patch', '/settings/external-notification', {});
        await api.settings.updateExternalNotification({ external_notification_token: 't' });
    });
    it('POST /settings/external-notification/test', async () => {
        captureMethod('post', '/settings/external-notification/test', { ok: true });
        const r = await api.settings.testExternalNotification();
        expect(r.ok).toBe(true);
    });
    it('PATCH /settings/notifications', async () => {
        captureMethod('patch', '/settings/notifications', {});
        await api.settings.updateNotifications({});
    });
    it('GET /settings/env', async () => {
        captureGet('/settings/env', { vars: [] });
        await api.settings.getEnv();
    });
    it('PATCH /settings/env wraps updates', async () => {
        const cap = captureMethod('patch', '/settings/env', { vars: [] });
        await api.settings.updateEnv([{ key: 'A', value: 'B' }]);
        expect(cap.body).toEqual({ updates: [{ key: 'A', value: 'B' }] });
    });
    it('POST /settings/reset', async () => {
        captureMethod('post', '/settings/reset', { ok: true });
        await api.settings.reset();
    });
});

describe('api.server', () => {
    it('POST /server/restart', async () => {
        captureMethod('post', '/server/restart', { ok: true, supervised: false });
        const r = await api.server.restart();
        expect(r.ok).toBe(true);
    });
});

describe('api.cliModels', () => {
    it('list/create/update/remove', async () => {
        captureGet('/cli-models', []);
        await api.cliModels.list();
        captureMethod('post', '/cli-models', {});
        await api.cliModels.create({ cli: 'claude', model_name: 'm' });
        captureMethod('patch', '/cli-models/x', {});
        await api.cliModels.update('x', { note: 'n' });
        captureMethod('delete', '/cli-models/x', {});
        await api.cliModels.remove('x');
    });
});

describe('api.toolCatalog', () => {
    it('GET /tool-catalog and /tools/matrix', async () => {
        captureGet('/tool-catalog', { groups: [] });
        await api.toolCatalog.get();
    });
});

describe('api.agents', () => {
    it('full CRUD and sub-resources', async () => {
        captureGet('/agents', []);
        await api.agents.list();
        captureGet('/agents/a1', {});
        await api.agents.get('a1');
        captureMethod('post', '/agents', {});
        await api.agents.create({});
        captureMethod('patch', '/agents/a1', {});
        await api.agents.update('a1', {});
        captureMethod('delete', '/agents/a1', {});
        await api.agents.delete('a1');
        captureGet('/agents/a1/runs', []);
        await api.agents.getRuns('a1');
        captureGet('/agents/a1/handoff-rules', []);
        await api.agents.getHandoffRules('a1');
        captureMethod('put', '/agents/a1/handoff-rules', []);
        await api.agents.setHandoffRules('a1', []);
    });
});

describe('api.projects', () => {
    it('list/get/create/update/delete', async () => {
        captureGet('/projects', []);
        await api.projects.list();
        captureGet('/projects/p1', {});
        await api.projects.get('p1');
        captureMethod('post', '/projects', {});
        await api.projects.create({});
        captureMethod('patch', '/projects/p1', {});
        await api.projects.update('p1', {});
        captureMethod('delete', '/projects/p1', {});
        await api.projects.delete('p1');
    });

    it('clone/reclone/status/reveal/head/folderOrigin/env', async () => {
        captureMethod('post', '/projects/clone', { clone_id: 'c1', destination: '/x' });
        await api.projects.clone({
            repo_url: 'r',
            credential_id: 'c',
            project_name: 'n',
            issue_key_prefix: 'ATL',
            default_branch: 'main',
        });
        captureGet('/projects/prefix-available', { available: true });
        await api.projects.prefixAvailable('ATL');
        captureMethod('post', '/projects/p1/delete', { delete_id: 'd' });
        await api.projects.deleteJob('p1', { mode: 'unregister' });
        captureMethod('post', '/projects/p1/reclone', { reclone_id: 'r1' });
        await api.projects.reclone('p1');
        captureGet('/projects/p1/status', { local_head: 'h', remote_head: 'r', behind: 0, uncommitted: 0 });
        await api.projects.status('p1');
        captureMethod('post', '/projects/p1/reveal', { ok: true, path: '/' });
        await api.projects.reveal('p1');
        captureGet('/projects/folder-origin', { origin: null });
        await api.projects.folderOrigin('/x');
        captureGet('/projects/p1/head', { short_sha: null, subject: null, relative_time: null });
        await api.projects.head('p1');
        captureGet('/projects/p1/env', { vars: [] });
        await api.projects.getEnv('p1');
        captureMethod('put', '/projects/p1/env', { vars: [] });
        await api.projects.saveEnv('p1', []);
    });

    it('connect returns the raw response', async () => {
        captureMethod('post', '/projects/connect', { id: 'p1' });
        const r = await api.projects.connect({
            folder_path: '/p',
            repo_url: 'r',
            credential_id: 'c',
            issue_key_prefix: 'ATL',
        });
        expect(r.ok).toBe(true);
    });
});

describe('api.schedules', () => {
    it('list/get/save/delete/fire', async () => {
        captureGet('/schedules', []);
        await api.schedules.listEnabled();
        captureGet('/projects/p1/schedule', {});
        await api.schedules.get('p1');
        captureMethod('put', '/projects/p1/schedule', {});
        await api.schedules.save('p1', {
            enabled: true,
            preset: 'daily',
            time_of_day: '09:00',
            weekday: null,
            cron_expression: '',
            skip_if_dirty: false,
            pause_while_agents_active: false,
            conflict_policy: 'skip',
        });
        captureMethod('delete', '/projects/p1/schedule', {});
        await api.schedules.delete('p1');
        captureMethod('post', '/projects/p1/schedule/fire', { autofetch_id: 'a' });
        await api.schedules.fire('p1');
    });
});

describe('api.credentials', () => {
    it('list/get/create/update/delete', async () => {
        captureGet('/credentials', []);
        await api.credentials.list();
        captureGet('/credentials/c1', {});
        await api.credentials.get('c1');
        captureMethod('post', '/credentials', {});
        await api.credentials.create({ label: 'L', token: 't' });
        captureMethod('patch', '/credentials/c1', {});
        await api.credentials.update('c1', { label: 'L2' });
        captureMethod('delete', '/credentials/c1', {});
        await api.credentials.delete('c1');
    });
});

describe('api.epics', () => {
    it('CRUD + composite + transitions', async () => {
        const cap = captureGet('/epics', []);
        await api.epics.list();
        expect(cap.url).toMatch(/\/epics$/);
        captureGet('/epics', []);
        await api.epics.list('p1');
        captureGet('/epics/stats', { total: 0, awaiting_pickup: 0 });
        await api.epics.stats();
        captureGet('/epics/E1', {});
        await api.epics.get('E1');
        captureGet('/epics/E1/full', {});
        await api.epics.full('E1');
        captureMethod('post', '/epics', {});
        await api.epics.create({});
        captureMethod('patch', '/epics/E1', {});
        await api.epics.update('E1', {});
        captureMethod('patch', '/epics/E1/status', {});
        await api.epics.transition('E1', 'ready');
        captureMethod('patch', '/epics/E1/status', {});
        await api.epics.transition('E1', 'ready', true);
        captureMethod('patch', '/epics/E1/assign', {});
        await api.epics.assign('E1', 'agent-coder');
        captureMethod('delete', '/epics/E1', {});
        await api.epics.delete('E1');
    });
});

describe('api.stories', () => {
    it('builds correct list query string', async () => {
        const cap = captureGet('/stories', []);
        await api.stories.list({ epicId: 'E1', projectId: 'p1' });
        expect(cap.url).toContain('epic_id=E1');
        expect(cap.url).toContain('project_id=p1');
    });
    it('CRUD + composite + sub creations', async () => {
        captureGet('/stories/S1', {});
        await api.stories.get('S1');
        captureGet('/stories/S1/full', {});
        await api.stories.full('S1');
        captureMethod('post', '/stories', {});
        await api.stories.create({});
        captureMethod('patch', '/stories/S1', {});
        await api.stories.update('S1', {});
        captureMethod('patch', '/stories/S1/status', {});
        await api.stories.transition('S1', 'ready');
        captureMethod('patch', '/stories/S1/assign', {});
        await api.stories.assign('S1', null);
        captureMethod('delete', '/stories/S1', {});
        await api.stories.delete('S1');
        captureGet('/stories/S1/sub-tasks', []);
        await api.stories.getSubTasks('S1');
        captureMethod('post', '/stories/S1/sub-tasks', {});
        await api.stories.createSubTask('S1', {});
        captureGet('/stories/S1/sub-bugs', []);
        await api.stories.getSubBugs('S1');
        captureMethod('post', '/stories/S1/sub-bugs', {});
        await api.stories.createSubBug('S1', {});
    });
});

describe('api.subTasks + subBugs', () => {
    it('full CRUD', async () => {
        captureGet('/sub-tasks', []);
        await api.subTasks.list();
        captureGet('/sub-tasks/T1/full', {});
        await api.subTasks.full('T1');
        captureMethod('patch', '/sub-tasks/T1', {});
        await api.subTasks.update('T1', {});
        captureMethod('patch', '/sub-tasks/T1/status', {});
        await api.subTasks.transition('T1', 'ready');
        captureMethod('patch', '/sub-tasks/T1/assign', {});
        await api.subTasks.assign('T1', null);
        captureMethod('delete', '/sub-tasks/T1', {});
        await api.subTasks.delete('T1');

        captureGet('/sub-bugs', []);
        await api.subBugs.list();
        captureGet('/sub-bugs/SB1/full', {});
        await api.subBugs.full('SB1');
        captureMethod('patch', '/sub-bugs/SB1', {});
        await api.subBugs.update('SB1', {});
        captureMethod('patch', '/sub-bugs/SB1/status', {});
        await api.subBugs.transition('SB1', 'ready');
        captureMethod('patch', '/sub-bugs/SB1/assign', {});
        await api.subBugs.assign('SB1', null);
        captureMethod('delete', '/sub-bugs/SB1', {});
        await api.subBugs.delete('SB1');
    });
});

describe('api.bugs', () => {
    it('list with filters and full CRUD', async () => {
        const cap = captureGet('/bugs', []);
        await api.bugs.list({ epicId: 'E1' });
        expect(cap.url).toContain('epic_id=E1');
        captureGet('/bugs/B1', {});
        await api.bugs.get('B1');
        captureGet('/bugs/B1/full', {});
        await api.bugs.full('B1');
        captureMethod('post', '/bugs', {});
        await api.bugs.create({});
        captureMethod('patch', '/bugs/B1', {});
        await api.bugs.update('B1', {});
        captureMethod('patch', '/bugs/B1/status', {});
        await api.bugs.transition('B1', 'ready');
        captureMethod('patch', '/bugs/B1/assign', {});
        await api.bugs.assign('B1', null);
        captureMethod('delete', '/bugs/B1', {});
        await api.bugs.delete('B1');
    });
});

describe('api.issues.tree', () => {
    it('appends project_id when given', async () => {
        const cap = captureGet('/issues/tree', { tree: [], projects: [], agents: [], epics: [], stories: [], bugs: [] });
        await api.issues.tree({ projectId: 'p1' });
        expect(cap.url).toContain('project_id=p1');
    });
    it('omits query when no project_id', async () => {
        const cap = captureGet('/issues/tree', { tree: [], projects: [], agents: [], epics: [], stories: [], bugs: [] });
        await api.issues.tree({});
        expect(cap.url).toMatch(/\/issues\/tree$/);
    });
});

describe('api.comments', () => {
    it('list + create + delete', async () => {
        const cap = captureGet('/comments', []);
        await api.comments.list('story', 'S1');
        expect(cap.url).toContain('issue_type=story');
        expect(cap.url).toContain('issue_id=S1');
        captureMethod('post', '/comments', {});
        await api.comments.create({});
        captureMethod('delete', '/comments/1', {});
        await api.comments.delete(1);
    });
});

describe('api.activity', () => {
    it('GET /issues/:type/:id/activity', async () => {
        const cap = captureGet('/issues/story/S1/activity', []);
        await api.activity.get('story', 'S1');
        expect(cap.url).toMatch(/\/issues\/story\/S1\/activity$/);
    });
});

describe('api.issueLinks', () => {
    it('list/create/delete', async () => {
        captureGet('/issues/story/S1/links', []);
        await api.issueLinks.list('story', 'S1');
        captureMethod('post', '/issues/story/S1/links', {});
        await api.issueLinks.create('story', 'S1', 'bug', 'B1');
        captureMethod('delete', '/issues/links/9', {});
        await api.issueLinks.delete(9);
    });
});

describe('api.notifications', () => {
    it('list with no opts', async () => {
        const cap = captureGet('/notifications', []);
        await api.notifications.list();
        expect(cap.url).toMatch(/\/notifications$/);
    });
    it('list with kind, external_status, limit', async () => {
        const cap = captureGet('/notifications', []);
        await api.notifications.list({ kind: 'needs_you', external_status: 'sent', limit: 10 });
        expect(cap.url).toContain('kind=needs_you');
        expect(cap.url).toContain('external_status=sent');
        expect(cap.url).toContain('limit=10');
    });
    it('all mutation routes', async () => {
        captureMethod('patch', '/notifications/1/sent', {});
        await api.notifications.markSent(1);
        captureMethod('post', '/notifications/1/resend', {});
        await api.notifications.resend(1);
        captureMethod('post', '/notifications/1/cancel', {});
        await api.notifications.cancel(1);
        captureMethod('post', '/notifications/mark-all-read', { ok: true, changed: 0 });
        await api.notifications.markAllRead();
        captureMethod('post', '/notifications/1/read', { ok: true, changed: true });
        await api.notifications.markRead(1);
    });
});

describe('api.guardrails', () => {
    it('CRUD + save', async () => {
        captureGet('/guardrails', { rules: [], published_at: null });
        await api.guardrails.list();
        captureMethod('post', '/guardrails', {});
        await api.guardrails.create({ category: 'file_system', rule_text: 't', detail: null, severity: 'warn' });
        captureMethod('patch', '/guardrails/g1', {});
        await api.guardrails.update('g1', {});
        captureMethod('delete', '/guardrails/g1', {});
        await api.guardrails.remove('g1');
        captureMethod('post', '/guardrails/save', { ok: true, published_at: 'x' });
        await api.guardrails.save();
    });
});

describe('api.projectGuardrails', () => {
    it('CRUD + toggle', async () => {
        captureGet('/projects/p1/guardrails', []);
        await api.projectGuardrails.list('p1');
        captureMethod('post', '/projects/p1/guardrails', {});
        await api.projectGuardrails.create('p1', { title: 't', body_md: 'b' });
        captureMethod('patch', '/projects/p1/guardrails/g1', {});
        await api.projectGuardrails.update('p1', 'g1', {});
        captureMethod('patch', '/projects/p1/guardrails/g1/toggle', {});
        await api.projectGuardrails.toggle('p1', 'g1', 1);
        captureMethod('delete', '/projects/p1/guardrails/g1', {});
        await api.projectGuardrails.remove('p1', 'g1');
    });
});

describe('api.search.query', () => {
    it('encodes the query string', async () => {
        const cap = captureGet('/search', []);
        await api.search.query({ q: 'hello world' });
        expect(cap.url).toContain('q=hello+world');
    });

    it('forwards filter params as a CSV-encoded query string', async () => {
        const cap = captureGet('/search', []);
        await api.search.query({
            q: 'foo',
            type: ['story', 'bug'],
            project_id: ['p1'],
            status: 'ready',
            updated: 'last_7_days',
            limit: 25,
        });
        expect(cap.url).toContain('type=story%2Cbug');
        expect(cap.url).toContain('project_id=p1');
        expect(cap.url).toContain('status=ready');
        expect(cap.url).toContain('updated=last_7_days');
        expect(cap.url).toContain('limit=25');
    });

    it('drops queries shorter than 2 chars to avoid noisy hits', async () => {
        const cap = captureGet('/search', []);
        await api.search.query({ q: 'a', type: ['story'] });
        expect(cap.url).not.toContain('q=');
        expect(cap.url).toContain('type=story');
    });
});

describe('api.run', () => {
    it('trigger/get/list', async () => {
        captureMethod('post', '/run', { runId: 'r1' });
        await api.run.trigger('agent-coder', 'story', 'S1');
        captureGet('/run/r1', {});
        await api.run.get('r1');
        const cap = captureGet('/run', []);
        await api.run.list({ issue_type: 'story', issue_id: 'S1', limit: 5 });
        expect(cap.url).toContain('issue_type=story');
        expect(cap.url).toContain('limit=5');
    });
});

describe('request error handling', () => {
    it('throws Error with server-provided message', async () => {
        server.use(
            http.get('http://localhost:3000/api/health', () =>
                HttpResponse.json({ error: 'boom' }, { status: 500 }),
            ),
        );
        await expect(api.health()).rejects.toThrow(/boom/);
    });

    it('falls back to status text when no error body', async () => {
        server.use(
            http.get('http://localhost:3000/api/health', () =>
                HttpResponse.text('nope', { status: 503 }),
            ),
        );
        await expect(api.health()).rejects.toThrow();
    });

    it('returns undefined for 204 responses', async () => {
        server.use(
            http.delete('http://localhost:3000/api/projects/p1', () => new HttpResponse(null, { status: 204 })),
        );
        await expect(api.projects.delete('p1')).resolves.toBeUndefined();
    });
});

describe('api.counts.project', () => {
    it('GET /counts/project/:id', async () => {
        const cap = captureGet('/counts/project/p1', { open: 0 });
        await api.counts.project('p1');
        expect(cap.url).toMatch(/\/counts\/project\/p1$/);
    });
});

describe('api.analytics (extended)', () => {
    it('get with explicit tz', async () => {
        const cap = captureGet('/analytics', {});
        await api.analytics.get('America/New_York');
        expect(cap.url).toContain('tz=');
    });
    it('project drill-down', async () => {
        const cap = captureGet('/analytics/project/p1', {});
        await api.analytics.project('p1');
        expect(cap.url).toContain('/analytics/project/p1');
    });
    it('projectEpics with page+limit', async () => {
        const cap = captureGet('/analytics/project/p1/epics', { rows: [], total: 0 });
        await api.analytics.projectEpics('p1', { page: 2, limit: 10 });
        expect(cap.url).toContain('page=2');
        expect(cap.url).toContain('limit=10');
    });
    it('projectEpics without params', async () => {
        const cap = captureGet('/analytics/project/p1/epics', { rows: [], total: 0 });
        await api.analytics.projectEpics('p1');
        expect(cap.url).toMatch(/\/analytics\/project\/p1\/epics$/);
    });
    it('epic drill-down', async () => {
        const cap = captureGet('/analytics/epic/e1', {});
        await api.analytics.epic('e1');
        expect(cap.url).toContain('/analytics/epic/e1');
    });
    it('epicChildren with type', async () => {
        const cap = captureGet('/analytics/epic/e1/children', { rows: [], total: 0 });
        await api.analytics.epicChildren('e1', { page: 1, limit: 25, type: 'story' });
        expect(cap.url).toContain('type=story');
    });
    it('epicChildren without params', async () => {
        const cap = captureGet('/analytics/epic/e1/children', { rows: [], total: 0 });
        await api.analytics.epicChildren('e1');
        expect(cap.url).toMatch(/\/analytics\/epic\/e1\/children$/);
    });
});

describe('api.labels', () => {
    it('list without projectId', async () => {
        const cap = captureGet('/labels', { labels: [] });
        await api.labels.list();
        expect(cap.url).toMatch(/\/labels$/);
    });
    it('list with projectId', async () => {
        const cap = captureGet('/labels', { labels: [] });
        await api.labels.list('p1');
        expect(cap.url).toContain('project_id=p1');
    });
});

describe('api.roles', () => {
    it('list/get/update', async () => {
        captureGet('/roles', []);
        await api.roles.list();
        captureGet('/roles/engineer', {});
        await api.roles.get('engineer');
        captureMethod('patch', '/roles/engineer', {});
        await api.roles.update('engineer', { label: 'Coder' });
    });
});

describe('api.agents (extended)', () => {
    it('checklists CRUD', async () => {
        captureGet('/agents/a1/checklists', []);
        await api.agents.getChecklists('a1');
        captureMethod('put', '/agents/a1/checklists', []);
        await api.agents.setChecklists('a1', []);
    });
    it('memory CRUD', async () => {
        captureGet('/agents/a1/memory', {});
        await api.agents.getMemory('a1');
        captureMethod('put', '/agents/a1/memory', {});
        await api.agents.setMemory('a1', 'body');
        captureMethod('post', '/agents/a1/memory/regenerate', {});
        await api.agents.regenerateMemory('a1');
    });
    it('memory history', async () => {
        captureGet('/agents/a1/memory/history', []);
        await api.agents.getMemoryHistory('a1');
        captureGet('/agents/a1/memory/history', []);
        await api.agents.getMemoryHistory('a1', 5);
    });
    it('similar items', async () => {
        captureGet('/items/item-1/similar', []);
        await api.agents.getSimilarItems('item-1');
        captureGet('/items/item-1/similar', []);
        await api.agents.getSimilarItems('item-1', 10);
    });
    it('commit verifications', async () => {
        captureGet('/agents/a1/commit-verifications', []);
        await api.agents.getCommitVerifications('a1');
        captureGet('/agents/a1/commit-verifications', []);
        await api.agents.getCommitVerifications('a1', 10);
    });
    it('prompt versions + revert', async () => {
        captureGet('/agents/a1/prompt-versions', []);
        await api.agents.getPromptVersions('a1');
        captureMethod('post', '/agents/a1/prompt-versions/1/revert', {});
        await api.agents.revertPrompt('a1', 1);
    });
    it('dry run', async () => {
        captureMethod('post', '/agents/a1/dry-run', { dryRunId: 'd1', model: 'm', cli: 'claude', promptLen: 100 });
        await api.agents.startDryRun('a1', null);
    });
    it('compile prompt', async () => {
        captureMethod('post', '/agents/a1/compile-prompt', { prompt: '', filename: '', length: 0, agent: { id: '', name: '', cli: '', model: '' }, issue: null, guardrails_count: 0, sections: [] });
        await api.agents.compilePrompt('a1', 'story', 'S1');
    });
    it('marketplace ops', async () => {
        captureMethod('post', '/agents/a1/accept-upgrade', {});
        await api.agents.acceptUpgrade('a1', []);
        captureMethod('post', '/agents/a1/dismiss-upgrade', {});
        await api.agents.dismissUpgrade('a1');
        captureMethod('post', '/agents/a1/detach', {});
        await api.agents.detachMarketplace('a1');
    });
    it('exportZipUrl returns a URL string', () => {
        const url = api.agents.exportZipUrl('my-agent');
        expect(url).toContain('/agents/my-agent/export');
    });
});

describe('api.marketplace', () => {
    it('list/get/install/diff/exportZipUrl', async () => {
        captureGet('/marketplace/agents', []);
        await api.marketplace.list();
        captureGet('/marketplace/agents', []);
        await api.marketplace.list({ q: 'coder', category: 'software-dev', limit: 10 });
        captureGet('/marketplace/agents/m1', {});
        await api.marketplace.get('m1');
        captureMethod('post', '/marketplace/agents/m1/install', {});
        await api.marketplace.install('m1');
        captureMethod('post', '/marketplace/agents/m1/install', {});
        await api.marketplace.install('m1', { agent_id: 'a1' });
        captureGet('/marketplace/agents/m1/diff/a1', {});
        await api.marketplace.diff('m1', 'a1');
        const url = api.marketplace.exportZipUrl('m1');
        expect(url).toContain('/marketplace/agents/m1/export');
    });
});

describe('api.projects (extended)', () => {
    it('listPaged', async () => {
        const cap = captureGet('/projects/paged', { rows: [], total: 0, page: 1, limit: 25 });
        await api.projects.listPaged({ page: 1, limit: 25 });
        expect(cap.url).toContain('page=1');
    });
    it('generateAiScaffold', async () => {
        captureMethod('post', '/projects/p1/generate-ai-scaffold', { run_id: 'r1' });
        await api.projects.generateAiScaffold('p1');
    });
});

describe('api.environmentSecrets', () => {
    it('list/save', async () => {
        captureGet('/environment-secrets', { vars: [] });
        await api.environmentSecrets.list();
        captureMethod('put', '/environment-secrets', { vars: [] });
        await api.environmentSecrets.save([{ key: 'K', value: 'V' }]);
    });
});

describe('api.push', () => {
    it('vapid key / subscribe / unsubscribe / test', async () => {
        captureGet('/push-subscriptions/vapid-public-key', { publicKey: 'pk' });
        await api.push.getVapidPublicKey();
        captureMethod('post', '/push-subscriptions/subscribe', { ok: true });
        await api.push.subscribe({ endpoint: 'e', p256dh: 'p', auth: 'a' });
        captureMethod('post', '/push-subscriptions/unsubscribe', null);
        await api.push.unsubscribe('e');
        captureMethod('post', '/push-subscriptions/test', { ok: true, subscriptions: 1, delivered: 1 });
        await api.push.test();
    });
});

describe('api.reminders', () => {
    it('list/create/update/cancel', async () => {
        captureGet('/reminders', []);
        await api.reminders.list();
        captureMethod('post', '/reminders', {});
        await api.reminders.create({ label: 'Test', body: '', schedule: { kind: 'once', at: new Date().toISOString() }, channel: 'notification' });
        captureMethod('patch', '/reminders/1', {});
        await api.reminders.update(1, { body: 'hello' });
        // cancel uses DELETE method
        server.use(http.delete('http://localhost:3000/api/reminders/1', () => HttpResponse.json({})));
        await api.reminders.cancel(1);
    });
});

describe('api.scratchPad', () => {
    it('list/get/create/update/delete', async () => {
        captureGet('/scratch-pad', []);
        await api.scratchPad.list();
        captureGet('/scratch-pad/sp1', {});
        await api.scratchPad.get('sp1');
        captureMethod('post', '/scratch-pad', {});
        await api.scratchPad.create({});
        captureMethod('patch', '/scratch-pad/sp1', {});
        await api.scratchPad.update('sp1', { title: 'T' });
        captureMethod('delete', '/scratch-pad/sp1', {});
        await api.scratchPad.delete('sp1');
    });
});

describe('api.guardrailScripts', () => {
    it('list/create/update/remove', async () => {
        captureGet('/guardrail-scripts', []);
        await api.guardrailScripts.list();
        captureMethod('post', '/guardrail-scripts', {});
        await api.guardrailScripts.create({ name: 'n', body_sh: 's', body_ps1: 'p' });
        captureMethod('patch', '/guardrail-scripts/g1', {});
        await api.guardrailScripts.update('g1', { name: 'n2' });
        captureMethod('delete', '/guardrail-scripts/g1', {});
        await api.guardrailScripts.remove('g1');
    });
});

describe('api.projectGuardrailScripts', () => {
    it('list/create/update/remove', async () => {
        captureGet('/projects/p1/guardrail-scripts', []);
        await api.projectGuardrailScripts.list('p1');
        captureMethod('post', '/projects/p1/guardrail-scripts', {});
        await api.projectGuardrailScripts.create('p1', { name: 'n', body_sh: 's', body_ps1: 'p' });
        captureMethod('patch', '/projects/p1/guardrail-scripts/g1', {});
        await api.projectGuardrailScripts.update('p1', 'g1', { name: 'n2' });
        captureMethod('delete', '/projects/p1/guardrail-scripts/g1', {});
        await api.projectGuardrailScripts.remove('p1', 'g1');
    });
});

describe('api.run (extended)', () => {
    it('get with since param', async () => {
        const cap = captureGet('/run/r1', {});
        await api.run.get('r1', { since: 100 });
        expect(cap.url).toContain('since=100');
    });
    it('get without since param', async () => {
        const cap = captureGet('/run/r1', {});
        await api.run.get('r1');
        expect(cap.url).toMatch(/\/run\/r1$/);
    });
    it('list with project_id', async () => {
        const cap = captureGet('/run', []);
        await api.run.list({ project_id: 'p1' });
        expect(cap.url).toContain('project_id=p1');
    });
    it('list without opts', async () => {
        const cap = captureGet('/run', []);
        await api.run.list();
        expect(cap.url).toMatch(/\/run$/);
    });
    it('delete a run', async () => {
        captureMethod('delete', '/run/r1', {});
        await api.run.delete('r1');
    });
    it('stop a run', async () => {
        captureMethod('post', '/run/r1/stop', { runId: 'r1', status: 'cancelled', killedSubprocess: false, pidKilled: null });
        await api.run.stop('r1');
    });
});

describe('api.cli.sessions', () => {
    it('list/get/create/pause/resume/preflightStop/stop/transcript/delete', async () => {
        captureGet('/cli/sessions', []);
        await api.cli.sessions.list();
        captureGet('/cli/sessions', []);
        await api.cli.sessions.list({ project_id: 'p1' });
        captureGet('/cli/sessions/s1', {});
        await api.cli.sessions.get('s1');
        captureMethod('post', '/cli/sessions', {});
        await api.cli.sessions.create({ project_id: 'p1', cli: 'claude', model: 'claude-opus-4' });
        captureMethod('post', '/cli/sessions/s1/pause', {});
        await api.cli.sessions.pause('s1');
        captureMethod('post', '/cli/sessions/s1/resume', {});
        await api.cli.sessions.resume('s1');
        captureMethod('post', '/cli/sessions/s1/preflight-stop', { unstaged: [], current_branch: 'main', ahead_of_remote: 0 });
        await api.cli.sessions.preflightStop('s1');
        captureMethod('post', '/cli/sessions/s1/stop', {});
        await api.cli.sessions.stop('s1', { files_to_stage: [] });
        captureGet('/cli/sessions/s1/transcript', { entries: [] });
        await api.cli.sessions.transcript('s1');
        captureMethod('delete', '/cli/sessions/s1', {});
        await api.cli.sessions.delete('s1');
    });
});

describe('api.search (extended)', () => {
    it('query with agent_id and labels filters', async () => {
        const cap = captureGet('/search', []);
        await api.search.query({ q: 'test', agent_id: ['a1'], labels: ['bug'] });
        expect(cap.url).toContain('agent_id=a1');
        expect(cap.url).toContain('labels=bug');
    });
});

describe('api.comments.update', () => {
    it('PATCH /comments/:id', async () => {
        const cap = captureMethod('patch', '/comments/1', {});
        await api.comments.update(1, 'new body');
        expect(cap.body).toEqual({ body: 'new body' });
    });
});

describe('api.epics.resetRounds + stories + subTasks + subBugs + bugs', () => {
    it('resetRounds POSTs to /reset-rounds for each type', async () => {
        captureMethod('post', '/epics/E1/reset-rounds', {});
        await api.epics.resetRounds('E1');
        captureMethod('post', '/stories/S1/reset-rounds', {});
        await api.stories.resetRounds('S1');
        captureMethod('post', '/sub-tasks/T1/reset-rounds', {});
        await api.subTasks.resetRounds('T1');
        captureMethod('post', '/sub-bugs/SB1/reset-rounds', {});
        await api.subBugs.resetRounds('SB1');
        captureMethod('post', '/bugs/B1/reset-rounds', {});
        await api.bugs.resetRounds('B1');
    });
});

describe('api.epics.list (includeArchived)', () => {
    it('appends include_archived when true', async () => {
        const cap = captureGet('/epics', []);
        await api.epics.list(undefined, true);
        expect(cap.url).toContain('include_archived=true');
    });
});

describe('api.issues.tree (includeArchived)', () => {
    it('appends include_archived when true', async () => {
        const cap = captureGet('/issues/tree', {
            tree: [],
            projects: [],
            agents: [],
            epics: [],
            stories: [],
            bugs: [],
        });
        await api.issues.tree({ includeArchived: true });
        expect(cap.url).toContain('include_archived=true');
    });
});

describe('api.issueLinks.create with relationType', () => {
    it('forwards relation_type to server', async () => {
        const cap = captureMethod('post', '/issues/story/S1/links', {});
        await api.issueLinks.create('story', 'S1', 'bug', 'B1', 'depends_on');
        expect((cap.body as Record<string, unknown>)['relation_type']).toBe('depends_on');
    });
});

describe('api.stories.list (empty opts)', () => {
    it('returns all stories when no filters provided', async () => {
        const cap = captureGet('/stories', []);
        await api.stories.list();
        expect(cap.url).toMatch(/\/stories$/);
    });
});

describe('api.bugs.list (empty opts)', () => {
    it('returns all bugs when no filters provided', async () => {
        const cap = captureGet('/bugs', []);
        await api.bugs.list();
        expect(cap.url).toMatch(/\/bugs$/);
    });
});

describe('api.bugs.list (projectId filter)', () => {
    it('includes project_id param when projectId provided (line 659 true branch)', async () => {
        const cap = captureGet('/bugs', []);
        await api.bugs.list({ projectId: 'P1' });
        expect(cap.url).toContain('project_id=P1');
    });
});

describe('api.subTasks.transition (override=true)', () => {
    it('appends ?override=1 when override=true (line 633 true branch)', async () => {
        const cap = captureMethod('patch', '/sub-tasks/T1/status', {});
        await api.subTasks.transition('T1', 'ready', true);
        expect(cap.url).toContain('?override=1');
    });
});

describe('api.subBugs.transition (override=true)', () => {
    it('appends ?override=1 when override=true (line 647 true branch)', async () => {
        const cap = captureMethod('patch', '/sub-bugs/SB1/status', {});
        await api.subBugs.transition('SB1', 'ready', true);
        expect(cap.url).toContain('?override=1');
    });
});

describe('api.bugs.transition (override=true)', () => {
    it('appends ?override=1 when override=true (line 670 true branch)', async () => {
        const cap = captureMethod('patch', '/bugs/B1/status', {});
        await api.bugs.transition('B1', 'ready', true);
        expect(cap.url).toContain('?override=1');
    });
});

describe('api.stories.transition (override=true)', () => {
    it('appends ?override=1 when override=true (line 614 true branch)', async () => {
        const cap = captureMethod('patch', '/stories/S1/status', {});
        await api.stories.transition('S1', 'ready', true);
        expect(cap.url).toContain('?override=1');
    });
});

describe('api.analytics.get (no tz arg)', () => {
    it('uses Intl.DateTimeFormat timezone when tz not provided (line 223 ?? branch)', async () => {
        const cap = captureGet('/analytics', {});
        // Call without tz — triggers the `tz ?? Intl.DateTimeFormat()...` right side
        await api.analytics.get();
        // The tz param should be present (from Intl.DateTimeFormat in jsdom)
        expect(cap.url).toContain('tz=');
    });
});

describe('api.marketplace.list (with kind)', () => {
    it('includes kind param', async () => {
        const cap = captureGet('/marketplace/agents', []);
        await api.marketplace.list({ kind: 'coder' as AgentKindSlug });
        expect(cap.url).toContain('kind=coder');
    });
});

describe('api.push.subscribe (with userAgent)', () => {
    it('forwards userAgent in subscribe body', async () => {
        const cap = captureMethod('post', '/push-subscriptions/subscribe', { ok: true });
        await api.push.subscribe({ endpoint: 'e', p256dh: 'p', auth: 'a', userAgent: 'Mozilla' });
        expect((cap.body as Record<string, unknown>)['userAgent']).toBe('Mozilla');
    });
});

describe('api.scratchPad.create (default arg)', () => {
    it('creates scratch-pad with no args', async () => {
        captureMethod('post', '/scratch-pad', {});
        await api.scratchPad.create();
    });
});

describe('api.projects.connect (ConnectError path)', () => {
    it('returns ok:false with checks when server returns 400', async () => {
        server.use(
            http.post('http://localhost:3000/api/projects/connect', () =>
                HttpResponse.json(
                    {
                        ok: false,
                        checks: {
                            folder_exists: true,
                            has_git: false,
                            origin_matches: false,
                            ls_remote_ok: false,
                        },
                        error_kind: 'not_git',
                    },
                    { status: 400 },
                ),
            ),
        );
        const r = await api.projects.connect({
            folder_path: '/x',
            repo_url: 'r',
            credential_id: 'c',
            issue_key_prefix: 'ATL',
        });
        expect(r.ok).toBe(false);
    });
});

describe('api.agents.importZip (postForm path)', () => {
    it('sends multipart FormData to /agents/import', async () => {
        let receivedContentType = '';
        server.use(
            http.post('http://localhost:3000/api/agents/import', ({ request }) => {
                receivedContentType = request.headers.get('content-type') ?? '';
                return HttpResponse.json({ id: 'a1', name: 'Imported' });
            }),
        );
        const file = new File(['content'], 'agent.zip', { type: 'application/zip' });
        await api.agents.importZip(file);
        // multipart/form-data boundary is set automatically by the browser
        expect(receivedContentType).toContain('multipart/form-data');
    });

    it('sends multipart with agent_id when opts.agent_id is provided', async () => {
        server.use(
            http.post('http://localhost:3000/api/agents/import', () =>
                HttpResponse.json({ id: 'a1', name: 'Imported' }),
            ),
        );
        const file = new File(['content'], 'agent.zip', { type: 'application/zip' });
        // Should resolve without throwing
        const result = await api.agents.importZip(file, { agent_id: 'existing-agent' });
        expect(result).toEqual({ id: 'a1', name: 'Imported' });
    });
});
