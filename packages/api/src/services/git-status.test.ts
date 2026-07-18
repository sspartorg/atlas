import { describe, expect, it, beforeEach, vi } from 'vitest';

// Must be declared before vi.mock factories run.
const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
    execFile: (
        bin: string,
        args: string[],
        opts: unknown,
        cb: (err: unknown, res?: { stdout: string; stderr: string }) => void,
    ) => {
        try {
            const res = execFileMock(bin, args, opts);
            if (res && typeof res === 'object' && 'then' in res) {
                (res as Promise<{ stdout: string; stderr: string }>).then(
                    (r) => cb(null, r),
                    (err) => cb(err),
                );
            } else {
                cb(null, res as { stdout: string; stderr: string });
            }
        } catch (err) {
            cb(err);
        }
    },
}));

vi.mock('./git-env.js', () => ({
    // Return an env that reflects the gitConfigPath arg so callers that
    // pass a tmpfile path (Batch 3 auth-off-argv fix) can be asserted on.
    gitInvokeEnv: vi.fn((gitConfigPath: string | null) =>
        gitConfigPath ? { GIT_CONFIG_GLOBAL: gitConfigPath } : {},
    ),
}));

import { getProjectGitStatus } from './git-status.js';

// Helper: returns a sync result object for execFileMock.
const ok = (stdout: string): { stdout: string; stderr: string } => ({ stdout, stderr: '' });

// Helper: returns a rejected promise to simulate exec failure.
const fail = (msg = 'git error'): Promise<never> => Promise.reject(new Error(msg));

describe('getProjectGitStatus', () => {
    beforeEach(() => {
        execFileMock.mockReset();
    });

    it('returns correct status when authB64 is null (no fetch call)', async () => {
        // No fetch — 4 calls: rev-parse HEAD, rev-parse origin/branch, rev-list, status
        execFileMock
            .mockReturnValueOnce(ok('abc1234\n'))   // rev-parse --short HEAD
            .mockReturnValueOnce(ok('def5678\n'))   // rev-parse --short origin/main
            .mockReturnValueOnce(ok('3\n'))          // rev-list --count HEAD..origin/main
            .mockReturnValueOnce(ok(''));            // status --porcelain (clean)

        const result = await getProjectGitStatus('/repo', 'main', null);

        expect(result).toEqual({
            localHead: 'abc1234',
            remoteHead: 'def5678',
            behind: 3,
            uncommitted: 0,
        });

        // Verify fetch was NOT called.
        const calls: [string, string[]][] = execFileMock.mock.calls as [string, string[]][];
        const fetchCall = calls.find(([, args]) => args.includes('fetch'));
        expect(fetchCall).toBeUndefined();
    });

    it('calls fetch with http.extraheader when authB64 is provided (via GIT_CONFIG_GLOBAL)', async () => {
        // With authB64: fetch + 4 status calls = 5 total.
        execFileMock
            .mockReturnValueOnce(ok(''))            // fetch (success)
            .mockReturnValueOnce(ok('aaa0001\n'))   // rev-parse HEAD
            .mockReturnValueOnce(ok('bbb0002\n'))   // rev-parse origin/branch
            .mockReturnValueOnce(ok('1\n'))          // rev-list
            .mockReturnValueOnce(ok('M file.ts\n')); // status --porcelain, 1 dirty file

        const result = await getProjectGitStatus('/repo', 'main', 'dXNlcjp0b2tlbg==');

        expect(result).toEqual({
            localHead: 'aaa0001',
            remoteHead: 'bbb0002',
            behind: 1,
            uncommitted: 1,
        });

        // After the argv-leak fix (Batch 3): the token is NO LONGER on
        // argv. It's written to a 0o600 tmp git config referenced via the
        // fetch call's env `GIT_CONFIG_GLOBAL`. Assert both properties:
        //   1. fetch argv does NOT contain any `http.extraheader=...`
        //   2. the fetch invocation's env carries `GIT_CONFIG_GLOBAL`
        //      pointing at a tmp path.
        const calls = execFileMock.mock.calls as [string, string[], { env?: Record<string, string> }][];
        const fetchCall = calls.find(([, args]) => args.includes('fetch'));
        expect(fetchCall).toBeDefined();
        const [, fetchArgs, fetchOpts] = fetchCall!;
        // Regression guard: token must NEVER appear on argv again.
        expect(fetchArgs.some((a) => a.startsWith('http.extraheader='))).toBe(false);
        expect(fetchArgs.some((a) => typeof a === 'string' && a.includes('dXNlcjp0b2tlbg=='))).toBe(false);
        // Auth is now injected via GIT_CONFIG_GLOBAL pointing at a
        // atlas-git-<uuid>.config tmpfile.
        expect(fetchOpts?.env?.['GIT_CONFIG_GLOBAL']).toBeDefined();
        expect(fetchOpts?.env?.['GIT_CONFIG_GLOBAL']).toMatch(/atlas-git-.*\.config$/);
    });

    it('swallows fetch errors and continues', async () => {
        // fetch rejects — but the function should still return status.
        execFileMock
            .mockReturnValueOnce(fail('network unreachable'))  // fetch fails
            .mockReturnValueOnce(ok('ccc0003\n'))              // rev-parse HEAD
            .mockReturnValueOnce(ok('ddd0004\n'))              // rev-parse origin/main
            .mockReturnValueOnce(ok('0\n'))                    // rev-list
            .mockReturnValueOnce(ok(''));                      // status --porcelain

        await expect(
            getProjectGitStatus('/repo', 'main', 'c29tZXRva2Vu'),
        ).resolves.toMatchObject({ localHead: 'ccc0003' });
    });

    it('falls back to empty remoteHead when rev-parse origin/<branch> fails', async () => {
        execFileMock
            .mockReturnValueOnce(ok('eee0005\n'))   // rev-parse HEAD
            .mockReturnValueOnce(fail('unknown ref'))// rev-parse origin/main → caught
            .mockReturnValueOnce(ok('2\n'))          // rev-list
            .mockReturnValueOnce(ok(''));            // status --porcelain

        const result = await getProjectGitStatus('/repo', 'main', null);

        expect(result.remoteHead).toBe('');
        expect(result.localHead).toBe('eee0005');
    });

    it('falls back to behind=0 when rev-list fails', async () => {
        execFileMock
            .mockReturnValueOnce(ok('fff0006\n'))    // rev-parse HEAD
            .mockReturnValueOnce(ok('ggg0007\n'))    // rev-parse origin/main
            .mockReturnValueOnce(fail('bad rev'))    // rev-list → caught
            .mockReturnValueOnce(ok(''));             // status --porcelain

        const result = await getProjectGitStatus('/repo', 'main', null);

        expect(result.behind).toBe(0);
    });

    it('counts uncommitted lines correctly when porcelain has multiple entries', async () => {
        const porcelain = ' M packages/api/src/foo.ts\n?? packages/web/src/bar.ts\n';
        execFileMock
            .mockReturnValueOnce(ok('hhh0008\n'))   // rev-parse HEAD
            .mockReturnValueOnce(ok('iii0009\n'))   // rev-parse origin/main
            .mockReturnValueOnce(ok('0\n'))          // rev-list
            .mockReturnValueOnce(ok(porcelain));    // status --porcelain

        const result = await getProjectGitStatus('/repo', 'main', null);

        expect(result.uncommitted).toBe(2);
    });

    it('reports behind=0 when behindRes stdout is an empty string (NaN → 0)', async () => {
        execFileMock
            .mockReturnValueOnce(ok('jjj0010\n'))   // rev-parse HEAD
            .mockReturnValueOnce(ok('kkk0011\n'))   // rev-parse origin/main
            .mockReturnValueOnce(ok('\n'))           // rev-list → Number('') === NaN → 0
            .mockReturnValueOnce(ok(''));            // status --porcelain

        const result = await getProjectGitStatus('/repo', 'main', null);

        expect(result.behind).toBe(0);
    });

    it('counts zero uncommitted when porcelain output is only blank lines', async () => {
        execFileMock
            .mockReturnValueOnce(ok('lll0012\n'))
            .mockReturnValueOnce(ok('mmm0013\n'))
            .mockReturnValueOnce(ok('0\n'))
            .mockReturnValueOnce(ok('\n\n'));  // two blank lines → zero after filter

        const result = await getProjectGitStatus('/repo', 'main', null);

        expect(result.uncommitted).toBe(0);
    });
});
