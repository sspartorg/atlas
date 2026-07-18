import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before vi.mock factories.
// ---------------------------------------------------------------------------
vi.mock('node:fs/promises', () => ({
    rm: vi.fn(),
    access: vi.fn(),
}));

vi.mock('./projects.js', () => ({
    projectsService: {
        get: vi.fn(),
        createFromClone: vi.fn(),
        delete: vi.fn(),
    },
}));

// The new workspace-scope guard on `mode=purge` reads settings; return a
// workspace_path that CONTAINS the BASE_INPUT.destination so the guard
// passes and the tests exercise the existing rm/access/delete branches.
vi.mock('./settings.js', () => ({
    settingsService: {
        get: vi.fn().mockResolvedValue({ workspace_path: '/workspace' }),
    },
}));

vi.mock('../routes/events.js', () => ({
    broadcastSSE: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { startDelete } from './delete-runner.js';
import { rm, access } from 'node:fs/promises';
import { projectsService } from './projects.js';
import { broadcastSSE } from '../routes/events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE_INPUT = {
    projectId: 'proj-abc',
    destination: '/workspace/my-project',
};

/** Collect all broadcastSSE calls and find by type. */
function sseCalls() {
    return vi.mocked(broadcastSSE).mock.calls.map((c) => c[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('startDelete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // mode = 'unregister'
    // -----------------------------------------------------------------------

    it('mode=unregister: emits progress lines, calls projectsService.delete, broadcasts delete_completed', async () => {
        vi.mocked(projectsService.delete).mockResolvedValue(undefined as never);

        const deleteId = startDelete({ ...BASE_INPUT, mode: 'unregister' });

        expect(typeof deleteId).toBe('string');
        expect(deleteId.length).toBeGreaterThan(0);

        // Allow the fire-and-forget async block to complete.
        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();

        // delete_status with 'pending' should be first.
        const statusEvt = calls.find((c) => c.type === 'delete_status');
        expect(statusEvt).toBeDefined();
        expect(statusEvt!.status).toBe('pending');

        // Several delete_output lines should have been emitted.
        const outputEvts = calls.filter((c) => c.type === 'delete_output');
        expect(outputEvts.length).toBeGreaterThan(0);
        // Workspace folder kept on disk message for unregister mode.
        const keptEvt = outputEvts.find((c) =>
            (c.output as string).includes('Workspace folder kept on disk'),
        );
        expect(keptEvt).toBeDefined();

        // rm should NOT have been called.
        expect(rm).not.toHaveBeenCalled();

        // projectsService.delete should have been called.
        expect(projectsService.delete).toHaveBeenCalledWith(BASE_INPUT.projectId);

        // delete_completed should be broadcast.
        const completed = calls.find((c) => c.type === 'delete_completed');
        expect(completed).toBeDefined();
        expect(completed!.mode).toBe('unregister');
        expect(completed!.status).toBe('ready');
        expect(completed!.deleteId).toBe(deleteId);
    });

    it('mode=unregister: projectsService.delete throws → broadcasts delete_error', async () => {
        vi.mocked(projectsService.delete).mockRejectedValue(
            new Error('DB error on delete'),
        );

        startDelete({ ...BASE_INPUT, mode: 'unregister' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'delete_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('DB error on delete');
        expect(errorEvt!.status).toBe('error');

        // delete_completed must NOT have been broadcast.
        expect(calls.find((c) => c.type === 'delete_completed')).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // mode = 'purge'
    // -----------------------------------------------------------------------

    it('mode=purge: calls access, calls rm, calls projectsService.delete, broadcasts delete_completed', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        vi.mocked(rm).mockResolvedValue(undefined);
        vi.mocked(projectsService.delete).mockResolvedValue(undefined as never);

        const deleteId = startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        // access called with the destination path.
        expect(access).toHaveBeenCalledWith(BASE_INPUT.destination);

        // rm called with recursive + force.
        expect(rm).toHaveBeenCalledWith(BASE_INPUT.destination, {
            recursive: true,
            force: true,
        });

        // projectsService.delete called.
        expect(projectsService.delete).toHaveBeenCalledWith(BASE_INPUT.projectId);

        const calls = sseCalls();
        const completed = calls.find((c) => c.type === 'delete_completed');
        expect(completed).toBeDefined();
        expect(completed!.mode).toBe('purge');
        expect(completed!.deleteId).toBe(deleteId);
    });

    it('mode=purge + folder not found: skips rm, calls delete, broadcasts delete_completed', async () => {
        // access rejects → folder not found.
        vi.mocked(access).mockRejectedValue(
            Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        );
        vi.mocked(projectsService.delete).mockResolvedValue(undefined as never);

        const deleteId = startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        // rm must NOT have been called.
        expect(rm).not.toHaveBeenCalled();

        // projectsService.delete should still have been called.
        expect(projectsService.delete).toHaveBeenCalledWith(BASE_INPUT.projectId);

        const calls = sseCalls();

        // The "skipped" output line should be present.
        const skippedEvt = calls
            .filter((c) => c.type === 'delete_output')
            .find((c) => (c.output as string).includes('not found'));
        expect(skippedEvt).toBeDefined();

        // delete_completed should still be broadcast.
        const completed = calls.find((c) => c.type === 'delete_completed');
        expect(completed).toBeDefined();
        expect(completed!.deleteId).toBe(deleteId);
    });

    it('mode=purge + rm fails → broadcasts delete_error', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        vi.mocked(rm).mockRejectedValue(new Error('Permission denied'));

        startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'delete_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('Permission denied');

        // projectsService.delete should NOT have been called (early return).
        expect(projectsService.delete).not.toHaveBeenCalled();

        // delete_completed must NOT have been broadcast.
        expect(calls.find((c) => c.type === 'delete_completed')).toBeUndefined();
    });

    it('mode=purge + rm ok + projectsService.delete throws → broadcasts delete_error', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        vi.mocked(rm).mockResolvedValue(undefined);
        vi.mocked(projectsService.delete).mockRejectedValue(
            new Error('Constraint violation'),
        );

        startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'delete_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('Constraint violation');

        expect(calls.find((c) => c.type === 'delete_completed')).toBeUndefined();
    });

    it('mode=purge + folder not found + projectsService.delete throws → broadcasts delete_error', async () => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
        vi.mocked(projectsService.delete).mockRejectedValue(
            new Error('delete failed after skip'),
        );

        startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'delete_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toContain('delete failed after skip');
    });

    // -----------------------------------------------------------------------
    // Output content assertions
    // -----------------------------------------------------------------------

    it('mode=purge emits the -PurgeContent flag in the first output line', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        vi.mocked(rm).mockResolvedValue(undefined);
        vi.mocked(projectsService.delete).mockResolvedValue(undefined as never);

        startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const firstOutput = calls.filter((c) => c.type === 'delete_output')[0];
        expect((firstOutput!.output as string)).toContain('-PurgeContent');
    });

    it('mode=unregister does NOT emit -PurgeContent in the first output line', async () => {
        vi.mocked(projectsService.delete).mockResolvedValue(undefined as never);

        startDelete({ ...BASE_INPUT, mode: 'unregister' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const firstOutput = calls.filter((c) => c.type === 'delete_output')[0];
        expect((firstOutput!.output as string)).not.toContain('-PurgeContent');
    });

    it('returns deleteId synchronously before async work completes', () => {
        vi.mocked(projectsService.delete).mockResolvedValue(undefined as never);

        // The return value is synchronous — no await needed here.
        const deleteId = startDelete({ ...BASE_INPUT, mode: 'unregister' });
        expect(typeof deleteId).toBe('string');
    });

    // -----------------------------------------------------------------------
    // Non-Error thrown value — covers String(err) fallback branches (DRUN-STR)
    // -----------------------------------------------------------------------

    it('mode=unregister: projectsService.delete throws non-Error → String(err) fallback in errorDetail (DRUN-STR-1)', async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        vi.mocked(projectsService.delete).mockRejectedValue('non-error-delete-unregister');

        startDelete({ ...BASE_INPUT, mode: 'unregister' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'delete_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toBe('non-error-delete-unregister');
    });

    it('mode=purge + rm throws non-Error → String(err) fallback in msg (DRUN-STR-2)', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        vi.mocked(rm).mockRejectedValue('non-error-rm');

        startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'delete_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toBe('non-error-rm');
    });

    it('mode=purge + folder not found + projectsService.delete throws non-Error → String(err) fallback (DRUN-STR-3)', async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        vi.mocked(access).mockRejectedValue('non-error-access');
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        vi.mocked(projectsService.delete).mockRejectedValue('non-error-delete-purge-notfound');

        startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'delete_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toBe('non-error-delete-purge-notfound');
    });

    it('mode=purge + rm ok + projectsService.delete throws non-Error → String(err) fallback (DRUN-STR-4)', async () => {
        vi.mocked(access).mockResolvedValue(undefined);
        vi.mocked(rm).mockResolvedValue(undefined);
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        vi.mocked(projectsService.delete).mockRejectedValue('non-error-delete-purge-post-rm');

        startDelete({ ...BASE_INPUT, mode: 'purge' });

        await new Promise((r) => setTimeout(r, 20));

        const calls = sseCalls();
        const errorEvt = calls.find((c) => c.type === 'delete_error') as
            | Record<string, unknown>
            | undefined;

        expect(errorEvt).toBeDefined();
        expect(errorEvt!.errorDetail).toBe('non-error-delete-purge-post-rm');
    });
});
