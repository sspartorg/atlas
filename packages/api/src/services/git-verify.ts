import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { gitInvokeEnv } from './git-env.js';

const exec = promisify(execFile);

export function normalizeRepoUrl(url: string): string {
    return url
        .trim()
        .toLowerCase()
        .replace(/\.git\/?$/, '')
        .replace(/\/+$/, '');
}

export function folderExists(path: string): boolean {
    try {
        return existsSync(path) && statSync(path).isDirectory();
    } catch {
        return false;
    }
}

export function hasGitDir(path: string): boolean {
    return existsSync(join(path, '.git'));
}

export async function readFolderOrigin(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await exec(
            'git',
            ['-C', cwd, 'config', '--get', 'remote.origin.url'],
            { env: gitInvokeEnv(null) },
        );
        const trimmed = stdout.trim();
        return trimmed.length > 0 ? trimmed : null;
    } catch {
        return null;
    }
}

export async function readHead(cwd: string): Promise<{ branch: string; sha: string } | null> {
    try {
        const [b, s] = await Promise.all([
            exec('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { env: gitInvokeEnv(null) }),
            exec('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'], { env: gitInvokeEnv(null) }),
        ]);
        return { branch: b.stdout.trim(), sha: s.stdout.trim() };
    } catch {
        return null;
    }
}

/**
 * Strip URL-embedded basic auth ("https://user:token@host/..." →
 * "https://host/..."). Returns the cleaned URL and the base64(user:token)
 * ready for an `http.extraheader` config, or null when the URL carried no
 * credentials.
 */
function extractAuthFromUrl(rawUrl: string): { cleanUrl: string; authB64: string | null } {
    try {
        const u = new URL(rawUrl);
        if (u.username || u.password) {
            const user = decodeURIComponent(u.username);
            const token = decodeURIComponent(u.password);
            const authB64 = Buffer.from(`${user}:${token}`, 'utf-8').toString('base64');
            u.username = '';
            u.password = '';
            return { cleanUrl: u.toString(), authB64 };
        }
    } catch {
        /* not a URL — fall through */
    }
    return { cleanUrl: rawUrl, authB64: null };
}

export async function lsRemote(authedUrl: string): Promise<boolean> {
    // If the URL embedded basic auth, move it into a 0o600 GIT_CONFIG_GLOBAL
    // tmpfile so the token isn't visible on the argv (which every local user
    // can read via `ps -eo args` / `wmic process get commandline`).
    // Plain URLs pass through unchanged.
    const { cleanUrl, authB64 } = extractAuthFromUrl(authedUrl);
    let gitConfigPath: string | null = null;
    if (authB64) {
        gitConfigPath = join(tmpdir(), `atlas-git-${randomUUID()}.config`);
        writeFileSync(
            gitConfigPath,
            `[http]\n\textraheader = AUTHORIZATION: basic ${authB64}\n[credential]\n\thelper =\n`,
            { mode: 0o600 },
        );
    }

    try {
        await exec('git', ['-c', 'credential.helper=', 'ls-remote', cleanUrl, 'HEAD'], {
            env: gitInvokeEnv(gitConfigPath),
            timeout: 30_000,
        });
        return true;
    } catch {
        return false;
    } finally {
        if (gitConfigPath) {
            try {
                unlinkSync(gitConfigPath);
            } catch {
                /* best-effort */
            }
        }
    }
}

export function deriveProjectName(folderPath: string): string {
    return basename(folderPath.replace(/[\\/]$/, ''));
}
