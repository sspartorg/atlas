import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { schedulesService } from './schedules.js';
import { projectsService } from './projects.js';
import { projectReposService } from './project-repos.js';
import { credentialsService } from './credentials.js';
import { isAnyAgentActiveForProject } from './agent-activity.js';
import { broadcastSSE } from '../routes/events.js';
import { notificationsService } from './notifications.js';
import { sendExternalNotification } from './external-notifications.js';
import { performAutoFetch, type AutoFetchCode } from './auto-fetch.js';
import { gitInvokeEnv } from './git-env.js';
import type { IProjectSchedule, ScheduleRunStatus } from '@atlas/shared';

const execFileP = promisify(execFile);
const AUTH_FAIL_DISABLE_THRESHOLD = 3;

function mapCode(code: AutoFetchCode, detail: string): { result: ScheduleRunStatus; detail: string } {
    switch (code) {
        case 'OK_UPTODATE':
            return { result: 'success', detail: 'already up to date' };
        case 'OK_UPDATED':
            return { result: 'success', detail: 'updated to latest' };
        case 'OK_STASHED_AND_MERGED':
            return { result: 'success', detail: `merged after stash -> ${detail}` };
        case 'CONFLICT_SKIPPED':
            return {
                result: 'conflict',
                detail: detail
                    ? `fast-forward not possible - left folder alone (${detail})`
                    : 'fast-forward not possible - left folder alone',
            };
        case 'CONFLICT_ABORTED':
            return {
                result: 'conflict',
                detail: detail
                    ? `fast-forward not possible - aborted (${detail})`
                    : 'fast-forward not possible - aborted',
            };
        case 'CONFLICT_STASH_POPPED_WITH_CONFLICTS':
            return { result: 'conflict', detail: `merged but stash pop conflicted -> ${detail}` };
        case 'AUTH_FAILED':
            return { result: 'failure', detail: `auth failed: ${detail || 'see API logs'}` };
        case 'FETCH_FAILED':
            return { result: 'failure', detail: `fetch failed: ${detail || 'see API logs'}` };
    }
}

async function isWorkingTreeDirty(cwd: string): Promise<boolean> {
    try {
        const { stdout } = await execFileP('git', ['-C', cwd, 'status', '--porcelain'], {
            env: gitInvokeEnv(null),
            timeout: 10_000,
        });
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

interface GuardSkip {
    detail: string;
}

async function checkGuards(
    schedule: IProjectSchedule,
    repo: { git_path: string },
): Promise<GuardSkip | null> {
    if (
        schedule.skip_if_dirty &&
        schedule.conflict_policy === 'skip' &&
        (await isWorkingTreeDirty(repo.git_path))
    ) {
        return { detail: 'working tree has uncommitted changes' };
    }
    if (schedule.pause_while_agents_active && (await isAnyAgentActiveForProject(schedule.project_id))) {
        return { detail: 'agent run is in flight for this project' };
    }
    return null;
}

// ADR 0018 — auto-fetch runs on one repo of a project.
export async function runAutoFetch(repoId: string): Promise<void> {
    const autofetchId = randomUUID();
    const repo = await projectReposService.get(repoId);
    if (!repo) return;
    const schedule = await schedulesService.getOrDefault(repoId, repo.project_id);
    if (!schedule.enabled) return;
    const project = await projectsService.get(repo.project_id);
    if (!project) return;
    const projectId = repo.project_id;

    broadcastSSE({ type: 'autofetch_status', autofetchId, projectId, repoId, status: 'starting' });

    if (!repo.credential_id) {
        await schedulesService.recordRun(repoId, 'failure', 'no credential attached', schedule.next_run_at);
        await notificationsService.create({
            event_type: 'autofetch_failed',
            project_id: projectId,
            message: `Auto-fetch skipped on "${project.name}/${repo.name}": no credential attached.`,
        });
        broadcastSSE({ type: 'autofetch_completed', autofetchId, projectId, repoId, result: 'failure', detail: 'no credential attached' });
        return;
    }
    const cred = await credentialsService.get(repo.credential_id);
    if (!cred) {
        await schedulesService.recordRun(repoId, 'failure', 'credential missing', schedule.next_run_at);
        await notificationsService.create({
            event_type: 'autofetch_failed',
            project_id: projectId,
            message: `Auto-fetch failed on "${project.name}/${repo.name}": credential missing.`,
        });
        broadcastSSE({ type: 'autofetch_completed', autofetchId, projectId, repoId, result: 'failure', detail: 'credential missing' });
        return;
    }
    let token: string;
    try {
        token = await credentialsService.getToken(repo.credential_id);
    } catch {
        await schedulesService.recordRun(repoId, 'failure', 'token unreadable', schedule.next_run_at);
        await notificationsService.create({
            event_type: 'autofetch_failed',
            project_id: projectId,
            message: `Auto-fetch failed on "${project.name}/${repo.name}": token unreadable.`,
        });
        broadcastSSE({ type: 'autofetch_completed', autofetchId, projectId, repoId, result: 'failure', detail: 'token unreadable' });
        return;
    }

    const guard = await checkGuards(schedule, repo);
    if (guard) {
        await schedulesService.recordRun(repoId, 'skipped', guard.detail, schedule.next_run_at);
        await notificationsService.create({
            event_type: 'autofetch_skipped',
            project_id: projectId,
            message: `Auto-fetch skipped on "${project.name}/${repo.name}": ${guard.detail}.`,
        });
        broadcastSSE({ type: 'autofetch_status', autofetchId, projectId, repoId, status: 'skipped' });
        broadcastSSE({ type: 'autofetch_completed', autofetchId, projectId, repoId, result: 'skipped', detail: guard.detail });
        return;
    }

    const authB64 = Buffer.from(`${cred.username}:${token}`, 'utf8').toString('base64');
    broadcastSSE({ type: 'autofetch_status', autofetchId, projectId, repoId, status: 'fetching' });

    const redact = (line: string) => line.split(authB64).join('***').split(token).join('***');
    const fetchResult = await performAutoFetch({
        destination: repo.git_path,
        branch: repo.default_branch,
        remoteUrl: repo.git_url,
        authB64,
        conflictPolicy: schedule.conflict_policy,
        onLine: (raw) => {
            for (const part of raw.split(/\r?\n/)) {
                const line = part.trimEnd();
                if (!line) continue;
                broadcastSSE({
                    type: 'autofetch_output',
                    autofetchId,
                    projectId,
                    repoId,
                    output: redact(line),
                });
            }
        },
    });

    const { result, detail } = mapCode(fetchResult.code, fetchResult.detail);

    if (fetchResult.code === 'AUTH_FAILED') {
        const count = await schedulesService.incrementAuthFailure(repoId);
        if (count >= AUTH_FAIL_DISABLE_THRESHOLD) {
            await schedulesService.disable(repoId);
            await schedulesService.recordRun(
                repoId,
                'failure',
                `${detail} - auto-disabled after ${count} failures`,
                null,
            );
            await notificationsService.create({
                event_type: 'autofetch_disabled',
                kind: 'needs_you',
                project_id: projectId,
                message: `Auto-fetch disabled on "${project.name}/${repo.name}": credential rejected ${count} times in a row. Re-attach credential and re-enable.`,
            });
            sendExternalNotification(
                `Auto-fetch disabled on "${project.name}/${repo.name}" after ${count} auth failures.`,
            ).catch(() => {});
            broadcastSSE({
                type: 'autofetch_error',
                autofetchId,
                projectId,
                repoId,
                errorDetail: `${detail} - auto-disabled`,
            });
            return;
        }
    } else if (result === 'success') {
        await schedulesService.resetAuthFailure(repoId);
    }

    await schedulesService.recordRun(repoId, result, detail, schedule.next_run_at);

    const evt = `autofetch_${result === 'success' ? 'success' : result === 'skipped' ? 'skipped' : result === 'conflict' ? 'conflict' : 'failed'}`;
    await notificationsService.create({
        event_type: evt,
        kind: 'system',
        project_id: projectId,
        message: `Auto-fetch on "${project.name}/${repo.name}": ${detail}.`,
    });
    if (result === 'failure' || (result === 'conflict' && schedule.conflict_policy === 'abort')) {
        sendExternalNotification(`Auto-fetch on "${project.name}/${repo.name}": ${detail}.`).catch(() => {});
    }
    broadcastSSE({ type: 'autofetch_completed', autofetchId, projectId, repoId, result, detail });
}

export const __internal = { isWorkingTreeDirty, checkGuards, mapCode };
