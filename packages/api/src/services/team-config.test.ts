import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

const dataDir = mkdtempSync(join(tmpdir(), 'atlas-team-'));
process.env['ATLAS_DATA_DIR'] = dataDir;

import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject, insertProjectRepo } from '../../tests/_items.js';
import { execFileSync } from 'node:child_process';
import { encrypt } from './crypto.js';
import { teamConfig, teamConfigDir } from './team-config.js';
import { workflowsService } from './workflows.js';

const pos = { x: 0, y: 0 };
const graph = (agentId: string) => ({
    nodes: [
        { id: 'start', type: 'start' as const, position: pos },
        { id: 'coder', type: 'agent' as const, agent_id: agentId, position: pos },
        { id: 'end', type: 'end' as const, position: pos },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'coder', kind: 'pass' as const },
        { id: 'e2', source: 'coder', target: 'end', kind: 'pass' as const },
    ],
});

const SUBSCRIBER = {
    role: 'subscriber' as const,
    repo_url: null,
    credential_id: null,
    branch: 'main',
    interval_minutes: 60,
    last_sync_at: null,
    last_sync_ok: null,
    last_sync_message: null,
    last_commit: null,
};

/** Every file under the clone, path → contents. */
function snapshot(dir = teamConfigDir(), prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) Object.assign(out, snapshot(p, `${prefix}${name}/`));
        else out[`${prefix}${name}`] = readFileSync(p, 'utf8');
    }
    return out;
}

/** The publisher's side: a team project with one of everything, plus a secret. */
async function seedPublisher(): Promise<{ workflowId: string }> {
    await insertAgent({ id: 'agent-coder', prompt_md: 'Write the code.' });
    await insertProject('p1', 'ATL', { no_repo: true, name: 'Atlas' });
    await testDb.updateTable('projects').set({ team_managed: true, guardrails_md: 'Be careful.' }).where('id', '=', 'p1').execute();
    const repoId = await insertProjectRepo('p1', { id: 'r1', name: 'web', git_url: 'https://github.com/acme/web.git', verify_command: 'pnpm test' });
    await testDb.insertInto('project_guardrails').values({ id: 'g1', project_id: 'p1', title: 'No force push', body_md: 'Never.' }).execute();
    await testDb
        .insertInto('project_guardrail_scripts')
        .values({ id: 's1', project_id: 'p1', name: 'lint', body_sh: 'pnpm lint', body_ps1: 'pnpm lint' })
        .execute();
    await testDb.insertInto('project_env_vars').values({ id: 'e1', project_id: 'p1', key: 'API_KEY', value_encrypted: 'SECRET-CIPHERTEXT' } as never).execute();
    const wf = await workflowsService.create({ name: 'Delivery', project_id: 'p1', graph: graph('agent-coder') });
    await testDb
        .insertInto('jira_sources')
        .values({ project_id: 'p1', jql: 'assignee = currentUser()', workflow_id: wf.id, repo_ids: JSON.stringify([repoId]) })
        .execute();
    return { workflowId: wf.id };
}

beforeEach(async () => {
    await truncateAll();
    rmSync(teamConfigDir(), { recursive: true, force: true });
});

afterAll(async () => {
    await closeTestDb();
    rmSync(dataDir, { recursive: true, force: true });
});

describe('team config export', () => {
    it('writes the project, its workflows and agents, and is stable across runs', async () => {
        const { workflowId } = await seedPublisher();
        await teamConfig.exportToFiles();
        const first = snapshot();
        expect(Object.keys(first).sort()).toEqual([
            'README.md',
            'agents/agent-coder/agent.json',
            'agents/agent-coder/prompt.md',
            'projects/ATL/HELP.md',
            'projects/ATL/project.json',
            `projects/ATL/workflows/${workflowId}.json`,
        ]);
        const project = JSON.parse(first['projects/ATL/project.json'] ?? '{}');
        expect(project).toMatchObject({
            id: 'p1',
            guardrails_md: 'Be careful.',
            repos: [{ id: 'r1', name: 'web', verify_command: 'pnpm test' }],
            jira_sources: [{ jql: 'assignee = currentUser()', workflow_id: workflowId, repo_ids: ['r1'] }],
        });

        await teamConfig.exportToFiles();
        expect(snapshot()).toEqual(first);
    });

    it('never writes secrets or machine-local fields', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        const all = Object.values(snapshot()).join('\n');
        expect(all).not.toMatch(/_encrypted|SECRET-CIPHERTEXT|API_KEY|git_path|credential_id/);
    });

    it('leaves README.md and HELP.md as the lead edited them', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        const { writeFileSync } = await import('node:fs');
        writeFileSync(join(teamConfigDir(), 'projects/ATL/HELP.md'), 'Ask Sam for VPN access.');
        await teamConfig.exportToFiles();
        expect(readFileSync(join(teamConfigDir(), 'projects/ATL/HELP.md'), 'utf8')).toBe('Ask Sam for VPN access.');
    });
});

describe('team config import', () => {
    it('recreates the project on an empty machine and marks it team-managed', async () => {
        const { workflowId } = await seedPublisher();
        await teamConfig.exportToFiles();
        await truncateAll();
        const workspace = mkdtempSync(join(tmpdir(), 'atlas-ws-'));
        await testDb.updateTable('settings').set({ workspace_path: workspace }).where('id', '=', 1).execute();
        // Something of my own that a pull must not touch.
        await insertAgent({ id: 'my-agent', prompt_md: 'Mine.' });

        const report = await teamConfig.importFromFiles(SUBSCRIBER);

        expect(report).toEqual({ problems: [], info: [] });
        const project = await testDb.selectFrom('projects').selectAll().where('id', '=', 'p1').executeTakeFirstOrThrow();
        expect(project).toMatchObject({ issue_key_prefix: 'ATL', guardrails_md: 'Be careful.', team_managed: true });
        const repo = await testDb.selectFrom('project_repos').selectAll().where('id', '=', 'r1').executeTakeFirstOrThrow();
        // No credential to clone with yet, so it waits.
        expect(repo).toMatchObject({ name: 'web', verify_command: 'pnpm test', clone_status: 'pending', credential_id: null });
        expect(repo.git_path.startsWith(workspace)).toBe(true);
        const wf = await workflowsService.get(workflowId);
        expect(wf).toMatchObject({ name: 'Delivery', project_id: 'p1', team_managed: true });
        const agent = await testDb.selectFrom('agents').selectAll().where('id', '=', 'agent-coder').executeTakeFirstOrThrow();
        expect(agent).toMatchObject({ prompt_md: 'Write the code.', team_managed: true });
        expect(await testDb.selectFrom('jira_sources').select(['jql', 'workflow_id']).execute()).toEqual([
            { jql: 'assignee = currentUser()', workflow_id: workflowId },
        ]);
        expect(await testDb.selectFrom('project_guardrails').select('id').execute()).toEqual([{ id: 'g1' }]);
        expect(await testDb.selectFrom('project_env_vars').select('key').execute()).toEqual([]);
        expect(await testDb.selectFrom('agents').select(['id', 'team_managed']).where('id', '=', 'my-agent').execute()).toEqual([
            { id: 'my-agent', team_managed: false },
        ]);
        rmSync(workspace, { recursive: true, force: true });
    });

    it('overwrites local edits and removes what left the repo, but keeps my own items', async () => {
        const { workflowId } = await seedPublisher();
        await teamConfig.exportToFiles();
        await teamConfig.importFromFiles(SUBSCRIBER);
        await insertAgent({ id: 'my-agent', prompt_md: 'Mine.' });
        await testDb.updateTable('projects').set({ guardrails_md: 'edited locally' }).where('id', '=', 'p1').execute();

        // The publisher drops the workflow; its agent goes with it.
        rmSync(join(teamConfigDir(), 'projects/ATL/workflows', `${workflowId}.json`));
        rmSync(join(teamConfigDir(), 'agents'), { recursive: true });
        await teamConfig.importFromFiles(SUBSCRIBER);

        expect((await testDb.selectFrom('projects').select('guardrails_md').where('id', '=', 'p1').executeTakeFirstOrThrow()).guardrails_md).toBe(
            'Be careful.'
        );
        expect(await workflowsService.get(workflowId)).toBeNull();
        expect((await testDb.selectFrom('agents').select('id').execute()).map((a) => a.id)).toEqual(['my-agent']);
    });

    it('detaches, not deletes, a project that left the repo', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        await teamConfig.importFromFiles(SUBSCRIBER);
        rmSync(join(teamConfigDir(), 'projects'), { recursive: true });

        const { problems, info } = await teamConfig.importFromFiles(SUBSCRIBER);

        expect(problems).toEqual([]);
        expect(info.join()).toMatch(/left the team config/);
        expect(await testDb.selectFrom('projects').select(['id', 'team_managed']).execute()).toEqual([{ id: 'p1', team_managed: false }]);
    });

    it('refuses a project whose key is taken by one of my own', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        await truncateAll();
        await insertProject('mine', 'ATL', { no_repo: true });

        const { problems } = await teamConfig.importFromFiles(SUBSCRIBER);

        expect(problems.join()).toMatch(/already uses this key/);
        expect(await testDb.selectFrom('projects').select('id').execute()).toEqual([{ id: 'mine' }]);
    });
});

describe('team config sync over git', () => {
    it('publishes to the repo and a fresh machine pulls the same project', async () => {
        const remote = mkdtempSync(join(tmpdir(), 'atlas-remote-'));
        execFileSync('git', ['init', '-q', '--bare', remote]);
        const credential = {
            id: 'c1',
            label: 'mine',
            kind: 'pat',
            username: 'x-access-token',
            token_encrypted: encrypt('tok'),
            token_fingerprint: 'tok',
        };
        // A file URL takes no credentials, so the same code path runs without a server.
        const connect = async (role: 'publisher' | 'subscriber') => {
            await testDb.insertInto('credentials').values(credential as never).onConflict((oc) => oc.doNothing()).execute();
            await teamConfig.saveConfig({ role, repo_url: `file://${remote}`, credential_id: 'c1' });
        };

        const { workflowId } = await seedPublisher();
        await connect('publisher');
        expect(await teamConfig.syncNow()).toMatch(/^Published [0-9a-f]{7}$/);
        expect(await teamConfig.syncNow()).toBe('Up to date');
        expect(execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' })).toContain(
            `projects/ATL/workflows/${workflowId}.json`
        );

        await truncateAll();
        rmSync(teamConfigDir(), { recursive: true, force: true });
        await connect('subscriber');
        await teamConfig.syncNow();

        expect(await testDb.selectFrom('projects').select(['id', 'team_managed']).execute()).toEqual([{ id: 'p1', team_managed: true }]);
        expect(await workflowsService.get(workflowId)).toMatchObject({ team_managed: true });
        expect((await teamConfig.getConfig()).last_commit).toMatch(/^[0-9a-f]{40}$/);
        expect((await teamConfig.help()).projects).toEqual([{ issue_key_prefix: 'ATL', help_md: expect.stringContaining('# Atlas') }]);
        rmSync(remote, { recursive: true, force: true });
    });
});

// ── Shared git fixtures ─────────────────────────────────────────────────────

/** A bare repo to publish to; a file URL takes no credentials, so no server is needed. */
function bareRepo(): string {
    const remote = mkdtempSync(join(tmpdir(), 'atlas-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    return remote;
}

/** A normal repo with one commit, standing in for a team project's code repo. */
function codeRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'atlas-code-'));
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'README.md'), '# app');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
    return repo;
}

async function connect(role: 'publisher' | 'subscriber', remote: string): Promise<void> {
    await testDb
        .insertInto('credentials')
        .values({ id: 'c1', label: 'mine', kind: 'pat', username: 'x-access-token', token_encrypted: encrypt('tok'), token_fingerprint: 'tok' } as never)
        .onConflict((oc) => oc.doNothing())
        .execute();
    await teamConfig.saveConfig({ role, repo_url: `file://${remote}`, credential_id: 'c1' });
}

/** Publishes the seeded project, then turns this database into a fresh subscriber. */
async function publishThenBecomeSubscriber(remote: string): Promise<{ workflowId: string }> {
    const seeded = await seedPublisher();
    await connect('publisher', remote);
    await teamConfig.syncNow();
    await truncateAll();
    rmSync(teamConfigDir(), { recursive: true, force: true });
    await connect('subscriber', remote);
    return seeded;
}

async function waitFor(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
    const until = Date.now() + ms;
    while (!(await check())) {
        if (Date.now() > until) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 100));
    }
}

describe('team config publishing', () => {
    it('reports the git host when it rejects the push, and records the failure', async () => {
        const remote = bareRepo();
        // What a protected branch looks like from the client: the host refuses the update.
        writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho "protected branch: changes need a pull request" >&2\nexit 1\n');
        chmodSync(join(remote, 'hooks', 'pre-receive'), 0o755);
        await seedPublisher();
        await connect('publisher', remote);

        await expect(teamConfig.syncNow()).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/protected branch/) });
        expect(await teamConfig.getConfig()).toMatchObject({ last_sync_ok: false, last_sync_message: expect.stringMatching(/protected branch/) });
        rmSync(remote, { recursive: true, force: true });
    });

    it('publishes on the minute tick only when something changed', async () => {
        const remote = bareRepo();
        await seedPublisher();
        await connect('publisher', remote);
        const commits = () => Number(execFileSync('git', ['--git-dir', remote, 'rev-list', '--count', 'main'], { encoding: 'utf8' }).trim());

        // Never synced, so the first tick is due: a full publish.
        await teamConfig.tick(new Date());
        expect(commits()).toBe(1);
        // Not due and nothing changed: no commit.
        await teamConfig.tick(new Date());
        expect(commits()).toBe(1);
        // Not due, but an edit: published within the minute.
        await testDb.updateTable('projects').set({ guardrails_md: 'Changed' }).where('id', '=', 'p1').execute();
        await teamConfig.tick(new Date());
        expect(commits()).toBe(2);
        rmSync(remote, { recursive: true, force: true });
    });

    it('does nothing while the role is off or the connection is incomplete', async () => {
        await seedPublisher();
        await teamConfig.tick(new Date());
        await teamConfig.saveConfig({ role: 'publisher', repo_url: 'https://github.com/acme/team.git' });
        await teamConfig.tick(new Date());
        expect(existsSync(teamConfigDir())).toBe(false);
        expect((await teamConfig.getConfig()).last_sync_at).toBeNull();
    });
});

describe('team config pulling', () => {
    it('pulls on the tick only once the interval has passed', async () => {
        const remote = bareRepo();
        await publishThenBecomeSubscriber(remote);
        await testDb.updateTable('team_config').set({ last_sync_at: new Date().toISOString() }).execute();

        await teamConfig.tick(new Date());
        expect(await testDb.selectFrom('projects').select('id').execute()).toEqual([]);

        await teamConfig.tick(new Date(Date.now() + 61 * 60_000));
        expect(await testDb.selectFrom('projects').select('id').execute()).toEqual([{ id: 'p1' }]);
        rmSync(remote, { recursive: true, force: true });
    });

    it('says so when the branch has nothing published yet', async () => {
        const remote = bareRepo();
        await connect('subscriber', remote);
        expect(await teamConfig.syncNow()).toBe('Nothing published yet');
        expect(await teamConfig.getConfig()).toMatchObject({ last_sync_ok: true, last_sync_message: expect.stringMatching(/waiting for the publisher/) });
        rmSync(remote, { recursive: true, force: true });
    });

    it('reports a repo it cannot reach as a 502 from the git host', async () => {
        await connect('subscriber', join(tmpdir(), 'atlas-no-such-repo'));
        await expect(teamConfig.syncNow()).rejects.toMatchObject({ status: 502 });
        expect((await teamConfig.getConfig()).last_sync_ok).toBe(false);
    });

    it('clones a team repo this machine lacks, with my own credential', async () => {
        const remote = bareRepo();
        const code = codeRepo();
        await seedPublisher();
        await testDb.updateTable('project_repos').set({ git_url: `file://${code}` }).where('id', '=', 'r1').execute();
        await connect('publisher', remote);
        await teamConfig.syncNow();
        await truncateAll();
        rmSync(teamConfigDir(), { recursive: true, force: true });
        const workspace = mkdtempSync(join(tmpdir(), 'atlas-ws-'));
        await testDb.updateTable('settings').set({ workspace_path: workspace }).where('id', '=', 1).execute();
        await connect('subscriber', remote);

        await teamConfig.syncNow();

        const repo = () => testDb.selectFrom('project_repos').selectAll().where('id', '=', 'r1').executeTakeFirstOrThrow();
        expect(await repo()).toMatchObject({ credential_id: 'c1' });
        await waitFor(async () => (await repo()).clone_status === 'ready');
        expect(existsSync(join((await repo()).git_path, 'README.md'))).toBe(true);
        rmSync(remote, { recursive: true, force: true });
        rmSync(code, { recursive: true, force: true });
        rmSync(workspace, { recursive: true, force: true });
    });

    it('asks for a workspace folder before it can place a team repo', async () => {
        const remote = bareRepo();
        await publishThenBecomeSubscriber(remote);
        await teamConfig.syncNow();
        const cfg = await teamConfig.getConfig();
        expect(cfg.last_sync_ok).toBe(false);
        expect(cfg.last_sync_message).toMatch(/ATL\/web: set a workspace folder/);
        rmSync(remote, { recursive: true, force: true });
    });

    it('keeps my pause on a team workflow and makes no new prompt versions when nothing changed', async () => {
        const remote = bareRepo();
        const { workflowId } = await publishThenBecomeSubscriber(remote);
        await teamConfig.syncNow();
        await testDb.updateTable('workflows').set({ status: 'inactive' }).where('id', '=', workflowId).execute();
        const versions = () => testDb.selectFrom('agent_prompt_versions').select(({ fn }) => fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
        const before = await versions();

        await teamConfig.syncNow();

        expect((await workflowsService.get(workflowId))?.status).toBe('inactive');
        expect(await versions()).toEqual(before);
        rmSync(remote, { recursive: true, force: true });
    });

    it('takes over a same-named agent of mine and says so, without failing the sync', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        await truncateAll();
        await testDb.updateTable('settings').set({ workspace_path: tmpdir() }).where('id', '=', 1).execute();
        await insertAgent({ id: 'agent-coder', prompt_md: 'My local coder.' });

        const { problems, info } = await teamConfig.importFromFiles(SUBSCRIBER);

        expect(problems).toEqual([]);
        expect(info).toEqual([expect.stringMatching(/is now team-managed/)]);
        const agent = await testDb.selectFrom('agents').select(['prompt_md', 'team_managed']).where('id', '=', 'agent-coder').executeTakeFirstOrThrow();
        expect(agent).toEqual({ prompt_md: 'Write the code.', team_managed: true });
    });

    it('keeps a dropped agent that one of my own workflows still uses, as mine', async () => {
        const { workflowId } = await seedPublisher();
        await teamConfig.exportToFiles();
        await teamConfig.importFromFiles(SUBSCRIBER);
        await workflowsService.create({ name: 'Mine', project_id: 'p1', graph: graph('agent-coder') });
        rmSync(join(teamConfigDir(), 'projects/ATL/workflows', `${workflowId}.json`));
        rmSync(join(teamConfigDir(), 'agents'), { recursive: true });

        await teamConfig.importFromFiles(SUBSCRIBER);

        expect(await testDb.selectFrom('agents').select(['id', 'team_managed']).execute()).toEqual([{ id: 'agent-coder', team_managed: false }]);
    });

    it('removes a team repo the publisher dropped', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        await teamConfig.importFromFiles(SUBSCRIBER);
        const file = join(teamConfigDir(), 'projects/ATL/project.json');
        const project = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...project, repos: [], jira_sources: [] }));

        await teamConfig.importFromFiles(SUBSCRIBER);

        expect(await testDb.selectFrom('project_repos').select('id').execute()).toEqual([]);
    });

    it('rejects a file from a newer Atlas instead of guessing', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        await truncateAll();
        const file = join(teamConfigDir(), 'projects/ATL/project.json');
        writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), format_version: 99 }));

        const { problems } = await teamConfig.importFromFiles(SUBSCRIBER);

        expect(problems.join()).toMatch(/format_version/);
        expect(await testDb.selectFrom('projects').select('id').execute()).toEqual([]);
    });
});

describe('team config edge cases', () => {
    it('carries an agent\'s checklist across', async () => {
        await seedPublisher();
        await testDb.insertInto('agent_checklists').values({ agent_id: 'agent-coder', label: 'Tests pass', sort_order: 0, required: true } as never).execute();
        await teamConfig.exportToFiles();
        await truncateAll();
        await teamConfig.importFromFiles(SUBSCRIBER);
        expect(await testDb.selectFrom('agent_checklists').select(['label', 'required']).execute()).toEqual([{ label: 'Tests pass', required: true }]);
    });

    it('reports a team agent whose model this machine does not have, and the workflow that needs it', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        await truncateAll();
        const file = join(teamConfigDir(), 'agents/agent-coder/agent.json');
        writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), model: 'no-such-model' }));

        const { problems } = await teamConfig.importFromFiles(SUBSCRIBER);

        expect(problems.join('\n')).toMatch(/Agent agent-coder: .*no-such-model/s);
        expect(problems.join('\n')).toMatch(/Workflow "Delivery"/);
    });

    it('keeps a dropped workflow that is still running, and says why', async () => {
        const { workflowId } = await seedPublisher();
        await teamConfig.exportToFiles();
        await teamConfig.importFromFiles(SUBSCRIBER);
        await testDb
            .insertInto('workflow_runs')
            .values({ id: 'run-1', workflow_id: workflowId, graph_snapshot: JSON.stringify(graph('agent-coder')), status: 'running' } as never)
            .execute();
        rmSync(join(teamConfigDir(), 'projects/ATL/workflows', `${workflowId}.json`));

        const { problems } = await teamConfig.importFromFiles(SUBSCRIBER);

        expect(problems.join()).toMatch(/Workflow "Delivery" not removed: .*live runs/);
        expect(await workflowsService.get(workflowId)).not.toBeNull();
    });

    it('drops a Jira query whose repos are all gone', async () => {
        await seedPublisher();
        await teamConfig.exportToFiles();
        const file = join(teamConfigDir(), 'projects/ATL/project.json');
        const project = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...project, jira_sources: [{ ...project.jira_sources[0], repo_ids: ['gone'] }] }));

        await teamConfig.importFromFiles(SUBSCRIBER);

        expect(await testDb.selectFrom('jira_sources').select('id').execute()).toEqual([]);
    });

    it('asks for another credential when the chosen one was deleted', async () => {
        const remote = bareRepo();
        await connect('subscriber', remote);
        // The FK clears the choice, so the tick goes quiet and Sync now asks for a new one.
        await testDb.deleteFrom('credentials').execute();
        expect((await teamConfig.getConfig()).credential_id).toBeNull();
        await expect(teamConfig.syncNow()).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Pick a credential/) });
        rmSync(remote, { recursive: true, force: true });
    });

    it('runs one sync at a time and lets the tick skip while one is going', async () => {
        const remote = bareRepo();
        await seedPublisher();
        await connect('publisher', remote);

        const [a, b] = await Promise.all([teamConfig.syncNow(), teamConfig.syncNow(), teamConfig.tick(new Date())]);

        expect([a, b].sort()).toEqual([expect.stringMatching(/^Published/), 'Up to date'].sort());
        expect(execFileSync('git', ['--git-dir', remote, 'rev-list', '--count', 'main'], { encoding: 'utf8' }).trim()).toBe('1');
        rmSync(remote, { recursive: true, force: true });
    });
});
