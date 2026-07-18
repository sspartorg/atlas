import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { gitInvokeEnv } from './git-env.js';

const exec = promisify(execFile);

export interface ProjectGitStatus {
    localHead: string;
    remoteHead: string;
    behind: number;
    uncommitted: number;
}

// `authB64` is base64(`${username}:${token}`). When present, the remote fetch
// uses `http.extraheader` Basic auth so it bypasses every credential helper —
// otherwise a naked `git fetch origin` triggers the system Git Credential
// Manager and pops up the account-selector dialog. When absent (credential
// deleted or never attached), we skip the remote fetch entirely and report
// local-only status; otherwise we'd still hit GCM here.
export async function getProjectGitStatus(
    cwd: string,
    branch: string,
    authB64: string | null
): Promise<ProjectGitStatus> {
    // When authenticated fetch is required, write the Basic-auth header
    // into a 0o600 tmp git config and point git at it via
    // `GIT_CONFIG_GLOBAL` — same pattern as `auto-fetch.ts`. Previously
    // this used `-c http.extraheader=...` on argv, exposing base64(user:
    // token) on the process command line (visible to any local user via
    // `ps -eo args` / `wmic process get commandline`).
    let gitConfigPath: string | null = null;
    if (authB64) {
        const authHeader = `AUTHORIZATION: basic ${authB64}`;
        gitConfigPath = join(tmpdir(), `atlas-git-${randomUUID()}.config`);
        writeFileSync(
            gitConfigPath,
            `[http]\n\textraheader = ${authHeader}\n[credential]\n\thelper =\n`,
            { mode: 0o600 },
        );
    }
    // Silencers-only env for local calls; the authed fetch below uses
    // the config-file-bound env instead.
    const env = gitInvokeEnv(null);

    try {
        if (authB64 && gitConfigPath) {
            const authedEnv = gitInvokeEnv(gitConfigPath);
            await exec(
                'git',
                ['-C', cwd, 'fetch', '--prune', 'origin'],
                { env: authedEnv, timeout: 30_000 },
            ).catch(() => undefined);
        }

        const [headRes, remoteRes, behindRes, dirtyRes] = await Promise.all([
            exec('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'], { env }),
            exec('git', ['-C', cwd, 'rev-parse', '--short', `origin/${branch}`], { env }).catch(() => ({
                stdout: '',
            })),
            exec('git', ['-C', cwd, 'rev-list', '--count', `HEAD..origin/${branch}`], { env }).catch(() => ({
                stdout: '0',
            })),
            exec('git', ['-C', cwd, 'status', '--porcelain'], { env }),
        ]);
        return {
            localHead: headRes.stdout.trim(),
            remoteHead: remoteRes.stdout.trim(),
            behind: Number(behindRes.stdout.trim()) || 0,
            uncommitted: dirtyRes.stdout.split('\n').filter((l) => l.trim().length > 0).length,
        };
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
