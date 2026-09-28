import { execFile } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { withProjectGitLock } from './project-git-lock.js';

// A real checkout for an agent test run (migration 003).
//
// A workflow run gets its worktree from the engine; an agent-only test used to
// get an empty temp folder, which is why every Coder test ended "not a git
// repository". This gives the run a detached checkout of the repo instead:
//
//   - **Detached, from a commit.** No branch is created, so nothing can be
//     pushed by accident and there is no ref to clean up afterwards.
//   - **No fetch.** The sandbox repo has no remote; a real repo is checked out
//     at `origin/<default>` when that ref exists, else at the local branch.
//     ponytail: a stale local clone tests against stale code — fetch first if
//     that ever matters.
//   - **Collected once.** When the run finishes, the diff against the base is
//     kept as evidence and the checkout is deleted.

const execFileAsync = promisify(execFile);

/** Past this, the diff is cut: evidence for a check, not an archive. */
const MAX_DIFF_CHARS = 200_000;

/** What Atlas itself writes into the folder before the CLI starts (`worktree-stage.ts`). */
const STAGED_BY_ATLAS = [
    ':(exclude).atlas',
    ':(glob,exclude).claude/commands/atlas-*',
    ':(glob,exclude).github/prompts/atlas-*',
];

export interface AgentTestEvidence {
    base_sha: string;
    files_changed?: string[];
    diff?: string;
    diff_truncated?: boolean;
    /** Set when the diff could not be taken; the checkout is deleted anyway. */
    collect_error?: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
}

async function resolveBase(gitPath: string, defaultBranch: string): Promise<string> {
    for (const ref of [`refs/remotes/origin/${defaultBranch}`, `refs/heads/${defaultBranch}`, 'HEAD']) {
        try {
            return (await git(gitPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
        } catch {
            /* try the next ref */
        }
    }
    throw new Error(`no commit to check out in ${gitPath}`);
}

/** Check the repo out, detached, into a fresh folder. */
export async function openTestWorkspace(
    repo: { id: string; git_path: string; default_branch: string | null },
    runId: string,
): Promise<{ path: string; base_sha: string }> {
    const path = join(tmpdir(), `atlas-test-${runId}`);
    // Serialised per repo: parallel samples all `worktree add` against the
    // same `.git` directory.
    return withProjectGitLock(repo.id, async () => {
        const base = await resolveBase(repo.git_path, repo.default_branch?.trim() || 'main');
        await git(repo.git_path, ['worktree', 'add', '--detach', path, base]);
        return { path, base_sha: base };
    });
}

/**
 * What the agent changed since `base_sha`, then delete the checkout.
 *
 * Staged-and-diffed rather than `git status`, so new files, edits and
 * deletions all show up, committed or not.
 */
export async function collectTestWorkspace(path: string, baseSha: string): Promise<AgentTestEvidence> {
    const evidence: AgentTestEvidence = { base_sha: baseSha };
    if (!existsSync(path)) return evidence;
    let commonDir: string | null = null;
    try {
        commonDir = (await git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
        await git(path, ['add', '-A']);
        const spec = ['--', '.', ...STAGED_BY_ATLAS];
        const names = await git(path, ['diff', '--cached', '--name-only', baseSha, ...spec]);
        const diff = await git(path, ['diff', '--cached', baseSha, ...spec]);
        evidence.files_changed = names.split('\n').filter(Boolean);
        evidence.diff = diff.slice(0, MAX_DIFF_CHARS);
        if (diff.length > MAX_DIFF_CHARS) evidence.diff_truncated = true;
    } finally {
        rmSync(path, { recursive: true, force: true });
        // The folder is gone; tell the repo to forget it.
        if (commonDir) await git(dirname(commonDir), ['worktree', 'prune']).catch(() => undefined);
    }
    return evidence;
}
