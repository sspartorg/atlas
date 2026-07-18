import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before vi.mock factories run.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
    execFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
    spawn: mocks.spawn,
    execFile: (
        bin: string,
        args: string[],
        opts: unknown,
        cb: (err: unknown, res?: unknown) => void,
    ) => {
        const res = mocks.execFile(bin, args, opts);
        if (res && typeof res === 'object' && 'then' in res) {
            (res as Promise<unknown>).then(
                (r) => cb(null, r),
                (err) => cb(err),
            );
        } else {
            cb(null, res);
        }
    },
}));

vi.mock('./credentials.js', () => ({
    credentialsService: {
        get: vi.fn(),
        getToken: vi.fn(),
        markUsed: vi.fn(),
    },
}));

vi.mock('./projects.js', () => ({
    projectsService: {
        get: vi.fn(),
        createFromClone: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../routes/events.js', () => ({
    broadcastSSE: vi.fn(),
}));

vi.mock('./git-env.js', () => ({ gitInvokeEnv: vi.fn(() => ({})) }));

// Mock fs/promises — reclone-runner uses mkdir and writeFile for stash patch.
vi.mock('node:fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn(),
    access: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { startReclone } from './reclone-runner.js';
import { credentialsService } from './credentials.js';
import { projectsService } from './projects.js';
import { broadcastSSE } from '../routes/events.js';
import { mkdir, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Fake child process helper — mirrors the one in clone-runner tests.
// ---------------------------------------------------------------------------
function makeChild() {
    const stdoutListeners: Record<string, Array<(data: Buffer) => void>> = {};
    const stderrListeners: Record<string, Array<(data: Buffer) => void>> = {};
    const childListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

    const child = {
        stdout: {
            on(evt: string, fn: (data: Buffer) => void) {
                (stdoutListeners[evt] ??= []).push(fn);
            },
        },
        stderr: {
            on(evt: string, fn: (data: Buffer) => void) {
                (stderrListeners[evt] ??= []).push(fn);
            },
        },
        on(evt: string, fn: (...args: unknown[]) => void) {
            (childListeners[evt] ??= []).push(fn);
            return child;
        },
        emitStdout(data: string) {
            stdoutListeners['data']?.forEach((f) => f(Buffer.from(data)));
        },
        emitStderr(data: string) {
            stderrListeners['data']?.forEach((f) => f(Buffer.from(data)));
        },
        emitClose(code: number) {
            childListeners['close']?.forEach((f) => f(code));
        },
        emitError(err: Error) {
            childListeners['error']?.forEach((f) => f(err));
        },
        pid: 9999,
    };

    return child;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const INPUT = {
    projectId: 'proj-1',
    destination: '/workspace/my-project',
    branch: 'main',
};

const FAKE_PROJECT = {
    id: 'proj-1',
    name: 'My Project',
    git_url: 'https://example.com/owner/repo.git',
    credential_id: 'cred-1',
};

const FAKE_CRED = { id: 'cred-1', username: 'alice' };
const FAKE_TOKEN = 'secret-reclone-token';

// ---------------------------------------------------------------------------
// Helper: set up the happy-path mocks for credentials.
// ---------------------------------------------------------------------------
function setupCredMocks() {
    vi.mocked(projectsService.get).mockResolvedValue(FAKE_PROJECT as never);
    vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
    vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);
}

// ---------------------------------------------------------------------------
// Helper: collect broadcastSSE calls.
// ---------------------------------------------------------------------------
function sseCalls() {
    return vi.mocked(broadcastSSE).mock.calls.map((c) => c[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('startReclone', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset the fs/promises mocks to their default resolved state.
        vi.mocked(mkdir).mockResolvedValue(undefined as never);
        vi.mocked(writeFile).mockResolvedValue(undefined);
    });

    // -----------------------------------------------------------------------
    // Guard-clause failures (synchronous throws from the async setup phase)
    // -----------------------------------------------------------------------

    it('throws when project is not found', async () => {
        vi.mocked(projectsService.get).mockResolvedValue(null as never);

        await expect(startReclone(INPUT)).rejects.toThrow('proj-1 not found');
    });

    it('throws when project has no credential_id', async () => {
        vi.mocked(projectsService.get).mockResolvedValue({
            ...FAKE_PROJECT,
            credential_id: null,
        } as never);

        await expect(startReclone(INPUT)).rejects.toThrow(
            'Original credential was deleted',
        );
    });

    it('throws when credential record is not found', async () => {
        vi.mocked(projectsService.get).mockResolvedValue(FAKE_PROJECT as never);
        vi.mocked(credentialsService.get).mockResolvedValue(null as never);

        await expect(startReclone(INPUT)).rejects.toThrow(
            'Original credential was deleted',
        );
    });

    it('throws when getToken rejects (token unreadable)', async () => {
        vi.mocked(projectsService.get).mockResolvedValue(FAKE_PROJECT as never);
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockRejectedValue(
            new Error('decryption failed'),
        );

        await expect(startReclone(INPUT)).rejects.toThrow(
            'Original credential was deleted',
        );
    });

    // -----------------------------------------------------------------------
    // Clean working tree (no stash needed): status → fetch → pull
    // -----------------------------------------------------------------------

    it('success path (clean tree): broadcasts reclone_completed with stashPath=null', async () => {
        setupCredMocks();

        // status: clean (empty stdout, code 0)
        const childStatus = makeChild();
        // fetch: success
        const childFetch = makeChild();
        // pull: success
        const childPull = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childFetch)
            .mockReturnValueOnce(childPull);

        const recloneId = await startReclone(INPUT);
        expect(typeof recloneId).toBe('string');

        // Trigger status → clean (no stdout, exit 0).
        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // Trigger fetch success.
        childFetch.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // Trigger pull success.
        childPull.emitClose(0);
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();

        const completed = calls.find((c) => c.type === 'reclone_completed');
        expect(completed).toBeDefined();
        expect(completed!.stashPath).toBeNull();
        expect(completed!.status).toBe('ready');
        expect(completed!.recloneId).toBe(recloneId);

        // No error events.
        expect(calls.find((c) => c.type === 'reclone_error')).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Dirty working tree: status → diff → stash push → fetch → pull
    // -----------------------------------------------------------------------

    it('dirty tree: stash push happens, broadcasts reclone_completed with stashPath set', async () => {
        setupCredMocks();

        // status: dirty (stdout has content, exit 0)
        const childStatus = makeChild();
        // diff
        const childDiff = makeChild();
        // stash push: success
        const childStash = makeChild();
        // fetch: success
        const childFetch = makeChild();
        // pull: success
        const childPull = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childDiff)
            .mockReturnValueOnce(childStash)
            .mockReturnValueOnce(childFetch)
            .mockReturnValueOnce(childPull);

        const recloneId = await startReclone(INPUT);

        // status: dirty output then close 0
        childStatus.emitStdout(' M packages/api/src/foo.ts\n');
        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // diff: some diff output, close 0
        childDiff.emitStdout('diff --git a/foo.ts b/foo.ts\n');
        childDiff.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // stash push: success
        childStash.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // fetch: success
        childFetch.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // pull: success
        childPull.emitClose(0);
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();

        const completed = calls.find((c) => c.type === 'reclone_completed');
        expect(completed).toBeDefined();
        // stashPath should be a non-null string containing .patch
        expect(typeof completed!.stashPath).toBe('string');
        expect((completed!.stashPath as string)).toContain('.patch');
        expect(completed!.recloneId).toBe(recloneId);

        // mkdir and writeFile should have been called for the stash patch.
        expect(mkdir).toHaveBeenCalled();
        expect(writeFile).toHaveBeenCalled();

        // No error events.
        expect(calls.find((c) => c.type === 'reclone_error')).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Failure: git status exits non-zero
    // -----------------------------------------------------------------------

    it('git status fails (non-zero code): broadcasts reclone_error', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        mocks.spawn.mockReturnValueOnce(childStatus);

        await startReclone(INPUT);

        // status: stderr message + non-zero exit
        childStatus.emitStderr('fatal: not a git repository\n');
        childStatus.emitClose(128);

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('fatal: not a git repository');

        expect(calls.find((c) => c.type === 'reclone_completed')).toBeUndefined();
    });

    it('git status fails with no stderr: uses fallback message', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        mocks.spawn.mockReturnValueOnce(childStatus);

        await startReclone(INPUT);

        // No stderr output, just non-zero exit.
        childStatus.emitClose(2);

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('git status failed with exit code 2');
    });

    // -----------------------------------------------------------------------
    // Failure: fetch exits non-zero
    // -----------------------------------------------------------------------

    it('fetch fails: broadcasts reclone_error', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        const childFetch = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childFetch);

        await startReclone(INPUT);

        // status: clean
        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // fetch: failure with stderr
        childFetch.emitStderr('fatal: unable to access remote\n');
        childFetch.emitClose(1);

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        // errorDetail should contain the stderr content (redacted if it contains the token).
        expect(errorEvt!.status).toBe('error');

        expect(calls.find((c) => c.type === 'reclone_completed')).toBeUndefined();
    });

    it('fetch fails with no stderr: uses fallback message', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        const childFetch = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childFetch);

        await startReclone(INPUT);

        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        childFetch.emitClose(3);
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('git fetch failed with exit code 3');
    });

    // -----------------------------------------------------------------------
    // Failure: pull exits non-zero
    // -----------------------------------------------------------------------

    it('pull fails: broadcasts reclone_error', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        const childFetch = makeChild();
        const childPull = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childFetch)
            .mockReturnValueOnce(childPull);

        await startReclone(INPUT);

        // status: clean
        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // fetch: success
        childFetch.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // pull: failure
        childPull.emitStderr('error: cannot fast-forward\n');
        childPull.emitClose(1);

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.status).toBe('error');

        expect(calls.find((c) => c.type === 'reclone_completed')).toBeUndefined();
    });

    it('pull fails with no stderr: uses fallback message', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        const childFetch = makeChild();
        const childPull = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childFetch)
            .mockReturnValueOnce(childPull);

        await startReclone(INPUT);

        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        childFetch.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        childPull.emitClose(2);
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('git pull failed with exit code 2');
    });

    // -----------------------------------------------------------------------
    // Failure: stash push exits non-zero
    // -----------------------------------------------------------------------

    it('stash push fails: broadcasts reclone_error', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        const childDiff = makeChild();
        const childStash = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childDiff)
            .mockReturnValueOnce(childStash);

        await startReclone(INPUT);

        // status: dirty
        childStatus.emitStdout('M packages/api/src/foo.ts\n');
        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // diff: ok
        childDiff.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // stash push: failure
        childStash.emitStderr('error: stash push failed\n');
        childStash.emitClose(1);

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.status).toBe('error');

        // fetch and pull must NOT have been invoked.
        const spawnCalls = mocks.spawn.mock.calls as [string, string[]][];
        const fetchCall = spawnCalls.find(([, args]) => args.includes('fetch'));
        expect(fetchCall).toBeUndefined();

        expect(calls.find((c) => c.type === 'reclone_completed')).toBeUndefined();
    });

    it('stash push fails with no stderr: uses fallback message', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        const childDiff = makeChild();
        const childStash = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childDiff)
            .mockReturnValueOnce(childStash);

        await startReclone(INPUT);

        childStatus.emitStdout('M packages/api/src/foo.ts\n');
        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        childDiff.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // stash push: failure, no stderr
        childStash.emitClose(1);

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('git stash push failed');
    });

    // -----------------------------------------------------------------------
    // Return value
    // -----------------------------------------------------------------------

    it('returns recloneId (UUID string) synchronously after setup', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        mocks.spawn.mockReturnValueOnce(childStatus);

        // We only need the return value; let the async block dangle.
        const recloneId = await startReclone(INPUT);
        expect(typeof recloneId).toBe('string');
        expect(recloneId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
    });

    // -----------------------------------------------------------------------
    // SSE: reclone_status is broadcast immediately on startReclone
    // -----------------------------------------------------------------------

    it('broadcasts reclone_status pending before any git calls', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        mocks.spawn.mockReturnValueOnce(childStatus);

        await startReclone(INPUT);

        // reclone_status should have already been broadcast synchronously.
        const calls = sseCalls();
        const statusEvt = calls.find((c) => c.type === 'reclone_status');
        expect(statusEvt).toBeDefined();
        expect(statusEvt!.status).toBe('pending');
    });

    // -----------------------------------------------------------------------
    // Redaction: token must not appear in SSE output
    // -----------------------------------------------------------------------

    it('redacts the token from SSE output lines', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        const childFetch = makeChild();
        const childPull = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childFetch)
            .mockReturnValueOnce(childPull);

        await startReclone(INPUT);

        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // Fetch emits a line that accidentally contains the token.
        childFetch.emitStdout(`Fetching from ${FAKE_TOKEN}\n`);
        childFetch.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        childPull.emitClose(0);
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const outputLines = calls
            .filter((c) => c.type === 'reclone_output')
            .map((c) => c.output as string);

        // None of the output lines should expose the raw token.
        for (const line of outputLines) {
            expect(line).not.toContain(FAKE_TOKEN);
        }
    });

    // -----------------------------------------------------------------------
    // child.on('error') path in runGit — resolves with code 1
    // -----------------------------------------------------------------------

    it('spawn error event on status child causes reclone_error via fallback message', async () => {
        setupCredMocks();

        const childStatus = makeChild();
        mocks.spawn.mockReturnValueOnce(childStatus);

        await startReclone(INPUT);

        // Emit an error event (e.g. ENOENT) — runGit resolves with code 1.
        childStatus.emitError(new Error('spawn ENOENT'));

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error');
        expect(errorEvt).toBeDefined();
    });

    it('outer catch: writeFile throws non-Error → String(err) fallback in reclone_error errorDetail (RCLRUN-STR-1)', async () => {
        // Triggers the outer catch at line 256 of reclone-runner.ts via a non-Error
        // thrown from writeFile (called during dirty-tree stash dump, before stash push).
        setupCredMocks();

        // eslint-disable-next-line @typescript-eslint/only-throw-error
        vi.mocked(writeFile).mockRejectedValueOnce('non-error-writefile');

        const childStatus = makeChild();
        const childDiff = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childDiff);

        await startReclone(INPUT);

        // status: dirty output then close 0
        childStatus.emitStdout(' M packages/api/src/foo.ts\n');
        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        // diff: some diff output, close 0
        childDiff.emitStdout('diff --git a/foo.ts b/foo.ts\n');
        childDiff.emitClose(0);
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        // String(err) fallback: 'non-error-writefile' is a string so String() returns it as-is.
        expect(errorEvt!.errorDetail).toBe('non-error-writefile');
    });

    it('outer catch: a real Error thrown uses err.message in reclone_error errorDetail (RCLRUN-ERR-1)', async () => {
        // Covers the `err instanceof Error` TRUE branch — RCLRUN-STR-1 above
        // only exercises the non-Error/String(err) fallback.
        setupCredMocks();
        vi.mocked(mkdir).mockRejectedValueOnce(new Error('disk full'));

        const childStatus = makeChild();
        mocks.spawn.mockReturnValueOnce(childStatus);

        await startReclone(INPUT);

        // status: dirty output then close 0 -> triggers mkdir() for the stash dir
        childStatus.emitStdout(' M packages/api/src/foo.ts\n');
        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toBe('disk full');
    });

    it('pull step forwards stdout lines through emit (stream === stderr false branch)', async () => {
        // The fetch step's stdout-forwarding branch is already covered by
        // "redacts the token from SSE output lines"; the pull step's
        // identical callback never received a stdout event in any existing
        // test, leaving the `stream === 'stderr'` false branch uncovered
        // for THAT callback instance.
        setupCredMocks();

        const childStatus = makeChild();
        const childFetch = makeChild();
        const childPull = makeChild();

        mocks.spawn
            .mockReturnValueOnce(childStatus)
            .mockReturnValueOnce(childFetch)
            .mockReturnValueOnce(childPull);

        await startReclone(INPUT);

        childStatus.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        childFetch.emitClose(0);
        await new Promise((r) => setTimeout(r, 5));

        childPull.emitStdout('Updating abc123..def456\n');
        childPull.emitClose(0);
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const outputLines = calls
            .filter((c) => c.type === 'reclone_output')
            .map((c) => c.output as string);
        expect(outputLines.some((l) => l.includes('Updating abc123..def456'))).toBe(true);
    });

    it('runGit resolves code=1 when the child exits via signal (code=null ?? 1 fallback)', async () => {
        // Node passes `code=null` on the 'close' event when a process is
        // killed by a signal instead of exiting normally — covers the
        // `code ?? 1` fallback in runGit's close handler.
        setupCredMocks();

        const childStatus = makeChild();
        mocks.spawn.mockReturnValueOnce(childStatus);

        await startReclone(INPUT);

        childStatus.emitStderr('fatal: killed by signal\n');
        childStatus.emitClose(null as unknown as number);

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'reclone_error') as
            | Record<string, unknown>
            | undefined;
        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('fatal: killed by signal');
    });
});
