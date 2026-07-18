// Workstream #3 — per-project mutex for git operations.
//
// The worktree orchestrator runs `git fetch` / `git worktree add` /
// `git branch -D` / `git push` / `gh pr create` against the same on-disk
// project clone. Two concurrent runs targeting the same project can race
// on these commands (especially the worktree-admin + branch-ref ops);
// `withProjectGitLock` chains them onto a per-project promise queue so
// callers on the same `projectId` serialize while different `projectId`s
// run in parallel.
//
// This is **in-process only**. If the runner ever fans out across worker
// processes the lock falls back to "no lock" — escalate to a DB advisory
// lock (`pg_advisory_lock`) in that future.

const projectQueues = new Map<string, Promise<unknown>>();

/**
 * Run `fn` such that no other `withProjectGitLock` call with the same
 * `projectId` is concurrently executing. Different `projectId`s run in
 * parallel.
 *
 * Rejections from `fn` propagate to the caller, but the per-project
 * queue continues to advance — the next caller is not poisoned by a
 * predecessor's failure.
 */
export async function withProjectGitLock<T>(
    projectId: string,
    fn: () => Promise<T>,
): Promise<T> {
    const tail = projectQueues.get(projectId) ?? Promise.resolve();

    // Chain `fn` after the current tail. We capture-and-rethrow so the
    // caller still sees the rejection, but the queue's tail is a
    // settled promise — predecessors' failures don't block successors.
    const next = tail.then(
        () => fn(),
        () => fn(),
    );

    // Replace the tail with a promise that resolves regardless of `next`'s
    // outcome, so the next call after a failure doesn't reject when it
    // attaches.
    projectQueues.set(
        projectId,
        next.then(
            () => undefined,
            () => undefined,
        ),
    );

    return next;
}
