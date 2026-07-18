import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
    projectGuardrailScriptsService,
    ProjectGuardrailScriptIdConflictError,
} from './projectGuardrailScripts.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

// Phase 1.5b — Per-project guardrail SCRIPTS service. Same Owner-
// supplied slug contract as the org-wide service; conflict raises
// `ProjectGuardrailScriptIdConflictError` so the route can return 409.

async function insertProject(id: string): Promise<string> {
    await testDb
        .insertInto('projects')
        .values({
            id,
            name: id,
            issue_key_prefix: 'TST',
            git_url: 'https://example.com/repo.git',
        })
        .execute();
    return id;
}

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('projectGuardrailScriptsService', () => {
    it('create() persists Owner-supplied id scoped to the project', async () => {
        const projectId = await insertProject('p-scripts-1');
        const row = await projectGuardrailScriptsService.create(projectId, {
            id: 'check-bar',
            name: 'Bar Check',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        expect(row.id).toBe('check-bar');
        expect(row.project_id).toBe(projectId);
    });

    it('create() with a duplicate id in the same project throws conflict error', async () => {
        const projectId = await insertProject('p-scripts-2');
        await projectGuardrailScriptsService.create(projectId, {
            id: 'check-dup',
            name: 'First',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });

        await expect(
            projectGuardrailScriptsService.create(projectId, {
                id: 'check-dup',
                name: 'Second',
                body_sh: 'exit 1',
                body_ps1: 'exit 1',
            }),
        ).rejects.toBeInstanceOf(ProjectGuardrailScriptIdConflictError);
    });

    it('update() with an empty patch returns the existing row unchanged (line 90-91 branch)', async () => {
        // Covers the early-return when Object.keys(clean).length === 0.
        const projectId = await insertProject('p-scripts-3');
        await projectGuardrailScriptsService.create(projectId, {
            id: 'check-empty-pg',
            name: 'Stable',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        const result = await projectGuardrailScriptsService.update('check-empty-pg', {});
        expect(result?.id).toBe('check-empty-pg');
        expect(result?.name).toBe('Stable');
    });

    it('update() with a non-empty patch persists the named fields', async () => {
        const projectId = await insertProject('p-scripts-4');
        await projectGuardrailScriptsService.create(projectId, {
            id: 'check-patch-pg',
            name: 'Original',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        const result = await projectGuardrailScriptsService.update('check-patch-pg', {
            name: 'Renamed',
            body_sh: 'exit 1',
        });
        expect(result?.name).toBe('Renamed');
        expect(result?.body_sh).toBe('exit 1');
    });

    it('update() skips an explicit undefined key mixed with a defined key (v !== undefined false branch)', async () => {
        const projectId = await insertProject('p-scripts-mixed');
        await projectGuardrailScriptsService.create(projectId, {
            id: 'check-mixed-pg',
            name: 'Original',
            description: 'orig-desc',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        const result = await projectGuardrailScriptsService.update('check-mixed-pg', {
            name: 'Renamed',
            description: undefined,
        });
        expect(result?.name).toBe('Renamed');
        expect(result?.description).toBe('orig-desc');
    });

    it('update() on a missing id with an empty patch returns null (the `?? null` fallback on get())', async () => {
        const result = await projectGuardrailScriptsService.update('does-not-exist-pg', {});
        expect(result).toBeNull();
    });

    it('update() on a missing id with a non-empty patch returns null (executeTakeFirst finds no row)', async () => {
        const result = await projectGuardrailScriptsService.update('does-not-exist-pg-2', {
            name: 'New Name',
        });
        expect(result).toBeNull();
    });

    it('get() returns undefined for a missing id', async () => {
        expect(await projectGuardrailScriptsService.get('nope-pg')).toBeUndefined();
    });

    it('remove() deletes the row', async () => {
        const projectId = await insertProject('p-scripts-5');
        await projectGuardrailScriptsService.create(projectId, {
            id: 'check-remove-pg',
            name: 'ToRemove',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        await projectGuardrailScriptsService.remove('check-remove-pg');
        expect(await projectGuardrailScriptsService.get('check-remove-pg')).toBeUndefined();
    });

    it('create() rethrows non-23505 errors unchanged', async () => {
        // A NOT NULL violation (23502) on body_sh should propagate as-is,
        // exercising the `else { throw err; }` path distinct from the
        // conflict-mapping branch.
        await expect(
            projectGuardrailScriptsService.create('project-does-not-exist-pg', {
                id: 'check-fk-violation',
                name: 'Bad FK',
                body_sh: 'exit 0',
                body_ps1: 'exit 0',
            }),
        ).rejects.not.toBeInstanceOf(ProjectGuardrailScriptIdConflictError);
    });
});
