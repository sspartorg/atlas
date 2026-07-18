import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { credentialsService } from './credentials.js';
import { projectsService } from './projects.js';
import { broadcastSSE } from '../routes/events.js';
import { gitInvokeEnv } from './git-env.js';
import type { IProject } from '@atlas/shared';

const execFileP = promisify(execFile);

export function injectToken(repoUrl: string, username: string, token: string): string {
    const u = new URL(repoUrl);
    u.username = encodeURIComponent(username);
    u.password = encodeURIComponent(token);
    return u.toString();
}

function cleanUrl(repoUrl: string): string {
    const u = new URL(repoUrl);
    u.username = '';
    u.password = '';
    return u.toString();
}

export interface StartCloneInput {
    repo_url: string;
    credential_id: string;
    project_name: string;
    issue_key_prefix: string;
    default_branch: string;
    destination: string;
}

export async function startClone(input: StartCloneInput): Promise<string> {
    const cred = await credentialsService.get(input.credential_id);
    if (!cred) throw new Error(`Credential ${input.credential_id} not found`);

    const cloneId = randomUUID();
    const token = await credentialsService.getToken(input.credential_id);
    const authedUrl = injectToken(input.repo_url, cred.username, token);

    // Mirrors the pattern in reclone-runner.ts:101 — scrub the token from
    // every string that git may echo back to the SSE stream (progress lines,
    // error messages including the credential-embedded remote URL that git
    // sometimes prints on failure). Splitting-and-joining avoids RegExp-
    // escape footguns on tokens that contain regex metachars.
    const encodedToken = encodeURIComponent(token);
    const redact = (line: string): string =>
        line.split(token).join('***').split(encodedToken).join('***');

    broadcastSSE({ type: 'clone_status', cloneId, status: 'cloning' });

    // `credential.helper=` (empty) disables every configured helper, including
    // OS-level credential managers that would otherwise intercept the clone.
    // Auth ends up entirely in the URL (basic auth), which is fine for the
    // duration of this single call — we rewrite the remote to a credential-less
    // URL the moment the clone finishes (see `remote set-url` below).
    const child = spawn(
        'git',
        [
            '-c',
            'credential.helper=',
            'clone',
            '--progress',
            '--branch',
            input.default_branch,
            '--',
            authedUrl,
            input.destination,
        ],
        {
            // Auth lives in `authedUrl` (basic), so `gitInvokeEnv(null)` is
            // right — silencers only. The previous partial env omitted
            // `GIT_CONFIG_NOSYSTEM`, which on Windows could let
            // `/etc/gitconfig`'s `credential.helper = manager` race the
            // URL-embedded auth and pop a GCM modal during clone.
            env: gitInvokeEnv(null),
            windowsHide: true,
        },
    );

    const stderrBuf: string[] = [];

    const emit = (text: string, stream: 'stdout' | 'stderr'): void => {
        for (const raw of text.split(/\r?\n/)) {
            const line = redact(raw.trimEnd());
            if (!line) continue;
            if (stream === 'stderr') stderrBuf.push(line);
            broadcastSSE({ type: 'clone_output', cloneId, output: line });
        }
    };

    child.stdout.on('data', (b: Buffer) => emit(b.toString(), 'stdout'));
    child.stderr.on('data', (b: Buffer) => emit(b.toString(), 'stderr'));

    child.on('close', async (code) => {
        if (code === 0) {
            try {
                await execFileP(
                    'git',
                    [
                        '-C',
                        input.destination,
                        'remote',
                        'set-url',
                        'origin',
                        cleanUrl(input.repo_url),
                    ],
                    { env: gitInvokeEnv(null) },
                );
                // Workstream #2 — enable Windows long-path handling so
                // future `git worktree remove` calls don't strand on
                // pnpm/.next trees that exceed MAX_PATH. The flag also
                // lives in `scrubSharedConfigDuplicateAuth` (defensive
                // re-apply on every `ensureWorktree`), but setting it
                // here means a fresh clone is correct from the first
                // run. No-op on non-Windows.
                await execFileP(
                    'git',
                    [
                        '-C',
                        input.destination,
                        'config',
                        '--local',
                        'core.longpaths',
                        'true',
                    ],
                    { env: gitInvokeEnv(null) },
                ).catch(() => undefined);
                await credentialsService.markUsed(input.credential_id);
                const project: IProject = await projectsService.createFromClone({
                    name: input.project_name,
                    issue_key_prefix: input.issue_key_prefix,
                    git_url: cleanUrl(input.repo_url),
                    git_path: input.destination,
                    credential_id: input.credential_id,
                    default_branch: input.default_branch,
                });
                broadcastSSE({ type: 'clone_completed', cloneId, status: 'ready', project });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                broadcastSSE({ type: 'clone_error', cloneId, status: 'error', errorDetail: redact(msg) });
            }
        } else {
            broadcastSSE({
                type: 'clone_error',
                cloneId,
                status: 'error',
                errorDetail: redact(stderrBuf.join('\n')) || `git exited with code ${code}`,
            });
        }
    });

    child.on('error', (err) => {
        broadcastSSE({ type: 'clone_error', cloneId, status: 'error', errorDetail: redact(err.message) });
    });

    return cloneId;
}
