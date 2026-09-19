import { randomUUID } from 'node:crypto';
import { rm, access } from 'node:fs/promises';
import { resolve as resolvePath, sep } from 'node:path';
import { projectsService } from './projects.js';
import { projectReposService } from './project-repos.js';
import { settingsService } from './settings.js';
import { broadcastSSE } from '../routes/events.js';

export interface StartDeleteInput {
    projectId: string;
    destination: string;
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
            // ADR 0017 — the project's extra repos go with it. Read before the
            // project row (and, by cascade, theirs) is deleted.
            const extraPaths = (await projectReposService.list(input.projectId).catch(() => []))
                .filter((r) => !r.primary)
                .map((r) => r.git_path);
            if (!insideWorkspace(input.destination)) {
                const msg = `Refused to purge ${input.destination}: not under workspace root ${workspaceRoot || '<unset>'}`;
                emit(deleteId, msg);
                broadcastSSE({
                    type: 'delete_error',
                    deleteId,
                    status: 'error',
                    errorDetail: msg,
                });
                return;
            }
            for (const extra of extraPaths) {
                if (!insideWorkspace(extra)) {
                    emit(deleteId, `Kept repo folder ${extra}: not under workspace root`);
                    continue;
                }
                await rm(extra, { recursive: true, force: true })
                    .then(() => emit(deleteId, `Removing repo folder ${extra} ... ok`))
                    .catch((err: unknown) =>
                        emit(deleteId, `Removing repo folder ${extra} failed: ${err instanceof Error ? err.message : String(err)}`)
                    );
            }
            emit(deleteId, `Removing workspace folder ${input.destination} ...`);
            try {
                await access(input.destination);
            } catch {
                emit(deleteId, `Workspace folder not found at ${input.destination} ... skipped`);
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
                return;
            }
            try {
                await rm(input.destination, { recursive: true, force: true });
                emit(deleteId, `Removing workspace folder ${input.destination} ... ok`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                emit(deleteId, `Removing workspace folder failed: ${msg}`);
                broadcastSSE({
                    type: 'delete_error',
                    deleteId,
                    status: 'error',
                    errorDetail: msg,
                });
                return;
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
