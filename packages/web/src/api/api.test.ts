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

    it('reclone/status/reveal/head/folderOrigin/env', async () => {
        captureGet('/projects/prefix-available', { available: true });
        await api.projects.prefixAvailable('ATL');
        captureMethod('post', '/projects/p1/delete', { delete_id: 'd' });
        await api.projects.deleteJob('p1', { mode: 'unregister' });
        // ADR 0018 — every git call names the repo it acts on.
        captureMethod('post', '/projects/p1/repos/r1/reclone', { reclone_id: 'r1' });
        await api.projects.reclone('p1', 'r1');
        captureGet('/projects/p1/repos/r1/status', { local_head: 'h', remote_head: 'r', behind: 0, uncommitted: 0 });
        await api.projects.status('p1', 'r1');
        captureMethod('post', '/projects/p1/repos/r1/reveal', { ok: true, path: '/' });
        await api.projects.reveal('p1', 'r1');
        captureGet('/projects/folder-origin', { origin: null });
        await api.projects.folderOrigin('/x');
        captureGet('/projects/p1/repos/r1/head', { short_sha: null, subject: null, relative_time: null });
        await api.projects.head('p1', 'r1');
        captureGet('/projects/p1/env', { vars: [] });
        await api.projects.getEnv('p1');
        captureMethod('put', '/projects/p1/env', { vars: [] });
        await api.projects.saveEnv('p1', []);
    });

});

describe('api.schedules', () => {
    it('list/get/save/delete/fire', async () => {
        captureGet('/schedules', []);
        await api.schedules.listEnabled();
        captureGet('/projects/p1/repos/r1/schedule', {});
        await api.schedules.get('p1', 'r1');
        captureMethod('put', '/projects/p1/repos/r1/schedule', {});
        await api.schedules.save('p1', 'r1', {
            enabled: true,
            preset: 'daily',
            time_of_day: '09:00',
            weekday: null,
            cron_expression: '',
            skip_if_dirty: false,
            pause_while_agents_active: false,
            conflict_policy: 'skip',
        });
        captureMethod('delete', '/projects/p1/repos/r1/schedule', {});
        await api.schedules.delete('p1', 'r1');
        captureMethod('post', '/projects/p1/repos/r1/schedule/fire', { autofetch_id: 'a' });
        await api.schedules.fire('p1', 'r1');
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

describe('api.tasks', () => {
    it('CRUD + composite + transitions', async () => {
        const cap = captureGet('/tasks', []);
        await api.tasks.list();
        expect(cap.url).toMatch(/\/tasks$/);
        const scoped = captureGet('/tasks', []);
        await api.tasks.list('p1');
        expect(scoped.url).toContain('project_id=p1');
        captureGet('/tasks/stats', { total: 0, awaiting_pickup: 0 });
        await api.tasks.stats();
        captureGet('/tasks/T1', {});
        await api.tasks.get('T1');
        captureGet('/tasks/T1/full', {});
        await api.tasks.full('T1');
        captureMethod('post', '/tasks', {});
        await api.tasks.create({});
        captureMethod('patch', '/tasks/T1', {});
        await api.tasks.update('T1', {});
        const status = captureMethod('patch', '/tasks/T1/status', {});
        await api.tasks.transition('T1', 'ready');
        expect(status.url).not.toContain('override');
        const override = captureMethod('patch', '/tasks/T1/status', {});
        await api.tasks.transition('T1', 'ready', true);
        expect(override.url).toContain('?override=1');
        const assign = captureMethod('patch', '/tasks/T1/assign', {});
        await api.tasks.assign('T1', 'agent-coder');
        expect(assign.body).toEqual({ assignee_agent_id: 'agent-coder' });
        captureMethod('delete', '/tasks/T1', {});
        await api.tasks.delete('T1');
    });
});

describe('api.subTasks', () => {
    it('lists, creates under the task, and full CRUD', async () => {
        captureGet('/sub-tasks', []);
        await api.subTasks.list();
        captureGet('/tasks/T1/sub-tasks', []);
        await api.subTasks.listForTask('T1');
        const create = captureMethod('post', '/tasks/T1/sub-tasks', {});
        await api.subTasks.create('T1', { title: 'Write tests', labels: ['qa'] });
        expect(create.body).toEqual({ title: 'Write tests', labels: ['qa'], task_id: 'T1' });
        captureGet('/sub-tasks/ST1/full', {});
        await api.subTasks.full('ST1');
        captureMethod('patch', '/sub-tasks/ST1', {});
        await api.subTasks.update('ST1', {});
        captureMethod('patch', '/sub-tasks/ST1/status', {});
        await api.subTasks.transition('ST1', 'ready');
        captureMethod('patch', '/sub-tasks/ST1/assign', {});
        await api.subTasks.assign('ST1', null);
        captureMethod('delete', '/sub-tasks/ST1', {});
        await api.subTasks.delete('ST1');
    });
});

describe('api.issues.tree', () => {
    it('appends project_id when given', async () => {
        const cap = captureGet('/issues/tree', { tree: [], projects: [], agents: [], tasks: [] });
        await api.issues.tree({ projectId: 'p1' });
        expect(cap.url).toContain('project_id=p1');
    });
    it('omits query when no project_id', async () => {
        const cap = captureGet('/issues/tree', { tree: [], projects: [], agents: [], tasks: [] });
        await api.issues.tree({});
        expect(cap.url).toMatch(/\/issues\/tree$/);
    });
});

describe('api.comments', () => {
    it('list + create + delete', async () => {
        const cap = captureGet('/comments', []);
        await api.comments.list('sub_task', 'S1');
        expect(cap.url).toContain('issue_type=sub_task');
        expect(cap.url).toContain('issue_id=S1');
        captureMethod('post', '/comments', {});
        await api.comments.create({});
        captureMethod('delete', '/comments/1', {});
        await api.comments.delete(1);
    });
});

describe('api.activity', () => {
    it('GET /issues/:type/:id/activity', async () => {
        const cap = captureGet('/issues/sub_task/S1/activity', []);
        await api.activity.get('sub_task', 'S1');
        expect(cap.url).toMatch(/\/issues\/sub_task\/S1\/activity$/);
    });
});

describe('api.issueLinks', () => {
    it('list/create/delete', async () => {
        captureGet('/issues/sub_task/S1/links', []);
        await api.issueLinks.list('sub_task', 'S1');
        captureMethod('post', '/issues/sub_task/S1/links', {});
        await api.issueLinks.create('sub_task', 'S1', 'task', 'T1');
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
            type: ['task', 'sub_task'],
            project_id: ['p1'],
            status: 'ready',
            updated: 'last_7_days',
            limit: 25,
        });
        expect(cap.url).toContain('type=task%2Csub_task');
        expect(cap.url).toContain('project_id=p1');
        expect(cap.url).toContain('status=ready');
        expect(cap.url).toContain('updated=last_7_days');
        expect(cap.url).toContain('limit=25');
    });

    it('drops queries shorter than 2 chars to avoid noisy hits', async () => {
        const cap = captureGet('/search', []);
        await api.search.query({ q: 'a', type: ['sub_task'] });
        expect(cap.url).not.toContain('q=');
        expect(cap.url).toContain('type=sub_task');
    });
});

describe('api.run', () => {
    it('trigger/get/list', async () => {
        captureMethod('post', '/run', { runId: 'r1' });
        await api.run.trigger('agent-coder', 'sub_task', 'S1');
        captureGet('/run/r1', {});
        await api.run.get('r1');
        const cap = captureGet('/run', []);
        await api.run.list({ issue_type: 'sub_task', issue_id: 'S1', limit: 5 });
        expect(cap.url).toContain('issue_type=sub_task');
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
    it('projectTasks with page+limit', async () => {
        const cap = captureGet('/analytics/project/p1/tasks', { rows: [], total: 0 });
        await api.analytics.projectTasks('p1', { page: 2, limit: 10 });
        expect(cap.url).toContain('page=2');
        expect(cap.url).toContain('limit=10');
    });
    it('projectTasks without params', async () => {
        const cap = captureGet('/analytics/project/p1/tasks', { rows: [], total: 0 });
        await api.analytics.projectTasks('p1');
        expect(cap.url).toMatch(/\/analytics\/project\/p1\/tasks$/);
    });
    it('task drill-down', async () => {
        const cap = captureGet('/analytics/task/t1', {});
        await api.analytics.task('t1');
        expect(cap.url).toContain('/analytics/task/t1');
    });
    it('taskChildren with type', async () => {
        const cap = captureGet('/analytics/task/t1/children', { rows: [], total: 0 });
        await api.analytics.taskChildren('t1', { page: 1, limit: 25, type: 'sub_task' });
        expect(cap.url).toContain('type=sub_task');
    });
    it('taskChildren without params', async () => {
        const cap = captureGet('/analytics/task/t1/children', { rows: [], total: 0 });
        await api.analytics.taskChildren('t1');
        expect(cap.url).toMatch(/\/analytics\/task\/t1\/children$/);
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
    it('compile prompt', async () => {
        captureMethod('post', '/agents/a1/compile-prompt', { prompt: '', filename: '', length: 0, agent: { id: '', name: '', cli: '', model: '' }, issue: null, guardrails_count: 0, sections: [] });
        await api.agents.compilePrompt('a1', 'sub_task', 'S1');
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

describe('api.tasks.list (includeArchived)', () => {
    it('appends include_archived when true', async () => {
        const cap = captureGet('/tasks', []);
        await api.tasks.list(undefined, true);
        expect(cap.url).toContain('include_archived=true');
    });
});

describe('api.issues.tree (includeArchived)', () => {
    it('appends include_archived when true', async () => {
        const cap = captureGet('/issues/tree', { tree: [], projects: [], agents: [], tasks: [] });
        await api.issues.tree({ includeArchived: true });
        expect(cap.url).toContain('include_archived=true');
    });
});

describe('api.issueLinks.create with relationType', () => {
    it('forwards relation_type to server', async () => {
        const cap = captureMethod('post', '/issues/sub_task/S1/links', {});
        await api.issueLinks.create('sub_task', 'S1', 'task', 'T1', 'depends_on');
        expect((cap.body as Record<string, unknown>)['relation_type']).toBe('depends_on');
    });
});

describe('api.subTasks.transition (override=true)', () => {
    it('appends ?override=1 when override=true', async () => {
        const cap = captureMethod('patch', '/sub-tasks/ST1/status', {});
        await api.subTasks.transition('ST1', 'ready', true);
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

describe('api.credentials (rotation + reveal)', () => {
    it('rotates a GitHub App installation token via POST /credentials/:id/refresh', async () => {
        // An expired installation token is why an agent's push suddenly 403s;
        // this is the one-click way out of it, so the path has to be right.
        const cap = captureMethod('post', '/credentials/c1/refresh', { id: 'c1' });
        await api.credentials.refresh('c1');
        expect(cap.url).toMatch(/\/credentials\/c1\/refresh$/);
        expect(cap.body).toEqual({});
    });

    it('reads a stored PAT back from the dedicated reveal route', async () => {
        // The list endpoint is metadata-only — the plaintext lives behind
        // this separate, audited GET and must never be folded into it.
        const cap = captureGet('/credentials/c1/token', { id: 'c1', value: 'ghp_x' });
        const r = await api.credentials.revealToken('c1');
        expect(r.value).toBe('ghp_x');
        expect(cap.url).toMatch(/\/credentials\/c1\/token$/);
    });
});

describe('api.workflows.create / api.workflowRuns.stop', () => {
    it('POSTs a new workflow with its graph intact', async () => {
        const cap = captureMethod('post', '/workflows', { id: 'wf-1' });
        await api.workflows.create({
            name: 'Release',
            project_id: 'p1',
            input_kind: 'item',
            trigger: 'manual',
            graph: { nodes: [], edges: [] },
        } as Parameters<typeof api.workflows.create>[0]);
        expect(cap.url).toMatch(/\/workflows$/);
        expect(cap.body).toMatchObject({ name: 'Release', project_id: 'p1' });
    });

    it('stops a run with an empty POST body', async () => {
        // Stop is the Owner's kill switch on a runaway agent — a wrong path
        // here means the run keeps burning tokens with no way to halt it.
        const cap = captureMethod('post', '/workflow-runs/run-9/stop', { id: 'run-9' });
        await api.workflowRuns.stop('run-9');
        expect(cap.url).toMatch(/\/workflow-runs\/run-9\/stop$/);
        expect(cap.body).toEqual({});
    });
});
