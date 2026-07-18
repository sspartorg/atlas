import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { broadcastSSE } from '../routes/events.js';
import { projectsService } from './projects.js';
import { credentialsService } from './credentials.js';
import { gitInvokeEnv } from './git-env.js';

export interface StartRecloneInput {
    projectId: string;
    destination: string;
    branch: string;
}

interface GitSpawnResult {
    code: number;
    stdout: string;
    stderr: string;
}

// Run a git command in a subprocess, capturing stdout/stderr. The caller
// decides what to broadcast — we never echo lines from here, because the
// reclone flow needs to redact secrets before any output crosses the
// SSE boundary.
function runGit(
    args: string[],
    cwd: string,
    onLine: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<GitSpawnResult> {
    return new Promise((resolve) => {
        // Auth (when needed by fetch/pull) is injected inline via `-c
        // http.extraheader=` in the args, so `gitInvokeEnv(null)` is right
        // here — silencers only, no `GIT_CONFIG_GLOBAL`. The previous
        // partial env omitted `GIT_CONFIG_NOSYSTEM` and `GCM_GUI_PROMPT`,
        // which on Windows let `/etc/gitconfig`'s `credential.helper =
        // manager` fire mid-reclone.
        const child = spawn('git', args, {
            cwd,
            env: gitInvokeEnv(null),
            windowsHide: true,
        });
        let stdoutBuf = '';
        let stderrBuf = '';
        const emit = (text: string, stream: 'stdout' | 'stderr'): void => {
            for (const raw of text.split(/\r?\n/)) {
                const line = raw.trimEnd();
                if (!line) continue;
                onLine(line, stream);
            }
        };
        child.stdout.on('data', (b: Buffer) => {
            const s = b.toString();
            stdoutBuf += s;
            emit(s, 'stdout');
        });
        child.stderr.on('data', (b: Buffer) => {
            const s = b.toString();
            stderrBuf += s;
            emit(s, 'stderr');
        });
        child.on('close', (code) => {
            resolve({ code: code ?? 1, stdout: stdoutBuf, stderr: stderrBuf });
        });
        child.on('error', (err) => {
            resolve({ code: 1, stdout: stdoutBuf, stderr: stderrBuf + err.message });
        });
    });
}

export async function startReclone(input: StartRecloneInput): Promise<string> {
    const project = await projectsService.get(input.projectId);
    if (!project) throw new Error(`Project ${input.projectId} not found`);

    if (!project.credential_id) {
        throw new Error(
            'Original credential was deleted. Re-attach a credential in Settings -> Credentials.',
        );
    }
    const credentialId = project.credential_id;
    const cred = await credentialsService.get(credentialId);
    if (!cred) {
        throw new Error(
            'Original credential was deleted. Re-attach a credential in Settings -> Credentials.',
        );
    }
    let token: string;
    try {
        token = await credentialsService.getToken(credentialId);
    } catch {
        throw new Error(
            'Original credential was deleted. Re-attach a credential in Settings -> Credentials.',
        );
    }

    const authB64 = Buffer.from(`${cred.username}:${token}`, 'utf8').toString('base64');
    const authHeader = `AUTHORIZATION: basic ${authB64}`;
    const recloneId = randomUUID();
    broadcastSSE({ type: 'reclone_status', recloneId, status: 'pending' });

    const redact = (line: string): string => line.split(authB64).join('***').split(token).join('***');
    const emit = (line: string): void => {
        broadcastSSE({ type: 'reclone_output', recloneId, output: redact(line) });
    };

    let stashPath: string | null = null;
    const collectedStderr: string[] = [];

    void (async () => {
        try {
            // 1. Detect dirty working tree
            const status = await runGit(
                ['-c', 'credential.helper=', 'status', '--porcelain'],
                input.destination,
                () => {
                    // status output goes to disk in step 2 if needed — don't stream
                },
            );
            if (status.code !== 0) {
                const msg = status.stderr.trim() || `git status failed with exit code ${status.code}`;
                emit(msg);
                broadcastSSE({
                    type: 'reclone_error',
                    recloneId,
                    status: 'error',
                    errorDetail: redact(msg),
                });
                return;
            }

            // 2. If dirty, stash + dump patch
            const isDirty = status.stdout.trim().length > 0;
            if (isDirty) {
                const stashDir = join(input.destination, '.atlas', 'stash');
                await mkdir(stashDir, { recursive: true });
                const stamp = formatStamp(new Date());
                const stashFile = join(stashDir, `${stamp}.patch`);

                const diff = await runGit(
                    ['-c', 'credential.helper=', 'diff'],
                    input.destination,
                    () => undefined,
                );
                await writeFile(stashFile, diff.stdout, 'utf8');

                emit(`Stashing local changes -> ${stashFile}`);
                const stashPush = await runGit(
                    [
                        '-c',
                        'credential.helper=',
                        'stash',
                        'push',
                        '--include-untracked',
                        '-m',
                        `atlas-reclone-${stamp}`,
                    ],
                    input.destination,
                    (line) => emit(line),
                );
                if (stashPush.code !== 0) {
                    emit(`git stash push failed with exit code ${stashPush.code}`);
                    broadcastSSE({
                        type: 'reclone_error',
                        recloneId,
                        status: 'error',
                        errorDetail: redact(stashPush.stderr || `git stash push failed`),
                    });
                    return;
                }
                emit('Stashing local changes... ok');
                stashPath = stashFile;
            } else {
                emit('Stashing local changes... clean, skipped');
            }

            // 3. Fetch with extraheader auth
            emit('Fetching remote...');
            // `--` sentinel isolates positional args from option parsing so a
            // branch name / url beginning with `-` (or via a future DB
            // migration that widens the shape) can't be interpreted as
            // `--upload-pack=` / `--exec=` and become an argv-injection RCE.
            const fetchRes = await runGit(
                [
                    '-c',
                    'credential.helper=',
                    '-c',
                    `http.extraheader=${authHeader}`,
                    'fetch',
                    '--prune',
                    '--',
                    project.git_url,
                    input.branch,
                ],
                input.destination,
                (line, stream) => {
                    if (stream === 'stderr') collectedStderr.push(line);
                    emit(line);
                },
            );
            if (fetchRes.code !== 0) {
                emit(`Fetch failed with exit code ${fetchRes.code}`);
                broadcastSSE({
                    type: 'reclone_error',
                    recloneId,
                    status: 'error',
                    errorDetail: redact(
                        collectedStderr.join('\n') || `git fetch failed with exit code ${fetchRes.code}`,
                    ),
                });
                return;
            }
            emit('Fetching remote... ok');

            // 4. Fast-forward only
            emit(`Fast-forwarding ${input.branch}...`);
            // `--` sentinel — see fetch above.
            const pullRes = await runGit(
                [
                    '-c',
                    'credential.helper=',
                    '-c',
                    `http.extraheader=${authHeader}`,
                    'pull',
                    '--ff-only',
                    '--',
                    project.git_url,
                    input.branch,
                ],
                input.destination,
                (line, stream) => {
                    if (stream === 'stderr') collectedStderr.push(line);
                    emit(line);
                },
            );
            if (pullRes.code !== 0) {
                emit(`Fast-forward failed with exit code ${pullRes.code}`);
                broadcastSSE({
                    type: 'reclone_error',
                    recloneId,
                    status: 'error',
                    errorDetail: redact(
                        collectedStderr.join('\n') || `git pull failed with exit code ${pullRes.code}`,
                    ),
                });
                return;
            }

            emit('Re-indexing project... ok');

            // 2026-06-10 (Phase 5) — `.env` restore step removed. The
            // per-project setup runner (project-setup-runner.ts) is now
            // responsible for materialising whatever config files the
            // project needs from DB-stored secrets at agent-dispatch
            // time; reclone no longer writes a `.env` to the cloned
            // tree.

            broadcastSSE({
                type: 'reclone_completed',
                recloneId,
                status: 'ready',
                stashPath,
            });
        } catch (err) {
            broadcastSSE({
                type: 'reclone_error',
                recloneId,
                status: 'error',
                errorDetail: redact(err instanceof Error ? err.message : String(err)),
            });
        }
    })();

    return recloneId;
}

// "yyyy-MM-dd-HHmmss" to match the legacy PS1 naming.
function formatStamp(d: Date): string {
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
}
