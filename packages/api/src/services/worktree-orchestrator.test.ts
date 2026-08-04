import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type * as NodeFs from 'node:fs';

// The orchestrator's exec path is the part that's hard to exercise from
// unit tests — mock `node:child_process.execFile` so the suite covers
// the branching logic (missing field, missing path, existing worktree,
// branch on origin, net-new branch) without needing a real git repo.

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./events-log.js', () => ({
    eventsLog: { record: vi.fn(), activity: vi.fn().mockResolvedValue([]) },
}));

// fs / child_process mocks. existsSync returns true only for paths the
// test explicitly opts into; execFile's mock is per-test (vi.mocked
// reset in beforeEach).
const execFileMock = vi.fn();
const existsSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();
const unlinkSyncMock = vi.fn();
const mkdtempSyncMock = vi.fn();
const rmSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
    execFile: (
        bin: string,
        args: string[],
        opts: unknown,
        cb: (err: unknown, res?: { stdout: string; stderr: string }) => void,
    ) => {
        // promisify(execFile) calls the (bin, args, opts, callback) form.
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

vi.mock('node:fs', async () => {
    const actual = await vi.importActual<typeof NodeFs>('node:fs');
    return {
        ...actual,
        existsSync: (p: string) => existsSyncMock(p),
        mkdirSync: (p: string, opts?: unknown) => mkdirSyncMock(p, opts),
        writeFileSync: (p: string, data: string, opts?: unknown) =>
            writeFileSyncMock(p, data, opts),
        unlinkSync: (p: string) => unlinkSyncMock(p),
        mkdtempSync: (prefix: string) => mkdtempSyncMock(prefix),
        rmSync: (p: string, opts?: unknown) => rmSyncMock(p, opts),
    };
});

// Stub `git-credentials` so push/PR tests don't have to seed the
// credentials table — the only behaviour we care about per-test is
// whether the helper resolved a config path (auth wired) or not
// (hard-fail path). Each test overrides as needed via `buildGitConfigMock`.
//
// NOTE the shape: `buildGitConfig` resolves to
// `{ configPath: string | null; transient: boolean }`, NOT a bare path.
// `transient` distinguishes a GitHub App token-mint outage (retry) from
// permanent misconfiguration (re-attach the credential) — see the
// 2026-07-03 note in worktree-orchestrator.ts. Mocking a bare string here
// makes `const { configPath } = await buildGitConfig(...)` destructure to
// `undefined`, which silently routes every push test down the
// no-credential hard-fail branch.
const buildGitConfigMock = vi.fn();
const cleanupGitConfigMock = vi.fn();
vi.mock('./git-credentials.js', () => ({
    buildGitConfig: (id: string | null) => buildGitConfigMock(id),
    cleanupGitConfig: (p: string | null) => cleanupGitConfigMock(p),
}));

import {
    ensureWorktree,
    WorktreeProvisioningError,
    computeWorktreePath,
    buildWorktreePreamble,
    WORKTREE_BRANCH_RE,
} from './worktree-orchestrator.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    execFileMock.mockReset();
    existsSyncMock.mockReset();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    unlinkSyncMock.mockReset();
    buildGitConfigMock.mockReset();
    cleanupGitConfigMock.mockReset();
    mkdtempSyncMock.mockReset();
    rmSyncMock.mockReset();
    // Default to "directory doesn't exist" so tests opt into the
    // pre-existing-worktree path explicitly.
    existsSyncMock.mockReturnValue(false);
    // Default to a deterministic temp path so the robocopy fallback
    // assertions can match on it. Tests that exercise other code paths
    // don't care.
    mkdtempSyncMock.mockReturnValue('/tmp/atlas-empty-fake');
    // Default to "credential is wired" so push/PR tests don't have to
    // opt-in per case. The null-credential hard-fail test overrides
    // this to return null.
    buildGitConfigMock.mockResolvedValue({ configPath: '/tmp/fake-git-config', transient: false });
});

afterAll(async () => {
    await closeTestDb();
});

describe('WORKTREE_BRANCH_RE', () => {
    it('accepts atlas/dev/<id> and atlas/qa/<id> shapes', () => {
        expect(WORKTREE_BRANCH_RE.test('atlas/dev/ATL-12')).toBe(true);
        expect(WORKTREE_BRANCH_RE.test('atlas/qa/ATL-13')).toBe(true);
        expect(WORKTREE_BRANCH_RE.test('atlas/agent/ATL-99')).toBe(true);
    });

    it('rejects shapes without the atlas/<role>/<id> form', () => {
        expect(WORKTREE_BRANCH_RE.test('main')).toBe(false);
        expect(WORKTREE_BRANCH_RE.test('atlas/ATL-12')).toBe(false);
        expect(WORKTREE_BRANCH_RE.test('atlas//ATL-12')).toBe(false);
        expect(WORKTREE_BRANCH_RE.test('something/atlas/dev/ATL-12')).toBe(false);
    });
});

describe('computeWorktreePath', () => {
    it('places the worktree as a sibling of the project clone', () => {
        const path = computeWorktreePath('/repos/atlas', 'p1', 'atlas/dev/ATL-12');
        // Path normalisation differs slightly across platforms — assert
        // structural pieces instead of an exact string.
        expect(path).toMatch(/worktrees/);
        expect(path).toMatch(/p1/);
        expect(path).toMatch(/atlas__dev__ATL-12$/);
    });
});

describe('buildWorktreePreamble', () => {
    it('mentions the path, the branch, and the no-git-pull directive', () => {
        const md = buildWorktreePreamble({
            branch: 'atlas/dev/ATL-7',
            path: '/repos/worktrees/p1/atlas__dev__ATL-7',
            freshlyCreated: false,
        });
        expect(md).toContain('atlas/dev/ATL-7');
        expect(md).toContain('/repos/worktrees/p1/atlas__dev__ATL-7');
        expect(md).toContain('Do NOT run');
        expect(md).toContain('worktree add');
        expect(md).toContain('git pull');
    });

    it('reports freshlyCreated state in the preamble copy', () => {
        const fresh = buildWorktreePreamble({
            branch: 'atlas/dev/ATL-1',
            path: '/tmp/wt',
            freshlyCreated: true,
        });
        expect(fresh).toContain('just created');
        const reused = buildWorktreePreamble({
            branch: 'atlas/dev/ATL-1',
            path: '/tmp/wt',
            freshlyCreated: false,
        });
        expect(reused).toContain('pulled');
    });
});

// All inserts go via this helper so every story carries a parent epic
// (items table CHECK constraint: non-epic items require parent_id).
async function setupProjectAndStory(opts: {
    projectId?: string;
    prefix?: string;
    gitPath?: string;
    defaultBranch?: string;
    storyId: string;
    worktreeBranch?: string | null;
} = { storyId: 'ATL-1' }): Promise<{ projectId: string; storyId: string }> {
    const projectId = opts.projectId ?? 'p1';
    await insertProject(projectId, opts.prefix ?? 'ATL', {
        git_path: opts.gitPath ?? '/repos/atlas',
        ...(opts.defaultBranch ? { default_branch: opts.defaultBranch } : {}),
    });
    const epicId = `${opts.prefix ?? 'ATL'}-epic`;
    await insertItem({ id: epicId, type: 'epic', project_id: projectId, title: 'E' });
    await insertItem({
        id: opts.storyId,
        type: 'story',
        project_id: projectId,
        parent_id: epicId,
        parent_type: 'epic',
        title: 'S',
    });
    if (opts.worktreeBranch !== undefined) {
        await testDb
            .updateTable('items')
            .set({ worktree_branch: opts.worktreeBranch })
            .where('id', '=', opts.storyId)
            .execute();
    }
    return { projectId, storyId: opts.storyId };
}

describe('ensureWorktree — validation errors', () => {
    it('throws missing_worktree_branch when item.worktree_branch is null', async () => {
        await setupProjectAndStory({ storyId: 'ATL-1' });
        await expect(
            ensureWorktree({
                item: { id: 'ATL-1', worktree_branch: null, worktree_path: null },
                project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
            }),
        ).rejects.toMatchObject({
            name: 'WorktreeProvisioningError',
            code: 'missing_worktree_branch',
        });
    });

    it('throws invalid_branch_name on a non-conforming branch', async () => {
        await setupProjectAndStory({ storyId: 'ATL-1' });
        await expect(
            ensureWorktree({
                item: { id: 'ATL-1', worktree_branch: 'main', worktree_path: null },
                project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
            }),
        ).rejects.toMatchObject({
            name: 'WorktreeProvisioningError',
            code: 'invalid_branch_name',
        });
    });

    it('throws missing_project_git_path when project.git_path is empty', async () => {
        await setupProjectAndStory({ storyId: 'ATL-1' });
        await expect(
            ensureWorktree({
                item: { id: 'ATL-1', worktree_branch: 'atlas/dev/ATL-1', worktree_path: null },
                project: { id: 'p1', git_path: '', credential_id: null },
            }),
        ).rejects.toMatchObject({
            name: 'WorktreeProvisioningError',
            code: 'missing_project_git_path',
        });
    });
});

describe('ensureWorktree — provisioning paths', () => {
    it('pulls --ff-only when the worktree already exists on the right branch', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-2',
            worktreeBranch: 'atlas/dev/ATL-2',
        });

        existsSyncMock.mockReturnValue(true);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            // The probe call (`rev-parse --abbrev-ref HEAD`) confirms the
            // checkout is on the right branch.
            if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
                return { stdout: 'atlas/dev/ATL-2\n', stderr: '' };
            }
            if (args.includes('pull')) {
                return { stdout: 'Already up to date.\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        const result = await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/dev/ATL-2', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        expect(result.branch).toBe('atlas/dev/ATL-2');
        expect(result.freshlyCreated).toBe(false);
        expect(result.path).toMatch(/atlas__dev__ATL-2$/);
        // Path was written back to the items row.
        const row = await testDb
            .selectFrom('items')
            .select(['worktree_path'])
            .where('id', '=', itemId)
            .executeTakeFirst();
        expect(row?.worktree_path).toBe(result.path);
        // We invoked `git pull --ff-only origin <branch>` somewhere in the call list.
        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        expect(calls.some((args) => args.includes('pull') && args.includes('--ff-only'))).toBe(
            true,
        );
        // We did NOT call `git worktree add`.
        expect(calls.every((args) => !args.includes('worktree') || !args.includes('add'))).toBe(
            true,
        );
    });

    // F-009 — Path 1 must `reset --hard HEAD` + `clean -fd` before any
    // rebase / ff-only-pull because the project setup-script
    // regenerates files (e.g. mono-repo's SUNNY.md) every provision,
    // leaving the worktree dirty. `rebase` then refuses with "cannot
    // rebase: You have unstaged changes". This test asserts the reset
    // happens BEFORE the rebase.
    it('discards dirty worktree state before the main-rebase (F-009)', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-905',
            worktreeBranch: 'atlas/qa/ATL-905',
        });
        existsSyncMock.mockReturnValue(true);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
                return { stdout: 'atlas/qa/ATL-905\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/qa/ATL-905', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        const resetIdx = calls.findIndex(
            (args) => args.includes('reset') && args.includes('--hard') && args.includes('HEAD'),
        );
        const cleanIdx = calls.findIndex(
            (args) => args.includes('clean') && args.includes('-fd'),
        );
        const rebaseIdx = calls.findIndex(
            (args) => args.includes('rebase') && !args.includes('--abort'),
        );
        expect(resetIdx).toBeGreaterThanOrEqual(0);
        expect(cleanIdx).toBeGreaterThanOrEqual(0);
        expect(rebaseIdx).toBeGreaterThanOrEqual(0);
        // Both reset and clean must fire BEFORE the rebase.
        expect(resetIdx).toBeLessThan(rebaseIdx);
        expect(cleanIdx).toBeLessThan(rebaseIdx);
    });

    // F-010 — after GitHub auto-deletes the source branch on PR
    // merge, the local worktree still has the branch but
    // `pull --ff-only origin <branch>` errors with "couldn't find
    // remote ref <branch>". The orchestrator treats that as benign
    // (branch is merged; rebaseOntoOrigin catches the worktree up
    // to current main which already contains the merged work).
    it('treats branch-gone-from-origin as benign on Path 1 pull (F-010)', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-908',
            worktreeBranch: 'atlas/qa/ATL-908',
        });
        existsSyncMock.mockReturnValue(true);
        let rebasePullCalls = 0;
        let rebaseOriginCalls = 0;
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
                return { stdout: 'atlas/qa/ATL-908\n', stderr: '' };
            }
            if (args.includes('pull') && args.includes('--ff-only')) {
                const err = new Error('branch gone') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr = "fatal: couldn't find remote ref atlas/qa/ATL-908\n";
                err.code = 128;
                throw err;
            }
            if (args.includes('pull') && args.includes('--rebase')) {
                rebasePullCalls += 1;
                return { stdout: '', stderr: '' };
            }
            if (
                args.includes('rebase') &&
                !args.includes('--abort') &&
                args.some((a) => a.startsWith('origin/'))
            ) {
                rebaseOriginCalls += 1;
                return { stdout: '', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        const result = await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/qa/ATL-908', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        expect(result.freshlyCreated).toBe(false);
        // Branch-gone is benign: NO pull --rebase fallback (that's
        // for divergence, not missing-ref), but rebaseOntoOrigin
        // still runs to bring the worktree up to current main.
        expect(rebasePullCalls).toBe(0);
        expect(rebaseOriginCalls).toBeGreaterThanOrEqual(1);
    });

    // F-009 — when origin/<branch> has diverged from the worktree's
    // local tip (e.g. a previous Owner pushed a different lineage),
    // `pull --ff-only` rejects with "Not possible to fast-forward".
    // The orchestrator falls back to `pull --rebase` which puts the
    // local commits on top of the remote tip.
    it('falls back to pull --rebase when pull --ff-only rejects on divergence (F-009)', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-906',
            worktreeBranch: 'atlas/qa/ATL-906',
        });
        existsSyncMock.mockReturnValue(true);
        let pullCount = 0;
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
                return { stdout: 'atlas/qa/ATL-906\n', stderr: '' };
            }
            if (args.includes('pull')) {
                pullCount += 1;
                if (pullCount === 1) {
                    // First call is `pull --ff-only` — error with non-FF.
                    const err = new Error('cannot fast-forward') as Error & {
                        stderr?: string;
                        code?: number;
                    };
                    err.stderr =
                        'From https://github.com/x/y.git\nhint: Diverging branches can\'t be fast-forwarded\nfatal: Not possible to fast-forward, aborting.\n';
                    err.code = 1;
                    throw err;
                }
                // Second call is `pull --rebase` — succeeds.
                return { stdout: 'Successfully rebased and updated.\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        const result = await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/qa/ATL-906', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        expect(result.freshlyCreated).toBe(false);
        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        const ffPull = calls.find(
            (args) => args.includes('pull') && args.includes('--ff-only'),
        );
        const rebasePull = calls.find(
            (args) => args.includes('pull') && args.includes('--rebase'),
        );
        expect(ffPull).toBeDefined();
        expect(rebasePull).toBeDefined();
    });

    // F-009 — when the rebase-onto-main fails with a cherry-pick
    // conflict (`could not apply <sha>`), the orchestrator throws a
    // dedicated WorktreeProvisioningError with code
    // `worktree_diverged_from_main` instead of the generic
    // `git_command_failed`, so the Owner sees an actionable hint.
    it('surfaces worktree_diverged_from_main on rebase cherry-pick conflict (F-009)', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-907',
            worktreeBranch: 'atlas/qa/ATL-907',
        });
        existsSyncMock.mockReturnValue(true);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
                return { stdout: 'atlas/qa/ATL-907\n', stderr: '' };
            }
            if (args.includes('pull')) {
                return { stdout: '', stderr: '' };
            }
            if (
                args.includes('rebase') &&
                !args.includes('--abort') &&
                args.some((a) => a.startsWith('origin/'))
            ) {
                const err = new Error('cherry-pick conflict') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr =
                    'Rebasing (1/2)\nerror: could not apply abc1234... feat: some change\nCould not apply abc1234... feat: some change\n';
                err.code = 1;
                throw err;
            }
            // `rebase --abort` and everything else succeeds.
            return { stdout: '', stderr: '' };
        });

        const { WorktreeProvisioningError: _WorktreeProvisioningError } = await import(
            './worktree-orchestrator.js'
        );

        await expect(
            ensureWorktree({
                item: { id: itemId, worktree_branch: 'atlas/qa/ATL-907', worktree_path: null },
                project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
            }),
        ).rejects.toMatchObject({
            name: 'WorktreeProvisioningError',
            code: 'worktree_diverged_from_main',
        });
        // Verify rebase --abort was attempted (worktree left clean).
        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        expect(calls.some((args) => args.includes('rebase') && args.includes('--abort'))).toBe(
            true,
        );
    });

    it('adds the worktree against the existing origin branch when it exists', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-3',
            worktreeBranch: 'atlas/dev/ATL-3',
        });

        // Directory does not exist → probe returns false → branch-on-origin path.
        existsSyncMock.mockReturnValue(false);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('ls-remote')) {
                return { stdout: 'deadbeef\trefs/heads/atlas/dev/ATL-3\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        const result = await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/dev/ATL-3', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        expect(result.freshlyCreated).toBe(true);
        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        // We fetched the branch and added a worktree against it.
        expect(calls.some((args) => args.includes('fetch') && args.includes('origin'))).toBe(true);
        expect(
            calls.some(
                (args) =>
                    args.includes('worktree') && args.includes('add') && args.includes('atlas/dev/ATL-3'),
            ),
        ).toBe(true);
        // We did NOT push because the branch was already on origin.
        expect(calls.every((args) => !args.includes('push'))).toBe(true);
    });

    // F-002 — orphan-worktree recovery. When a previous run ended
    // without cleanup (cancel, error, or push-failure left the
    // worktree on disk), the path exists but probeWorktree refuses
    // it (rev-parse fails, or it's on a different branch). The
    // orchestrator must remove the stale worktree + local branch
    // before adding a fresh one, otherwise `git worktree add` fails
    // with "directory already exists" and the retry errors instantly.
    it('cleans up orphan worktree dir before re-provisioning (F-002)', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-902',
            worktreeBranch: 'atlas/qa/ATL-902',
        });

        // Path exists on disk (orphan from a previous run) but rev-parse
        // fails, so probeWorktree returns false → recovery branch.
        existsSyncMock.mockReturnValue(true);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('rev-parse')) {
                const err = new Error('not a git repo') as Error & { stderr?: string };
                err.stderr = 'fatal: not a git repository\n';
                throw err;
            }
            if (args.includes('ls-remote')) {
                return { stdout: 'cafebabe\trefs/heads/atlas/qa/ATL-902\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        const result = await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/qa/ATL-902', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        expect(result.freshlyCreated).toBe(true);
        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        // Cleanup commands ran before the new worktree add.
        const removeIdx = calls.findIndex(
            (args) =>
                args.includes('worktree') && args.includes('remove') && args.includes('--force'),
        );
        const branchDeleteIdx = calls.findIndex(
            (args) => args.includes('branch') && args.includes('-D'),
        );
        const addIdx = calls.findIndex(
            (args) =>
                args.includes('worktree') &&
                args.includes('add') &&
                args.includes('atlas/qa/ATL-902') &&
                !args.includes('--force'),
        );
        expect(removeIdx).toBeGreaterThanOrEqual(0);
        expect(branchDeleteIdx).toBeGreaterThanOrEqual(0);
        expect(addIdx).toBeGreaterThanOrEqual(0);
        // Cleanup must fire BEFORE the add.
        expect(removeIdx).toBeLessThan(addIdx);
        expect(branchDeleteIdx).toBeLessThan(addIdx);
    });

    it('creates a new branch off origin/main and pushes when the branch is net-new', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-4',
            worktreeBranch: 'atlas/dev/ATL-4',
        });

        existsSyncMock.mockReturnValue(false);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('ls-remote')) {
                // Empty → branch does not exist on origin yet.
                return { stdout: '', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        const result = await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/dev/ATL-4', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        expect(result.freshlyCreated).toBe(true);
        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        // Worktree added with `-b <branch> <path> origin/main`.
        expect(
            calls.some(
                (args) =>
                    args.includes('worktree') &&
                    args.includes('add') &&
                    args.includes('-b') &&
                    args.includes('atlas/dev/ATL-4') &&
                    args.includes('origin/main'),
            ),
        ).toBe(true);
        // And we pushed with upstream tracking.
        expect(
            calls.some(
                (args) =>
                    args.includes('push') &&
                    args.includes('--set-upstream') &&
                    args.includes('origin') &&
                    args.includes('atlas/dev/ATL-4'),
            ),
        ).toBe(true);
    });

    it('D1: scrubs stale http.extraheader + credential.helper from the shared config at startup', async () => {
        // Workstream C (commit 9bf3970) accidentally wrote these keys
        // to the shared .git/config on Windows installs because the
        // worktree-config extension wasn't enabled. The leftover keys
        // then collided with GIT_CONFIG_GLOBAL on every subsequent op,
        // producing Duplicate-Authorization 400s. D1 scrubs them at the
        // top of every ensureWorktree call so installs that ran C are
        // remediated in-place. Idempotent on installs that never had C.
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-D1',
            worktreeBranch: 'atlas/dev/ATL-D1',
        });

        existsSyncMock.mockReturnValue(true);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
                return { stdout: 'atlas/dev/ATL-D1\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/dev/ATL-D1', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        // The scrub fires BEFORE other git ops — assert both unsets run.
        const unsetExtraHeader = calls.find(
            (args) =>
                args.includes('config') &&
                args.includes('--local') &&
                args.includes('--unset-all') &&
                args.includes('http.extraheader'),
        );
        const unsetHelper = calls.find(
            (args) =>
                args.includes('config') &&
                args.includes('--local') &&
                args.includes('--unset-all') &&
                args.includes('credential.helper'),
        );
        expect(unsetExtraHeader).toBeDefined();
        expect(unsetHelper).toBeDefined();
    });

    it('respects project.default_branch when cutting a net-new branch', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-5',
            defaultBranch: 'develop',
            worktreeBranch: 'atlas/dev/ATL-5',
        });

        existsSyncMock.mockReturnValue(false);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('ls-remote')) return { stdout: '', stderr: '' };
            return { stdout: '', stderr: '' };
        });

        await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/dev/ATL-5', worktree_path: null },
            project: {
                id: 'p1',
                git_path: '/repos/atlas',
                credential_id: null,
                default_branch: 'develop',
            },
        });

        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        expect(
            calls.some(
                (args) =>
                    args.includes('worktree') &&
                    args.includes('add') &&
                    args.includes('-b') &&
                    args.includes('origin/develop'),
            ),
        ).toBe(true);
        // The pre-cut fetch should target the default branch.
        expect(
            calls.some(
                (args) =>
                    args.includes('fetch') && args.includes('origin') && args.includes('develop'),
            ),
        ).toBe(true);
    });

    it('surfaces git_command_failed when a git invocation rejects', async () => {
        await setupProjectAndStory({
            storyId: 'ATL-6',
            worktreeBranch: 'atlas/dev/ATL-6',
        });

        existsSyncMock.mockReturnValue(true);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('rev-parse')) {
                return { stdout: 'atlas/dev/ATL-6\n', stderr: '' };
            }
            if (args.includes('pull')) {
                const err = new Error('fatal: not possible to fast-forward') as Error & {
                    stdout?: string;
                    stderr?: string;
                };
                err.stdout = '';
                err.stderr = 'fatal: not possible to fast-forward';
                throw err;
            }
            return { stdout: '', stderr: '' };
        });

        await expect(
            ensureWorktree({
                item: { id: 'ATL-6', worktree_branch: 'atlas/dev/ATL-6', worktree_path: null },
                project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
            }),
        ).rejects.toMatchObject({
            name: 'WorktreeProvisioningError',
            code: 'git_command_failed',
        });
    });
});

// Workstream #3 (2026-06-02) — ROLE_BRANCH_OVERRIDES + per-agent
// branch routing are gone. The orchestrator now derives the branch
// exclusively from `items.worktree_branch`, set by PO Writer when the
// story is authored. The Automation Engineer working on a QA twin
// uses the QA twin's `atlas/qa/<id>` branch verbatim, not a
// role-derived `atlas/auto/<id>` fresh-off-main. See plan #2.
describe('ensureWorktree — item.worktree_branch is the single source of truth', () => {
    it('uses item.worktree_branch verbatim (no role-based override path)', async () => {
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-77',
            worktreeBranch: 'atlas/qa/ATL-77',
        });

        existsSyncMock.mockReturnValue(false);
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            // Empty ls-remote → net-new branch cut off origin/main.
            if (args.includes('ls-remote')) return { stdout: '', stderr: '' };
            return { stdout: '', stderr: '' };
        });

        const result = await ensureWorktree({
            item: { id: itemId, worktree_branch: 'atlas/qa/ATL-77', worktree_path: null },
            project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
        });

        expect(result.branch).toBe('atlas/qa/ATL-77');
        expect(result.path).toMatch(/atlas__qa__ATL-77$/);

        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        // The orchestrator never reaches for an alternative `atlas/auto/`
        // shape — that path is removed entirely.
        expect(
            calls.every((args) => !args.some((a) => a.startsWith('atlas/auto/'))),
        ).toBe(true);
    });

    it('throws missing_worktree_branch when item.worktree_branch is null', async () => {
        await setupProjectAndStory({ storyId: 'ATL-79', worktreeBranch: null });
        await expect(
            ensureWorktree({
                item: { id: 'ATL-79', worktree_branch: null, worktree_path: null },
                project: { id: 'p1', git_path: '/repos/atlas', credential_id: null },
            }),
        ).rejects.toMatchObject({
            name: 'WorktreeProvisioningError',
            code: 'missing_worktree_branch',
        });
    });
});

describe('WorktreeProvisioningError', () => {
    it('carries the code and optional details on the error object', () => {
        const err = new WorktreeProvisioningError('missing_worktree_branch', 'oops', {
            item_id: 'ATL-1',
        });
        expect(err.code).toBe('missing_worktree_branch');
        expect(err.details).toEqual({ item_id: 'ATL-1' });
        expect(err.message).toBe('oops');
        expect(err.name).toBe('WorktreeProvisioningError');
    });
});

// D2 — pushWorktree is the orchestrator's end-of-run network op for
// agents. Imported lazily here so the mocked execFile picks up its
// invocations cleanly.
describe('pushWorktree — orchestrator-driven git push', () => {
    it('runs `git push --set-upstream origin HEAD:<branch>` from the worktree', async () => {
        const { pushWorktree } = await import('./worktree-orchestrator.js');
        execFileMock.mockImplementation(() => ({ stdout: 'pushed\n', stderr: '' }));
        // 2026-06-10 — the push pre-check now reads existsSync(worktree/.git)
        // and bails if absent (was producing the noisy MON-3 reviewer error).
        // Real runs always have .git present at push time; the test opts in.
        existsSyncMock.mockReturnValue(true);

        const result = await pushWorktree(
            '/tmp/wt/atlas__dev__ATL-200',
            'atlas/dev/ATL-200',
            'cred-1',
            'p1',
        );

        expect(result.pushed).toBe(true);
        expect(result.alreadyUpToDate).toBe(false);
        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        const pushCall = calls.find(
            (args) =>
                args.includes('push') &&
                args.includes('--set-upstream') &&
                args.includes('origin') &&
                args.includes('HEAD:atlas/dev/ATL-200'),
        );
        expect(pushCall).toBeDefined();
        expect(pushCall).toContain('-C');
        expect(pushCall).toContain('/tmp/wt/atlas__dev__ATL-200');
    });

    it('reports alreadyUpToDate when git emits "Everything up-to-date"', async () => {
        const { pushWorktree } = await import('./worktree-orchestrator.js');
        execFileMock.mockImplementation(() => ({
            stdout: '',
            stderr: 'Everything up-to-date\n',
        }));
        existsSyncMock.mockReturnValue(true);

        const result = await pushWorktree('/tmp/wt', 'atlas/dev/ATL-201', 'cred-1', 'p1');

        expect(result.alreadyUpToDate).toBe(true);
        expect(result.pushed).toBe(false);
        expect(result.error).toBeUndefined();
    });

    it('returns { pushed: false, error } on a non-recoverable auth or conflict failure', async () => {
        const { pushWorktree } = await import('./worktree-orchestrator.js');
        execFileMock.mockImplementation(() => {
            const err = new Error('push rejected') as Error & {
                stderr?: string;
                stdout?: string;
                code?: number;
            };
            // Non-divergence failure — credential issue. Does NOT trigger
            // the rebase-and-retry path (Plan 4 / F-008 fix).
            err.stderr = 'fatal: Authentication failed for https://github.com/...\n';
            err.code = 128;
            throw err;
        });
        existsSyncMock.mockReturnValue(true);

        const result = await pushWorktree('/tmp/wt', 'atlas/dev/ATL-202', 'cred-1', 'p1');

        expect(result.pushed).toBe(false);
        expect(result.alreadyUpToDate).toBe(false);
        expect(result.error).toContain('Authentication failed');
    });

    // F-008 — when a previous run pushed a divergent lineage, the
    // first push errors with non-fast-forward. The orchestrator must
    // rebase HEAD onto origin/<branch> and retry once before giving
    // up, so the agent's commit doesn't get stranded on a local
    // branch that the PR never sees.
    it('rebases onto origin/<branch> and retries when first push errors non-fast-forward', async () => {
        const { pushWorktree } = await import('./worktree-orchestrator.js');
        existsSyncMock.mockReturnValue(true);

        let pushCount = 0;
        execFileMock.mockImplementation((_cmd: string, args: string[]) => {
            if (args.includes('push')) {
                pushCount += 1;
                if (pushCount === 1) {
                    const err = new Error('non-fast-forward') as Error & {
                        stderr?: string;
                        code?: number;
                    };
                    err.stderr =
                        'To https://github.com/x/y.git\n ! [rejected]        HEAD -> atlas/qa/ATL-1 (non-fast-forward)\nUpdates were rejected because the tip of your current branch is behind\n';
                    err.code = 1;
                    throw err;
                }
                return { stdout: 'pushed\n', stderr: '' };
            }
            // fetch / rebase succeed cleanly
            return { stdout: '', stderr: '' };
        });

        const result = await pushWorktree('/tmp/wt', 'atlas/qa/ATL-1', 'cred-1', 'p1');

        expect(result.pushed).toBe(true);
        expect(result.error).toBeUndefined();
        const argSets = execFileMock.mock.calls.map((c) => c[1] as string[]);
        expect(argSets.some((a) => a.includes('fetch') && a.includes('origin'))).toBe(true);
        expect(argSets.some((a) => a.includes('rebase') && a.includes('origin/atlas/qa/ATL-1'))).toBe(true);
        // First push + retry push.
        expect(argSets.filter((a) => a.includes('push'))).toHaveLength(2);
    });

    it('aborts rebase and surfaces the original error when rebase fails', async () => {
        const { pushWorktree } = await import('./worktree-orchestrator.js');
        existsSyncMock.mockReturnValue(true);

        execFileMock.mockImplementation((_cmd: string, args: string[]) => {
            if (args.includes('push')) {
                const err = new Error('non-fast-forward') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr = '! [rejected]        HEAD -> branch (non-fast-forward)\n';
                err.code = 1;
                throw err;
            }
            if (args.includes('rebase') && !args.includes('--abort')) {
                const err = new Error('conflict') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr = 'CONFLICT (content): Merge conflict in foo.txt\n';
                err.code = 1;
                throw err;
            }
            // fetch and rebase --abort succeed.
            return { stdout: '', stderr: '' };
        });

        const result = await pushWorktree('/tmp/wt', 'atlas/qa/ATL-2', 'cred-1', 'p1');

        expect(result.pushed).toBe(false);
        expect(result.error).toMatch(/non-fast-forward push; rebase failed/);
        expect(result.error).toContain('CONFLICT');
        // Verify we attempted `rebase --abort` to leave the worktree clean.
        const argSets = execFileMock.mock.calls.map((c) => c[1] as string[]);
        expect(argSets.some((a) => a.includes('rebase') && a.includes('--abort'))).toBe(true);
    });

    // Workstream #1 (2026-06-02) — never silently fall through to the
    // OS credential manager. When the project has no credential_id, the
    // push must refuse with a clear, actionable error so the Owner
    // sees the misconfiguration in the run log instead of being
    // prompted by GCM on every push.
    it('hard-fails without spawning git when no credential is wired', async () => {
        const { pushWorktree } = await import('./worktree-orchestrator.js');
        buildGitConfigMock.mockResolvedValueOnce({ configPath: null, transient: false });

        const result = await pushWorktree('/tmp/wt', 'atlas/dev/ATL-203', null, 'p1');

        expect(result.pushed).toBe(false);
        expect(result.alreadyUpToDate).toBe(false);
        expect(result.error).toMatch(/credential_id is not configured/);
        // No `git push` should ever have been invoked.
        const pushCalls = execFileMock.mock.calls.filter((c) =>
            (c[1] as string[]).includes('push'),
        );
        expect(pushCalls).toHaveLength(0);
    });

    it('hard-fails with a credential-id-specific message when the credential lookup misses', async () => {
        const { pushWorktree } = await import('./worktree-orchestrator.js');
        buildGitConfigMock.mockResolvedValueOnce({ configPath: null, transient: false });

        const result = await pushWorktree('/tmp/wt', 'atlas/dev/ATL-204', 'cred-missing', 'p1');

        expect(result.pushed).toBe(false);
        expect(result.error).toMatch(/credential cred-missing not found/);
    });
});

// Owner's "remote is source of truth" lifecycle — cleanup runs AFTER
// a successful push. Each step is independent and best-effort:
// failures collect warnings but never throw, and the DB clear is the
// load-bearing invariant (next run must re-provision from origin).
describe('cleanupWorktreeAfterPush', () => {
    it('removes the worktree + local branch and nulls worktree_path, but preserves worktree_branch for the next agent in the chain', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-300',
            worktreeBranch: 'atlas/dev/ATL-300',
        });
        // Seed the worktree_path so we can assert the DB clear flips it to null.
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-300' })
            .where('id', '=', itemId)
            .execute();

        execFileMock.mockImplementation(() => ({ stdout: '', stderr: '' }));

        const result = await cleanupWorktreeAfterPush({
            itemId,
            projectId: 'p1',
            // Provide a credential so Step 4 (fetch --prune) actually
            // runs and the `warnings === []` assertion below holds.
            // The default `buildGitConfigMock.mockResolvedValue` returns
            // `/tmp/fake-git-config`, so the fetch goes through the
            // mock harmlessly.
            credentialId: 'cred-test',
            projectGitPath: '/repos/atlas',
            worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-300',
            branch: 'atlas/dev/ATL-300',
        });

        expect(result.worktreeRemoved).toBe(true);
        expect(result.branchDeleted).toBe(true);
        expect(result.dbCleared).toBe(true);
        expect(result.warnings).toEqual([]);

        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        const removeCall = calls.find(
            (args) =>
                args.includes('worktree') &&
                args.includes('remove') &&
                args.includes('--force') &&
                args.includes('/repos/worktrees/p1/atlas__dev__ATL-300'),
        );
        expect(removeCall).toBeDefined();
        expect(removeCall).toContain('-C');
        expect(removeCall).toContain('/repos/atlas');

        const branchCall = calls.find(
            (args) =>
                args.includes('branch') &&
                args.includes('-D') &&
                args.includes('atlas/dev/ATL-300'),
        );
        expect(branchCall).toBeDefined();
        expect(branchCall).toContain('-C');
        expect(branchCall).toContain('/repos/atlas');

        const row = await testDb
            .selectFrom('items')
            .select(['worktree_path', 'worktree_branch'])
            .where('id', '=', itemId)
            .executeTakeFirst();
        // worktree_path nulled (per-run state) — next dispatch re-provisions.
        expect(row?.worktree_path).toBeNull();
        // worktree_branch PRESERVED — it's PO Writer's per-story contract
        // and downstream agents (Architect Reviewer, Coder, …) need it set
        // to provision their own worktree off origin.
        expect(row?.worktree_branch).toBe('atlas/dev/ATL-300');
    });

    it('still clears the DB when `git worktree remove` fails (filesystem lock, etc.)', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-301',
            worktreeBranch: 'atlas/dev/ATL-301',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-301' })
            .where('id', '=', itemId)
            .execute();

        // First worktree-remove call rejects → cleanup retries with prune
        // (also fails harmlessly), then proceeds to branch delete.
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('worktree') && args.includes('remove')) {
                const err = new Error('removal failed') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr = 'fatal: could not remove worktree (file in use)\n';
                err.code = 1;
                throw err;
            }
            if (args.includes('worktree') && args.includes('prune')) {
                return { stdout: '', stderr: '' };
            }
            // branch -D succeeds.
            return { stdout: '', stderr: '' };
        });

        // Cleanup retries `git worktree remove` with real-time backoffs
        // totalling ~10 minutes. Fake timers let `runAllTimersAsync` drain
        // the schedule instantly so the test exercises the full retry
        // path without blowing the vitest timeout.
        vi.useFakeTimers();
        let result;
        try {
            const cleanupPromise = cleanupWorktreeAfterPush({
                itemId,
                projectId: 'p1',
                credentialId: null,
                projectGitPath: '/repos/atlas',
                worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-301',
                branch: 'atlas/dev/ATL-301',
            });
            await vi.runAllTimersAsync();
            result = await cleanupPromise;
        } finally {
            vi.useRealTimers();
        }

        // 2026-06-03: cleanup now SKIPS `git branch -D` when worktree remove
        // failed — deleting the branch while the worktree dir is still on
        // disk produced the main-clone-pollution incident. So branchDeleted
        // must be false here and the warnings must reflect the skip.
        expect(result.worktreeRemoved).toBe(false);
        expect(result.branchDeleted).toBe(false);
        expect(result.dbCleared).toBe(true);
        expect(result.warnings.some((w) => w.includes('worktree remove failed'))).toBe(true);
        expect(result.warnings.some((w) => w.includes('skipped branch delete'))).toBe(true);

        const row = await testDb
            .selectFrom('items')
            .select(['worktree_path', 'worktree_branch'])
            .where('id', '=', itemId)
            .executeTakeFirst();
        expect(row?.worktree_path).toBeNull();
        expect(row?.worktree_branch).toBe('atlas/dev/ATL-301');
    });

    // Workstream #2 (2026-06-02) — on Windows, deep pnpm/.next trees
    // blow past MAX_PATH and `git worktree remove --force` errors with
    // "Filename too long". The robocopy empty-mirror fallback handles
    // those paths via `\\?\` prefixing. After it succeeds the worktree
    // directory is gone, so we still set `worktreeRemoved: true` and
    // continue with branch delete + DB clear.
    it('falls back to robocopy on Windows when worktree remove fails with "Filename too long"', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-310',
            worktreeBranch: 'atlas/dev/ATL-310',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-310' })
            .where('id', '=', itemId)
            .execute();

        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
            value: 'win32',
            configurable: true,
        });
        // robocopyDeleteTree's `existsSync(targetPath)` gate must pass
        // so we proceed with the empty-mirror.
        existsSyncMock.mockReturnValue(true);

        execFileMock.mockImplementation((bin: string, args: string[]) => {
            if (bin === 'git' && args.includes('worktree') && args.includes('remove')) {
                const err = new Error('removal failed') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr =
                    "fatal: failed to delete '/repos/worktrees/.../deep/path': Filename too long\n";
                err.code = 1;
                throw err;
            }
            // robocopy returns code 1 (files copied) — execFile treats
            // non-zero as a throw, so emulate that and let the helper's
            // bitmask check (codes <8 = success) absorb it.
            if (bin === 'robocopy') {
                const err = new Error('robocopy exited 1') as Error & {
                    code?: number;
                };
                err.code = 1;
                throw err;
            }
            // `git worktree prune`, `git branch -D`, `git fetch --prune`
            // all succeed.
            return { stdout: '', stderr: '' };
        });

        try {
            vi.useFakeTimers();
            let result;
            try {
                const cleanupPromise = cleanupWorktreeAfterPush({
                    itemId,
                    projectId: 'p1',
                    credentialId: null,
                    projectGitPath: '/repos/atlas',
                    worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-310',
                    branch: 'atlas/dev/ATL-310',
                });
                await vi.runAllTimersAsync();
                result = await cleanupPromise;
            } finally {
                vi.useRealTimers();
            }

            expect(result.worktreeRemoved).toBe(true);
            expect(result.warnings.some((w) => w.includes('worktree remove failed'))).toBe(true);
            expect(
                result.warnings.some((w) => w.includes('robocopy fallback')),
            ).toBe(true);

            const calls = execFileMock.mock.calls.map((c) => ({
                bin: c[0] as string,
                args: c[1] as string[],
            }));
            const robocopyCall = calls.find((c) => c.bin === 'robocopy');
            expect(robocopyCall).toBeDefined();
            expect(robocopyCall?.args).toContain('/MIR');
            expect(robocopyCall?.args).toContain('/repos/worktrees/p1/atlas__dev__ATL-310');

            // The empty-source temp dir got created and cleaned up.
            expect(mkdtempSyncMock).toHaveBeenCalled();
            // rmSync called on both the target (after mirror) and the
            // empty source (in the finally).
            const rmPaths = rmSyncMock.mock.calls.map((c) => c[0] as string);
            expect(rmPaths).toContain('/repos/worktrees/p1/atlas__dev__ATL-310');
            expect(rmPaths).toContain('/tmp/atlas-empty-fake');
        } finally {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
                configurable: true,
            });
        }
    });

    it('does NOT run the robocopy fallback when the failure is not a long-path error', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-311',
            worktreeBranch: 'atlas/dev/ATL-311',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-311' })
            .where('id', '=', itemId)
            .execute();

        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
            value: 'win32',
            configurable: true,
        });

        execFileMock.mockImplementation((bin: string, args: string[]) => {
            if (bin === 'git' && args.includes('worktree') && args.includes('remove')) {
                const err = new Error('removal failed') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr = 'fatal: could not remove worktree (file in use)\n';
                err.code = 1;
                throw err;
            }
            return { stdout: '', stderr: '' };
        });

        try {
            vi.useFakeTimers();
            let result;
            try {
                const cleanupPromise = cleanupWorktreeAfterPush({
                    itemId,
                    projectId: 'p1',
                    credentialId: null,
                    projectGitPath: '/repos/atlas',
                    worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-311',
                    branch: 'atlas/dev/ATL-311',
                });
                await vi.runAllTimersAsync();
                result = await cleanupPromise;
            } finally {
                vi.useRealTimers();
            }

            expect(result.worktreeRemoved).toBe(false);
            // robocopy must not have run — the error wasn't a long-path one.
            const robocopyCalls = execFileMock.mock.calls.filter(
                (c) => (c[0] as string) === 'robocopy',
            );
            expect(robocopyCalls).toHaveLength(0);
        } finally {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
                configurable: true,
            });
        }
    });

    it('still clears the DB when `git branch -D` fails (no local ref present)', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-302',
            worktreeBranch: 'atlas/dev/ATL-302',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-302' })
            .where('id', '=', itemId)
            .execute();

        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('branch') && args.includes('-D')) {
                const err = new Error('branch missing') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr = "error: branch 'atlas/dev/ATL-302' not found.\n";
                err.code = 1;
                throw err;
            }
            return { stdout: '', stderr: '' };
        });

        const result = await cleanupWorktreeAfterPush({
            itemId,
            projectId: 'p1',
            credentialId: null,
            projectGitPath: '/repos/atlas',
            worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-302',
            branch: 'atlas/dev/ATL-302',
        });

        expect(result.worktreeRemoved).toBe(true);
        expect(result.branchDeleted).toBe(false);
        expect(result.dbCleared).toBe(true);
        expect(result.warnings.some((w) => w.includes('branch delete failed'))).toBe(true);

        const row = await testDb
            .selectFrom('items')
            .select(['worktree_path', 'worktree_branch'])
            .where('id', '=', itemId)
            .executeTakeFirst();
        expect(row?.worktree_path).toBeNull();
        expect(row?.worktree_branch).toBe('atlas/dev/ATL-302');
    });

    it('never throws when both git ops fail; DB still clears', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-303',
            worktreeBranch: 'atlas/dev/ATL-303',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-303' })
            .where('id', '=', itemId)
            .execute();

        execFileMock.mockImplementation(() => {
            const err = new Error('git unavailable') as Error & {
                stderr?: string;
                code?: number;
            };
            err.stderr = 'git: command not found\n';
            err.code = 127;
            throw err;
        });

        vi.useFakeTimers();
        let result;
        try {
            const cleanupPromise = cleanupWorktreeAfterPush({
                itemId,
                projectId: 'p1',
                credentialId: null,
                projectGitPath: '/repos/atlas',
                worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-303',
                branch: 'atlas/dev/ATL-303',
            });
            await vi.runAllTimersAsync();
            result = await cleanupPromise;
        } finally {
            vi.useRealTimers();
        }

        expect(result.worktreeRemoved).toBe(false);
        expect(result.branchDeleted).toBe(false);
        expect(result.dbCleared).toBe(true);
        expect(result.warnings.length).toBeGreaterThanOrEqual(2);

        const row = await testDb
            .selectFrom('items')
            .select(['worktree_path', 'worktree_branch'])
            .where('id', '=', itemId)
            .executeTakeFirst();
        expect(row?.worktree_path).toBeNull();
        expect(row?.worktree_branch).toBe('atlas/dev/ATL-303');
    });

    // Workstream #3 — Step 7c of the worktree contract. After cleanup,
    // the main repo must `fetch origin --prune` so its
    // `refs/remotes/origin/*` view stays in sync with the actual remote
    // state (merged + deleted branches disappear from the local view).
    // Safe with the implicit refspec — the auto-fetch.ts `--prune` ban
    // applies only to explicit single-branch refspecs.
    it('runs `git fetch origin --prune` on the project clone after the DB clear', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-305',
            worktreeBranch: 'atlas/dev/ATL-305',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-305' })
            .where('id', '=', itemId)
            .execute();

        execFileMock.mockImplementation(() => ({ stdout: '', stderr: '' }));

        const result = await cleanupWorktreeAfterPush({
            itemId,
            projectId: 'p1',
            // Step 4 only fires with a credential — see the new
            // "skipped when null" test below for the no-credential
            // path. This existing test asserts Step 4 *does* run.
            credentialId: 'cred-test',
            projectGitPath: '/repos/atlas',
            worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-305',
            branch: 'atlas/dev/ATL-305',
        });

        expect(result.dbCleared).toBe(true);

        const calls = execFileMock.mock.calls.map((c) => c[1] as string[]);
        const pruneCall = calls.find(
            (args) =>
                args.includes('-C') &&
                args.includes('/repos/atlas') &&
                args.includes('fetch') &&
                args.includes('origin') &&
                args.includes('--prune'),
        );
        expect(pruneCall).toBeDefined();
    });

    it('records a warning but does not throw when the post-cleanup prune fails', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-306',
            worktreeBranch: 'atlas/dev/ATL-306',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-306' })
            .where('id', '=', itemId)
            .execute();

        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            if (args.includes('fetch') && args.includes('--prune')) {
                const err = new Error('fetch failed') as Error & {
                    stderr?: string;
                    code?: number;
                };
                err.stderr = 'fatal: unable to access network\n';
                err.code = 1;
                throw err;
            }
            return { stdout: '', stderr: '' };
        });

        const result = await cleanupWorktreeAfterPush({
            itemId,
            projectId: 'p1',
            // This test exercises the FAILURE path of Step 4 — fetch
            // throws — so we need a credential to make Step 4 actually
            // fire (otherwise it'd be skipped). The mock above throws
            // for the fetch+--prune args.
            credentialId: 'cred-test',
            projectGitPath: '/repos/atlas',
            worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-306',
            branch: 'atlas/dev/ATL-306',
        });

        expect(result.dbCleared).toBe(true);
        expect(result.warnings.some((w) => w.includes('prune'))).toBe(true);
    });

    it('is idempotent — calling twice on the same item is a no-op the second time', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-304',
            worktreeBranch: 'atlas/dev/ATL-304',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-304' })
            .where('id', '=', itemId)
            .execute();

        execFileMock.mockImplementation(() => ({ stdout: '', stderr: '' }));

        const first = await cleanupWorktreeAfterPush({
            itemId,
            projectId: 'p1',
            credentialId: null,
            projectGitPath: '/repos/atlas',
            worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-304',
            branch: 'atlas/dev/ATL-304',
        });
        expect(first.dbCleared).toBe(true);

        // Second call against an already-cleared row: UPDATE matches zero
        // changed rows but the statement itself succeeds, so dbCleared
        // remains true and no exception escapes.
        const second = await cleanupWorktreeAfterPush({
            itemId,
            projectId: 'p1',
            credentialId: null,
            projectGitPath: '/repos/atlas',
            worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-304',
            branch: 'atlas/dev/ATL-304',
        });
        expect(second.dbCleared).toBe(true);
        expect(second.warnings.filter((w) => w.startsWith('db clear failed'))).toEqual([]);
    });

    // GCM-popup fix (2026-06-03). Step 4 (`git fetch origin --prune`) must
    // pass `gitInvokeEnv(gitConfigPath)` so Git for Windows doesn't fall
    // through to `/etc/gitconfig`'s `credential.helper = manager` and pop
    // a modal. Asserts the env shape on the captured spawn args.
    it('Step 4 fetch runs with GCM-silencing env + GIT_CONFIG_GLOBAL when credentialId is provided', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-310',
            worktreeBranch: 'atlas/dev/ATL-310',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-310' })
            .where('id', '=', itemId)
            .execute();

        buildGitConfigMock.mockResolvedValue({ configPath: '/tmp/fake-git-config', transient: false });
        execFileMock.mockImplementation(() => ({ stdout: '', stderr: '' }));

        await cleanupWorktreeAfterPush({
            itemId,
            projectId: 'p1',
            credentialId: 'cred-abc',
            projectGitPath: '/repos/atlas',
            worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-310',
            branch: 'atlas/dev/ATL-310',
        });

        // The credential helper was consulted for the cleanup's own
        // gitConfigPath (not the push that ran upstream).
        expect(buildGitConfigMock).toHaveBeenCalledWith('cred-abc');
        expect(cleanupGitConfigMock).toHaveBeenCalledWith('/tmp/fake-git-config');

        // Locate the Step 4 fetch call by argv and inspect the env it ran
        // with — this is the load-bearing assertion: the env MUST silence
        // GCM (GIT_CONFIG_NOSYSTEM=1, etc.) AND MUST point GIT_CONFIG_GLOBAL
        // at the per-call temp config so the http.extraheader authenticates
        // the fetch.
        const fetchCall = execFileMock.mock.calls.find(
            ([, args]) => Array.isArray(args)
                && args.includes('fetch')
                && args.includes('origin')
                && args.includes('--prune'),
        );
        expect(fetchCall, 'Step 4 fetch should be invoked when credentialId is set').toBeDefined();
        const opts = fetchCall![2] as { env: NodeJS.ProcessEnv };
        expect(opts.env.GIT_CONFIG_NOSYSTEM).toBe('1');
        expect(opts.env.GIT_TERMINAL_PROMPT).toBe('0');
        expect(opts.env.GCM_INTERACTIVE).toBe('Never');
        expect(opts.env.GCM_GUI_PROMPT).toBe('false');
        expect(opts.env.GCM_MODAL_PROMPT).toBe('false');
        expect(opts.env.GIT_CONFIG_GLOBAL).toBe('/tmp/fake-git-config');
    });

    it('Step 4 fetch is skipped (no execFile call, no credential lookup) when credentialId is null', async () => {
        const { cleanupWorktreeAfterPush } = await import('./worktree-orchestrator.js');
        const { storyId: itemId } = await setupProjectAndStory({
            storyId: 'ATL-311',
            worktreeBranch: 'atlas/dev/ATL-311',
        });
        await testDb
            .updateTable('items')
            .set({ worktree_path: '/repos/worktrees/p1/atlas__dev__ATL-311' })
            .where('id', '=', itemId)
            .execute();

        execFileMock.mockImplementation(() => ({ stdout: '', stderr: '' }));

        const result = await cleanupWorktreeAfterPush({
            itemId,
            projectId: 'p1',
            credentialId: null,
            projectGitPath: '/repos/atlas',
            worktreePath: '/repos/worktrees/p1/atlas__dev__ATL-311',
            branch: 'atlas/dev/ATL-311',
        });

        // No credential => no gitConfigPath built, no tempfile to clean.
        expect(buildGitConfigMock).not.toHaveBeenCalled();
        expect(cleanupGitConfigMock).not.toHaveBeenCalled();

        // No `git fetch origin --prune` call landed on execFileMock — we
        // skipped it entirely and recorded a warning instead.
        const fetchCall = execFileMock.mock.calls.find(
            ([, args]) => Array.isArray(args)
                && args.includes('fetch')
                && args.includes('origin')
                && args.includes('--prune'),
        );
        expect(fetchCall).toBeUndefined();
        expect(result.warnings.some((w) => w.includes('fetch --prune skipped'))).toBe(true);
    });
});
