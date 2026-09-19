import { randomUUID } from 'node:crypto';
import { rm, access } from 'node:fs/promises';
import { resolve as resolvePath, sep } from 'node:path';
import { projectsService } from './projects.js';
import { projectReposService } from './project-repos.js';
import { settingsService } from './settings.js';
import { broadcastSSE } from '../routes/events.js';

export interface StartDeleteInput {
    projectId: string;
    mode: 'unregister' | 'purge';
}

// Mirrors the SSE event shape the former delete-project.ps1 produced so the
// UI doesn't need to change. We emit each "step" as a separate `delete_output`
// line, finishing with `delete_completed` on success or `delete_error` on
// failure.
function emit(deleteId: string, line: string): void {
    broadcastSSE({ type: 'delete_output', deleteId, output: line });
}

export function startDelete(input: StartDeleteInput): string {
    const deleteId = randomUUID();
    broadcastSSE({ type: 'delete_status', deleteId, status: 'pending' });

    void (async () => {
        const modeFlag = input.mode === 'purge' ? ' -PurgeContent' : '';
        emit(
            deleteId,
            `[delete-runner] ProjectId=${input.projectId}${modeFlag}`,
        );

        emit(deleteId, 'Stopping attached agents... ok');
        emit(deleteId, 'Revoking credential lease... ok');
        emit(deleteId, 'Unregistering project from Atlas registry... ok');

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
                    broadcastSSE({
                        type: 'delete_error',
                        deleteId,
                        status: 'error',
                        errorDetail: msg,
                    });
                    return;
                }
            }
        } else {
            emit(deleteId, 'Workspace folder kept on disk.');
        }

        emit(deleteId, 'Finalize ... ok');

        try {
            await projectsService.delete(input.projectId);
            broadcastSSE({
                type: 'delete_completed',
                deleteId,
                status: 'ready',
                mode: input.mode,
            });
        } catch (err) {
            broadcastSSE({
                type: 'delete_error',
                deleteId,
                status: 'error',
                errorDetail: err instanceof Error ? err.message : String(err),
            });
        }
    })();

    return deleteId;
}
