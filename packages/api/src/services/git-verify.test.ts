import { describe, expect, it, beforeEach, vi } from 'vitest';
import type * as NodeFs from 'node:fs';

// Hoisted mock state so the vi.mock factories can close over them safely.
const { execFileMock, existsSyncMock, statSyncMock } = vi.hoisted(() => ({
    execFileMock: vi.fn(),
    existsSyncMock: vi.fn(),
    statSyncMock: vi.fn(),
}));

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

vi.mock('node:fs', async () => {
    const actual = await vi.importActual<typeof NodeFs>('node:fs');
    return {
        ...actual,
        existsSync: (p: string) => existsSyncMock(p),
        statSync: (p: string) => statSyncMock(p),
    };
});

vi.mock('./git-env.js', () => ({ gitInvokeEnv: vi.fn(() => ({})) }));

import {
    normalizeRepoUrl,
    folderExists,
    hasGitDir,
    readFolderOrigin,
    readHead,
    lsRemote,
    deriveProjectName,
} from './git-verify.js';

const ok = (stdout: string): { stdout: string; stderr: string } => ({ stdout, stderr: '' });
const fail = (msg = 'git error'): Promise<never> => Promise.reject(new Error(msg));

beforeEach(() => {
    execFileMock.mockReset();
    existsSyncMock.mockReset();
    statSyncMock.mockReset();
});

// ---------------------------------------------------------------------------
// normalizeRepoUrl
// ---------------------------------------------------------------------------
describe('normalizeRepoUrl', () => {
    it('trims whitespace and lowercases', () => {
        expect(normalizeRepoUrl('  HTTPS://GITHUB.COM/Org/Repo  ')).toBe(
            'https://github.com/org/repo',
        );
    });

    it('strips trailing .git', () => {
        expect(normalizeRepoUrl('https://github.com/org/repo.git')).toBe(
            'https://github.com/org/repo',
        );
    });

    it('strips trailing .git/ (with slash)', () => {
        expect(normalizeRepoUrl('https://github.com/org/repo.git/')).toBe(
            'https://github.com/org/repo',
        );
    });

    it('strips trailing slashes without .git', () => {
        expect(normalizeRepoUrl('https://github.com/org/repo/')).toBe(
            'https://github.com/org/repo',
        );
    });

    it('strips multiple trailing slashes', () => {
        expect(normalizeRepoUrl('https://github.com/org/repo///')).toBe(
            'https://github.com/org/repo',
        );
    });

    it('leaves clean URL unchanged', () => {
        expect(normalizeRepoUrl('https://github.com/org/repo')).toBe(
            'https://github.com/org/repo',
        );
    });
});

// ---------------------------------------------------------------------------
// folderExists
// ---------------------------------------------------------------------------
describe('folderExists', () => {
    it('returns true when path exists and is a directory', () => {
        existsSyncMock.mockReturnValue(true);
        statSyncMock.mockReturnValue({ isDirectory: () => true });

        expect(folderExists('/some/path')).toBe(true);
    });

    it('returns false when existsSync returns false', () => {
        existsSyncMock.mockReturnValue(false);

        expect(folderExists('/missing')).toBe(false);
        // statSync should not be called when existsSync is false.
        expect(statSyncMock).not.toHaveBeenCalled();
    });

    it('returns false when path exists but is not a directory (file)', () => {
        existsSyncMock.mockReturnValue(true);
        statSyncMock.mockReturnValue({ isDirectory: () => false });

        expect(folderExists('/some/file.txt')).toBe(false);
    });

    it('returns false when statSync throws', () => {
        existsSyncMock.mockReturnValue(true);
        statSyncMock.mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });

        expect(folderExists('/no-access')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// hasGitDir
// ---------------------------------------------------------------------------
describe('hasGitDir', () => {
    it('returns true when .git exists inside path', () => {
        existsSyncMock.mockReturnValue(true);

        expect(hasGitDir('/repo')).toBe(true);
        // The argument passed to existsSync should end with '.git'.
        const [[calledPath]] = existsSyncMock.mock.calls as [[string]];
        expect(calledPath).toMatch(/\.git$/);
    });

    it('returns false when .git does not exist', () => {
        existsSyncMock.mockReturnValue(false);

        expect(hasGitDir('/not-a-repo')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// readFolderOrigin
// ---------------------------------------------------------------------------
describe('readFolderOrigin', () => {
    it('returns trimmed origin URL on success', async () => {
        execFileMock.mockReturnValueOnce(ok('https://github.com/org/repo\n'));

        const result = await readFolderOrigin('/repo');

        expect(result).toBe('https://github.com/org/repo');
    });

    it('returns null when stdout is empty', async () => {
        execFileMock.mockReturnValueOnce(ok('   '));

        const result = await readFolderOrigin('/repo');

        expect(result).toBeNull();
    });

    it('returns null when stdout is a bare newline', async () => {
        execFileMock.mockReturnValueOnce(ok('\n'));

        const result = await readFolderOrigin('/repo');

        expect(result).toBeNull();
    });

    it('returns null when exec throws (not a git repo)', async () => {
        execFileMock.mockReturnValueOnce(fail('not a git repository'));

        const result = await readFolderOrigin('/not-a-repo');

        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// readHead
// ---------------------------------------------------------------------------
describe('readHead', () => {
    it('returns branch and sha on success', async () => {
        // Two calls: rev-parse --abbrev-ref HEAD, then rev-parse --short HEAD.
        execFileMock
            .mockReturnValueOnce(ok('feature/my-branch\n'))
            .mockReturnValueOnce(ok('abc1234\n'));

        const result = await readHead('/repo');

        expect(result).toEqual({ branch: 'feature/my-branch', sha: 'abc1234' });
    });

    it('returns null when either exec call throws', async () => {
        execFileMock
            .mockReturnValueOnce(ok('main\n'))
            .mockReturnValueOnce(fail('not a git repo'));

        const result = await readHead('/not-a-repo');

        expect(result).toBeNull();
    });

    it('returns null when the first exec call throws', async () => {
        execFileMock.mockReturnValueOnce(fail('ENOENT'));

        const result = await readHead('/bad-path');

        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// lsRemote
// ---------------------------------------------------------------------------
// lsRemote receives a pre-authed URL (caller injects credentials via URL
// encoding before calling). We pass a plain URL here since secretlint
// flags embedded auth; the mock just captures whatever URL is supplied.
describe('lsRemote', () => {
    it('returns true when ls-remote succeeds', async () => {
        execFileMock.mockReturnValueOnce(ok('abc123\tHEAD\n'));

        const result = await lsRemote('https://github.com/org/repo.git');

        expect(result).toBe(true);
    });

    it('returns false when ls-remote throws (bad credentials / no network)', async () => {
        execFileMock.mockReturnValueOnce(fail('authentication failed'));

        const result = await lsRemote('https://github.com/org/private-repo.git');

        expect(result).toBe(false);
    });

    it('passes credential.helper= disable flag and the authedUrl to git', async () => {
        execFileMock.mockReturnValueOnce(ok(''));

        await lsRemote('https://github.com/org/repo');

        const [[, args]] = execFileMock.mock.calls as [[string, string[]]];
        expect(args).toContain('credential.helper=');
        expect(args).toContain('ls-remote');
        expect(args).toContain('https://github.com/org/repo');
    });
});

// ---------------------------------------------------------------------------
// deriveProjectName
// ---------------------------------------------------------------------------
describe('deriveProjectName', () => {
    it('returns basename of a clean path', () => {
        expect(deriveProjectName('/home/user/my-project')).toBe('my-project');
    });

    it('strips a trailing forward slash before taking basename', () => {
        expect(deriveProjectName('/home/user/my-project/')).toBe('my-project');
    });

    it('strips a trailing backslash before taking basename', () => {
        expect(deriveProjectName('C:\\Projects\\my-project\\')).toBe('my-project');
    });

    it('handles a simple directory name with no path separators', () => {
        expect(deriveProjectName('my-repo')).toBe('my-repo');
    });
});
