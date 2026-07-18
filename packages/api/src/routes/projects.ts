import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { spawnAgentRun } from '../services/agent-runner.js';
import { projectsService, PrefixCollisionError } from '../services/projects.js';
import { IssueKeyPrefixSchema } from '@atlas/shared';
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
    deriveProjectName,
} from '../services/git-verify.js';
import {
    CreateProjectSchema,
    CloneProjectSchema,
    DeleteProjectSchema,
    ConnectExistingProjectSchema,
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

    app.post('/api/projects/clone', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CloneProjectSchema.parse(req.body);
        const settings = await settingsService.get();
        if (!settings.workspace_path) {
            return reply
                .status(400)
                .send({ error: 'Workspace path is not set. Finish onboarding first.' });
        }
        const prefixCheck = await projectsService.checkPrefix(body.issue_key_prefix);
        if (!prefixCheck.available) {
            return reply.status(409).send({
                error: `Issue key prefix already used by "${prefixCheck.conflict}"`,
                reason: prefixCheck.reason,
                /* v8 ignore next */
                conflict: prefixCheck.conflict ?? null,
            });
        }
        // Reject project_name shapes that would escape the workspace root
        // via path traversal (`..`), path separators, or Windows drive
        // letters. CloneProjectSchema only enforces min/max length; without
        // this guard, `project_name = '..\\..\\..\\Windows\\Temp\\foo'`
        // would cause `git clone` to write a tree anywhere the process can
        // write. Zod schema is a shape check, this is the security check.
        const nameTraversal =
            /[\\/]/.test(body.project_name) ||
            body.project_name.split(/[\\/]/).includes('..') ||
            /^[a-zA-Z]:/.test(body.project_name) ||
            body.project_name === '.' ||
            body.project_name === '..';
        if (nameTraversal) {
            return reply.status(400).send({
                error: 'project_name must not contain path separators, "..", or a drive letter',
                kind: 'validation_error',
            });
        }
        const destination = join(settings.workspace_path, body.project_name);
        try {
            const cloneId = await startClone({
                repo_url: body.repo_url,
                credential_id: body.credential_id,
                project_name: body.project_name,
                issue_key_prefix: body.issue_key_prefix,
                default_branch: body.default_branch,
                destination,
            });
            return reply.status(202).send({ clone_id: cloneId, destination });
        } catch (err) {
            /* v8 ignore next */
            return reply.status(400).send({ error: err instanceof Error ? err.message : 'Could not start clone' });
        }
    });

    app.post('/api/projects/:id/reveal', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const project = await projectsService.get(id);
        if (!project) return reply.status(404).send({ error: 'Project not found' });
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
            const child = spawn(bin, [project.git_path], {
                detached: true,
                stdio: 'ignore',
                windowsHide: false,
            });
            child.unref();
            return reply.send({ ok: true, path: project.git_path });
        } catch (err) {
            /* v8 ignore next 3 */
            return reply
                .status(500)
                .send({
                    error: err instanceof Error ? err.message : 'Could not open file browser',
                });
        }
    });

    app.post('/api/projects/:id/reclone', { preHandler: requireMcpToken }, async (req, reply) => {
        /* v8 ignore next */
        RecloneProjectSchema.parse(req.body ?? {});
        const { id } = req.params as { id: string };
        const project = await projectsService.get(id);
        if (!project) return reply.status(404).send({ error: 'Project not found' });
        try {
            const recloneId = await startReclone({
                projectId: id,
                destination: project.git_path,
                branch: project.default_branch,
            });
            return reply.status(202).send({ reclone_id: recloneId });
        } catch (err) {
            /* v8 ignore next */
            return reply.status(400).send({ error: err instanceof Error ? err.message : 'Could not start reclone' });
        }
    });

    app.get('/api/projects/:id/status', async (req, reply) => {
        const { id } = req.params as { id: string };
        const project = await projectsService.get(id);
        if (!project) return reply.status(404).send({ error: 'Project not found' });

        let authB64: string | null = null;
        if (project.credential_id) {
            const cred = await credentialsService.get(project.credential_id);
            if (cred) {
                try {
                    const token = await credentialsService.getToken(project.credential_id);
                    authB64 = Buffer.from(`${cred.username}:${token}`, 'utf8').toString('base64');
                } catch {
                    authB64 = null;
                }
            }
        }

        try {
            const s = await getProjectGitStatus(project.git_path, project.default_branch, authB64);
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

    app.get('/api/projects/:id/head', async (req, reply) => {
        const { id } = req.params as { id: string };
        const project = await projectsService.get(id);
        if (!project) return reply.status(404).send({ error: 'Project not found' });
        if (!project.git_path)
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
                ['-C', project.git_path, 'log', '-1', `--pretty=format:${GIT_HEAD_FORMAT}`],
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

    app.post('/api/projects/connect', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = ConnectExistingProjectSchema.parse(req.body);

        const checks = {
            folder_exists: folderExists(body.folder_path),
            has_git: false,
            origin_matches: false,
            ls_remote_ok: false,
        };
        if (!checks.folder_exists) {
            return reply.status(400).send({ ok: false, checks, error_kind: 'missing_folder' });
        }
        checks.has_git = hasGitDir(body.folder_path);
        if (!checks.has_git) {
            return reply.status(400).send({ ok: false, checks, error_kind: 'not_git' });
        }

        const existing = (await projectsService.list()).find((p) => p.git_path === body.folder_path);
        if (existing) {
            return reply.status(400).send({
                ok: false,
                checks: { ...checks, origin_matches: true, ls_remote_ok: true },
                error_kind: 'already_registered',
                existing_project: { id: existing.id, name: existing.name },
            });
        }

        const folderOrigin = await readFolderOrigin(body.folder_path);
        checks.origin_matches =
            !!folderOrigin && normalizeRepoUrl(folderOrigin) === normalizeRepoUrl(body.repo_url);
        if (!checks.origin_matches) {
            const head = await readHead(body.folder_path);
            return reply.status(400).send({
                ok: false,
                checks,
                folder_origin: folderOrigin,
                head_branch: head?.branch ?? null,
                head_sha: head?.sha ?? null,
                error_kind: 'origin_mismatch',
            });
        }

        const cred = await credentialsService.get(body.credential_id);
        if (!cred) {
            return reply.status(400).send({ ok: false, checks, error_kind: 'credential_missing' });
        }
        let token: string;
        try {
            token = await credentialsService.getToken(body.credential_id);
        } catch {
            return reply.status(400).send({ ok: false, checks, error_kind: 'credential_missing' });
        }
        const authedUrl = injectToken(body.repo_url, cred.username, token);
        checks.ls_remote_ok = await lsRemote(authedUrl);
        if (!checks.ls_remote_ok) {
            return reply.status(400).send({ ok: false, checks, error_kind: 'auth_failed' });
        }

        const head = await readHead(body.folder_path);
        try {
            const project = await projectsService.createFromClone({
                name: deriveProjectName(body.folder_path),
                issue_key_prefix: body.issue_key_prefix,
                git_url: body.repo_url,
                git_path: body.folder_path,
                credential_id: body.credential_id,
                default_branch: head?.branch ?? 'main',
            });
            await credentialsService.markUsed(body.credential_id);
            return reply.status(201).send(project);
        } catch (err) {
            if (err instanceof PrefixCollisionError) {
                return reply.status(409).send({
                    ok: false,
                    checks,
                    error: err.message,
                    error_kind: 'prefix_collision',
                    reason: err.reason,
                    conflict: err.conflict,
                });
            }
            /* v8 ignore next */
            throw err;
        }
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
            const deleteId = startDelete({
                projectId: id,
                destination: project.git_path,
                mode: body.mode,
            });
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
            if (project.clone_status !== 'ready') {
                return reply.status(409).send({
                    error: 'Project is not cloned yet',
                    detail: `clone_status='${project.clone_status}'. Wait for the clone to finish before generating AI scaffold.`,
                });
            }
            if (!project.credential_id) {
                return reply.status(409).send({
                    error: 'Project has no credential attached',
                    detail: 'Attach a credential before generating AI scaffold — git push needs it.',
                });
            }
            try {
                const runId = await spawnAgentRun({
                    agentId: 'agent-ai-readiness',
                    projectId: id,
                });
                return reply.status(202).send({ run_id: runId });
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
