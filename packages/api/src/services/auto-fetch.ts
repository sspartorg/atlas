import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { gitInvokeEnv } from './git-env.js';

const execFileP = promisify(execFile);

export type AutoFetchCode =
    | 'OK_UPTODATE'
    | 'OK_UPDATED'
    | 'OK_STASHED_AND_MERGED'
    | 'CONFLICT_SKIPPED'
    | 'CONFLICT_ABORTED'
    | 'CONFLICT_STASH_POPPED_WITH_CONFLICTS'
    | 'AUTH_FAILED'
    | 'FETCH_FAILED';

export interface AutoFetchResult {
    code: AutoFetchCode;
    detail: string;
    stashFile?: string;
}

export interface AutoFetchOptions {
    destination: string;
    branch: string;
    remoteUrl: string;
    authB64: string;
    conflictPolicy: 'skip' | 'stash' | 'abort';
    onLine?: (line: string) => void;
}

export interface GitRunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export type GitRun = (args: string[], cwd: string) => Promise<GitRunResult>;

// Factory that binds a per-call `GIT_CONFIG_GLOBAL` (tmpfile holding
// `http.extraheader` with the Basic-auth token) into the git env so the
// token never appears on argv. Auth via `-c http.extraheader=` argv leaks
// to every local user via `ps -eo args` / `wmic process get commandline`;
// argv is world-readable on process listings. The tmpfile is 0o600, so
// only the owner can read it.
function makeDefaultGitRun(gitConfigPath: string | null): GitRun {
    return async (args, cwd) => {
        try {
            const { stdout, stderr } = await execFileP('git', args, {
                cwd,
                env: gitInvokeEnv(gitConfigPath),
                maxBuffer: 16 * 1024 * 1024,
            });
            return { stdout, stderr, exitCode: 0 };
        } catch (err) {
            const e = err as { stdout?: string; stderr?: string; code?: number };
            // Node's execFile always populates stdout/stderr (as strings, possibly
            // empty) and code on both spawn errors (e.g. ENOENT) and nonzero exits —
            // the `??` fallbacks only guard the type-level optionality of the cast
            // above and are unreachable with a real ChildProcess error object.
            /* v8 ignore next */
            return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err), exitCode: e.code ?? 1 };
        }
    };
}

export async function performAutoFetch(
    opts: AutoFetchOptions,
    gitRun?: GitRun,
): Promise<AutoFetchResult> {
    const { destination, branch, remoteUrl, authB64, onLine } = opts;
    const log = (s: string) => onLine?.(s);

    if (!existsSync(destination)) {
        return { code: 'FETCH_FAILED', detail: `Destination missing ${destination}` };
    }

    // Write the Basic auth header to a 0o600 tmp git config and point git
    // at it via `GIT_CONFIG_GLOBAL` instead of `-c http.extraheader=...` on
    // argv. Same output as the argv form, but the token doesn't appear in
    // `ps -eo args` / `wmic process get commandline` where every local user
    // could read it. Mirrors the pattern already in
    // services/git-credentials.ts:40-43.
    const authHeader = `AUTHORIZATION: basic ${authB64}`;
    const gitConfigPath = join(tmpdir(), `atlas-git-${randomUUID()}.config`);
    const gitConfigBody =
        `[http]\n\textraheader = ${authHeader}\n[credential]\n\thelper =\n`;
    writeFileSync(gitConfigPath, gitConfigBody, { mode: 0o600 });

    // Tests inject a mock GitRun; production callers omit it and get the
    // config-file-bound runner so `GIT_CONFIG_GLOBAL` reaches git.
    const runGit: GitRun = gitRun ?? makeDefaultGitRun(gitConfigPath);

    try {

        // Use an explicit +<branch>:refs/remotes/origin/<branch> refspec so a
        // force-pushed remote doesn't break the fetch. Do NOT pass --prune: with an
        // explicit refspec it treats "didn't fetch the src" as "delete the dst" and
        // silently destroys refs/remotes/origin/<Branch> on transient auth/network
        // blips (we hit this in production — origin tracking ref pruned, then
        // git merge failed with "not something we can merge").
        const fetchRefspec = `+${branch}:refs/remotes/origin/${branch}`;
        // `--` sentinel isolates positional args from option parsing so a
        // remote URL or refspec beginning with `-` can't be interpreted as
        // an option (`--upload-pack=`, `--exec=`).
        const fetch = await runGit(
            ['fetch', '--', remoteUrl, fetchRefspec],
            destination,
        );
        log(fetch.stdout);
        log(fetch.stderr);
        if (fetch.exitCode !== 0) {
            const joined = `${fetch.stdout} ${fetch.stderr}`.trim().replace(/\r?\n/g, ' | ');
            if (/Authentication failed|HTTP 401|HTTP 403/.test(joined)) {
                return { code: 'AUTH_FAILED', detail: joined };
            }
            return { code: 'FETCH_FAILED', detail: joined };
        }

        // git rev-parse <ref> echoes its argument verbatim if the ref doesn't
        // resolve (and writes a fatal error to stderr) — without --verify we'd fall
        // through to a misleading "not something we can merge" merge failure.
        const verify = await runGit(['rev-parse', '--verify', `origin/${branch}`], destination);
        if (verify.exitCode !== 0) {
            return {
                code: 'FETCH_FAILED',
                detail: `refs/remotes/origin/${branch} missing after fetch - try the Reclone option`,
            };
        }

        const localHead = (await runGit(['rev-parse', 'HEAD'], destination)).stdout.trim();
        const remoteHead = (await runGit(['rev-parse', `origin/${branch}`], destination)).stdout.trim();
        if (localHead === remoteHead) {
            return { code: 'OK_UPTODATE', detail: '' };
        }

        // Capture merge stderr so we surface git's actual refusal reason on
        // CONFLICT_* statuses (e.g. "would overwrite untracked file X",
        // "Not possible to fast-forward"). Without this the user only sees a
        // generic "fast-forward not possible" with no diagnostic.
        const merge = await runGit(['merge', '--ff-only', `origin/${branch}`], destination);
        log(merge.stdout);
        log(merge.stderr);
        if (merge.exitCode === 0) {
            return { code: 'OK_UPDATED', detail: '' };
        }

        const mergeWhy = `${merge.stdout} ${merge.stderr}`.trim().replace(/\r?\n/g, ' | ');
        const aheadRes = await runGit(['rev-list', '--count', `origin/${branch}..HEAD`], destination);
        const behindRes = await runGit(['rev-list', '--count', `HEAD..origin/${branch}`], destination);
        const ahead = aheadRes.stdout.trim();
        const behind = behindRes.stdout.trim();
        const diag = `ahead=${ahead} behind=${behind} why=${mergeWhy}`;

        if (opts.conflictPolicy === 'skip') {
            return { code: 'CONFLICT_SKIPPED', detail: diag };
        }
        if (opts.conflictPolicy === 'abort') {
            return { code: 'CONFLICT_ABORTED', detail: diag };
        }

        // policy === 'stash'
        const stashDir = join(destination, '.atlas', 'stash');
        mkdirSync(stashDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const stashFile = join(stashDir, `autofetch-${stamp}.patch`);
        const diff = await runGit(['diff'], destination);
        writeFileSync(stashFile, diff.stdout);

        await runGit(['stash', 'push', '-u', '-m', `atlas-autofetch-${stamp}`], destination);

        const retry = await runGit(['merge', '--ff-only', `origin/${branch}`], destination);
        if (retry.exitCode !== 0) {
            const why2 = `${retry.stdout} ${retry.stderr}`.trim().replace(/\r?\n/g, ' | ');
            // stash+retry exhausted; fall back to the same abort code so callers can
            // treat it uniformly with the policy='abort' case.
            return { code: 'CONFLICT_ABORTED', detail: `${diag} retry-why=${why2}`, stashFile };
        }

        const pop = await runGit(['stash', 'pop'], destination);
        if (pop.exitCode !== 0) {
            return { code: 'CONFLICT_STASH_POPPED_WITH_CONFLICTS', detail: stashFile, stashFile };
        }
        return { code: 'OK_STASHED_AND_MERGED', detail: stashFile, stashFile };
    } catch (err) {
        return { code: 'FETCH_FAILED', detail: `unexpected gitRun error: ${String(err)}` };
    } finally {
        // The 0o600 tmpfile carries the Basic-auth header; delete it once
        // the fetch finishes (success or failure) so it doesn't linger in
        // %TEMP% / /tmp. Best-effort — a stale file is harmless (only
        // readable by the owner) but tidiness matters.
        try {
            unlinkSync(gitConfigPath);
        } catch {
            /* best-effort — file may already be gone if the process was killed */
        }
    }
}
