import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    performAutoFetch,
    type AutoFetchOptions,
    type GitRun,
    type GitRunResult,
} from './auto-fetch.js';

const baseOpts = (destination: string): AutoFetchOptions => ({
    destination,
    branch: 'main',
    remoteUrl: 'https://example.invalid/demo.git',
    authB64: 'dXNlcjp0b2tlbg==',
    conflictPolicy: 'skip',
});

function makeGitRun(steps: Array<Partial<GitRunResult>>): GitRun {
    const queue = [...steps];
    return vi.fn(async () => {
        if (queue.length === 0) {
            throw new Error('makeGitRun: queue exhausted — implementation made more git calls than the test scripted');
        }
        const step = queue.shift() as Partial<GitRunResult>;
        return { stdout: step.stdout ?? '', stderr: step.stderr ?? '', exitCode: step.exitCode ?? 0 };
    });
}

describe('performAutoFetch', () => {
    it('returns OK_UPTODATE when local HEAD equals origin/<branch>', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { exitCode: 0 },                       // fetch
                { stdout: 'abc123', exitCode: 0 },     // rev-parse --verify origin/main
                { stdout: 'abc123', exitCode: 0 },     // rev-parse HEAD
                { stdout: 'abc123', exitCode: 0 },     // rev-parse origin/main
            ]);
            const result = await performAutoFetch(baseOpts(dest), gitRun);
            expect(result.code).toBe('OK_UPTODATE');
            expect(existsSync(dest)).toBe(true);
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns FETCH_FAILED when destination directory does not exist', async () => {
        const dest = join(tmpdir(), `atlas-missing-${Date.now()}`);
        const gitRun = makeGitRun([]);
        const result = await performAutoFetch(baseOpts(dest), gitRun);
        expect(result.code).toBe('FETCH_FAILED');
        expect(result.detail).toContain('Destination missing');
    });

    it('returns AUTH_FAILED when git fetch fails with 401', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { stderr: 'remote: HTTP 401\nfatal: Authentication failed', exitCode: 128 },
            ]);
            const result = await performAutoFetch(baseOpts(dest), gitRun);
            expect(result.code).toBe('AUTH_FAILED');
            expect(result.detail).toContain('Authentication failed');
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns FETCH_FAILED for non-auth fetch errors', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { stderr: 'fatal: unable to access', exitCode: 128 },
            ]);
            const result = await performAutoFetch(baseOpts(dest), gitRun);
            expect(result.code).toBe('FETCH_FAILED');
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns OK_UPDATED when fast-forward succeeds', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { exitCode: 0 },                       // fetch
                { stdout: 'abc123', exitCode: 0 },     // rev-parse --verify origin/main
                { stdout: 'local1', exitCode: 0 },     // rev-parse HEAD
                { stdout: 'remote1', exitCode: 0 },    // rev-parse origin/main
                { stdout: 'Updating local1..remote1\nFast-forward', exitCode: 0 }, // merge --ff-only
            ]);
            const result = await performAutoFetch(baseOpts(dest), gitRun);
            expect(result.code).toBe('OK_UPDATED');
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns FETCH_FAILED if origin/<branch> is missing after fetch', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { exitCode: 0 },                       // fetch
                { stderr: 'fatal: bad revision', exitCode: 128 }, // rev-parse --verify origin/main
            ]);
            const result = await performAutoFetch(baseOpts(dest), gitRun);
            expect(result.code).toBe('FETCH_FAILED');
            expect(result.detail).toContain('refs/remotes/origin/main missing');
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns CONFLICT_SKIPPED with ahead/behind diag when policy=skip and ff fails', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { exitCode: 0 },                                   // fetch
                { stdout: 'remote1', exitCode: 0 },                // verify origin/main
                { stdout: 'local1', exitCode: 0 },                 // HEAD
                { stdout: 'remote1', exitCode: 0 },                // origin/main
                { stderr: 'fatal: Not possible to fast-forward', exitCode: 128 }, // merge --ff-only
                { stdout: '2', exitCode: 0 },                      // rev-list ahead
                { stdout: '3', exitCode: 0 },                      // rev-list behind
            ]);
            const result = await performAutoFetch({ ...baseOpts(dest), conflictPolicy: 'skip' }, gitRun);
            expect(result.code).toBe('CONFLICT_SKIPPED');
            expect(result.detail).toContain('ahead=2');
            expect(result.detail).toContain('behind=3');
            expect(result.detail).toContain('Not possible to fast-forward');
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns CONFLICT_ABORTED when policy=abort and ff fails', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { exitCode: 0 },
                { stdout: 'remote1', exitCode: 0 },
                { stdout: 'local1', exitCode: 0 },
                { stdout: 'remote1', exitCode: 0 },
                { stderr: 'fatal: cannot ff', exitCode: 128 },
                { stdout: '1', exitCode: 0 },
                { stdout: '1', exitCode: 0 },
            ]);
            const result = await performAutoFetch({ ...baseOpts(dest), conflictPolicy: 'abort' }, gitRun);
            expect(result.code).toBe('CONFLICT_ABORTED');
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns OK_STASHED_AND_MERGED when stash -> ff -> pop all succeed', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { exitCode: 0 },                                                // fetch
                { stdout: 'remote1', exitCode: 0 },                             // verify
                { stdout: 'local1', exitCode: 0 },                              // HEAD
                { stdout: 'remote1', exitCode: 0 },                             // origin/main
                { stderr: 'fatal: cannot ff', exitCode: 128 },                  // merge --ff-only (first)
                { stdout: '1', exitCode: 0 },                                   // ahead
                { stdout: '2', exitCode: 0 },                                   // behind
                { stdout: 'diff content', exitCode: 0 },                        // git diff
                { exitCode: 0 },                                                // stash push
                { exitCode: 0 },                                                // merge --ff-only (retry)
                { exitCode: 0 },                                                // stash pop
            ]);
            const result = await performAutoFetch({ ...baseOpts(dest), conflictPolicy: 'stash' }, gitRun);
            expect(result.code).toBe('OK_STASHED_AND_MERGED');
            expect(result.stashFile).toMatch(/\.atlas[\\/]stash[\\/]autofetch-/);
            expect(existsSync(result.stashFile ?? '')).toBe(true);
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns CONFLICT_STASH_POPPED_WITH_CONFLICTS when pop conflicts', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { exitCode: 0 },
                { stdout: 'remote1', exitCode: 0 },
                { stdout: 'local1', exitCode: 0 },
                { stdout: 'remote1', exitCode: 0 },
                { stderr: 'fatal: cannot ff', exitCode: 128 },
                { stdout: '1', exitCode: 0 },
                { stdout: '1', exitCode: 0 },
                { stdout: 'diff', exitCode: 0 },
                { exitCode: 0 },                                                // stash push
                { exitCode: 0 },                                                // merge --ff-only (retry)
                { stderr: 'CONFLICT (content): Merge conflict', exitCode: 1 }, // stash pop
            ]);
            const result = await performAutoFetch({ ...baseOpts(dest), conflictPolicy: 'stash' }, gitRun);
            expect(result.code).toBe('CONFLICT_STASH_POPPED_WITH_CONFLICTS');
            expect(result.stashFile).toBeTruthy();
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns CONFLICT_ABORTED if retry merge also fails after stash', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun = makeGitRun([
                { exitCode: 0 },
                { stdout: 'remote1', exitCode: 0 },
                { stdout: 'local1', exitCode: 0 },
                { stdout: 'remote1', exitCode: 0 },
                { stderr: 'cannot ff', exitCode: 128 },
                { stdout: '1', exitCode: 0 },
                { stdout: '1', exitCode: 0 },
                { stdout: '', exitCode: 0 },
                { exitCode: 0 },                                                // stash push
                { stderr: 'still cannot ff', exitCode: 128 },                   // merge retry fails
            ]);
            const result = await performAutoFetch({ ...baseOpts(dest), conflictPolicy: 'stash' }, gitRun);
            expect(result.code).toBe('CONFLICT_ABORTED');
            expect(result.detail).toContain('retry-why=');
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    it('returns FETCH_FAILED if gitRun throws unexpectedly', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-'));
        try {
            const gitRun: GitRun = vi.fn(async () => {
                throw new Error('boom');
            });
            const result = await performAutoFetch(baseOpts(dest), gitRun);
            expect(result.code).toBe('FETCH_FAILED');
            expect(result.detail).toContain('boom');
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });

    // AF-EXTRA — exercises the real (unmocked) `defaultGitRun` so its
    // execFile catch block (stdout/stderr/exitCode fallbacks) runs for
    // real instead of via the injected `GitRun` test double. `.invalid`
    // is an RFC 2606 reserved TLD that always fails DNS resolution fast,
    // so this stays deterministic and offline-safe.
    it('uses the real default gitRun against an unreachable remote (no injected GitRun)', async () => {
        const dest = mkdtempSync(join(tmpdir(), 'atlas-autofetch-realgit-'));
        try {
            const result = await performAutoFetch({
                destination: dest,
                branch: 'main',
                remoteUrl: 'https://example.invalid/demo.git',
                authB64: 'dXNlcjp0b2tlbg==',
                conflictPolicy: 'skip',
            });
            expect(['FETCH_FAILED', 'AUTH_FAILED']).toContain(result.code);
            expect(result.detail.length).toBeGreaterThan(0);
        } finally {
            rmSync(dest, { recursive: true, force: true });
        }
    });
});
