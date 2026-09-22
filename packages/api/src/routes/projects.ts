import type { FastifyInstance, FastifyReply } from 'fastify';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { workflowsService } from '../services/workflows.js';
import { startWorkflowRun } from '../services/workflow-engine.js';
import { projectsService, PrefixCollisionError } from '../services/projects.js';
import { projectReposService } from '../services/project-repos.js';
import { GenerateAiScaffoldSchema, IssueKeyPrefixSchema } from '@atlas/shared';
import type { IProjectRepo } from '@atlas/shared';
import { settingsService } from '../services/settings.js';
import { startClone, injectToken } from '../services/clone-runner.js';
import { startDelete } from '../services/delete-runner.js';
import { startReclone } from '../services/reclone-runner.js';
import { getProjectGitStatus } from '../services/git-status.js';
import { credentialsService } from '../services/credentials.js';
import { projectEnvFileService } from '../services/project-env-file.js';
import {
    folderExists,
    hasGitDir,
    readFolderOrigin,
    readHead,
    lsRemote,
    normalizeRepoUrl,
} from '../services/git-verify.js';
import {
    CreateProjectSchema,
    CreateProjectRepoSchema,
    UpdateProjectRepoSchema,
    DeleteProjectSchema,
    RecloneProjectSchema,
    UpdateProjectSchema,
} from '@atlas/shared';
import { requireMcpToken } from '../plugins/mcp-auth.js';

export async function projectsRoutes(app: FastifyInstance) {
    app.get('/api/projects', async (_req, reply) => reply.send(await projectsService.list()));

    // Page-scoped variant for the visible /projects table. Defaults to
    // page=1&limit=20; max limit=100. Response shape matches the
    // analytics paged endpoints: { rows, total, page, limit }.
    app.get('/api/projects/paged', async (req, reply) => {
        const q = req.query as { page?: string; limit?: string };
        const page = parseInt(q.page ?? '1', 10) || 1;
        const limit = parseInt(q.limit ?? '20', 10) || 20;
        return reply.send(await projectsService.listPaged({ page, limit }));
    });

    app.get('/api/projects/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const project = await projectsService.get(id);
        if (!project) return reply.status(404).send({ error: 'Project not found' });
        return reply.send(project);
    });

    app.post('/api/projects', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CreateProjectSchema.parse(req.body);
        try {
            return reply.status(201).send(await projectsService.create(body));
        } catch (err) {
            if (err instanceof PrefixCollisionError) {
                return reply.status(409).send({
                    error: err.message,
                    reason: err.reason,
                    conflict: err.conflict,
                });
            }
            /* v8 ignore next */
            throw err;
        }
    });

    app.get('/api/projects/prefix-available', async (req, reply) => {
        const raw = (req.query as { prefix?: string }).prefix;
        const parsed = IssueKeyPrefixSchema.safeParse(raw);
        if (!parsed.success) {
            return reply.send({ available: false, reason: 'invalid' });
        }
        const result = await projectsService.checkPrefix(parsed.data);
        if (result.available) return reply.send({ available: true });
        return reply.send({
            available: false,
            reason: result.reason,
            /* v8 ignore next */
            conflict: result.conflict ?? null,
        });
    });

    // ADR 0018 — every git action is on a repo of the project, not on the
    // project itself.
    async function repoOr404(
        projectId: string,
        repoId: string,
        reply: FastifyReply
    ): Promise<IProjectRepo | null> {
        const repos = await projectReposService.list(projectId).catch(() => null);
        if (!repos) {
            await reply.status(404).send({ error: 'Project not found', kind: 'not_found' });
            return null;
        }
        const repo = repos.find((r) => r.id === repoId);
        if (!repo) {
            await reply.status(404).send({ error: 'Repo not found', kind: 'not_found' });
            return null;
        }
        return repo;
    }

    app.post('/api/projects/:id/repos/:repoId/reveal', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id, repoId } = req.params as { id: string; repoId: string };
        const repo = await repoOr404(id, repoId, reply);
        if (!repo) return reply;
        /* v8 ignore next 13 */
        const bin =
            process.platform === 'win32'
                ? 'explorer.exe'
                : process.platform === 'darwin'
                  ? 'open'
                  : process.platform === 'linux'
                    ? 'xdg-open'
                    : null;
        if (!bin) {
            return reply
                .status(400)
                .send({ error: `Reveal is not supported on ${process.platform}` });
        }
        try {
            const child = spawn(bin, [repo.git_path], {
                detached: true,
                stdio: 'ignore',
                windowsHide: false,
            });
            child.unref();
            return reply.send({ ok: true, path: repo.git_path });
        } catch (err) {
            /* v8 ignore next 3 */
            return reply
                .status(500)
                .send({
                    error: err instanceof Error ? err.message : 'Could not open file browser',
                });
        }
    });

    app.post('/api/projects/:id/repos/:repoId/reclone', { preHandler: requireMcpToken }, async (req, reply) => {
        /* v8 ignore next */
        RecloneProjectSchema.parse(req.body ?? {});
        const { id, repoId } = req.params as { id: string; repoId: string };
        const repo = await repoOr404(id, repoId, reply);
        if (!repo) return reply;
        try {
            const recloneId = await startReclone({
                repoId: repo.id,
                destination: repo.git_path,
                branch: repo.default_branch,
            });
            return reply.status(202).send({ reclone_id: recloneId });
        } catch (err) {
            /* v8 ignore next */
            return reply.status(400).send({ error: err instanceof Error ? err.message : 'Could not start reclone' });
        }
    });

    app.get('/api/projects/:id/repos/:repoId/status', async (req, reply) => {
        const { id, repoId } = req.params as { id: string; repoId: string };
        const repo = await repoOr404(id, repoId, reply);
        if (!repo) return reply;

        let authB64: string | null = null;
        if (repo.credential_id) {
            const cred = await credentialsService.get(repo.credential_id);
            if (cred) {
                try {
                    const token = await credentialsService.getToken(repo.credential_id);
                    authB64 = Buffer.from(`${cred.username}:${token}`, 'utf8').toString('base64');
                } catch {
                    authB64 = null;
                }
            }
        }

        try {
            const s = await getProjectGitStatus(repo.git_path, repo.default_branch, authB64);
            return reply.send({
                local_head: s.localHead,
                remote_head: s.remoteHead,
                behind: s.behind,
                uncommitted: s.uncommitted,
            });
        } catch (err) {
            /* v8 ignore next */
            return reply.status(500).send({ error: err instanceof Error ? err.message : 'git status failed' });
        }
    });

    app.get('/api/projects/:id/repos/:repoId/head', async (req, reply) => {
        const { id, repoId } = req.params as { id: string; repoId: string };
        const repo = await repoOr404(id, repoId, reply);
        if (!repo) return reply;
        if (!repo.git_path)
            return reply.send({ short_sha: null, subject: null, relative_time: null });
        try {
            const { execFile } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const { parseGitHeadOutput, GIT_HEAD_FORMAT } = await import(
                '../services/git-head.js'
            );
            const exec = promisify(execFile);
            const { stdout } = await exec(
                'git',
                ['-C', repo.git_path, 'log', '-1', `--pretty=format:${GIT_HEAD_FORMAT}`],
                { timeout: 10_000 },
            );
            return reply.send(parseGitHeadOutput(stdout));
        } catch {
            return reply.send({ short_sha: null, subject: null, relative_time: null });
        }
    });

    app.get('/api/projects/folder-origin', async (req, reply) => {
        const { path } = req.query as { path?: string };
        if (!path) return reply.status(400).send({ error: 'path query param required' });
        if (!folderExists(path)) return reply.send({ origin: null });
        if (!hasGitDir(path)) return reply.send({ origin: null });
        const origin = await readFolderOrigin(path);
        return reply.send({ origin });
    });

    // Folder → git → not already registered → origin matches → credential can
    // reach the remote. Shared by connecting a project and adding a repo to one.
    async function checkLocalClone(body: { folder_path: string; repo_url: string; credential_id: string }) {
        const checks = {
            folder_exists: folderExists(body.folder_path),
            has_git: false,
            origin_matches: false,
            ls_remote_ok: false,
        };
        if (!checks.folder_exists) return { error: { ok: false, checks, error_kind: 'missing_folder' } };
        checks.has_git = hasGitDir(body.folder_path);
        if (!checks.has_git) return { error: { ok: false, checks, error_kind: 'not_git' } };

        const existing = await projectReposService.ownerOfPath(body.folder_path);
        if (existing) {
            return {
                error: {
                    ok: false,
                    checks: { ...checks, origin_matches: true, ls_remote_ok: true },
                    error_kind: 'already_registered',
                    existing_project: { id: existing.id, name: existing.name },
                },
            };
        }

        const folderOrigin = await readFolderOrigin(body.folder_path);
        checks.origin_matches =
            !!folderOrigin && normalizeRepoUrl(folderOrigin) === normalizeRepoUrl(body.repo_url);
        if (!checks.origin_matches) {
            const head = await readHead(body.folder_path);
            return {
                error: {
                    ok: false,
                    checks,
                    folder_origin: folderOrigin,
                    head_branch: head?.branch ?? null,
                    head_sha: head?.sha ?? null,
                    error_kind: 'origin_mismatch',
                },
            };
        }

        const cred = await credentialsService.get(body.credential_id);
        if (!cred) return { error: { ok: false, checks, error_kind: 'credential_missing' } };
        let token: string;
        try {
            token = await credentialsService.getToken(body.credential_id);
        } catch {
            return { error: { ok: false, checks, error_kind: 'credential_missing' } };
        }
        const authedUrl = injectToken(body.repo_url, cred.username, token);
        checks.ls_remote_ok = await lsRemote(authedUrl);
        if (!checks.ls_remote_ok) return { error: { ok: false, checks, error_kind: 'auth_failed' } };

        return { checks, head: await readHead(body.folder_path) };
    }

    // ADR 0018 — a project's repos, all equal; none is primary.
    app.get('/api/repos', async (_req, reply) => {
        return reply.send(await projectReposService.listAll());
    });

    app.get('/api/projects/:id/repos', async (req, reply) => {
        const { id } = req.params as { id: string };
        return reply.send(await projectReposService.list(id));
    });

    app.post('/api/projects/:id/repos', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = CreateProjectRepoSchema.parse(req.body);
        await projectReposService.assertNameFree(id, body.name);
        if (body.mode === 'connect') {
            const verified = await checkLocalClone(body);
            if ('error' in verified) return reply.status(400).send(verified.error);
            const repo = await projectReposService.insert({
                project_id: id,
                name: body.name,
                git_url: body.repo_url,
                git_path: body.folder_path,
                credential_id: body.credential_id,
                default_branch: verified.head?.branch ?? 'main',
            });
            await credentialsService.markUsed(body.credential_id);
            return reply.status(201).send(repo);
        }
        const settings = await settingsService.get();
        if (!settings.workspace_path) {
            return reply.status(400).send({ error: 'Workspace path is not set. Finish onboarding first.' });
        }
        const project = await projectsService.get(id);
        /* v8 ignore next -- assertNameFree already 404s a missing project */
        if (!project) return reply.status(404).send({ error: 'Project not found' });
        // F-009 — see `repoFolderName`: skips the project prefix when the
        // repo name already carries it. Both parts are slugs, so the folder
        // can't escape the workspace.
        const destination = join(
            settings.workspace_path,
            projectReposService.repoFolderName(project.name, body.name),
        );
        const cloneId = await startClone(
            {
                repo_url: body.repo_url,
                credential_id: body.credential_id,
                project_name: project.name,
                issue_key_prefix: project.issue_key_prefix,
                default_branch: body.default_branch,
                destination,
            },
            async (clone) => ({
                repo: await projectReposService.insert({
                    project_id: id,
                    name: body.name,
                    ...clone,
                    credential_id: body.credential_id,
                    default_branch: body.default_branch,
                }),
            })
        );
        return reply.status(202).send({ clone_id: cloneId, destination });
    });

    app.patch('/api/projects/:id/repos/:repoId', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id, repoId } = req.params as { id: string; repoId: string };
        const body = UpdateProjectRepoSchema.parse(req.body);
        return reply.send(await projectReposService.update(id, repoId, body));
    });

    app.delete('/api/projects/:id/repos/:repoId', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id, repoId } = req.params as { id: string; repoId: string };
        await projectReposService.remove(id, repoId);
        return reply.status(204).send();
    });

    app.post('/api/projects/:id/delete', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = DeleteProjectSchema.parse(req.body);
        const project = await projectsService.get(id);
        if (!project) return reply.status(404).send({ error: 'Project not found' });
        if (body.mode === 'purge' && body.confirm_name !== project.name) {
            return reply.status(400).send({ error: 'Project name confirmation does not match' });
        }
        try {
            const deleteId = startDelete({ projectId: id, mode: body.mode });
            return reply.status(202).send({ delete_id: deleteId });
        } catch (err) {
            /* v8 ignore next */
            return reply.status(400).send({ error: err instanceof Error ? err.message : 'Could not start delete' });
        }
    });

    app.patch('/api/projects/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await projectsService.get(id))) return reply.status(404).send({ error: 'Project not found' });
        const body = UpdateProjectSchema.parse(req.body);
        return reply.send(await projectsService.update(id, body));
    });

    app.delete('/api/projects/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await projectsService.get(id))) return reply.status(404).send({ error: 'Project not found' });
        await projectsService.delete(id);
        return reply.status(204).send();
    });

    // Theme 09b — AI-Readiness Agent trigger. Spawns a project-scope
    // agent run that generates the seven scaffolding files on a fresh
    // branch + pushes + opens a PR via `gh`. Owner reviews on GitHub
    // and merges. Token-gated; preconditions checked explicitly so
    // the UI can surface clear failure messages.
    app.post(
        '/api/projects/:id/generate-ai-scaffold',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            const project = await projectsService.get(id);
            if (!project) return reply.status(404).send({ error: 'Project not found' });
            // ADR 0018 — the scaffold reads a checkout, so it runs on a repo.
            // The body may name one; otherwise the project's first repo.
            const body = GenerateAiScaffoldSchema.parse(req.body ?? {});
            const repos = await projectReposService.list(id);
            const repo = body.repo_id ? repos.find((r) => r.id === body.repo_id) : repos[0];
            if (!repo) {
                return reply.status(409).send({
                    error: 'Project has no repo',
                    detail: 'Add a repo to this project before generating AI scaffold.',
                });
            }
            if (repo.clone_status !== 'ready') {
                return reply.status(409).send({
                    error: 'Repo is not cloned yet',
                    detail: `clone_status='${repo.clone_status}'. Wait for the clone to finish before generating AI scaffold.`,
                });
            }
            if (!repo.credential_id) {
                return reply.status(409).send({
                    error: 'Repo has no credential attached',
                    detail: 'Attach a credential before generating AI scaffold — git push needs it.',
                });
            }
            try {
                // ADR 0014 — the scaffold is the project's AI Readiness
                // workflow (worktree + push + PR), created from the starter
                // template on first use.
                const templateName = workflowsService.listTemplates().find((t) => t.id === 'ai-readiness')?.name;
                const existing = (await workflowsService.list(id)).find((w) => w.name === templateName);
                const workflow = existing ?? (await workflowsService.createFromTemplate('ai-readiness', id));
                const runId = await startWorkflowRun(workflow.id, null);
                return reply.status(202).send({ run_id: runId, workflow_id: workflow.id });
            } catch (err) {
                return reply.status(500).send({
                    error: 'Failed to spawn AI-readiness run',
                    detail: (err as Error).message,
                });
            }
        },
    );

    app.get('/api/projects/:id/env', async (req, reply) => {
        const { id } = req.params as { id: string };
        const project = await projectsService.get(id);
        if (!project) return reply.status(404).send({ error: 'Project not found' });
        // Batch-9 enterprise-secrets read model: metadata only. UI
        // fetches a single value on demand via
        // `GET /api/projects/:id/env/:key/value`.
        return reply.send({ vars: await projectEnvFileService.dbListMetadata(project.id) });
    });

    // On-demand reveal for a single project env var.
    app.get(
        '/api/projects/:id/env/:key/value',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id, key } = req.params as { id: string; key: string };
            const project = await projectsService.get(id);
            if (!project) return reply.status(404).send({ error: 'Project not found' });
            const KEY_RE_LOCAL = /^[A-Z][A-Z0-9_]*$/;
            if (!KEY_RE_LOCAL.test(key)) {
                return reply.status(400).send({
                    error: `Invalid key "${key}" — must be UPPER_SNAKE_CASE`,
                    kind: 'validation_error',
                });
            }
            const value = await projectEnvFileService.dbRevealOne(project.id, key);
            if (value === null) {
                return reply.status(404).send({ error: 'Secret not found' });
            }
            req.log.info(
                { tag: 'secret_reveal', scope: 'project', project_id: project.id, key },
                'secret revealed',
            );
            return reply.send({ key, value });
        },
    );

    app.put('/api/projects/:id/env', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const project = await projectsService.get(id);
        if (!project) return reply.status(404).send({ error: 'Project not found' });

        const raw = req.body as { vars?: unknown };
        if (!raw || !Array.isArray(raw.vars)) {
            return reply.status(400).send({ error: 'Expected { vars: Array<{key,value}> }' });
        }
        const KEY_RE = /^[A-Z][A-Z0-9_]*$/;
        const seen = new Set<string>();
        const next: Array<{ key: string; value: string }> = [];
        for (const item of raw.vars) {
            const v = item as { key?: unknown; value?: unknown };
            if (typeof v.key !== 'string' || typeof v.value !== 'string') {
                return reply.status(400).send({ error: 'Each row must have string key and value' });
            }
            if (!KEY_RE.test(v.key)) {
                return reply
                    .status(400)
                    .send({ error: `Invalid key "${v.key}" — must be UPPER_SNAKE_CASE` });
            }
            if (seen.has(v.key)) {
                return reply.status(400).send({ error: `Duplicate key "${v.key}"` });
            }
            seen.add(v.key);
            next.push({ key: v.key, value: v.value });
        }

        try {
            await projectEnvFileService.dbUpsert(project.id, next);
        } catch (err) {
            /* v8 ignore next 3 */
            return reply
                .status(500)
                .send({
                    error: err instanceof Error ? err.message : 'Could not save project secrets',
                });
        }
        // Metadata-only post-write response — see the GET route above.
        return reply.send({ vars: await projectEnvFileService.dbListMetadata(project.id) });
    });
}
