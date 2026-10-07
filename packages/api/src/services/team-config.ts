// Team config sync: a git repo that holds the configuration of the projects a
// lead publishes, so a teammate (or the Owner on a new laptop) pulls it instead
// of rebuilding it by hand.
//
//   README.md                              team help guide (written once, then the lead's)
//   projects/<PREFIX>/project.json         project, repos, guardrails, scripts, Jira queries
//   projects/<PREFIX>/HELP.md              per-project help (written once, then the lead's)
//   projects/<PREFIX>/workflows/<id>.json  each of the project's workflows
//   agents/<id>/agent.json + prompt.md     every agent those workflows use
//
// Secrets never go in: no credentials, no env values, no Jira token, and no
// machine-local fields (repo paths, credential ids, agent memory).
//
// A publisher exports DB → files → commit → push. A subscriber fetches and
// imports files → DB, marking what it writes `team_managed`; the next pull
// overwrites local edits to those rows and never touches anything else.
// Ids travel with the rows, so graph, Jira and default-workflow references
// resolve unchanged on every machine.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sql } from 'kysely';
import { z } from 'zod';
import type { ITeamConfig, ITeamConfigHelp, IWorkflowGraph } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';
import { AgentBundleManifestSchema } from './agent-bundle.js';
import { agentsService } from './agents.js';
import { injectToken, startClone } from './clone-runner.js';
import { credentialsService } from './credentials.js';
import { dataDir } from './crypto.js';
import { gitInvokeEnv } from './git-env.js';
import { projectReposService } from './project-repos.js';
import { settingsService } from './settings.js';
import { PortableWorkflowSchema } from './workflow-bundle.js';
import { workflowsService } from './workflows.js';

const execFileP = promisify(execFile);

/** Bump when the layout changes in a way an older Atlas can't read. */
const FORMAT = 1;

export function teamConfigDir(): string {
    return join(dataDir(), 'team-config');
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ── Repo file schemas ───────────────────────────────────────────────────────

const ProjectFileSchema = z.object({
    format_version: z.number().int().min(1).max(FORMAT),
    id: z.string().min(1),
    name: z.string().min(1),
    issue_key_prefix: z.string().regex(/^[A-Z]{3}$/),
    description: z.string(),
    status: z.string().min(1),
    guardrails_md: z.string(),
    default_workflow_id: z.string().nullable(),
    repos: z.array(
        z.object({
            id: z.string().min(1),
            name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
            git_url: z.string().url(),
            default_branch: z.string().min(1),
            setup_sh_body: z.string(),
            setup_ps1_body: z.string(),
            verify_command: z.string(),
            position: z.number().int(),
        })
    ),
    guardrails: z.array(
        z.object({
            id: z.string().min(1),
            title: z.string(),
            body_md: z.string(),
            icon: z.string(),
            enabled: z.number().int().min(0).max(1),
            sort_order: z.number().int(),
        })
    ),
    guardrail_scripts: z.array(
        z.object({
            id: z.string().min(1),
            name: z.string(),
            description: z.string(),
            body_sh: z.string(),
            body_ps1: z.string(),
            sort_order: z.number().int(),
        })
    ),
    jira_sources: z.array(
        z.object({ jql: z.string().min(1), workflow_id: z.string().nullable(), repo_ids: z.array(z.string()) })
    ),
});
type ProjectFile = z.infer<typeof ProjectFileSchema>;

const WorkflowFileSchema = PortableWorkflowSchema.extend({
    id: z.string().min(1),
    // Applied when the workflow first arrives; after that pausing it stays a
    // local choice, so a teammate can switch off a schedule they don't want.
    status: z.enum(['active', 'inactive']),
});
type WorkflowFile = z.infer<typeof WorkflowFileSchema>;

const AgentFileSchema = AgentBundleManifestSchema.omit({
    status: true,
    summary: true,
    version: true,
    published_at: true,
}).extend({
    checklists: z.array(z.object({ label: z.string(), sort_order: z.number().int(), required: z.boolean() })),
});
type AgentFile = z.infer<typeof AgentFileSchema>;

const DEFAULT_README = `# Team config

Atlas keeps this repo in sync. Each project folder holds what a teammate needs to
work on it: repos, guardrails, scripts, Jira queries, workflows and agents.

**Not in here:** secrets. Add your own GitHub credential, Jira token and project
\`.env\` secrets on your machine (Project → Manage .env secrets → Import).

**Don't edit team-managed items in Atlas** — the next sync overwrites them.
Make your own agents or workflows instead; those are never touched.

**Writing Jira queries:** use \`assignee = currentUser()\`, not a name. Jira
resolves it against each person's own token, so "assigned to me" means you.
`;

const defaultHelp = (name: string) => `# ${name}

Notes for teammates: which secrets this project needs, how to get access, anything
to set up before the first run. Edit this file in the team config repo.
`;

// ── Config row ──────────────────────────────────────────────────────────────

async function loadRow() {
    return db.selectFrom('team_config').selectAll().where('id', '=', 1).executeTakeFirst();
}

async function getConfig(): Promise<ITeamConfig> {
    const row = await loadRow();
    return {
        role: row?.role ?? 'off',
        repo_url: row?.repo_url ?? null,
        credential_id: row?.credential_id ?? null,
        branch: row?.branch ?? 'main',
        interval_minutes: row?.interval_minutes ?? 60,
        last_sync_at: row?.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
        last_sync_ok: row?.last_sync_ok ?? null,
        last_sync_message: row?.last_sync_message ?? null,
        last_commit: row?.last_commit ?? null,
    };
}

async function saveConfig(patch: {
    role?: ITeamConfig['role'] | undefined;
    repo_url?: string | null | undefined;
    credential_id?: string | null | undefined;
    branch?: string | undefined;
    interval_minutes?: number | undefined;
}): Promise<ITeamConfig> {
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (patch.credential_id && !(await credentialsService.get(patch.credential_id))) {
        throw new ApiError('validation_error', 'Credential not found', 400);
    }
    const before = await getConfig();
    await db
        .insertInto('team_config')
        .values({ id: 1, ...values })
        .onConflict((oc) => oc.column('id').doUpdateSet({ ...values, updated_at: sql<string>`now()` }))
        .execute();
    // Another repo or branch is another history; the old clone would push its
    // commits there or reset onto the wrong tree.
    if ((patch.repo_url !== undefined && patch.repo_url !== before.repo_url) || (patch.branch !== undefined && patch.branch !== before.branch)) {
        await rm(teamConfigDir(), { recursive: true, force: true });
        await db.updateTable('team_config').set({ last_commit: null }).where('id', '=', 1).execute();
    }
    return getConfig();
}

async function recordSync(ok: boolean, message: string, commit?: string | null): Promise<void> {
    await db
        .updateTable('team_config')
        .set({
            last_sync_at: new Date().toISOString(),
            last_sync_ok: ok,
            last_sync_message: message.slice(0, 2_000),
            ...(commit !== undefined ? { last_commit: commit } : {}),
        })
        .where('id', '=', 1)
        .execute();
}

// ── Git ─────────────────────────────────────────────────────────────────────

interface Remote {
    url: string;
    redact: (s: string) => string;
}

async function remoteFor(cfg: ITeamConfig): Promise<Remote> {
    if (!cfg.repo_url) throw new ApiError('validation_error', 'Set the team config repo URL first', 400);
    if (!cfg.credential_id) throw new ApiError('validation_error', 'Pick a credential for the team config repo', 400);
    const cred = await credentialsService.get(cfg.credential_id);
    if (!cred) throw new ApiError('validation_error', 'The team config credential was deleted; pick another', 400);
    const token = await credentialsService.getToken(cfg.credential_id);
    const encoded = encodeURIComponent(token);
    return {
        url: injectToken(cfg.repo_url, cred.username, token),
        redact: (s) => s.split(token).join('***').split(encoded).join('***'),
    };
}

async function git(args: string[], remote?: Remote): Promise<string> {
    try {
        // Auth lives in the URL; `credential.helper=` keeps OS helpers from
        // racing it or popping a prompt (same as clone-runner).
        const { stdout } = await execFileP('git', ['-c', 'credential.helper=', ...args], {
            cwd: teamConfigDir(),
            env: gitInvokeEnv(null),
            maxBuffer: 16 * 1024 * 1024,
            windowsHide: true,
        });
        return stdout.trim();
    } catch (err) {
        const e = err as { stderr?: string; message: string };
        const text = (e.stderr?.trim() || e.message).slice(0, 1_000);
        // With a remote it's the git host talking (not found, no access,
        // rejected push), not a fault in Atlas.
        if (remote) throw new ApiError('upstream_unavailable', remote.redact(text), 502);
        throw new Error(text);
    }
}

/** Brings the local clone to the remote branch. False when the branch doesn't exist yet. */
async function fetchAndReset(cfg: ITeamConfig, remote: Remote): Promise<boolean> {
    const dir = teamConfigDir();
    if (!existsSync(join(dir, '.git'))) {
        await mkdir(dir, { recursive: true });
        await git(['init', '-q']);
    }
    try {
        await git(['fetch', '-q', '--depth', '1', remote.url, cfg.branch], remote);
    } catch (err) {
        // An empty repo, or a branch the publisher hasn't pushed yet.
        if (/couldn't find remote ref/i.test(errMsg(err))) return false;
        throw err;
    }
    // The clone is a cache of the remote: nothing local is worth keeping.
    await git(['checkout', '-q', '-B', cfg.branch, 'FETCH_HEAD']);
    await git(['reset', '-q', '--hard', 'FETCH_HEAD']);
    await git(['clean', '-qfd']);
    return true;
}

// ── Export (publisher) ──────────────────────────────────────────────────────

function agentIdsIn(graphs: IWorkflowGraph[]): string[] {
    return [...new Set(graphs.flatMap((g) => g.nodes.flatMap((n) => (n.agent_id ? [n.agent_id] : []))))].sort();
}

async function exportProject(p: { id: string }): Promise<{ file: ProjectFile; workflows: WorkflowFile[] }> {
    const project = await db.selectFrom('projects').selectAll().where('id', '=', p.id).executeTakeFirstOrThrow();
    const [repos, guardrails, scripts, sources, wfs] = await Promise.all([
        db.selectFrom('project_repos').selectAll().where('project_id', '=', p.id).orderBy('position').orderBy('id').execute(),
        db.selectFrom('project_guardrails').selectAll().where('project_id', '=', p.id).orderBy('sort_order').orderBy('id').execute(),
        db.selectFrom('project_guardrail_scripts').selectAll().where('project_id', '=', p.id).orderBy('sort_order').orderBy('id').execute(),
        db.selectFrom('jira_sources').selectAll().where('project_id', '=', p.id).orderBy('id').execute(),
        workflowsService.list(p.id),
    ]);
    const file: ProjectFile = {
        format_version: FORMAT,
        id: project.id,
        name: project.name,
        issue_key_prefix: project.issue_key_prefix,
        description: project.description,
        status: project.status,
        guardrails_md: project.guardrails_md,
        default_workflow_id: project.default_workflow_id,
        repos: repos.map((r) => ({
            id: r.id,
            name: r.name,
            git_url: r.git_url,
            default_branch: r.default_branch,
            setup_sh_body: r.setup_sh_body,
            setup_ps1_body: r.setup_ps1_body,
            verify_command: r.verify_command,
            position: r.position,
        })),
        guardrails: guardrails.map((g) => ({
            id: g.id,
            title: g.title,
            body_md: g.body_md,
            icon: g.icon,
            enabled: g.enabled,
            sort_order: g.sort_order,
        })),
        guardrail_scripts: scripts.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            body_sh: s.body_sh,
            body_ps1: s.body_ps1,
            sort_order: s.sort_order,
        })),
        jira_sources: sources.map((s) => ({ jql: s.jql, workflow_id: s.workflow_id, repo_ids: s.repo_ids })),
    };
    const workflows = wfs.map((w) => ({ ...PortableWorkflowSchema.parse(w), id: w.id, status: w.status }));
    return { file, workflows };
}

async function exportAgent(id: string): Promise<{ file: AgentFile; prompt_md: string } | null> {
    const agent = await agentsService.get(id);
    if (!agent) return null;
    const checklists = await agentsService.getChecklists(id);
    // Memory is learned per machine from that machine's runs, so it stays out.
    const file = AgentFileSchema.parse({
        ...agent,
        checklists: checklists.map((c) => ({ label: c.label, sort_order: c.sort_order, required: c.required })),
    });
    return { file, prompt_md: agent.prompt_md };
}

/** Rewrites every generated file from the DB. Leaves README.md and HELP.md alone. */
async function exportToFiles(): Promise<void> {
    const dir = teamConfigDir();
    const projects = await db.selectFrom('projects').select(['id', 'name', 'issue_key_prefix']).where('team_managed', '=', true).execute();
    const keep = new Set(projects.map((p) => p.issue_key_prefix));
    const projectsDir = join(dir, 'projects');
    await mkdir(projectsDir, { recursive: true });
    for (const name of await readdir(projectsDir)) {
        await rm(join(projectsDir, name, ...(keep.has(name) ? ['workflows'] : [])), { recursive: true, force: true });
    }
    await rm(join(dir, 'agents'), { recursive: true, force: true });
    if (!existsSync(join(dir, 'README.md'))) await writeFile(join(dir, 'README.md'), DEFAULT_README);

    const graphs: IWorkflowGraph[] = [];
    for (const p of projects) {
        const { file, workflows } = await exportProject(p);
        const pDir = join(projectsDir, p.issue_key_prefix);
        await mkdir(join(pDir, 'workflows'), { recursive: true });
        await writeFile(join(pDir, 'project.json'), json(file));
        if (!existsSync(join(pDir, 'HELP.md'))) await writeFile(join(pDir, 'HELP.md'), defaultHelp(p.name));
        for (const w of workflows) {
            await writeFile(join(pDir, 'workflows', `${w.id}.json`), json(w));
            graphs.push(w.graph);
        }
    }
    for (const id of agentIdsIn(graphs)) {
        const agent = await exportAgent(id);
        if (!agent) continue;
        const aDir = join(dir, 'agents', id);
        await mkdir(aDir, { recursive: true });
        await writeFile(join(aDir, 'agent.json'), json(agent.file));
        await writeFile(join(aDir, 'prompt.md'), agent.prompt_md);
    }
}

async function publish(): Promise<string> {
    const cfg = await getConfig();
    const remote = await remoteFor(cfg);
    try {
        await fetchAndReset(cfg, remote);
        await exportToFiles();
        await git(['add', '-A']);
        if ((await git(['status', '--porcelain'])) === '') {
            const head = await git(['rev-parse', '--verify', '-q', 'HEAD']).catch(() => null);
            await recordSync(true, 'Up to date', head);
            return 'Up to date';
        }
        const settings = await settingsService.get();
        await git([
            '-c', `user.name=${settings.owner_name || 'Atlas'}`,
            '-c', 'user.email=atlas@localhost',
            'commit', '-q', '-m', 'Update team config from Atlas',
        ]);
        // A rejected push (someone else pushed) is retried by the next tick,
        // which resets onto their commit and re-exports on top.
        await git(['push', '-q', remote.url, `HEAD:${cfg.branch}`], remote);
        const head = await git(['rev-parse', 'HEAD']);
        await recordSync(true, `Published ${head.slice(0, 7)}`, head);
        return `Published ${head.slice(0, 7)}`;
    } catch (err) {
        await recordSync(false, errMsg(err));
        throw err;
    }
}

/** Between intervals: publish only when the export differs from the last commit. */
async function publishIfChanged(): Promise<void> {
    if (!existsSync(join(teamConfigDir(), '.git'))) return;
    await exportToFiles();
    if ((await git(['status', '--porcelain'])) !== '') await publish();
}

// ── Import (subscriber) ─────────────────────────────────────────────────────

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    const res = schema.safeParse(raw);
    if (!res.success) throw new Error(`${path}: ${res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return res.data;
}

async function listDirs(path: string): Promise<string[]> {
    if (!existsSync(path)) return [];
    return (await readdir(path, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
}

async function importAgent(id: string, report: SyncReport): Promise<void> {
    const aDir = join(teamConfigDir(), 'agents', id);
    const file = await readJson(join(aDir, 'agent.json'), AgentFileSchema);
    const prompt_md = existsSync(join(aDir, 'prompt.md')) ? await readFile(join(aDir, 'prompt.md'), 'utf8') : '';
    const { id: _id, checklists, ...fields } = file;
    const local = await agentsService.get(id);
    if (!local) {
        await agentsService.create({ ...fields, id, prompt_md, status: 'active', checklists });
    } else {
        if (!local.team_managed) report.info.push(`Agent "${local.name}" is now team-managed`);
        // Only a changed prompt is passed: each one bumps the prompt version.
        await agentsService.update(id, { ...fields, ...(local.prompt_md !== prompt_md ? { prompt_md } : {}), checklists });
    }
    await db.updateTable('agents').set({ team_managed: true }).where('id', '=', id).execute();
}

// When each team repo's clone last started. The clone runner reports only
// over SSE, so a failed clone is retried once this has aged out.
/** What a pull couldn't apply, and what it changed that the Owner should know. */
interface SyncReport {
    problems: string[];
    info: string[];
}

const cloneStarted = new Map<string, number>();
const CLONE_RETRY_MS = 10 * 60_000;

async function cloneMissingRepo(cfg: ITeamConfig, project: ProjectFile, repo: { id: string; git_url: string; default_branch: string; git_path: string }): Promise<void> {
    if (!cfg.credential_id || Date.now() - (cloneStarted.get(repo.id) ?? 0) < CLONE_RETRY_MS) return;
    cloneStarted.set(repo.id, Date.now());
    await startClone(
        {
            repo_url: repo.git_url,
            credential_id: cfg.credential_id,
            project_name: project.name,
            issue_key_prefix: project.issue_key_prefix,
            default_branch: repo.default_branch,
            destination: repo.git_path,
        },
        async () => {
            await db.updateTable('project_repos').set({ clone_status: 'ready' }).where('id', '=', repo.id).execute();
            const registered = await projectReposService.get(repo.id);
            return registered ? { repo: registered } : {};
        }
    );
}

async function importProject(cfg: ITeamConfig, prefix: string, report: SyncReport): Promise<{ id: string; workflowIds: string[] }> {
    const pDir = join(teamConfigDir(), 'projects', prefix);
    const file = await readJson(join(pDir, 'project.json'), ProjectFileSchema);
    const workflows: WorkflowFile[] = [];
    for (const f of existsSync(join(pDir, 'workflows')) ? await readdir(join(pDir, 'workflows')) : []) {
        if (f.endsWith('.json')) workflows.push(await readJson(join(pDir, 'workflows', f), WorkflowFileSchema));
    }

    const clash = await db
        .selectFrom('projects')
        .select('name')
        .where('issue_key_prefix', '=', file.issue_key_prefix)
        .where('id', '!=', file.id)
        .executeTakeFirst();
    if (clash) throw new Error(`${file.issue_key_prefix}: your local project "${clash.name}" already uses this key`);

    const fields = { name: file.name, description: file.description, status: file.status, guardrails_md: file.guardrails_md };
    const exists = await db.selectFrom('projects').select('id').where('id', '=', file.id).executeTakeFirst();
    if (exists) {
        await db.updateTable('projects').set({ ...fields, team_managed: true }).where('id', '=', file.id).execute();
    } else {
        await db.transaction().execute(async (trx) => {
            await trx.insertInto('projects').values({ id: file.id, issue_key_prefix: file.issue_key_prefix, ...fields, team_managed: true }).execute();
            await trx.insertInto('project_issue_counters').values({ project_id: file.id, last_seq: 0 }).execute();
        });
    }

    // Repos: shared fields only. The path and credential are this machine's.
    const settings = await settingsService.get();
    const localRepos = await db.selectFrom('project_repos').selectAll().where('project_id', '=', file.id).execute();
    for (const r of file.repos) {
        const shared = {
            name: r.name,
            git_url: r.git_url,
            default_branch: r.default_branch,
            setup_sh_body: r.setup_sh_body,
            setup_ps1_body: r.setup_ps1_body,
            verify_command: r.verify_command,
            position: r.position,
        };
        const local = localRepos.find((l) => l.id === r.id);
        if (local) {
            await db.updateTable('project_repos').set(shared).where('id', '=', r.id).execute();
            if (local.clone_status === 'pending' && !existsSync(join(local.git_path, '.git'))) {
                await cloneMissingRepo(cfg, file, { ...r, git_path: local.git_path }).catch((err) => report.problems.push(`${r.name}: ${errMsg(err)}`));
            }
            continue;
        }
        if (!settings.workspace_path) {
            report.problems.push(`${file.issue_key_prefix}/${r.name}: set a workspace folder to clone it`);
            continue;
        }
        const git_path = join(settings.workspace_path, projectReposService.repoFolderName(file.name, r.name));
        const cloned = existsSync(join(git_path, '.git'));
        await db
            .insertInto('project_repos')
            .values({ id: r.id, project_id: file.id, ...shared, git_path, credential_id: cfg.credential_id, clone_status: cloned ? 'ready' : 'pending' })
            .execute();
        if (!cloned) await cloneMissingRepo(cfg, file, { ...r, git_path }).catch((err) => report.problems.push(`${r.name}: ${errMsg(err)}`));
    }
    for (const l of localRepos.filter((l) => !file.repos.some((r) => r.id === l.id))) {
        await projectReposService.remove(file.id, l.id).catch((err) => report.problems.push(`${l.name}: ${errMsg(err)}`));
    }

    // Guardrails and scripts of a team project belong wholly to the repo.
    await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('project_guardrails').where('project_id', '=', file.id).execute();
        if (file.guardrails.length > 0) {
            await trx.insertInto('project_guardrails').values(file.guardrails.map((g) => ({ ...g, project_id: file.id }))).execute();
        }
        await trx.deleteFrom('project_guardrail_scripts').where('project_id', '=', file.id).execute();
        if (file.guardrail_scripts.length > 0) {
            await trx.insertInto('project_guardrail_scripts').values(file.guardrail_scripts.map((s) => ({ ...s, project_id: file.id }))).execute();
        }
    });

    // Workflows: insert stubs first so graphs can point at sibling
    // sub-workflows in any order, then apply each through the service, which
    // validates the graph and works out the next scheduled fire.
    for (const w of workflows) {
        await db
            .insertInto('workflows')
            .values({ id: w.id, name: w.name, project_id: file.id, input_kind: w.input_kind, use_worktree: w.use_worktree ?? true, status: w.status, team_managed: true })
            .onConflict((oc) => oc.column('id').doUpdateSet({ team_managed: true }))
            .execute();
    }
    for (const w of workflows) {
        const { id, status: _status, ...portable } = w;
        await workflowsService.update(id, portable).catch((err) => report.problems.push(`Workflow "${w.name}": ${errMsg(err)}`));
    }
    const stale = await db
        .selectFrom('workflows')
        .select(['id', 'name'])
        .where('project_id', '=', file.id)
        .where('team_managed', '=', true)
        .execute();
    for (const s of stale.filter((s) => !workflows.some((w) => w.id === s.id))) {
        await workflowsService.remove(s.id).catch((err) => report.problems.push(`Workflow "${s.name}" not removed: ${errMsg(err)}`));
    }

    const repoIds = new Set(file.repos.map((r) => r.id));
    const wfIds = new Set(workflows.map((w) => w.id));
    await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('jira_sources').where('project_id', '=', file.id).execute();
        for (const s of file.jira_sources) {
            const repo_ids = s.repo_ids.filter((r) => repoIds.has(r));
            if (repo_ids.length === 0) continue;
            await trx
                .insertInto('jira_sources')
                .values({ project_id: file.id, jql: s.jql, workflow_id: s.workflow_id && wfIds.has(s.workflow_id) ? s.workflow_id : null, repo_ids: JSON.stringify(repo_ids) })
                .execute();
        }
        await trx
            .updateTable('projects')
            .set({ default_workflow_id: file.default_workflow_id && wfIds.has(file.default_workflow_id) ? file.default_workflow_id : null })
            .where('id', '=', file.id)
            .execute();
    });
    return { id: file.id, workflowIds: workflows.map((w) => w.id) };
}

async function importFromFiles(cfg: ITeamConfig): Promise<SyncReport> {
    const dir = teamConfigDir();
    const report: SyncReport = { problems: [], info: [] };

    // Agents before workflows: a graph is only valid when its agents exist.
    const agentIds = await listDirs(join(dir, 'agents'));
    for (const id of agentIds) await importAgent(id, report).catch((err) => report.problems.push(`Agent ${id}: ${errMsg(err)}`));

    const projectIds: string[] = [];
    for (const prefix of await listDirs(join(dir, 'projects'))) {
        if (!existsSync(join(dir, 'projects', prefix, 'project.json'))) continue;
        try {
            projectIds.push((await importProject(cfg, prefix, report)).id);
        } catch (err) {
            report.problems.push(errMsg(err));
        }
    }

    // A project dropped from the repo is detached, not deleted: deleting it
    // would take this machine's Tasks and their history with it.
    const dropped = await db
        .selectFrom('projects')
        .select(['id', 'name'])
        .where('team_managed', '=', true)
        .$if(projectIds.length > 0, (q) => q.where('id', 'not in', projectIds))
        .execute();
    for (const p of dropped) {
        await db.updateTable('projects').set({ team_managed: false }).where('id', '=', p.id).execute();
        await db.updateTable('workflows').set({ team_managed: false }).where('project_id', '=', p.id).execute();
        report.info.push(`"${p.name}" left the team config; it stays here as your own project`);
    }

    const staleAgents = await db
        .selectFrom('agents')
        .select(['id', 'name'])
        .where('team_managed', '=', true)
        .$if(agentIds.length > 0, (q) => q.where('id', 'not in', agentIds))
        .execute();
    for (const a of staleAgents) {
        await agentsService.delete(a.id).catch(async () => {
            // Still used by one of the Owner's own workflows: keep it as theirs.
            await db.updateTable('agents').set({ team_managed: false }).where('id', '=', a.id).execute();
        });
    }
    return report;
}

async function pull(): Promise<string> {
    const cfg = await getConfig();
    const remote = await remoteFor(cfg);
    try {
        if (!(await fetchAndReset(cfg, remote))) {
            await recordSync(true, `Branch ${cfg.branch} has nothing yet; waiting for the publisher`, null);
            return 'Nothing published yet';
        }
        const { problems, info } = await importFromFiles(cfg);
        const head = await git(['rev-parse', 'HEAD']);
        const message = [...problems, ...info].join('\n') || `Up to date with ${head.slice(0, 7)}`;
        // Only a problem marks the sync failed; a detached project is news, not an error.
        await recordSync(problems.length === 0, message, head);
        return message;
    } catch (err) {
        await recordSync(false, errMsg(err));
        throw err;
    }
}

// ── Scheduling ──────────────────────────────────────────────────────────────

let running: Promise<unknown> | null = null;

// ponytail: in-process lock; the API is a single process. Keeps a tick and
// "Sync now" from running git in the same folder at once.
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    while (running) await running.catch(() => undefined);
    const p = fn();
    running = p;
    try {
        return await p;
    } finally {
        running = null;
    }
}

async function tick(now: Date = new Date()): Promise<void> {
    if (running) return;
    const cfg = await getConfig();
    if (cfg.role === 'off' || !cfg.repo_url || !cfg.credential_id) return;
    const last = cfg.last_sync_at ? new Date(cfg.last_sync_at).getTime() : 0;
    const due = now.getTime() - last >= cfg.interval_minutes * 60_000;
    if (cfg.role === 'subscriber') {
        if (due) await exclusive(pull);
        return;
    }
    // A publisher checks every minute for local changes, so an edit reaches
    // the team within a minute; the interval only bounds how stale it can get.
    await exclusive<unknown>(due ? publish : publishIfChanged);
}

async function syncNow(): Promise<string> {
    const cfg = await getConfig();
    if (cfg.role === 'off') throw new ApiError('conflict', 'Team config sync is off. Choose Publisher or Subscriber first.', 409);
    return exclusive(cfg.role === 'publisher' ? publish : pull);
}

async function help(): Promise<ITeamConfigHelp> {
    const dir = teamConfigDir();
    const read = async (p: string) => (existsSync(p) ? readFile(p, 'utf8') : '');
    const projects = [];
    for (const prefix of await listDirs(join(dir, 'projects'))) {
        projects.push({ issue_key_prefix: prefix, help_md: await read(join(dir, 'projects', prefix, 'HELP.md')) });
    }
    return { readme_md: await read(join(dir, 'README.md')), projects };
}

export const teamConfig = {
    getConfig,
    saveConfig,
    syncNow,
    tick,
    help,
    // Exposed for tests.
    exportToFiles,
    importFromFiles,
};
