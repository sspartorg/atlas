// 2026-06-22 - Terminal v1.
//
// REST + WebSocket surface for PTY-backed Claude Code sessions. The route
// handler owns DB lifecycle transitions; the in-memory PTY lives in
// `services/cli-session-host.ts`. Worktree provisioning + finalize re-use
// `ensureWorktree({item:null,branch})` + `cleanupWorktreeAfterPush({itemId:null,...})`
// from the existing worktree-orchestrator (no new exports needed).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
    type ICliSession,
    type CliSessionPreflightStopResponse,
    type CliSessionStopResponse,
    type CliSessionUnstagedFile,
    type CliSessionDiffScopeName,
    CliSessionCreateSchema,
    DEFAULT_CLI_MODEL,
    DEFAULT_COPILOT_MODEL,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { getTrustedBrowserOrigins } from '../utils/lan-origins.js';
import { tokensMatch } from '../plugins/mcp-auth.js';
import { projectsService } from '../services/projects.js';
import {
    ensureWorktree,
    pushWorktree,
    openPullRequest,
    cleanupWorktreeAfterPush,
    WorktreeProvisioningError,
} from '../services/worktree-orchestrator.js';
import {
    startSession as hostStartSession,
    resumeSession as hostResumeSession,
    pauseSession as hostPauseSession,
    killSessionPty as hostKillSessionPty,
    attachWebSocket as hostAttachWebSocket,
    CliSessionSpawnError,
} from '../services/cli-session-host.js';
import { ingestTranscript } from '../services/cli-transcript-ingest.js';
import { stageCliWorktree } from '../services/worktree-stage.js';
import { runProjectSetup } from '../services/project-setup-runner.js';
import {
    buildGitAuth,
    cleanupGitConfig,
    GitAuthUnavailableError,
    type GitAuth,
} from '../services/git-credentials.js';

// Wrap buildGitAuth so transient github_app mint failures (network
// hiccups on token refresh) degrade to a null auth env rather than
// throwing through the route handler. Local `git commit`, session
// lifecycle, and worktree probing all still work under null auth;
// only push/PR need credentialed access and they surface their own
// auth error paths.
async function safeBuildGitAuth(
    credentialId: string | null,
): Promise<GitAuth | null> {
    try {
        return await buildGitAuth(credentialId);
    } catch (err) {
        if (err instanceof GitAuthUnavailableError) {
            // eslint-disable-next-line no-console
            console.warn(err.message);
            return null;
        }
        throw err;
    }
}
import { gitInvokeEnv } from '../services/git-env.js';
import {
    getWorktreeDiffSummary,
    getWorktreeFilePatch,
    WorktreeDiffError,
} from '../services/worktree-diff.js';
import {
    externalLinks,
    parseGithubPrUrl,
    fetchGithubPrTitle,
} from '../services/external-links.js';
import { broadcastSSE } from './events.js';

const exec = promisify(execFile);

// CreateBodySchema lives in @atlas/shared as `CliSessionCreateSchema` so the
// web client and this route validate against the same shape. See the import
// above. The model default is also shared via DEFAULT_CLI_MODEL.

const StopBodySchema = z.object({
    files_to_stage: z.array(z.string().min(1)).default([]),
    commit_message: z.string().max(2_000).optional(),
    // Defaults true so every pre-existing caller (web client, MCP, tests)
    // keeps the auto-PR behaviour without sending the field. Affirmative
    // rather than `skip_pr` so the default reads as `true` at the call site.
    open_pull_request: z.boolean().default(true),
});

// Query params arrive as strings, hence `coerce` on the numeric one. `path`
// is validated structurally inside the service (normalizeRelPath) and then
// checked for membership in the scope's changed-file set — that membership
// check, not this schema, is what stops the endpoint being an arbitrary-file
// reader of the worktree.
const DiffFileQuerySchema = z.object({
    path: z.string().min(1).max(1024),
    scope: z.enum(['uncommitted', 'committed']),
    context: z.coerce.number().int().min(0).max(25).default(3),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function shortId(): string {
    /* v8 ignore next */
    return randomUUID().split('-')[0] ?? 'xxxxxxxx';
}

function defaultBranchName(): string {
    return `atlas/terminal/${shortId()}`;
}

function defaultTitle(sessionId: string): string {
    return `Session ${sessionId.slice(0, 8)}`;
}

function rowToSession(row: Record<string, unknown>): ICliSession {
    const cli = row['cli'] === 'copilot' ? 'copilot' : 'claude';
    const num = (v: unknown): number | null =>
        /* v8 ignore next */
        typeof v === 'number' && Number.isFinite(v)
            /* v8 ignore next */
            ? v
            /* v8 ignore next */
            : typeof v === 'string' && v.length > 0 && Number.isFinite(Number(v))
                /* v8 ignore next */
                ? Number(v)
                : null;
    return {
        id: String(row['id']),
        project_id: String(row['project_id']),
        title: String(row['title']),
        status: row['status'] as ICliSession['status'],
        cli,
        worktree_path: (row['worktree_path'] as string | null) ?? null,
        worktree_branch: (row['worktree_branch'] as string | null) ?? null,
        /* v8 ignore next */
        claude_session_id: (row['claude_session_id'] as string | null) ?? null,
        model: String(row['model']),
        initial_prompt: (row['initial_prompt'] as string | null) ?? null,
        created_at: String(row['created_at']),
        updated_at: String(row['updated_at']),
        last_active_at: String(row['last_active_at']),
        closed_at: (row['closed_at'] as string | null) ?? null,
        finalize_pr_url: (row['finalize_pr_url'] as string | null) ?? null,
        item_id: (row['item_id'] as string | null) ?? null,
        // PG `double precision` round-trips as a string in some kysely
        // builds depending on the underlying pg driver settings; the
        // `num()` helper above tolerates either shape so the API returns a
        // real number to the UI.
        total_cost_usd: num(row['total_cost_usd']),
        input_tokens: num(row['input_tokens']),
        output_tokens: num(row['output_tokens']),
        cache_creation_tokens: num(row['cache_creation_tokens']),
        cache_read_tokens: num(row['cache_read_tokens']),
    };
}

async function loadSession(id: string): Promise<ICliSession | null> {
    const row = await db
        .selectFrom('cli_sessions')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    return row ? rowToSession(row as never) : null;
}

function emitStatus(session: ICliSession): void {
    broadcastSSE({
        type: 'cli_session_status',
        cliSessionId: session.id,
        cliSessionStatus: session.status,
    });
}

// `git status --porcelain -z` returns NUL-separated fields. A normal entry is
// one field: 2-char code + space + path. A RENAME or COPY (`R`/`C` in either
// column) spends a SECOND field on the origin path, with no `XY ` prefix —
// and in `-z` mode the order is `to` then `from`, reversed from the human
// format. So this has to be a pointer walk, not a plain `for..of` over the
// split: treating that bare origin path as its own record yields a phantom
// entry whose `code` is the first two characters of the old path, and the
// phantom then shows up as a checkbox in the Stop modal.
async function porcelainUnstaged(worktreePath: string): Promise<CliSessionUnstagedFile[]> {
    try {
        // `--untracked-files=all` (not git's default `normal`, which collapses
        // an untracked directory to a single `dir/` entry). Two reasons:
        // the Stop modal's file list comes from `worktree-diff`, which also
        // uses `all`, and a mismatch would let you tick a file the staging set
        // doesn't contain; and per-file staging out of a brand-new directory
        // is what you want anyway. `git add -- <file>` works either way.
        const res = await exec(
            'git',
            ['-C', worktreePath, 'status', '--porcelain', '-z', '--untracked-files=all'],
            { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
        );
        const fields = (res.stdout || '').split('\0');
        const entries: CliSessionUnstagedFile[] = [];
        for (let i = 0; i < fields.length; i++) {
            const raw = fields[i] ?? '';
            if (raw.length < 4) continue;
            const code = raw.slice(0, 2);
            const path = raw.slice(3);
            // Consume (and discard) the origin-path field that follows a
            // rename/copy. `path` above is already the destination.
            if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') i++;
            entries.push({ code, path });
        }
        return entries;
    } catch {
        return [];
    }
}

async function currentBranch(worktreePath: string): Promise<string> {
    try {
        const res = await exec('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 15_000 });
        return res.stdout.trim();
    } catch {
        return '';
    }
}

async function commitsAhead(worktreePath: string, branch: string): Promise<number> {
    try {
        const res = await exec(
            'git',
            ['-C', worktreePath, 'rev-list', '--count', `origin/${branch}..HEAD`],
            { timeout: 15_000 },
        );
        const n = Number(res.stdout.trim());
        /* v8 ignore next */
        return Number.isFinite(n) ? n : 0;
    } catch {
        // Branch may not exist on origin yet -- count local commits since
        // the merge base with the default branch isn't worth chasing here.
        return 0;
    }
}

// ── Route registration ─────────────────────────────────────────────────────

export async function cliSessionsRoutes(app: FastifyInstance): Promise<void> {
    // LIST -- optional ?project_id filter.
    app.get('/api/cli/sessions', async (req: FastifyRequest) => {
        const projectId = (req.query as { project_id?: string } | undefined)?.project_id;
        let q = db.selectFrom('cli_sessions').selectAll();
        if (projectId) q = q.where('project_id', '=', projectId);
        const rows = await q.orderBy('last_active_at', 'desc').limit(200).execute();
        return rows.map((r) => rowToSession(r as never));
    });

    // GET ONE
    app.get('/api/cli/sessions/:id', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const session = await loadSession(id);
        if (!session) return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        return session;
    });

    // CREATE -- the hot path.
    app.post('/api/cli/sessions', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = CliSessionCreateSchema.parse(req.body);
        const project = await projectsService.get(body.project_id);
        if (!project) return reply.status(404).send({ error: 'project not found', kind: 'not_found' });
        if (!project.git_path) {
            return reply
                .status(400)
                .send({ error: 'project has no git_path; cannot provision worktree', kind: 'validation_error' });
        }

        // Validate the optional item link BEFORE we touch git -- a stale
        // item id should fail fast, not strand a worktree. We also pull
        // `type` so stageCliWorktree can render the right item snapshot
        // shape in `.atlas/current-task.md`.
        type ItemTypeStr = 'epic' | 'story' | 'sub_task' | 'bug' | 'sub_bug';
        const itemId = body.item_id ?? null;
        let itemType: ItemTypeStr | null = null;
        if (itemId) {
            const itemRow = await db
                .selectFrom('items')
                .select(['id', 'project_id', 'type'])
                .where('id', '=', itemId)
                .executeTakeFirst();
            if (!itemRow) {
                return reply
                    .status(404)
                    .send({ error: `item not found: ${itemId}`, kind: 'not_found' });
            }
            if (itemRow.project_id !== project.id) {
                return reply
                    .status(400)
                    .send({
                        error: 'item belongs to a different project',
                        kind: 'validation_error',
                    });
            }
            itemType = itemRow.type as ItemTypeStr;
        }

        const sessionId = randomUUID();
        const cli = body.cli;
        // Both `claude` and `copilot` accept `--session-id <uuid>` on start
        // and `--resume <uuid>` to rejoin, so we mint a Atlas UUID for
        // either CLI and persist it in `claude_session_id` (column name
        // predates copilot support; semantically it's "the UUID we passed
        // to the CLI's --session-id flag").
        const cliSessionId = randomUUID();
        const branchName = body.branch_name && body.branch_name.length > 0 ? body.branch_name : defaultBranchName();
        /* v8 ignore next */
        const title = body.title && body.title.length > 0 ? body.title : defaultTitle(sessionId);
        const defaultModel = cli === 'copilot' ? DEFAULT_COPILOT_MODEL : DEFAULT_CLI_MODEL;
        const model = body.model && body.model.length > 0 ? body.model : defaultModel;
        let initialPrompt: string | null = body.initial_prompt ?? null;

        // Provision the worktree FIRST so we don't insert a row with no
        // worktree_path if provisioning fails. The cli_sessions_one_active_per_
        // project_branch index would otherwise lock the (project, branch) slot
        // even on a failed start.
        let worktreePath: string;
        try {
            const result = await ensureWorktree({
                item: null,
                branch: branchName,
                project: {
                    id: project.id,
                    git_path: project.git_path,
                    credential_id: project.credential_id,
                    default_branch: project.default_branch,
                },
                pushUpstream: false,
            });
            worktreePath = result.path;
        } catch (err) {
            if (err instanceof WorktreeProvisioningError) {
                return reply
                    .status(400)
                    .send({ error: err.message, kind: 'validation_error', details: { code: err.code, ...err.details } });
            }
            throw err;
        }

        // All ground-rules + per-session context staging goes through the
        // shared `stageCliWorktree` helper (same call agent-runner makes).
        // Writes:
        //   - `.atlas/constitution.md` + `.atlas/scripts/{bash,powershell}/*`
        //   - `.atlas/templates/<filename>`
        //   - `.claude/commands/atlas-<slug>.md` + `.github/prompts/atlas-<slug>.prompt.md`
        //     for every agent so the user can invoke them inside the PTY.
        //   - `.atlas/current-task.md` when item or initialPrompt is set
        //     (item snapshot + optional "User's initial prompt" section).
        // SKIPS (no flags passed):
        //   - `.atlas/handoff.md` (routing-only — agent-runner sets includeHandoff)
        //   - `~/.copilot/agents/atlas-<runId>.md` (only for `--agent` agent runs)
        let stageResult: Awaited<ReturnType<typeof stageCliWorktree>>;
        try {
            stageResult = await stageCliWorktree({
                worktreePath,
                projectId: project.id,
                ...(itemId && itemType ? { item: { type: itemType, id: itemId } } : {}),
                ...(initialPrompt && initialPrompt.trim().length > 0
                    ? { userPrompt: initialPrompt }
                    : {}),
            });
        } catch (err) {
            await cleanupWorktreeAfterPush({
                itemId: null,
                projectId: project.id,
                projectGitPath: project.git_path,
                worktreePath,
                branch: branchName,
                credentialId: project.credential_id,
            }).catch(() => { /* best-effort */ });
            return reply.status(500).send({
                error: `worktree staging failed: ${(err as Error).message}`,
                kind: 'internal_error',
            });
        }

        // When current-task.md was written, swap the user's literal prompt
        // for a single-line PTY auto-prompt pointing the CLI at the file.
        // The slash-command preambles also nudge the CLI to read it on its
        // first turn, but this auto-line gives the user a working entry
        // point even when they don't immediately type `/atlas-<slug>`.
        if (stageResult.currentTaskPath) {
            initialPrompt = 'Read `.atlas/current-task.md` for the full task context, then begin.';
        }

        // Run the project's setup script INSIDE the worktree, before we
        // insert the DB row. Agent-runner does the same thing per-run
        // (project-setup-runner.ts). For terminals the session id doubles
        // as the per-run tag for the tmp script naming. No-ops when the
        // project has no setup_sh_body / setup_ps1_body.
        const setupResult = await runProjectSetup({
            projectId: project.id,
            worktreePath,
            runId: sessionId,
        });
        if (!setupResult.ok) {
            await cleanupWorktreeAfterPush({
                itemId: null,
                projectId: project.id,
                projectGitPath: project.git_path,
                worktreePath,
                branch: branchName,
                credentialId: project.credential_id,
            }).catch(() => { /* best-effort */ });
            return reply.status(400).send({
                /* v8 ignore next */
                error: `project setup script failed: ${setupResult.output ?? setupResult.kind ?? 'unknown'}`,
                kind: 'project_setup_failed',
            });
        }

        // Build the per-session tmp git config so `git push` inside the
        // PTY inherits the project's credential via GIT_CONFIG_GLOBAL.
        // Returns null when the project has no credential — the host then
        // skips the env var and the user can still run read-only git.
        // Lifecycle: host owns cleanup on pause / kill / unexpected exit.
        // The plaintext token is exposed alongside so `gh` (used inside
        // the PTY for `gh pr create` etc.) picks up the same identity
        // via GH_TOKEN / GITHUB_TOKEN — without it, `gh` falls back to
        // the developer's own `gh auth login` and PR authorship regresses.
        //
        // A github_app credential can throw `GitAuthUnavailableError` on
        // transient GitHub 5xx during lazy mint; degrade to no-auth so
        // the session can still start (git commit is local, git push
        // will surface its own auth error) rather than 500-ing.
        const gitAuth = await safeBuildGitAuth(project.credential_id);
        const gitConfigPath = gitAuth?.configPath ?? null;
        const ghToken = gitAuth?.token ?? null;

        // Insert the row. If this throws (e.g. unique-constraint race on
        // cli_sessions_one_active_per_project_branch, DB pool exhaustion),
        // the tmp git config directory returned by buildGitAuth would
        // orphan in /tmp forever — nothing else cleans it up because the
        // host session was never started. Clean the tmp dir on failure
        // and re-throw so Fastify converts to a 500. See finding
        // cli-sessions.ts:406 in the 2026-07-03 audit.
        try {
            await db
                .insertInto('cli_sessions')
                .values({
                    id: sessionId,
                    project_id: project.id,
                    title,
                    status: 'active',
                    cli,
                    worktree_path: worktreePath,
                    worktree_branch: branchName,
                    claude_session_id: cliSessionId,
                    model,
                    initial_prompt: initialPrompt,
                    item_id: itemId,
                })
                .execute();
        } catch (err) {
            cleanupGitConfig(gitAuth?.configDir ?? null);
            throw err;
        }

        try {
            hostStartSession({
                sessionId,
                cli,
                worktreePath,
                cliSessionId,
                model,
                initialPrompt: initialPrompt ?? undefined,
                gitConfigPath,
                ghToken,
            });
        } catch (err) {
            /* v8 ignore next */
            const reason = err instanceof CliSessionSpawnError ? err.kind : 'pty_failed';
            await db
                .updateTable('cli_sessions')
                .set({
                    status: 'errored',
                    updated_at: new Date().toISOString(),
                })
                .where('id', '=', sessionId)
                .execute();
            // Best-effort transcript snapshot — if the CLI managed to write
            // anything before crashing, capture it for the history page.
            // AWAITED so the row's transcript_jsonl is populated before the
            // route returns and the client opens the history view. The
            // `worktreePath` override is defense-in-depth; the resolver
            // would also find the path on the row (we no longer null it).
            try {
                await ingestTranscript(sessionId, { worktreePath });
            } catch (err) {
                req.log.warn(
                    { err, sessionId },
                    'transcript ingest failed on errored spawn',
                );
            }
            // PTY spawn failed -- roll back the worktree so the next session
            // on the same branch isn't blocked by stale on-disk state. The
            // host's catch block already unlinked the tmp git config when
            // the spawn threw, so no additional cleanup needed here.
            await cleanupWorktreeAfterPush({
                itemId: null,
                projectId: project.id,
                projectGitPath: project.git_path,
                worktreePath,
                branch: branchName,
                credentialId: project.credential_id,
            }).catch(() => { /* best-effort */ });
            return reply.status(500).send({
                error: `PTY spawn failed: ${(err as Error).message}`,
                kind: reason === 'binary_missing' ? 'cli_not_installed' : 'internal_error',
            });
        }

        const created = await loadSession(sessionId);
        if (!created) {
            return reply
                .status(500)
                .send({ error: 'session inserted but lookup failed', kind: 'internal_error' });
        }
        emitStatus(created);
        return reply.status(201).send(created);
    });

    // PAUSE
    app.post('/api/cli/sessions/:id/pause', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const session = await loadSession(id);
        if (!session) return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        if (session.status !== 'active') {
            return reply.status(409).send({ error: `cannot pause session in status ${session.status}`, kind: 'conflict' });
        }
        hostPauseSession(id);
        await db
            .updateTable('cli_sessions')
            .set({ status: 'paused', updated_at: new Date().toISOString(), last_active_at: new Date().toISOString() })
            .where('id', '=', id)
            .execute();
        const updated = await loadSession(id);
        if (updated) emitStatus(updated);
        return updated;
    });

    // RESUME
    app.post('/api/cli/sessions/:id/resume', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const session = await loadSession(id);
        if (!session) return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        if (session.status !== 'paused') {
            return reply.status(409).send({ error: `cannot resume session in status ${session.status}`, kind: 'conflict' });
        }
        if (!session.worktree_path || !session.claude_session_id) {
            return reply
                .status(409)
                .send({ error: 'session has no worktree_path / claude_session_id; cannot resume', kind: 'conflict' });
        }
        // Refresh ground-rules + slash-command bodies + current-task.md
        // in case anything changed since the session was paused. The
        // helper is idempotent (overwrites every file). We intentionally
        // do NOT re-run `runProjectSetup` on resume — it executes shell
        // code and is one-shot per worktree.
        type ItemTypeStr = 'epic' | 'story' | 'sub_task' | 'bug' | 'sub_bug';
        let resumeItemType: ItemTypeStr | null = null;
        if (session.item_id) {
            const itemRow = await db
                .selectFrom('items')
                .select(['type'])
                .where('id', '=', session.item_id)
                .executeTakeFirst();
            /* v8 ignore next */
            resumeItemType = (itemRow?.type as ItemTypeStr | undefined) ?? null;
        }
        try {
            await stageCliWorktree({
                worktreePath: session.worktree_path,
                projectId: session.project_id,
                ...(session.item_id && resumeItemType
                    ? { item: { type: resumeItemType, id: session.item_id } }
                    : {}),
                ...(session.initial_prompt && session.initial_prompt.trim().length > 0
                    ? { userPrompt: session.initial_prompt }
                    : {}),
            });
        } catch (err) {
            return reply.status(500).send({
                error: `worktree re-staging failed: ${(err as Error).message}`,
                kind: 'internal_error',
            });
        }
        // Build a fresh tmp git config — the previous one was unlinked
        // when the session paused (and wouldn't have survived an API
        // restart anyway). Host owns cleanup on the next pause / kill.
        // See the equivalent block in the start path for why ghToken is
        // threaded alongside gitConfigPath.
        const project = await projectsService.get(session.project_id);
        /* v8 ignore next */
        const gitAuthResume = project ? await safeBuildGitAuth(project.credential_id) : null;
        const gitConfigPath = gitAuthResume?.configPath ?? null;
        const ghToken = gitAuthResume?.token ?? null;
        try {
            hostResumeSession({
                sessionId: id,
                cli: session.cli,
                worktreePath: session.worktree_path,
                cliSessionId: session.claude_session_id,
                model: session.model,
                gitConfigPath,
                ghToken,
            });
        } catch (err) {
            return reply.status(500).send({
                error: `PTY resume failed: ${(err as Error).message}`,
                kind: err instanceof CliSessionSpawnError && err.kind === 'binary_missing' ? 'cli_not_installed' : 'internal_error',
            });
        }
        await db
            .updateTable('cli_sessions')
            .set({ status: 'active', updated_at: new Date().toISOString(), last_active_at: new Date().toISOString() })
            .where('id', '=', id)
            .execute();
        const updated = await loadSession(id);
        if (updated) emitStatus(updated);
        return updated;
    });

    // PREFLIGHT STOP -- read-only inspection of the worktree state.
    app.post('/api/cli/sessions/:id/preflight-stop', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const session = await loadSession(id);
        if (!session) return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        if (!session.worktree_path) {
            return reply.status(409).send({ error: 'session has no worktree_path', kind: 'conflict' });
        }
        const [unstaged, branch] = await Promise.all([
            porcelainUnstaged(session.worktree_path),
            currentBranch(session.worktree_path),
        ]);
        const ahead = branch ? await commitsAhead(session.worktree_path, branch) : 0;
        const body: CliSessionPreflightStopResponse = {
            unstaged,
            current_branch: branch,
            ahead_of_remote: ahead,
        };
        return body;
    });

    // DIFF SUMMARY -- per-file change list for both review scopes.
    //
    // GET (unlike preflight-stop's POST) because it is a pure read: it needs
    // no write-gate token, and TanStack Query caches it naturally. Kept
    // separate from preflight-stop so a session touching hundreds of files
    // doesn't bloat the modal's first paint, and so the patch bodies below
    // can be fetched lazily one file at a time.
    app.get('/api/cli/sessions/:id/diff', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const session = await loadSession(id);
        if (!session) return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        if (!session.worktree_path) {
            return reply.status(409).send({ error: 'session has no worktree_path', kind: 'conflict' });
        }
        const project = await projectsService.get(session.project_id);
        try {
            return await getWorktreeDiffSummary({
                worktreePath: session.worktree_path,
                defaultBranch: project?.default_branch ?? null,
            });
        } catch (err) {
            if (err instanceof WorktreeDiffError) {
                return reply
                    .status(409)
                    .send({ error: err.message, kind: 'conflict', details: { code: err.code } });
            }
            throw err;
        }
    });

    // DIFF FILE -- one file's unified patch, on demand.
    app.get('/api/cli/sessions/:id/diff/file', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const session = await loadSession(id);
        if (!session) return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        if (!session.worktree_path) {
            return reply.status(409).send({ error: 'session has no worktree_path', kind: 'conflict' });
        }
        const q = DiffFileQuerySchema.parse(req.query);
        const project = await projectsService.get(session.project_id);
        try {
            const patch = await getWorktreeFilePatch({
                worktreePath: session.worktree_path,
                defaultBranch: project?.default_branch ?? null,
                scope: q.scope as CliSessionDiffScopeName,
                path: q.path,
                context: q.context,
            });
            if (!patch) {
                return reply
                    .status(404)
                    .send({ error: 'path not changed in this scope', kind: 'not_found' });
            }
            return patch;
        } catch (err) {
            if (err instanceof WorktreeDiffError) {
                const invalid = err.code === 'invalid_path';
                return reply.status(invalid ? 400 : 409).send({
                    error: err.message,
                    kind: invalid ? 'validation_error' : 'conflict',
                    details: { code: err.code },
                });
            }
            throw err;
        }
    });

    // STOP -- the smart finalize. Optional commit + push + worktree teardown.
    app.post('/api/cli/sessions/:id/stop', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const body = StopBodySchema.parse(req.body);
        const session = await loadSession(id);
        if (!session) return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        if (session.status === 'closed') {
            return reply.status(409).send({ error: 'session already closed', kind: 'conflict' });
        }
        if (!session.worktree_path || !session.worktree_branch) {
            return reply
                .status(409)
                .send({ error: 'session has no worktree_path / worktree_branch', kind: 'conflict' });
        }
        if (body.files_to_stage.length > 0 && (!body.commit_message || body.commit_message.trim().length === 0)) {
            return reply
                .status(400)
                .send({ error: 'commit_message required when files_to_stage is non-empty', kind: 'validation_error' });
        }

        // Release any open file handles on the worktree before git work.
        hostKillSessionPty(id);

        const worktreePath = session.worktree_path;
        const branch = session.worktree_branch;
        let committed = false;
        let pushed = false;
        let finalizePrUrl: string | null = null;

        // Resolve the project up front — we need its credential to build
        // the git auth env so the `git commit` below runs with the App's
        // `[user]` block (see `buildGitAuth` → `[user]` section) instead
        // of picking up the developer's `~/.gitconfig`. Without this, PRs
        // opened by the bot still end up with commits authored by the
        // developer, which regresses the whole point of the App identity.
        const project = await projectsService.get(session.project_id);
        const finalizeAuth = project ? await safeBuildGitAuth(project.credential_id) : null;
        const finalizeEnv = gitInvokeEnv(
            finalizeAuth?.configPath ?? null,
            finalizeAuth?.token ?? null,
        );

        try {
            if (body.files_to_stage.length > 0) {
                try {
                    await exec(
                        'git',
                        ['-C', worktreePath, 'add', '--', ...body.files_to_stage],
                        { timeout: 60_000, env: finalizeEnv },
                    );
                    // -c core.hooksPath=.husky/_ matches the documented workaround
                    // for spawning Husky's pre-commit hook on Windows.
                    //
                    // Human-attribution trailer is threaded via `--trailer`
                    // (not the prepare-commit-msg hook) because the -c above
                    // is HIGHEST-priority git config and would clobber the
                    // `core.hooksPath` our GIT_CONFIG_GLOBAL sets. Explicit
                    // `--trailer` can't be overridden. When the credential
                    // has no human_name/human_email set, no trailer is added
                    // and the commit falls back to bot-only attribution
                    // (matches the pre-migration-025 behaviour).
                    const commitArgs: string[] = [
                        '-c',
                        'core.hooksPath=.husky/_',
                        '-C',
                        worktreePath,
                        'commit',
                        '-m',
                        /* v8 ignore next */
                        body.commit_message ?? 'Terminal session changes',
                    ];
                    if (finalizeAuth?.humanName && finalizeAuth.humanEmail) {
                        commitArgs.push(
                            '--trailer',
                            `Co-Authored-By: ${finalizeAuth.humanName} <${finalizeAuth.humanEmail}>`,
                        );
                    }
                    await exec('git', commitArgs, { timeout: 60_000, env: finalizeEnv });
                    committed = true;
                } catch (err) {
                    return reply.status(500).send({
                        error: `git add/commit failed: ${(err as Error).message}`,
                        kind: 'internal_error',
                    });
                }
            }

            // Push the branch (no-op when the branch has nothing new to ship).
            if (project && project.git_path) {
                const pushResult = await pushWorktree(worktreePath, branch, project.credential_id, project.id);
            pushed = pushResult.pushed;
            // pushResult.error is non-fatal here -- worktree teardown still runs
            // so we don't leak dirs.

            // 2026-06-22 — Auto-raise the PR when there's something to ship.
            // Idempotent: openPullRequest handles the "PR already exists"
            // case by returning its URL. We treat any PR-side failure as
            // non-fatal -- the branch is on origin either way and the user
            // can open one manually.
            //
            // 2026-08-04 — two changes here:
            //
            // 1. `open_pull_request: false` opts out entirely. The Owner
            //    often commits + pushes + opens their own PR from inside the
            //    PTY, and an unwanted second PR on top of that is noise. The
            //    push above still runs regardless: `cleanupWorktreeAfterPush`
            //    below deletes the worktree, so not pushing would lose work.
            //
            // 2. `alreadyUpToDate` now counts as "something to ship". The
            //    original comment claimed this gate fired on "pushed OR a
            //    previous push already landed work", but the condition was a
            //    bare `if (pushed)` — and pushWorktreeInner returns
            //    `pushed: false` when git says "Everything up-to-date"
            //    (worktree-orchestrator.ts). So a session whose commits were
            //    pushed from the PTY silently got no PR. The gate now matches
            //    what the comment always said it did.
            if (body.open_pull_request && (pushResult.pushed || pushResult.alreadyUpToDate)) {
                const prResult = await openPullRequest({
                    worktreePath,
                    branch,
                    /* v8 ignore next */
                    base: project.default_branch || 'main',
                    title: `Terminal: ${session.title}`,
                    body:
                        `Created from Atlas Terminal session \`${session.id}\`.\n\n` +
                        (session.item_id ? `Linked item: \`${session.item_id}\`\n\n` : '') +
                        (body.commit_message ? `Commit message:\n\n> ${body.commit_message}\n\n` : '') +
                        `Branch: \`${branch}\``,
                    credentialId: project.credential_id,
                    projectId: project.id,
                });
                finalizePrUrl = prResult.url;

                // Record the PR as an item_external_links row so every PR
                // ever opened against the item is listed in the UI (the old
                // path wrote `items.pr_url` once and refused to overwrite).
                // externalLinks.create is idempotent on (item_id, url): two
                // sessions finishing on the same branch produce the same URL
                // and collapse to a single row.
                if (session.item_id && finalizePrUrl) {
                    try {
                        const parsed = parseGithubPrUrl(finalizePrUrl);
                        const title = await fetchGithubPrTitle(finalizePrUrl).catch(() => null);
                        await externalLinks.create({
                            itemId: session.item_id,
                            url: finalizePrUrl,
                            linkKind: 'pull_request',
                            title,
                            /* v8 ignore next */
                            externalRef: parsed?.number ?? null,
                            createdByRunId: null,
                        });
                        /* v8 ignore next */
                    } catch {
                        // Persistence is best-effort here; the URL is also
                        // captured on cli_sessions.finalize_pr_url below.
                    }
                }
            }
            }
        } finally {
            // Always clean up the temp git config so we don't leak files
            // on the tmp partition. The token/config were single-use for
            // this finalize call — the PTY has its own copy.
            cleanupGitConfig(finalizeAuth?.configPath ?? null);
        }

        // Mark the session closed and notify subscribers NOW, before the
        // potentially-slow worktree cleanup. On Windows, `git worktree remove`
        // can block for several minutes while antivirus/Defender releases
        // file handles. Blocking the HTTP response on cleanup means the UI
        // stays in "paused" for those minutes; moving the DB write first lets
        // the client show "closed" immediately while cleanup runs in the
        // background. itemId:null on the cleanup call means Step 3
        // (items.worktree_path NULL) is skipped — the session row (not the
        // item row) owns worktree_path here.
        //
        // We deliberately KEEP `worktree_path` on the row. The unique partial
        // index `cli_sessions_one_active_per_project_branch` filters to
        // `status IN ('active','paused')`, so a closed row never competes
        // for the (project, branch) slot. The path is purely informational
        // post-close — resume is gated on `status === 'paused'` so a stale
        // path on a closed row can't cause an operation against a deleted
        // dir. Preserving it lets the lazy `GET /transcript` endpoint
        // recompute the on-disk file path (`~/.claude/projects/<encoded-cwd>/
        // <claude_session_id>.jsonl`) when the cached `transcript_jsonl`
        // is empty for any reason.
        await db
            .updateTable('cli_sessions')
            .set({
                status: 'closed',
                closed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                finalize_pr_url: finalizePrUrl,
            })
            .where('id', '=', id)
            .execute();
        const updated = await loadSession(id);
        if (updated) {
            emitStatus(updated);
            broadcastSSE({
                type: 'cli_session_closed',
                cliSessionId: updated.id,
                cliSessionFinalizePrUrl: updated.finalize_pr_url,
            });
        }

        // Fire-and-forget worktree cleanup so the HTTP response returns
        // immediately. The cleanup can take up to ~10 min on Windows when
        // file handles are busy; the session is already marked closed so
        // the user is unblocked. Warnings are logged but not surfaced to
        // the client — the user can always manually delete a stranded dir.
        void cleanupWorktreeAfterPush({
            itemId: null,
            projectId: session.project_id,
            /* v8 ignore next */
            projectGitPath: project?.git_path ?? '',
            worktreePath,
            branch,
            credentialId: project?.credential_id ?? null,
        }).catch((err: unknown) => {
            req.log.warn({ err, sessionId: id }, 'worktree cleanup failed after session close');
        });
        // Copy the CLI's on-disk JSONL into our DB so the history page has
        // a durable copy even if the user later wipes ~/.claude or
        // ~/.copilot. AWAITED — without this, opening the history page
        // immediately after Stop hit empty content because the lazy GET
        // ran before the fire-and-forget ingest landed. Typical cost is
        // ~100-500 ms (10 MB cap); the worktree cleanup above is what we
        // keep off the hot path, not this.
        //
        // We pass the local `worktreePath` as a defense-in-depth override.
        // The UPDATE above no longer nulls cli_sessions.worktree_path, so
        // the resolver would read it from the row regardless; the explicit
        // override just keeps this call self-contained against any future
        // schema change.
        try {
            await ingestTranscript(id, { worktreePath });
        } catch (err) {
            req.log.warn(
                { err, sessionId: id },
                'transcript ingest failed on session close',
            );
        }
        const respBody: CliSessionStopResponse = {
            /* v8 ignore next */
            session: updated ?? session,
            pushed,
            committed,
            finalize_pr_url: finalizePrUrl,
        };
        return respBody;
    });

    // TRANSCRIPT — returns the persisted JSONL from the CLI's state dir.
    // Only available for `closed`/`errored` sessions (active/paused → 409,
    // matching the "history is only for stopped sessions" rule). The handler
    // lazily ingests when the column is still NULL — covers pre-existing
    // closed rows and any close-side hook miss.
    app.get('/api/cli/sessions/:id/transcript', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const session = await loadSession(id);
        if (!session) {
            return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        }
        if (session.status === 'active' || session.status === 'paused') {
            return reply.status(409).send({
                error: 'transcript only available after a session is closed or errored',
                kind: 'session_still_live',
            });
        }
        const row = await db
            .selectFrom('cli_sessions')
            .select(['transcript_jsonl', 'transcript_ingested_at'])
            .where('id', '=', id)
            .executeTakeFirst();
        if (row?.transcript_jsonl) {
            return {
                jsonl_content: row.transcript_jsonl,
                /* v8 ignore next */
                ingested_at: (row.transcript_ingested_at as string | null) ?? null,
                source: session.cli,
            };
        }
        const result = await ingestTranscript(id);
        if (!result) {
            return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        }
        return result;
    });

    // DELETE -- destructive; intended for tests / cleanup. If the session is
    // still attached, we kill the PTY first.
    app.delete('/api/cli/sessions/:id', async (req: FastifyRequest, reply: FastifyReply) => {
        const id = (req.params as { id: string }).id;
        const session = await loadSession(id);
        if (!session) return reply.status(404).send({ error: 'session not found', kind: 'not_found' });
        hostKillSessionPty(id);
        await db.deleteFrom('cli_sessions').where('id', '=', id).execute();
        return reply.status(204).send();
    });

    // WEBSOCKET -- live PTY byte stream. Binary frames in both directions.
    // On attach the host replays a serialized screen snapshot (clean VT
    // stream from the server-side headless mirror), then forwards raw PTY
    // bytes live. The control envelope `{cmd:"resize",cols,rows}` flips
    // the PTY size (clamped; malformed frames are dropped) without writing
    // the JSON to the shell -- see cli-session-host.
    //
    // Auth gate: `websocket:true` bypasses the global write-gate hook
    // (that hook only fires for POST/PUT/PATCH/DELETE — WS upgrades are
    // GET). Without an explicit check any cross-origin page could open
    // a WebSocket to a session and inject bytes into the attached PTY,
    // which is arbitrary local code execution. Accept the connection
    // only when EITHER the Origin header matches the trusted browser
    // allowlist OR the URL query carries `?token=<ATLAS_MCP_TOKEN>`
    // (mirrors the two-path shape of `requireMcpToken`). When the token
    // env is empty (fresh dev), the gate stays open — same posture as
    // the write gate.
    app.get(
        '/api/cli/sessions/:id/stream',
        { websocket: true },
        (sock: WebSocket, req: FastifyRequest) => {
            const expected = process.env['ATLAS_MCP_TOKEN'] ?? '';
            if (expected) {
                const origin = (req.headers['origin'] as string | undefined) ?? '';
                const originOk = origin && getTrustedBrowserOrigins().has(origin);
                const providedToken =
                    (req.query as { token?: string } | undefined)?.token ?? '';
                const tokenOk = tokensMatch(providedToken, expected);
                if (!originOk && !tokenOk) {
                    try {
                        sock.close(4401, 'unauthorized');
                    } catch {
                        /* best-effort */
                    }
                    return;
                }
            }
            const id = (req.params as { id: string }).id;
            const attached = hostAttachWebSocket(id, sock as never);
            if (!attached) {
                try {
                    // Buffer, not string: the stream is uniformly binary so
                    // the client never needs a text-frame special case.
                    sock.send(Buffer.from('session not live; reconnect after Resume\r\n', 'utf8'));
                /* v8 ignore next */
                } catch {
                    /* best-effort */
                }
                try {
                    sock.close();
                /* v8 ignore next */
                } catch {
                    /* best-effort */
                }
            }
        },
    );
}
