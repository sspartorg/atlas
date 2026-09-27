// A workflow run's code changes, read inside Atlas instead of on GitHub.
//
// Each repo of the run is diffed from the best copy of its work still on this
// machine, and the response says which one it used:
//
//   worktree    — the run's own checkout exists (running, parked, cancelled,
//                 or a delivery whose push failed). Both scopes, exactly what
//                 the terminal Stop modal shows.
//   branch      — delivery removed the checkout (`cleanupWorktreeAfterPush`)
//                 but the repo's clone still has the branch: locally when
//                 cleanup kept it, else `origin/<branch>` from the push. The
//                 committed scope only.
//   unavailable — neither is left, typically because the PR merged and the
//                 remote branch was deleted and pruned. Said plainly rather
//                 than shown as "no changes", which would be a lie.
//
// All git work, including the security flags and output limits, stays in
// worktree-diff.ts; this module only decides WHICH directory and ref to hand it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
    CliSessionDiffScopeName,
    CliSessionFilePatchResponse,
    IProjectRepo,
    WorkflowRunDiffResponse,
    WorkflowRunRepoDiff,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { runRepos } from './run-repos.js';
import {
    getWorktreeDiffSummary,
    getWorktreeFilePatch,
    resolveBranchHead,
} from './worktree-diff.js';

type RepoSource =
    | { source: 'worktree'; path: string; headRef: undefined }
    | { source: 'branch'; path: string; headRef: string }
    | { source: 'unavailable'; reason: string };

/** A git checkout (a worktree's `.git` is a file, a clone's a folder). */
function isCheckout(path: string): boolean {
    // An empty git_path (a repo that never finished cloning) must not resolve
    // to `.git` relative to the API's own cwd — that is Atlas's repo.
    return path.length > 0 && existsSync(join(path, '.git'));
}

async function resolveSource(repo: IProjectRepo, livePath: string, branch: string): Promise<RepoSource> {
    if (isCheckout(livePath)) return { source: 'worktree', path: livePath, headRef: undefined };
    if (!isCheckout(repo.git_path)) {
        return { source: 'unavailable', reason: `The ${repo.name} clone is not on this machine, so there is nothing to diff.` };
    }
    const headRef = await resolveBranchHead(repo.git_path, branch);
    if (!headRef) {
        return {
            source: 'unavailable',
            reason: `The branch ${branch} is gone from ${repo.name} — usually because its pull request merged and the remote branch was deleted. Its changes are on the default branch now.`,
        };
    }
    return { source: 'branch', path: repo.git_path, headRef };
}

async function loadRun(runId: string) {
    return db
        .selectFrom('workflow_runs')
        .select(['id', 'project_id', 'item_id', 'branch', 'worktree_path'])
        .where('id', '=', runId)
        .executeTakeFirst();
}

/** Null when the run does not exist. */
export async function getWorkflowRunDiff(runId: string): Promise<WorkflowRunDiffResponse | null> {
    const run = await loadRun(runId);
    if (!run) return null;
    const { repos } = await runRepos(run);
    const out: WorkflowRunRepoDiff[] = [];
    // Sequential on purpose: each summary is several git spawns, and a Task
    // spans a handful of repos at most.
    for (const { repo, path } of repos) {
        const base = { repo_id: repo.id, repo_name: repo.name };
        // runRepos returns no repos without a branch, so it is set here.
        const src = await resolveSource(repo, path, run.branch as string);
        if (src.source === 'unavailable') {
            out.push({ ...base, source: 'unavailable', reason: src.reason, summary: null });
            continue;
        }
        // A checkout vanishing between the probe and the diff (delivery cleanup
        // racing this read) throws WorktreeDiffError; the route answers 409.
        const summary = await getWorktreeDiffSummary({
            worktreePath: src.path,
            defaultBranch: repo.default_branch,
            headRef: src.headRef,
        });
        out.push({ ...base, source: src.source, reason: null, summary });
    }
    return { run_id: run.id, branch: run.branch, repos: out };
}

export class WorkflowRunDiffNotFound extends Error {}

/**
 * One file's patch. Throws `WorkflowRunDiffNotFound` for an unknown run, a
 * repo that is not the run's, a repo with no diffable copy, or a path that is
 * not changed in `scope`; `WorktreeDiffError` for a hostile path.
 */
export async function getWorkflowRunFilePatch(opts: {
    runId: string;
    repoId: string;
    scope: CliSessionDiffScopeName;
    path: string;
    context: number;
}): Promise<CliSessionFilePatchResponse> {
    const run = await loadRun(opts.runId);
    if (!run) throw new WorkflowRunDiffNotFound('Workflow run not found');
    // Membership in the run's own repo list is the access control: a repo id
    // from another project can never select a directory to diff.
    const entry = (await runRepos(run)).repos.find((r) => r.repo.id === opts.repoId);
    if (!entry) throw new WorkflowRunDiffNotFound('Repo is not part of this run');
    const src = await resolveSource(entry.repo, entry.path, run.branch as string);
    if (src.source === 'unavailable') throw new WorkflowRunDiffNotFound(src.reason);
    const patch = await getWorktreeFilePatch({
        worktreePath: src.path,
        defaultBranch: entry.repo.default_branch,
        scope: opts.scope,
        path: opts.path,
        context: opts.context,
        headRef: src.headRef,
    });
    if (!patch) throw new WorkflowRunDiffNotFound('Path not changed in this scope');
    return patch;
}
