// ============================================================================
// Worktree 7-step contract
// ============================================================================
//
// Every agent run that targets an item with a `worktree_branch` flows
// through these seven steps. Owner-mandated lifecycle (Workstream #3,
// 2026-06-02). All git operations against a given project are
// serialized by `withProjectGitLock` — same project serializes,
// different projects run in parallel.
//
//   Step 1 — Fetch latest of the project's default branch.
//            (`runGit(['fetch', 'origin', defaultBranch])` inside
//            `ensureWorktree`.)
//
//   Step 2 — Create-or-checkout the per-item branch in a worktree
//            folder under `<project>/../worktrees/<projectId>/<slug>`.
//            (`ensureWorktree`'s Path 1 / Path 2 / Path 3 below.) The
//            branch is `items.worktree_branch` exclusively — there are
//            no role-based overrides.
//
//   Step 3 — Orchestrator writes constitution + work files into
//            `.atlas-run/` inside the worktree. (`writeRunArtefacts`
//            in this module, called by agent-runner before spawn.)
//
//   Step 4 — Agent runs inside the worktree. (`spawnCli` in
//            agent-runner.ts.)
//
//   Step 5 — Orchestrator parses outputs (cost, handoff signal).
//            (`parseClaudeCostFromOutput` / `parseCopilotCostFromOutput`
//            in agent-runner.ts.)
//
//   Step 6 — On run-end, orchestrator commits-only-the-agent-did,
//            pushes the worktree, and (if `agent.raises_pr === true`
//            AND code === 0 AND diff vs default ≥ 1) opens the PR.
//            (`cleanupRunArtefacts` → `pushWorktree` → `openPullRequest`
//            in agent-runner.ts.)
//
//   Step 7 — Teardown, regardless of outcome:
//            7a. `git worktree remove --force <path>`
//            7b. `git branch -D <branch>` (local ref only)
//            7c. `UPDATE items SET worktree_path = NULL`
//                (`worktree_branch` is preserved — the next agent in
//                 the SDLC chain reuses it.)
//            7d. `git fetch origin --prune` against the project clone
//                so `refs/remotes/origin/*` stays in sync with merged-
//                and-deleted remote branches.
//            (`cleanupWorktreeAfterPush` in this module.)
//
// Concurrency: `withProjectGitLock(projectId, ...)` wraps each of the
// four exported entry points (`ensureWorktree`, `pushWorktree`,
// `openPullRequest`, `cleanupWorktreeAfterPush`). In-process only — a
// future multi-process orchestrator needs `pg_advisory_lock`.
// ============================================================================

import { execFile } from 'node:child_process';
import {
    mkdirSync,
    existsSync,
    rmSync,
    mkdtempSync,
    writeFileSync,
    readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { db } from '../db/kysely-client.js';
import {
    buildGitAuth,
    buildGitConfig,
    cleanupGitConfig,
    GitAuthUnavailableError,
} from './git-credentials.js';
import { gitInvokeEnv } from './git-env.js';
import { withProjectGitLock } from './project-git-lock.js';

const exec = promisify(execFile);

// T2 — non-AI git worktree orchestrator.
//
// Goal: hoist worktree provisioning out of the agent's prompt into a
// deterministic helper the runner calls before `spawnCli`. Pre-T2 the
// agent had to call `git worktree add …` itself, which burned tokens,
// was fragile (especially on Windows where the sandboxed bash couldn't
// see GIT_CONFIG_GLOBAL), and produced inconsistent paths.
//
// Contract:
//   ensureWorktree({ item, project }) → { path, branch, freshlyCreated }
//
//   - If item.worktree_branch is null → throw WorktreeProvisioningError.
//     PO Writer's contract (T2) is to set this field on every dev/QA
//     story before downstream agents pick it up.
//   - Resolve the on-disk path: <project.git_path>/../worktrees/<projectSlug>/<branchSlug>.
//   - If the worktree already exists at that path and is on the right
//     branch: `git pull --ff-only origin <branch>` and return.
//   - If the branch exists on origin but no local worktree: `git fetch
//     origin <branch>` then `git worktree add <path> <branch>`.
//   - Else (branch doesn't exist on origin): `git worktree add -b
//     <branch> <path> origin/main`, then push the branch with upstream
//     tracking so subsequent runs find it on origin.
//   - Persist the resolved path back to items.worktree_path.
//
// Auth: when project.credential_id is set, builds a per-call temporary
// git config (mode 0600) containing `http.extraheader = AUTHORIZATION:
// basic <b64>` and invokes git with `GIT_CONFIG_GLOBAL=<tmp>` so the
// shell-out bypasses every credential helper. Mirrors the shape in
// agent-runner.ts:1121-1148 and git-status.ts.

export class WorktreeProvisioningError extends Error {
    public readonly code: WorktreeErrorCode;
    public readonly details: Record<string, unknown> | undefined;
    constructor(code: WorktreeErrorCode, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'WorktreeProvisioningError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

export type WorktreeErrorCode =
    | 'missing_worktree_branch'
    | 'missing_project_git_path'
    | 'git_command_failed'
    | 'invalid_branch_name'
    | 'worktree_diverged_from_main';

export interface EnsureWorktreeInput {
    /**
     * Item attached to the run, or null for project-scope runs.
     *
     * When non-null, `item.worktree_branch` supplies the branch name AND the
     * resolved on-disk path is persisted back to `items.worktree_path` so
     * downstream dispatches reuse the same checkout.
     *
     * When null, `branch` MUST be set. Nothing is persisted to `items` (there
     * is no item row to update); the orchestrator owns cleanup at run-end.
     */
    item: {
        id: string;
        worktree_branch: string | null;
        worktree_path: string | null;
    } | null;
    /**
     * Required when `item` is null; ignored when `item` is non-null
     * (item.worktree_branch wins). Must match WORKTREE_BRANCH_RE
     * (`atlas/<role>/<id>`).
     */
    branch?: string;
    project: {
        id: string;
        git_path: string | null;
        credential_id: string | null;
        default_branch?: string | null;
    };
    /**
     * Plan #7 — when false, a Path-3 net-new worktree skips the
     * `git push --set-upstream origin <branch>` step. The branch stays
     * local-only; the orchestrator's cleanup deletes it at run-end so
     * origin never sees it. Used for agents whose `push_code` is false
     * (PO Writer, PO Reviewer, Architect Reviewer). Default true to
     * preserve the legacy behavior for every other caller.
     */
    pushUpstream?: boolean;
}

// 2026-06-02 — `ROLE_BRANCH_OVERRIDES` and the per-agent `agent.role_id`
// input field were removed. `items.worktree_branch` (set by PO Writer
// when the story is authored) is now the single source of truth for
// every agent's branch. The Automation Engineer on a QA twin uses the
// QA twin's `atlas/qa/<id>` verbatim; if that branch has merged into
// main, automation tests need a rebase before merging. See
// `docs/superpowers/plans/2-workstream3-…` for the trade-off.

export interface EnsureWorktreeResult {
    path: string;
    branch: string;
    freshlyCreated: boolean;
}

// Owner-set branch names must match the dev/QA convention so the on-disk
// path stays sortable and inspectable. The PO Writer prompt enforces the
// dev/QA shape; we accept any `atlas/<segment>/<id>` shape here so
// custom Owner overrides don't get rejected.
export const WORKTREE_BRANCH_RE = /^atlas\/[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/;

function isValidBranchName(branch: string): boolean {
    return WORKTREE_BRANCH_RE.test(branch);
}

// Compute the canonical on-disk worktree path. Sibling-of-the-project
// layout: `<project.git_path>/../worktrees/<projectSlug>/<branchSlug>`.
// Sibling vs in-repo avoids polluting the project working tree with
// nested `.git/worktrees` entries the agent CLI might stumble over.
export function computeWorktreePath(projectGitPath: string, projectId: string, branch: string): string {
    const projectParent = dirname(resolve(projectGitPath));
    const branchSlug = branch.replace(/\//g, '__');
    return join(projectParent, 'worktrees', projectId, branchSlug);
}

interface GitInvokeContext {
    cwd: string;
    gitConfigPath: string | null;
}

// `gitInvokeEnv` lives in `./git-env.ts` so every git/gh shell-out in
// `packages/api/src/services/` shares the same env shape. See that file for
// the rationale on each flag. Anything new that calls `git` or `gh` MUST
// either route through `runGit` below (which already uses it) or pass
// `env: gitInvokeEnv(gitConfigPath | null)` to its own `exec`.

// F-009 — discard any uncommitted state in the worktree before
// operations that refuse dirty trees (rebase, ff-only pull). The
// project setup-script (e.g. mono-repo's SUNNY.md regeneration)
// re-creates files on every provision, leaving the worktree dirty
// even though no agent has committed yet. Every legitimate agent
// run commits its changes before exit + the cleanup deletes the
// worktree on success, so anything uncommitted at provision time
// is always noise — safe to discard.
//
// Best-effort: `reset --hard` followed by `clean -fd` handles both
// tracked and untracked files. Errors are swallowed because the
// caller will retry the actual operation; a meaningful error on the
// subsequent rebase / pull is more actionable than one on the reset.
async function resetWorktreeToHead(ctx: GitInvokeContext): Promise<void> {
    await runGit(ctx, ['reset', '--hard', 'HEAD'], 60_000).catch(() => undefined);
    await runGit(ctx, ['clean', '-fd'], 60_000).catch(() => undefined);
}

// Task 7 — rebase the worktree's current branch onto `origin/<defaultBranch>`.
// Wraps the rebase in an abort-on-failure so we never leave the worktree
// in a half-applied state — the run row surfaces the structured error
// and the Owner can resolve on main, then retry the dispatch.
//
// F-009 — discard the dirty state from setup-script artifacts first
// (otherwise the rebase refuses with "cannot rebase: You have
// unstaged changes"), and convert cherry-pick conflicts into a
// specific `worktree_diverged_from_main` error with the conflicting
// SHA so the Owner sees a clear hint instead of generic
// `git_command_failed`.
async function rebaseOntoOrigin(
    worktreePath: string,
    defaultBranch: string,
    gitConfigPath: string | null,
): Promise<void> {
    const ctx: GitInvokeContext = { cwd: worktreePath, gitConfigPath };
    await resetWorktreeToHead(ctx);
    try {
        await runGit(ctx, ['rebase', `origin/${defaultBranch}`], 120_000);
    } catch (err) {
        try {
            await runGit(ctx, ['rebase', '--abort'], 60_000);
        } catch {
            // Best-effort cleanup; the original error is the one that matters.
        }
        // F-009 — surface a clearer error when the rebase failed
        // because the branch has changes that don't apply on top of
        // current main (rebase produces "could not apply <sha>...").
        // Generic git_command_failed lands in a notification with no
        // actionable hint; this dedicated code lets the Owner +
        // dashboard surface "needs human resolution on main".
        const e = err as { message?: string; details?: { stderr?: string } };
        const stderr = e.details?.stderr ?? '';
        const applyMatch = stderr.match(/could not apply ([0-9a-f]{7,40})\b/i);
        if (applyMatch) {
            throw new WorktreeProvisioningError(
                'worktree_diverged_from_main',
                `Branch at ${worktreePath} has changes that don't apply cleanly on top of origin/${defaultBranch} (rebase conflict on ${applyMatch[1]}). Needs human resolution on main.`,
                {
                    worktree_path: worktreePath,
                    default_branch: defaultBranch,
                    conflicting_sha: applyMatch[1],
                    stderr: stderr.slice(0, 500),
                },
            );
        }
        throw err;
    }
}

async function runGit(
    ctx: GitInvokeContext,
    args: readonly string[],
    timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string }> {
    try {
        const res = await exec('git', ['-C', ctx.cwd, ...args], {
            env: gitInvokeEnv(ctx.gitConfigPath),
            timeout: timeoutMs,
            maxBuffer: 8 * 1024 * 1024,
        });
        return { stdout: res.stdout, stderr: res.stderr };
    } catch (err) {
        // execFile's promisified error carries stdout/stderr fields on
        // non-zero exit; surface both so the orchestrator can include
        // them in the WorktreeProvisioningError.details.
        const e = err as NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
            code?: string | number;
        };
        throw new WorktreeProvisioningError('git_command_failed', e.message, {
            args: ['-C', ctx.cwd, ...args],
            stdout: e.stdout ?? '',
            stderr: e.stderr ?? '',
            exitCode: e.code ?? null,
        });
    }
}

// D1 — scrub stale http.extraheader / credential.helper that
// Workstream C (commit 9bf3970) accidentally wrote into the project's
// shared `.git/config`. On Windows, git worktrees share the main
// repo's config unless `extensions.worktreeConfig` is enabled — so the
// `git config --local` writes from C landed in the main repo config,
// not the per-worktree config. Every subsequent git op against the
// repo (including this orchestrator's ls-remote / pull / fetch) then
// reads `http.extraheader` from the shared config AND from the per-call
// `GIT_CONFIG_GLOBAL` temp file → two Authorization headers → GitHub
// 400 "Duplicate header". This scrub unsets the leftover values on
// every `ensureWorktree` so installs that ran with C are remediated
// in-place. Idempotent (the `--unset-all` is a no-op when the key is
// absent). Wrapped in try/catch because git also exits non-zero on
// `--unset-all` of a missing key on some versions.
async function scrubSharedConfigDuplicateAuth(projectGitPath: string): Promise<void> {
    const baseEnv = gitInvokeEnv(null);
    for (const key of ['http.extraheader', 'credential.helper']) {
        try {
            await exec(
                'git',
                ['-C', projectGitPath, 'config', '--local', '--unset-all', key],
                { env: baseEnv, timeout: 15_000 },
            );
        } catch {
            // Key wasn't present (exit code 5) — that's the desired state.
        }
    }
    // Workstream #2 (2026-06-02) — `core.longpaths=true` lets Git for
    // Windows internally `\\?\`-prefix filesystem calls so paths past
    // MAX_PATH (260 chars) work. Without this, `git worktree remove`
    // fails on any worktree that contains a pnpm/.next/node_modules
    // tree and the directory strands on disk. Linked worktrees share
    // the main repo's `.git/config` on Windows, so this one write
    // covers every present and future worktree under the project.
    // Idempotent; on non-Windows it's a harmless no-op.
    try {
        await exec(
            'git',
            ['-C', projectGitPath, 'config', '--local', 'core.longpaths', 'true'],
            { env: baseEnv, timeout: 15_000 },
        );
    } catch {
        // Best-effort — a write failure here is non-fatal; the
        // robocopy fallback in `cleanupWorktreeAfterPushInner` still
        // catches the long-path case.
    }
}


// Workstream #2 — long-path-safe deletion via `robocopy <empty>
// <target> /MIR`. Robocopy ships with every Windows install and
// internally `\\?\`-prefixes filesystem calls, so it removes trees
// whose path lengths exceed MAX_PATH (260). Called by
// `cleanupWorktreeAfterPushInner` only on Windows AND only when `git
// worktree remove` failed with a "filename too long" error.
//
// Exit-code note: robocopy's exit code is a bitmask. 0–7 are
// success-ish (1 = files copied, 2 = extras detected, 4 = mismatches,
// combinations thereof). 8+ are real failures. `execFile`'s
// promisified wrapper throws on any non-zero exit, so we inspect
// `err.code` and re-throw only for 8+.
async function robocopyDeleteTree(targetPath: string): Promise<void> {
    if (!existsSync(targetPath)) return;
    const emptySrc = mkdtempSync(join(tmpdir(), 'atlas-empty-'));
    try {
        try {
            await exec(
                'robocopy',
                [
                    emptySrc,
                    targetPath,
                    '/MIR',
                    '/R:1',
                    '/W:1',
                    '/NFL',
                    '/NDL',
                    '/NJH',
                    '/NJS',
                    '/NC',
                    '/NS',
                    '/NP',
                ],
                { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
            );
        } catch (err) {
            const e = err as NodeJS.ErrnoException & { code?: number | string };
            const code = typeof e.code === 'number' ? e.code : Number(e.code);
            if (Number.isFinite(code) && code >= 8) throw err;
            // Codes 1–7 are success/info — fall through.
        }
        // The worktree is now empty; its own path is < MAX_PATH so the
        // standard rmSync succeeds.
        rmSync(targetPath, { recursive: true, force: true });
    } finally {
        // Always remove the throwaway empty source directory.
        try {
            rmSync(emptySrc, { recursive: true, force: true });
        } catch {
            /* best-effort */
        }
    }
}

// Probe whether the worktree directory looks like a git checkout on the
// expected branch. We don't trust `existsSync(path)` alone because a
// stale half-created worktree would pass that check.
async function probeWorktree(path: string, expectedBranch: string): Promise<boolean> {
    if (!existsSync(path)) return false;
    try {
        const res = await exec('git', ['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD'], {
            env: gitInvokeEnv(null),
            timeout: 15_000,
        });
        return res.stdout.trim() === expectedBranch;
    } catch {
        return false;
    }
}

// Check whether `origin/<branch>` exists. Returns true on a hit, false
// on a clean miss; throws WorktreeProvisioningError on unexpected git
// failures (network down, auth rejected, etc.).
async function originBranchExists(ctx: GitInvokeContext, branch: string): Promise<boolean> {
    try {
        const res = await exec(
            'git',
            ['-C', ctx.cwd, 'ls-remote', '--heads', 'origin', branch],
            {
                env: gitInvokeEnv(ctx.gitConfigPath),
                timeout: 30_000,
            },
        );
        return res.stdout.trim().length > 0;
    } catch (err) {
        const e = err as NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
            code?: string | number;
        };
        throw new WorktreeProvisioningError(
            'git_command_failed',
            `ls-remote failed: ${e.message}`,
            { stdout: e.stdout ?? '', stderr: e.stderr ?? '' },
        );
    }
}

export async function ensureWorktree(
    input: EnsureWorktreeInput,
): Promise<EnsureWorktreeResult> {
    // Workstream #3 — serialize git operations per project so concurrent
    // agent runs don't race on `fetch` / `worktree add` / `branch -D`.
    return withProjectGitLock(input.project.id, () => ensureWorktreeInner(input));
}

async function ensureWorktreeInner(
    input: EnsureWorktreeInput,
): Promise<EnsureWorktreeResult> {
    const { item, project } = input;
    const pushUpstream = input.pushUpstream !== false;

    // Resolve the branch name: item-attached uses item.worktree_branch (must
    // be set by PO Writer or the agent-runner fallback); project-scope passes
    // an explicit `branch` (generated as atlas/<kind|role|'run'>/<short-runId>
    // by the runner).
    const branchName = item?.worktree_branch ?? input.branch ?? null;
    if (!branchName) {
        throw new WorktreeProvisioningError(
            'missing_worktree_branch',
            item
                ? `Item ${item.id} has no worktree_branch — PO Writer is expected to set this before downstream agents are dispatched.`
                : 'ensureWorktree was called with no item and no branch — project-scope callers must supply `branch`.',
            item ? { item_id: item.id } : {},
        );
    }
    if (!isValidBranchName(branchName)) {
        throw new WorktreeProvisioningError(
            'invalid_branch_name',
            `Branch ${JSON.stringify(branchName)} does not match the atlas/<role>/<id> shape.`,
            item
                ? { item_id: item.id, worktree_branch: branchName }
                : { worktree_branch: branchName },
        );
    }
    if (!project.git_path || !project.git_path.trim()) {
        throw new WorktreeProvisioningError(
            'missing_project_git_path',
            `Project ${project.id} has no git_path — worktree orchestrator needs the cloned repo on disk to spawn a worktree from.`,
            { project_id: project.id },
        );
    }

    const branch = branchName;
    const worktreePath = computeWorktreePath(project.git_path, project.id, branch);
    const defaultBranch =
        project.default_branch && project.default_branch.trim() ? project.default_branch : 'main';

    // D1 — scrub stale http.extraheader / credential.helper from the
    // project's shared `.git/config` before any git op. Cleans up the
    // C-era leftover that was producing duplicate-Authorization 400s.
    // Idempotent; safe on fresh installs that never ran C.
    await scrubSharedConfigDuplicateAuth(project.git_path);

    const { configPath: gitConfigPath } = await buildGitConfig(project.credential_id);
    const projectCtx: GitInvokeContext = {
        cwd: project.git_path,
        gitConfigPath,
    };

    try {
        // Ensure the parent directory exists so `git worktree add` doesn't
        // fail on a missing intermediate. mkdir is idempotent under
        // recursive:true.
        mkdirSync(dirname(worktreePath), { recursive: true });

        // Always refresh `origin/<default>` before provisioning, regardless
        // of whether the worktree exists. This way the work branch's merge
        // base with main never goes stale silently — a Path-1 worktree that
        // we've been reusing for two weeks may pull --ff-only on its own
        // branch successfully while quietly diverging from a moved main.
        // The fetch is cheap; the alternative is hard-to-diagnose
        // merge-conflict surprises at PR time.
        await runGit(projectCtx, ['fetch', 'origin', defaultBranch], 90_000);

        const isReady = await probeWorktree(worktreePath, branch);
        let freshlyCreated = false;

        if (isReady) {
            // Path 1 — worktree exists and is on the right branch. Pull
            // FF-only so we get any new commits without merge surprises.
            //
            // F-009 — if a previous Owner / agent pushed a different
            // commit lineage to the same branch (or the worktree's
            // local commits diverged from origin), `pull --ff-only`
            // rejects with "Not possible to fast-forward, aborting".
            // Mirror the F-008 push-side fix on the pull side: detect
            // divergence and re-try with `pull --rebase`, which puts
            // the worktree's commits on top of the remote tip.
            const pullCtx: GitInvokeContext = { cwd: worktreePath, gitConfigPath };
            await resetWorktreeToHead(pullCtx);
            try {
                await runGit(
                    pullCtx,
                    ['pull', '--ff-only', 'origin', branch],
                    90_000,
                );
            } catch (err) {
                const e = err as { details?: { stderr?: string } };
                const stderrLower = (e.details?.stderr ?? '').toLowerCase();
                // F-010 — branch was deleted from origin after PR
                // merge (GitHub auto-delete-on-merge). Local still has
                // the branch + the work; pulling a non-existent ref
                // errors with "couldn't find remote ref". Treat as
                // benign: the rebase-onto-main step below brings the
                // worktree up to current main, which already contains
                // the merged work.
                const branchGone =
                    stderrLower.includes("couldn't find remote ref") ||
                    stderrLower.includes('remote ref does not exist');
                if (branchGone) {
                    // Skip the pull entirely; rebaseOntoOrigin handles
                    // catching up to main.
                } else {
                    const divergent =
                        stderrLower.includes('not possible to fast-forward') ||
                        stderrLower.includes("can't be fast-forwarded") ||
                        stderrLower.includes('non-fast-forward');
                    if (!divergent) throw err;
                    // Rebase fallback. resetWorktreeToHead was called above
                    // so the working tree is clean; pull --rebase will
                    // either land cleanly or surface the same
                    // `worktree_diverged_from_main`-style conflict we
                    // already model elsewhere.
                    await runGit(
                        pullCtx,
                        ['pull', '--rebase', 'origin', branch],
                        120_000,
                    );
                }
            }
            // Task 7 — rebase the agent's branch onto the just-fetched
            // origin/<defaultBranch> so we never start a run on stale
            // main. The ff-only pull above keeps the agent's own branch
            // history clean, but if main has moved forward since the
            // branch's last rebase, the merge base goes stale. Aborting
            // on conflict leaves the worktree in a clean state so the
            // run can be retried after the Owner resolves on main.
            await rebaseOntoOrigin(worktreePath, defaultBranch, gitConfigPath);
        } else {
            // Path 2 / 3 — need to provision the worktree.
            //
            // F-002 — orphan-worktree recovery. probeWorktree returned
            // false but the path may still exist on disk (a previous run
            // was cancelled / errored / left a wrong-branch checkout).
            // In that case `git worktree add <path>` would fail with
            // "directory already exists" and the next agent dispatch
            // errors instantly. Detect + clean up first so retries are
            // self-healing.
            if (existsSync(worktreePath)) {
                await runGit(
                    projectCtx,
                    ['worktree', 'remove', '--force', worktreePath],
                    60_000,
                ).catch(() => undefined);
                if (existsSync(worktreePath)) {
                    rmSync(worktreePath, { recursive: true, force: true });
                }
                // The local branch ref may also linger (worktree-add of
                // an existing branch into a fresh path is fine; but
                // when the ref points at a different state we want a
                // clean slate). `branch -D` of a branch git doesn't
                // know about is a no-op.
                await runGit(projectCtx, ['branch', '-D', branch], 30_000).catch(
                    () => undefined,
                );
            }
            const branchOnOrigin = await originBranchExists(projectCtx, branch);
            if (branchOnOrigin) {
                // Path 2 — fetch the existing remote branch and add a
                // worktree tracking it.
                await runGit(projectCtx, ['fetch', 'origin', branch], 90_000);
                await runGit(
                    projectCtx,
                    ['worktree', 'add', worktreePath, branch],
                    120_000,
                );
                // Task 7 — same rebase as Path 1 (the existing remote
                // branch may also lag main). Path 3 is cut fresh from
                // origin/<default>, so it skips this step.
                await rebaseOntoOrigin(worktreePath, defaultBranch, gitConfigPath);
            } else {
                // Path 3 — net-new branch. Cut it off origin/<default>;
                // the fetch already happened above so the base is fresh.
                await runGit(
                    projectCtx,
                    [
                        'worktree',
                        'add',
                        '-b',
                        branch,
                        worktreePath,
                        `origin/${defaultBranch}`,
                    ],
                    120_000,
                );
                // Plan #7 — skip the upstream push for agents whose
                // push_code is false (PO Writer, the read-only
                // reviewers). The branch stays local-only; cleanup
                // deletes it at run-end so origin never sees it.
                if (pushUpstream) {
                    await runGit(
                        {
                            cwd: worktreePath,
                            gitConfigPath,
                        },
                        ['push', '--set-upstream', 'origin', branch],
                        120_000,
                    );
                }
            }
            freshlyCreated = true;
        }

        // Persist the resolved path back to the item row so later
        // dispatches reuse the same on-disk checkout instead of relitigating.
        // Skip the write when the value is already up-to-date so the
        // updated_at column doesn't churn on every re-dispatch.
        // Project-scope runs (item === null) skip this entirely — there is
        // no item row to bind the worktree path to; the orchestrator's
        // cleanup at run-end removes the worktree regardless.
        if (item && item.worktree_path !== worktreePath) {
            await db
                .updateTable('items')
                .set({ worktree_path: worktreePath })
                .where('id', '=', item.id)
                .execute();
        }

        // Protect the target project from atlas's per-run scratch by
        // injecting the patterns into the worktree's tracked `.gitignore`
        // and staging the change. The agent's commit picks it up; once
        // pushed and merged the protection lives on `main` permanently.
        // Idempotent — repeats on the same worktree are no-ops.
        await ensureWorktreeGitignore(worktreePath, gitConfigPath);

        return { path: worktreePath, branch, freshlyCreated };
    } finally {
        cleanupGitConfig(gitConfigPath);
    }
}

// Patterns appended to the target project's `.gitignore` so atlas's
// per-run scratch never gets committed. Only atlas-prefixed files inside
// `.claude/commands` and `.github/prompts` are excluded (so the Owner's
// own files in those dirs stay tracked); the entire `.atlas/` is ours.
const ATLAS_GITIGNORE_PATTERNS = [
    '.claude/commands/atlas-*',
    '.github/prompts/atlas-*',
    '.atlas/',
] as const;

const ATLAS_GITIGNORE_HEADER = '# Atlas scratch — orchestrator-managed, do not edit by hand';

/**
 * Ensures the worktree's `.gitignore` contains every atlas-scratch
 * pattern, then runs `git add .gitignore` so the agent's commit will
 * include the change. The previous `.git/info/exclude` approach
 * (untracked, local-only) didn't stop `.atlas/` files from being pushed
 * once an agent explicitly added them or ran `git add -A` after a file
 * had been tracked in an earlier run — committing the gitignore is the
 * durable fix.
 *
 * Idempotent: re-reads each call, appends only the missing patterns.
 * Exported for testing.
 */
export async function ensureWorktreeGitignore(
    worktreePath: string,
    gitConfigPath: string | null,
): Promise<void> {
    const gitignorePath = join(worktreePath, '.gitignore');
    const existing = readGitignoreIfExists(gitignorePath);
    const existingLines = existing.split(/\r?\n/);
    const missing = ATLAS_GITIGNORE_PATTERNS.filter(
        (p) => !existingLines.some((line) => line.trim() === p),
    );
    if (missing.length === 0) {
        return; // already protected; no write, no stage
    }
    // Preserve existing content verbatim. Append a header + every missing
    // pattern, with a leading blank line when the existing file doesn't
    // already end in one.
    const prefix =
        existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    const block =
        ATLAS_GITIGNORE_HEADER +
        '\n' +
        missing.join('\n') +
        '\n';
    const next = existing + prefix + block;
    writeFileSync(gitignorePath, next, 'utf8');
    // Stage so the next commit (the agent's, or a follow-up) includes it.
    // Best-effort: if `git add` fails (e.g. worktree mid-tear-down), log
    // the error path but don't throw — the worst case is that the agent
    // commits without the gitignore and we try again on the next run.
    try {
        await runGit(
            { cwd: worktreePath, gitConfigPath },
            ['add', '.gitignore'],
            30_000,
        );
    } catch {
        // Defensive — see comment above. The file is still on disk and
        // a future run will re-attempt the staging.
    }
}

function readGitignoreIfExists(gitignorePath: string): string {
    try {
        if (!existsSync(gitignorePath)) return '';
        return readFileSync(gitignorePath, 'utf8');
    } catch {
        return '';
    }
}

// Prompt preamble the runner prepends to the agent's prompt. Kept short
// because it competes for the model's attention with the role-specific
// instructions below it; the key signal is "do not run git pull or
// worktree commands — the harness already did that".
export function buildWorktreePreamble(opts: {
    branch: string;
    path: string;
    freshlyCreated: boolean;
}): string {
    return [
        '## Worktree (pre-provisioned by the harness)',
        '',
        `Your working directory is the worktree at \`${opts.path}\`.`,
        `It is already checked out on branch \`${opts.branch}\` and synced with origin.`,
        opts.freshlyCreated
            ? 'The worktree was just created from origin/main for this run.'
            : 'The worktree was pulled --ff-only and rebased onto fresh origin/main just before the run started.',
        '',
        '**Do NOT run `git worktree add`, `git pull`, `git fetch`, `git checkout <branch>`, `git push`, or `gh pr create` / `gh pr edit`.** The harness owns all network git operations: it pulls before your run starts and pushes whatever you commit when your run ends (on success AND on failure). When your agent has `raises_pr = true` and the run exits cleanly, the harness opens the PR for you (URL written to `items.pr_url` automatically). Edit files and commit from the current directory; everything else is taken care of for you.',
        '',
        '**If the worktree looks broken — `.git` file pointing nowhere, expected files appear missing, `git rev-parse --abbrev-ref HEAD` errors out — STOP IMMEDIATELY.** Do NOT write a script to "fix" gitdir links, do NOT manually edit `.git/worktrees/*`, do NOT `git checkout` the branch in some other clone to "rescue" it. Past incident (2026-06-03): a self-repair attempt accidentally attached the project\'s main clone to the worktree\'s branch, leaving every subsequent run blocked. Instead: post a comment naming the broken path + branch via `mcp__atlas__update_item({ action: "add_comment", ... })`, then emit a `atlas-outcome` fenced block with `outcome: asked_question`, `summary: worktree_inconsistent`, and exit. The Owner does the manual recovery.',
        '',
    ].join('\n');
}

// D2 — push the worktree's current HEAD to origin. Called by the
// runner at the end of every run (success OR failure) so whatever the
// agent committed lands on the branch and nothing gets stranded on
// disk. Uses the same `GIT_CONFIG_GLOBAL` + http.extraheader auth path
// as the rest of the orchestrator's network ops.
//
// Behaviour:
//   • Branch is pushed via `git push --set-upstream origin HEAD:<branch>`.
//     `--set-upstream` is idempotent when upstream is already set.
//   • "Everything up-to-date" stderr maps to `alreadyUpToDate: true`
//     (no commits to push since the orchestrator's pre-run pull).
//   • Auth / conflict failures return `{ pushed: false, error }` instead
//     of throwing — the caller surfaces a non-fatal failure to the Owner.
export interface PushWorktreeResult {
    pushed: boolean;
    alreadyUpToDate: boolean;
    error?: string;
}

export async function pushWorktree(
    worktreePath: string,
    branch: string,
    credentialId: string | null,
    projectId: string,
): Promise<PushWorktreeResult> {
    return withProjectGitLock(projectId, () =>
        pushWorktreeInner(worktreePath, branch, credentialId),
    );
}

async function pushWorktreeInner(
    worktreePath: string,
    branch: string,
    credentialId: string | null,
): Promise<PushWorktreeResult> {
    // Hard-fail when auth is not wired. Spawning `git push` without an
    // extraheader on Windows hands the request to the system credential
    // helper (GCM Core), which pops a modal — exactly the loop we want
    // to break. Surface a clear error so the Owner knows what to fix
    // in Project Settings instead of being trained to dismiss prompts.
    const { configPath: gitConfigPath, transient: authTransient } =
        await buildGitConfig(credentialId);
    if (!gitConfigPath) {
        // Distinguish transient mint failures (GitHub 5xx during
        // installation-token refresh) from permanent misconfiguration.
        // Prior to the 2026-07-03 audit fix these looked identical
        // ("re-attach the credential"), and Owners re-attaching during
        // a GitHub outage would wipe `app_installation_id` and start
        // another mint against the same 5xx — cycling until GitHub
        // recovered. Steer them toward a retry when the failure is
        // transient.
        const reason = credentialId
            ? authTransient
                ? `project credential ${credentialId}: GitHub App installation-token mint is currently failing (likely a transient GitHub outage). Retry in a few minutes before re-attaching.`
                : `project credential ${credentialId} not found or token unreadable — re-attach it in Project Settings`
            : 'project credential_id is not configured — set it in Project Settings and re-run';
        return { pushed: false, alreadyUpToDate: false, error: reason };
    }
    // Skip push entirely if the worktree dir is gone or is not a git repo.
    // Happens when the previous agent's cleanup ran while the current run
    // was using the same path (MON-3 race), or when a read-only review
    // agent (using GitHub MCP only) had its worktree cleaned up between
    // spawn and push. Avoids the noisy `fatal: not a git repository`
    // pair we saw in MON-3's reviewer tail log.
    if (!existsSync(join(worktreePath, '.git'))) {
        return {
            pushed: false,
            alreadyUpToDate: false,
            error: `worktree at ${worktreePath} is not a git repo (likely cleanup-deleted or never created); push skipped`,
        };
    }
    const pushArgs = [
        '-C',
        worktreePath,
        'push',
        '--set-upstream',
        'origin',
        `HEAD:${branch}`,
    ];
    const env = gitInvokeEnv(gitConfigPath);
    const pushOpts = { env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 };

    try {
        const res = await exec('git', pushArgs, pushOpts);
        // git's "Everything up-to-date" emits on stderr (not stdout).
        const stderr = (res.stderr ?? '').toLowerCase();
        const alreadyUpToDate = stderr.includes('everything up-to-date');
        return { pushed: !alreadyUpToDate, alreadyUpToDate };
    } catch (err) {
        const e = err as NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
            code?: string | number;
        };
        const stderrLower = (e.stderr ?? '').toLowerCase();
        // F-008 — non-fast-forward divergence handling.
        //
        // When a previous run pushed a different commit lineage to the
        // same branch (e.g. the worktree was re-provisioned mid-stream
        // and re-derived the QA Writer commit with a different SHA, or
        // a previous Owner cleanup wiped local state but left the
        // remote branch), plain `git push` rejects with "non-fast-forward".
        // The agent's real work then never reaches the PR.
        //
        // Recovery: fetch + rebase HEAD onto origin/<branch>, then
        // retry the push exactly once. If the rebase produces a
        // conflict, abort it and surface the original push error so
        // the Owner sees the divergence rather than getting silently
        // corrupted state.
        const isNonFastForward =
            stderrLower.includes('non-fast-forward') ||
            stderrLower.includes('rejected') ||
            stderrLower.includes('updates were rejected');
        if (isNonFastForward) {
            try {
                await exec(
                    'git',
                    ['-C', worktreePath, 'fetch', 'origin', branch],
                    pushOpts,
                );
                await exec(
                    'git',
                    ['-C', worktreePath, 'rebase', `origin/${branch}`],
                    pushOpts,
                );
                const retry = await exec('git', pushArgs, pushOpts);
                const retryStderr = (retry.stderr ?? '').toLowerCase();
                const alreadyUpToDate = retryStderr.includes('everything up-to-date');
                return {
                    pushed: !alreadyUpToDate,
                    alreadyUpToDate,
                };
            } catch (rebaseErr) {
                // Rebase or retry-push failed (conflict, or remote
                // still ahead after concurrent push). Abort any
                // half-applied rebase so the worktree is left in a
                // clean state for cleanup, then surface the original
                // push error so the Owner sees the divergence.
                await exec('git', ['-C', worktreePath, 'rebase', '--abort'], pushOpts).catch(
                    () => undefined,
                );
                const re = rebaseErr as { stderr?: string; message?: string };
                const rebaseSnippet = (re.stderr ?? re.message ?? '').slice(0, 200);
                const snippet = (e.stderr ?? e.message ?? '').slice(0, 300);
                return {
                    pushed: false,
                    alreadyUpToDate: false,
                    error: `non-fast-forward push; rebase failed (${rebaseSnippet}); original: ${snippet}`,
                };
            }
        }
        // Trim to a reasonable snippet for activity-log + notification.
        const snippet = (e.stderr ?? e.message ?? '').slice(0, 500);
        return { pushed: false, alreadyUpToDate: false, error: snippet };
    } finally {
        cleanupGitConfig(gitConfigPath);
    }
}

// Plan E — open a pull request against the project's default branch
// using the API server's stored GitHub credential. Called by the agent
// runner at run-end, gated on `agent.raises_pr === true` AND a clean
// successful exit. Agents themselves never invoke `gh pr create`; this
// keeps the GitHub token in API-server hands and means the audit trail
// shows the orchestrator (not the AI's spawned shell) as the PR
// creator, which the Owner's GitHub org permissions are scoped against.
//
// Idempotency: if a PR with `head: <branch>` already exists, `gh pr
// create` errors with "already exists"; we detect that and re-fetch the
// existing URL via `gh pr view --json url`. Net effect: re-running a
// reviewer agent on the same item doesn't spawn duplicate PRs.
export interface OpenPullRequestResult {
    opened: boolean;
    url: string | null;
    alreadyExists: boolean;
    error?: string;
}

export async function openPullRequest(opts: {
    worktreePath: string;
    branch: string;
    base: string;
    title: string;
    body: string;
    credentialId: string | null;
    projectId: string;
}): Promise<OpenPullRequestResult> {
    return withProjectGitLock(opts.projectId, () => openPullRequestInner(opts));
}

async function openPullRequestInner(opts: {
    worktreePath: string;
    branch: string;
    base: string;
    title: string;
    body: string;
    credentialId: string | null;
}): Promise<OpenPullRequestResult> {
    const { worktreePath, branch, base, title, body, credentialId } = opts;
    // Hard-fail on missing/unreadable credential — same reasoning as
    // `pushWorktreeInner`: `gh pr create` without the extraheader path
    // falls back to whatever auth `gh` has cached, but the underlying
    // git operations it invokes can still bounce off GCM. Refuse early
    // with a clear message.
    //
    // We also need the plaintext token here so `gh` picks up the App
    // identity via `GH_TOKEN` — without it, `gh` uses the developer's
    // own `gh auth login` and the PR ends up attributed to them even
    // though `git push` (which reads `http.extraheader`) runs as the bot.
    // github_app credentials can throw GitAuthUnavailableError on
    // transient GitHub 5xx during lazy mint; convert to the documented
    // structured no-throw result so the outer runner logs "PR: FAILED"
    // instead of "post-run hook crashed".
    let gitAuth;
    try {
        gitAuth = await buildGitAuth(credentialId);
    } catch (err) {
        if (err instanceof GitAuthUnavailableError) {
            return {
                opened: false,
                url: null,
                alreadyExists: false,
                error: `credential ${credentialId} auth mint failed — GitHub may be reachable but the App token refresh returned an error`,
            };
        }
        throw err;
    }
    if (!gitAuth) {
        const reason = credentialId
            ? `project credential ${credentialId} not found or token unreadable — re-attach it in Project Settings`
            : 'project credential_id is not configured — set it in Project Settings and re-run';
        return { opened: false, url: null, alreadyExists: false, error: reason };
    }
    const gitConfigPath = gitAuth.configPath;
    const env = gitInvokeEnv(gitConfigPath, gitAuth.token);
    // Migration 025 — when the credential has a `human_gh_login`, mirror
    // the isw-CDM-Next/cdmnext-claude-bot playbook: assign the human as
    // PR assignee, and prepend `Requested-By: @<login>` to the body so
    // the PR is traceable to the human even when the App is the author.
    // Both are no-ops if the credential is a PAT or the human_gh_login
    // is null.
    const humanBody =
        gitAuth.humanGhLogin
            ? `Requested-By: @${gitAuth.humanGhLogin}\n\n${body}`
            : body;
    const ghArgs: string[] = [
        'pr',
        'create',
        '--head',
        branch,
        '--base',
        base,
        '--title',
        title,
        '--body',
        humanBody,
    ];
    if (gitAuth.humanGhLogin) {
        ghArgs.push('--assignee', gitAuth.humanGhLogin);
    }
    try {
        try {
            const res = await exec(
                'gh',
                ghArgs,
                { cwd: worktreePath, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
            );
            const stdout = (res.stdout ?? '').trim();
            const lastLine = stdout.split(/\r?\n/).pop() ?? '';
            const url = /^https?:\/\//.test(lastLine) ? lastLine : null;
            return { opened: true, url, alreadyExists: false };
        } catch (createErr) {
            const e = createErr as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
            const combined = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.toLowerCase();
            const isDuplicate =
                combined.includes('already exists') || combined.includes('a pull request');
            if (!isDuplicate) {
                const snippet = (e.stderr ?? e.message ?? '').slice(0, 500);
                return { opened: false, url: null, alreadyExists: false, error: snippet };
            }
            // PR already open — fetch its URL so the caller can persist it.
            try {
                const view = await exec(
                    'gh',
                    ['pr', 'view', branch, '--json', 'url', '-q', '.url'],
                    { cwd: worktreePath, env, timeout: 60_000 },
                );
                const url = (view.stdout ?? '').trim();
                return { opened: false, url: url || null, alreadyExists: true };
            } catch (viewErr) {
                const v = viewErr as NodeJS.ErrnoException & { stderr?: string };
                const snippet = (v.stderr ?? v.message ?? '').slice(0, 500);
                return { opened: false, url: null, alreadyExists: true, error: snippet };
            }
        }
    } finally {
        cleanupGitConfig(gitConfigPath);
    }
}

// Phase 1.5b — the legacy `.atlas-run/MANDATE_CONSTITUTION.md +
// WORK.md` two-file scheme has been retired. All paired item-driven
// runs now write the full `.atlas/` tree via `atlas-regen.ts` and
// the agent reads `.atlas/commands/<stage>.md` instead. The
// `writeRunArtefacts` / `cleanupRunArtefacts` / `buildRunArtefactCliPrompt`
// helpers were deleted on 2026-06-07; their cleanup hook in
// `agent-runner.ts` is now a no-op (the regenerator wipes the per-run
// `.atlas/` directory at the start of every run, so no
// between-run cleanup is needed).

// Owner's "remote is source of truth" lifecycle — after a successful
// push, delete the local worktree folder, the local branch ref, and
// null out items.worktree_path / items.worktree_branch. The next run on
// the same item re-provisions via ensureWorktree Path 2 (existing
// remote branch → fetch + worktree add) instead of Path 1.
//
// Best-effort: each step is caught independently, warnings collected
// but never thrown. A failed cleanup must never poison the run — the
// push already succeeded and the remote has the state.
//
// Caller contract: invoke ONLY when push.pushed || push.alreadyUpToDate.
// On push failure, keep the worktree on disk so manual recovery is
// still possible.
export interface CleanupWorktreeResult {
    worktreeRemoved: boolean;
    branchDeleted: boolean;
    dbCleared: boolean;
    warnings: string[];
}

export async function cleanupWorktreeAfterPush(opts: {
    /**
     * Null for project-scope runs (no item to clear `worktree_path` on).
     * Step 3 (items.worktree_path null-out) is skipped when null; Steps 1
     * (worktree remove), 2 (branch delete), and 4 (fetch --prune) still
     * fire so the on-disk + ref state matches `requires_worktree=true`.
     */
    itemId: string | null;
    projectId: string;
    projectGitPath: string;
    worktreePath: string;
    branch: string;
    credentialId: string | null;
}): Promise<CleanupWorktreeResult> {
    return withProjectGitLock(opts.projectId, () => cleanupWorktreeAfterPushInner(opts));
}

async function cleanupWorktreeAfterPushInner(opts: {
    itemId: string | null;
    projectGitPath: string;
    worktreePath: string;
    branch: string;
    credentialId: string | null;
}): Promise<CleanupWorktreeResult> {
    const warnings: string[] = [];
    let worktreeRemoved = false;
    let branchDeleted = false;
    let dbCleared = false;

    // Build the credentialed git config up front so Step 4's network fetch
    // authenticates without falling through to GCM. Steps 1-2 are local and
    // pass `gitInvokeEnv(null)` (silencers only, no credential). When the
    // project has no credential row, Step 4 is skipped entirely — the daily
    // `auto-fetch.ts` job is the safety net for refreshing remote refs.
    const gitConfigPath = opts.credentialId
        ? (await buildGitConfig(opts.credentialId)).configPath
        : null;

    // Step 1: git worktree remove --force. Runs from the main repo
    // because the worktree itself is being deleted (its own cwd would
    // be invalid). 2026-06-03: a flaky Windows file-handle race ("fatal:
    // failed to delete '<path>': Directory not empty") was leaving the
    // worktree dir on disk while Step 1's `git worktree prune` post-
    // failure still removed the admin entry, so Step 2 (`git branch -D`)
    // succeeded and the next dispatch saw a dangling .git pointer — the
    // agent then "rescued" it by accidentally attaching the main clone
    // to the branch. The mitigations:
    //   (a) retry the remove with escalating backoffs totalling up to
    //       ~10 minutes — most handle-busy races clear in seconds, but
    //       long-running `tsc --watch` / `vite dev` / antivirus indexers
    //       can hang on for minutes before releasing files;
    //   (b) widen the robocopy fallback to cover "Directory not empty"
    //       (was previously gated to long-path errors only);
    //   (c) ONLY skip ahead to Step 2 when the worktree was actually
    //       removed. Half-removed state is left for manual recovery, not
    //       compounded by deleting the branch.
    //
    // Backoffs: 1s, 5s, 15s, 30s, 60s, 120s, 180s, 180s → 9 attempts,
    // ~9.85 min total wait. After that we hand over to the user.
    const REMOVE_BACKOFFS_MS = [1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 180_000, 180_000];
    const MAX_REMOVE_ATTEMPTS = REMOVE_BACKOFFS_MS.length + 1;
    let lastRemoveMsg = '';
    for (let attempt = 1; attempt <= MAX_REMOVE_ATTEMPTS; attempt++) {
        try {
            await exec(
                'git',
                ['-C', opts.projectGitPath, 'worktree', 'remove', '--force', opts.worktreePath],
                { env: gitInvokeEnv(null), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
            );
            worktreeRemoved = true;
            if (attempt > 1) {
                warnings.push(`worktree removed on attempt ${attempt}/${MAX_REMOVE_ATTEMPTS} after transient busy errors`);
            }
            break;
        } catch (err) {
            lastRemoveMsg = ((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? (err as Error).message ?? '').slice(0, 500);
            // Bail-fast on permanent errors. "not a working tree" means git's
            // bookkeeping for this path is gone (the registration in
            // `.git/worktrees/<id>` was pruned or never created). Retrying
            // for 10 minutes won't bring it back — fall through to the
            // robocopy/manual-warn path immediately. Was producing the
            // ~10 min "stuck in_progress" pattern observed on MON-3.
            if (/not a working tree/i.test(lastRemoveMsg)) {
                warnings.push(
                    `worktree remove attempt ${attempt}/${MAX_REMOVE_ATTEMPTS} hit permanent error 'not a working tree'; bailing fast`,
                );
                break;
            }
            if (attempt < MAX_REMOVE_ATTEMPTS) {
                const backoff = REMOVE_BACKOFFS_MS[attempt - 1] ?? 180_000;
                warnings.push(
                    `worktree remove attempt ${attempt}/${MAX_REMOVE_ATTEMPTS} failed (${lastRemoveMsg.slice(0, 120)}); retrying in ${Math.round(backoff / 1000)}s`,
                );
                await new Promise((r) => setTimeout(r, backoff));
                continue;
            }
            warnings.push(`worktree remove failed after ${MAX_REMOVE_ATTEMPTS} attempts (~10 min): ${lastRemoveMsg}`);
        }
    }

    if (!worktreeRemoved) {
        // Robocopy fallback — was previously gated to "path too long"
        // only; widen to cover "Directory not empty" since the same
        // \\?\ long-path semantics apply there too (robocopy uses
        // unbuffered IO + retries by default).
        if (
            process.platform === 'win32' &&
            /file ?name too long|path too long|directory not empty/i.test(lastRemoveMsg)
        ) {
            try {
                await robocopyDeleteTree(opts.worktreePath);
                worktreeRemoved = true;
                warnings.push(`worktree removed via robocopy fallback after rename/busy failure`);
            } catch (rcErr) {
                const rcMsg = ((rcErr as Error).message ?? '').slice(0, 300);
                warnings.push(`robocopy fallback failed: ${rcMsg}`);
            }
        }
        // Last-ditch: prune the admin entry only when nothing else
        // worked AND the directory really is gone. We deliberately do
        // NOT prune when the dir is still present — that's how the
        // half-removed state was produced before. Without the admin
        // entry, `git branch -D` would succeed and leave the worktree
        // orphaned on disk for the next run to choke on.
        if (!worktreeRemoved && !existsSync(opts.worktreePath)) {
            try {
                await exec(
                    'git',
                    ['-C', opts.projectGitPath, 'worktree', 'prune'],
                    { env: gitInvokeEnv(null), timeout: 30_000, maxBuffer: 1 * 1024 * 1024 },
                );
            } catch (pruneErr) {
                const pruneMsg = ((pruneErr as NodeJS.ErrnoException & { stderr?: string }).stderr ?? (pruneErr as Error).message ?? '').slice(0, 300);
                warnings.push(`worktree prune failed: ${pruneMsg}`);
            }
        }
    }

    // Step 2: git branch -D — ONLY when the worktree was actually
    // removed. If the directory is still on disk and git still considers
    // it linked, deleting the branch would put us in the broken state
    // that produced the main-clone-pollution incident on 2026-06-03.
    // Leaving the local branch alone keeps the state consistent: a
    // future ensureWorktree call will see the worktree dir, probe it
    // (Path 1) or recreate it cleanly via Path 2.
    if (worktreeRemoved) {
        try {
            await exec(
                'git',
                ['-C', opts.projectGitPath, 'branch', '-D', opts.branch],
                { env: gitInvokeEnv(null), timeout: 30_000, maxBuffer: 1 * 1024 * 1024 },
            );
            branchDeleted = true;
        } catch (err) {
            const msg = ((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? (err as Error).message ?? '').slice(0, 500);
            warnings.push(`branch delete failed: ${msg}`);
        }
    } else {
        warnings.push(
            `skipped branch delete because worktree dir is still on disk — leaving local branch '${opts.branch}' intact for the next ensureWorktree call`,
        );
    }

    // Step 3: clear items.worktree_path ONLY. `worktree_branch` is
    // per-story metadata owned by PO Writer (it's the branch the entire
    // multi-agent chain — Architect → Architect Reviewer → Coder →
    // Coder Reviewer — works on); nulling it would break every
    // downstream agent's `ensureWorktree` gate
    // (`agent-runner.ts:if (worktree_branch)`), so the next agent would
    // skip worktree provisioning entirely and run against the bare
    // project clone. Only the on-disk `worktree_path` is per-run state
    // and should be cleared. Runs regardless of git outcomes — remote is
    // the source of truth and the DB must reflect that, even if local
    // cleanup partially failed (ensureWorktree Path 1 will still catch
    // the leftover directory on the next dispatch as a defensive
    // fallback).
    if (opts.itemId !== null) {
        try {
            await db
                .updateTable('items')
                .set({ worktree_path: null })
                .where('id', '=', opts.itemId)
                .execute();
            dbCleared = true;
        } catch (err) {
            warnings.push(`db clear failed: ${(err as Error).message}`);
        }
    } else {
        // Project-scope run — no item row to clear. Treat as "DB cleared"
        // for the result so the success log line doesn't read as a partial
        // failure (`db=false`) when nothing was supposed to be done.
        dbCleared = true;
    }

    // Step 4 (Workstream #3): `git fetch origin --prune` against the
    // project clone so `refs/remotes/origin/*` reflects the actual remote
    // state — merged-and-deleted branches disappear from the local view.
    // Implicit refspec, so `--prune` is safe (the auto-fetch.ts ban is
    // about explicit single-branch refspecs only). Best-effort — a
    // network blip surfaces as a warning, never as a thrown failure.
    //
    // GCM safety (this is the bug fix): network fetch MUST go through
    // `gitInvokeEnv(gitConfigPath)` so `GIT_CONFIG_NOSYSTEM=1` blocks
    // /etc/gitconfig's `credential.helper = manager` and the
    // `http.extraheader` from our temp config authenticates the request.
    // Without these, Git for Windows hands the auth challenge to GCM,
    // which pops a modal right after every run's push — exactly the
    // popup the Owner was seeing. When the project has no credential,
    // skip the fetch entirely; `auto-fetch.ts` is the safety net.
    if (gitConfigPath) {
        try {
            await exec(
                'git',
                ['-C', opts.projectGitPath, 'fetch', 'origin', '--prune'],
                { env: gitInvokeEnv(gitConfigPath), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
            );
        } catch (err) {
            const msg = ((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? (err as Error).message ?? '').slice(0, 500);
            warnings.push(`fetch --prune failed: ${msg}`);
        }
    } else {
        warnings.push('fetch --prune skipped: project has no credential (auto-fetch will catch up on its next cycle)');
    }

    // Always release the temp git config, even if any step above warned.
    if (gitConfigPath) {
        try {
            cleanupGitConfig(gitConfigPath);
        } catch {
            // Tempfile already gone or unreadable — non-fatal; the file
            // lives under os.tmpdir() and the OS will reap it.
        }
    }

    return { worktreeRemoved, branchDeleted, dbCleared, warnings };
}

// `buildRunArtefactCliPrompt` deleted with the rest of the legacy
// two-file scheme on 2026-06-07. The phase-1 pointer prompt is built
// inline in `agent-runner.ts:spawnAgentRun` after `atlasRegenerate`
// completes (it names `.atlas/commands/<stage>.md` + the prereqs
// script + the dispatch-token requirement).
