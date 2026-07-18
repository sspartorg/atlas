import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any vi.mock() factory runs.
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

// ---------------------------------------------------------------------------
// Imports after mocks so the module picks up the mocked dependencies.
// ---------------------------------------------------------------------------
import { injectToken, startClone } from './clone-runner.js';
import { credentialsService } from './credentials.js';
import { projectsService } from './projects.js';
import { broadcastSSE } from '../routes/events.js';

// ---------------------------------------------------------------------------
// Fake EventEmitter-like child process helper
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
        pid: 1234,
    };

    return child;
}

// ---------------------------------------------------------------------------
// Shared input fixture
// ---------------------------------------------------------------------------
const INPUT = {
    repo_url: 'https://example.com/owner/repo.git',
    credential_id: 'cred-1',
    project_name: 'My Project',
    issue_key_prefix: 'MP',
    default_branch: 'main',
    destination: '/tmp/repo',
};

const FAKE_CRED = { id: 'cred-1', username: 'alice' };
const FAKE_TOKEN = 'super-secret-token';
const FAKE_PROJECT = {
    id: 'proj-1',
    name: 'My Project',
    git_url: 'https://example.com/owner/repo.git',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('injectToken', () => {
    it('embeds username and token into the URL', () => {
        const result = injectToken(
            'https://github.com/owner/repo.git',
            'myuser',
            'my-token',
        );
        expect(result).toContain('myuser');
        expect(result).toContain('my-token');
        // Verify it is still a valid URL pointing at the right host/path.
        const u = new URL(result);
        expect(u.hostname).toBe('github.com');
        expect(u.pathname).toBe('/owner/repo.git');
    });

    it('percent-encodes special characters in username and token', () => {
        const result = injectToken(
            'https://github.com/owner/repo.git',
            'user@domain',
            'tok:en/slash',
        );
        const u = new URL(result);
        // URL spec decodes username/password when you read them back.
        expect(decodeURIComponent(u.username)).toBe('user@domain');
        expect(decodeURIComponent(u.password)).toBe('tok:en/slash');
    });
});

describe('startClone', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws when credential is not found', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(null as never);

        await expect(startClone(INPUT)).rejects.toThrow(
            'Credential cred-1 not found',
        );
    });

    it('success path: spawns git with correct args, emits stdout/stderr, broadcasts clone_completed', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);
        vi.mocked(credentialsService.markUsed).mockResolvedValue(undefined);
        vi.mocked(projectsService.createFromClone).mockResolvedValue(
            FAKE_PROJECT as never,
        );

        // execFile mock: set-url succeeds, longpaths succeeds.
        mocks.execFile
            .mockResolvedValueOnce({ stdout: '', stderr: '' }) // remote set-url
            .mockResolvedValueOnce({ stdout: '', stderr: '' }); // core.longpaths

        const child = makeChild();
        mocks.spawn.mockReturnValue(child);

        const cloneId = await startClone(INPUT);
        expect(typeof cloneId).toBe('string');
        expect(cloneId.length).toBeGreaterThan(0);

        // Verify spawn was called with git clone --progress and the authed URL.
        expect(mocks.spawn).toHaveBeenCalledOnce();
        const [bin, args] = mocks.spawn.mock.calls[0] as [string, string[]];
        expect(bin).toBe('git');
        expect(args).toContain('clone');
        expect(args).toContain('--progress');
        expect(args).toContain('main');
        // Authed URL contains the token.
        const authedUrlArg = args.find((a) => a.includes(FAKE_TOKEN));
        expect(authedUrlArg).toBeDefined();

        // Emit output on stdout and stderr before signalling close.
        child.emitStdout('Cloning into repo...\n');
        child.emitStderr('remote: Enumerating objects: 100\n');

        // Trigger successful close.
        child.emitClose(0);

        // Allow the async close handler to settle.
        await new Promise((r) => setTimeout(r, 20));

        // clone_status should have been broadcast before the spawn.
        const calls = vi.mocked(broadcastSSE).mock.calls.map((c) => c[0]);
        expect(calls.some((c) => (c as { type: string }).type === 'clone_status')).toBe(true);

        // clone_output for the stdout and stderr lines.
        const outputCalls = calls.filter(
            (c) => (c as { type: string }).type === 'clone_output',
        );
        expect(outputCalls.length).toBeGreaterThan(0);

        // clone_completed must be broadcast after everything succeeds.
        const completed = calls.find(
            (c) => (c as { type: string }).type === 'clone_completed',
        );
        expect(completed).toBeDefined();
        expect((completed as { project: unknown }).project).toEqual(FAKE_PROJECT);

        // markUsed and createFromClone should have been called.
        expect(credentialsService.markUsed).toHaveBeenCalledWith(INPUT.credential_id);
        expect(projectsService.createFromClone).toHaveBeenCalledWith(
            expect.objectContaining({
                name: INPUT.project_name,
                credential_id: INPUT.credential_id,
                default_branch: INPUT.default_branch,
            }),
        );
    });

    it('non-zero exit broadcasts clone_error with stderr content', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);

        const child = makeChild();
        mocks.spawn.mockReturnValue(child);

        await startClone(INPUT);

        child.emitStderr('fatal: repository not found\n');
        child.emitClose(128);

        await new Promise((r) => setTimeout(r, 20));

        const calls = vi.mocked(broadcastSSE).mock.calls.map((c) => c[0]);
        const errorEvt = calls.find(
            (c) => (c as { type: string }).type === 'clone_error',
        ) as { type: string; errorDetail: string } | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('fatal: repository not found');
    });

    it('non-zero exit with no stderr broadcasts fallback message', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);

        const child = makeChild();
        mocks.spawn.mockReturnValue(child);

        await startClone(INPUT);

        // No stderr output — just close with non-zero code.
        child.emitClose(1);

        await new Promise((r) => setTimeout(r, 20));

        const calls = vi.mocked(broadcastSSE).mock.calls.map((c) => c[0]);
        const errorEvt = calls.find(
            (c) => (c as { type: string }).type === 'clone_error',
        ) as { type: string; errorDetail: string } | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('git exited with code 1');
    });

    it('child error event broadcasts clone_error', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);

        const child = makeChild();
        mocks.spawn.mockReturnValue(child);

        await startClone(INPUT);

        child.emitError(new Error('spawn ENOENT'));

        await new Promise((r) => setTimeout(r, 20));

        const calls = vi.mocked(broadcastSSE).mock.calls.map((c) => c[0]);
        const errorEvt = calls.find(
            (c) => (c as { type: string }).type === 'clone_error',
        ) as { type: string; errorDetail: string } | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('spawn ENOENT');
    });

    it('success path but set-url throws → broadcasts clone_error', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);

        // First execFile call (remote set-url) rejects.
        mocks.execFile.mockRejectedValueOnce(new Error('git remote set-url failed'));

        const child = makeChild();
        mocks.spawn.mockReturnValue(child);

        await startClone(INPUT);

        child.emitClose(0);

        await new Promise((r) => setTimeout(r, 20));

        const calls = vi.mocked(broadcastSSE).mock.calls.map((c) => c[0]);
        const errorEvt = calls.find(
            (c) => (c as { type: string }).type === 'clone_error',
        ) as { type: string; errorDetail: string } | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('git remote set-url failed');

        // clone_completed must NOT have been broadcast.
        const completed = calls.find(
            (c) => (c as { type: string }).type === 'clone_completed',
        );
        expect(completed).toBeUndefined();
    });

    it('longpaths failure is swallowed and clone_completed is still broadcast', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);
        vi.mocked(credentialsService.markUsed).mockResolvedValue(undefined);
        vi.mocked(projectsService.createFromClone).mockResolvedValue(
            FAKE_PROJECT as never,
        );

        // remote set-url succeeds, longpaths rejects (should be swallowed).
        mocks.execFile
            .mockResolvedValueOnce({ stdout: '', stderr: '' }) // remote set-url ok
            .mockRejectedValueOnce(new Error('longpaths unsupported')); // core.longpaths fails — swallowed

        const child = makeChild();
        mocks.spawn.mockReturnValue(child);

        await startClone(INPUT);

        child.emitClose(0);

        await new Promise((r) => setTimeout(r, 20));

        const calls = vi.mocked(broadcastSSE).mock.calls.map((c) => c[0]);
        const completed = calls.find(
            (c) => (c as { type: string }).type === 'clone_completed',
        );
        expect(completed).toBeDefined();

        const errorEvt = calls.find(
            (c) => (c as { type: string }).type === 'clone_error',
        );
        expect(errorEvt).toBeUndefined();
    });

    it('success path but set-url throws non-Error → String(err) fallback in clone_error (CLRUN-STR-1)', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);

        // First execFile call (remote set-url) rejects with a non-Error value.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        mocks.execFile.mockRejectedValueOnce('non-error-set-url');

        const child = makeChild();
        mocks.spawn.mockReturnValue(child);

        await startClone(INPUT);

        child.emitClose(0);

        await new Promise((r) => setTimeout(r, 20));

        const calls = vi.mocked(broadcastSSE).mock.calls.map((c) => c[0]);
        const errorEvt = calls.find(
            (c) => (c as { type: string }).type === 'clone_error',
        ) as { type: string; errorDetail: string } | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toBe('non-error-set-url');
    });

    it('blank lines in stdout/stderr are not broadcast as clone_output', async () => {
        vi.mocked(credentialsService.get).mockResolvedValue(FAKE_CRED as never);
        vi.mocked(credentialsService.getToken).mockResolvedValue(FAKE_TOKEN);
        vi.mocked(credentialsService.markUsed).mockResolvedValue(undefined);
        vi.mocked(projectsService.createFromClone).mockResolvedValue(
            FAKE_PROJECT as never,
        );

        mocks.execFile
            .mockResolvedValueOnce({ stdout: '', stderr: '' })
            .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const child = makeChild();
        mocks.spawn.mockReturnValue(child);

        await startClone(INPUT);

        // Emit only blank lines.
        child.emitStdout('\n\n\n');
        child.emitClose(0);

        await new Promise((r) => setTimeout(r, 20));

        const calls = vi.mocked(broadcastSSE).mock.calls.map((c) => c[0]);
        const outputCalls = calls.filter(
            (c) => (c as { type: string }).type === 'clone_output',
        );
        // All blank → should produce zero clone_output events.
        expect(outputCalls.length).toBe(0);
    });
});
