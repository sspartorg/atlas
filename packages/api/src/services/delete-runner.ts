import { randomUUID } from 'node:crypto';
import { rm, access } from 'node:fs/promises';
import { resolve as resolvePath, sep } from 'node:path';
import { projectsService } from './projects.js';
import { projectReposService } from './project-repos.js';
import { settingsService } from './settings.js';
import { broadcastSSE } from '../routes/events.js';
import { notificationsService } from './notifications.js';

export interface StartDeleteInput {
    projectId: string;
    mode: 'unregister' | 'purge';
    /** Chosen by the client so it can subscribe before POSTing (see DeleteProjectSchema). */
    deleteId?: string;
}

// Each step is a `delete_output` line, finishing with `delete_completed` on
// success or `delete_error` on failure. Only steps that do work are emitted:
// live runs are not stopped here (the CASCADE drops their rows) and there is
// no credential lease to revoke.
function emit(deleteId: string, line: string): void {
    broadcastSSE({ type: 'delete_output', deleteId, output: line });
}

export function startDelete(input: StartDeleteInput): string {
    const deleteId = input.deleteId ?? randomUUID();
    broadcastSSE({ type: 'delete_status', deleteId, status: 'pending' });

    // The modal shows the error live; the notification is for an Owner who
    // closed it. A failed delete leaves the project in place, so it links there.
    const fail = async (detail: string): Promise<void> => {
        broadcastSSE({ type: 'delete_error', deleteId, status: 'error', errorDetail: detail });
        try {
            const project = await projectsService.get(input.projectId);
            await notificationsService.create({
                event_type: 'project_delete_failed',
                project_id: input.projectId,
                message: `Deleting project "${project?.name ?? input.projectId}" failed: ${detail.split('\n')[0]}`,
            });
        } catch {
            // The modal already has the error; a lost notification must not mask it.
        }
    };

    void (async () => {
        const modeFlag = input.mode === 'purge' ? ' -PurgeContent' : '';
        emit(
            deleteId,
            `[delete-runner] ProjectId=${input.projectId}${modeFlag}`,
        );

        if (input.mode === 'purge') {
            // Refuse to `rm -rf` any path that isn't strictly inside the
            // Owner's configured workspace_path. Without this guard, a
            // caller who has already flipped `projects.git_path` to `C:\`,
            // `/`, or any other sensitive tree can turn a purge into an
            // arbitrary-directory wipe (confirm_name only catches typos).
            const settings = await settingsService.get();
            const workspaceRoot = settings.workspace_path
                ? resolvePath(settings.workspace_path)
                : '';
            const insideWorkspace = (target: string): boolean => {
                const resolvedTarget = resolvePath(target);
                return (
                    workspaceRoot.length > 0 &&
                    (resolvedTarget === workspaceRoot || resolvedTarget.startsWith(workspaceRoot + sep))
                );
            };
            // ADR 0018 — every repo of the project goes with it. Read before
            // the project row (and, by cascade, its repos) is deleted.
            const repoPaths = (await projectReposService.list(input.projectId).catch(() => []))
                .map((r) => r.git_path)
                .filter((path) => path.trim().length > 0);
            for (const repoPath of repoPaths) {
                if (!insideWorkspace(repoPath)) {
                    emit(deleteId, `Kept repo folder ${repoPath}: not under workspace root ${workspaceRoot || '<unset>'}`);
                    continue;
                }
                emit(deleteId, `Removing repo folder ${repoPath} ...`);
                try {
                    await access(repoPath);
                } catch {
                    emit(deleteId, `Repo folder not found at ${repoPath} ... skipped`);
                    continue;
                }
                try {
                    await rm(repoPath, { recursive: true, force: true });
                    emit(deleteId, `Removing repo folder ${repoPath} ... ok`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    emit(deleteId, `Removing repo folder failed: ${msg}`);
                    await fail(msg);
                    return;
                }
            }
        } else {
            emit(deleteId, 'Workspace folder kept on disk.');
        }

        emit(deleteId, 'Unregistering project from Atlas...');
        try {
            await projectsService.delete(input.projectId);
            emit(deleteId, 'Unregistering project from Atlas... ok');
            broadcastSSE({
                type: 'delete_completed',
                deleteId,
                status: 'ready',
                mode: input.mode,
            });
        } catch (err) {
            await fail(err instanceof Error ? err.message : String(err));
        }
    })();

    return deleteId;
}
