import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
    guardrailScriptsService,
    GuardrailScriptIdConflictError,
} from './guardrailScripts.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';

// Phase 1.5b — Org-wide guardrail SCRIPTS service. Owner supplies the
// kebab-case slug at create time; the service surfaces a typed
// conflict error on duplicate ids so the HTTP layer can map it to 409.

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('guardrailScriptsService', () => {
    it('create() persists Owner-supplied id verbatim', async () => {
        const row = await guardrailScriptsService.create({
            id: 'check-foo',
            name: 'Foo Check',
            description: '',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        expect(row.id).toBe('check-foo');
        expect(row.name).toBe('Foo Check');

        const fetched = await guardrailScriptsService.get('check-foo');
        expect(fetched?.id).toBe('check-foo');
    });

    it('create() with a duplicate id throws GuardrailScriptIdConflictError', async () => {
        await guardrailScriptsService.create({
            id: 'check-dup',
            name: 'First',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });

        await expect(
            guardrailScriptsService.create({
                id: 'check-dup',
                name: 'Second',
                body_sh: 'exit 1',
                body_ps1: 'exit 1',
            }),
        ).rejects.toBeInstanceOf(GuardrailScriptIdConflictError);
    });

    it('update() does not allow changing id', async () => {
        const created = await guardrailScriptsService.create({
            id: 'check-immutable',
            name: 'Original',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });

        const patched = await guardrailScriptsService.update(created.id, {
            name: 'Renamed',
        });
        expect(patched?.id).toBe('check-immutable');
        expect(patched?.name).toBe('Renamed');
    });

    it('update() with an empty patch returns the existing row unchanged (line 90 branch)', async () => {
        // Covers the early-return when every patch key is undefined.
        await guardrailScriptsService.create({
            id: 'check-empty-patch',
            name: 'Stable',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        // Pass an empty patch object (no keys at all).
        const result = await guardrailScriptsService.update('check-empty-patch', {});
        expect(result?.id).toBe('check-empty-patch');
        expect(result?.name).toBe('Stable');
    });

    it('update() with all-undefined patch values returns existing row unchanged', async () => {
        await guardrailScriptsService.create({
            id: 'check-undef-patch',
            name: 'Stable2',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        // Patch with only undefined values — the clean-object branch skips them,
        // leaving Object.keys(clean).length === 0 → early-return path.
        const result = await guardrailScriptsService.update('check-undef-patch', {
            name: undefined,
            description: undefined,
        } as never);
        expect(result?.id).toBe('check-undef-patch');
        expect(result?.name).toBe('Stable2');
    });

    it('update() skips an explicit undefined key mixed with a defined key (v !== undefined false branch)', async () => {
        // Every existing update() test either passes all-defined keys or
        // all-undefined keys; this mixes both in one call so the loop
        // exercises `v !== undefined` true AND false in the same pass.
        await guardrailScriptsService.create({
            id: 'check-mixed-patch',
            name: 'Original',
            description: 'orig-desc',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        const result = await guardrailScriptsService.update('check-mixed-patch', {
            name: 'Renamed',
            description: undefined,
        });
        expect(result?.name).toBe('Renamed');
        expect(result?.description).toBe('orig-desc');
    });

    it('update() on a missing id with an empty patch returns null (the `?? null` fallback on get())', async () => {
        const result = await guardrailScriptsService.update('does-not-exist', {});
        expect(result).toBeNull();
    });

    it('update() on a missing id with a non-empty patch returns null (executeTakeFirst finds no row)', async () => {
        const result = await guardrailScriptsService.update('does-not-exist-2', { name: 'X' });
        expect(result).toBeNull();
    });

    it('get() returns undefined for a missing id', async () => {
        expect(await guardrailScriptsService.get('nope')).toBeUndefined();
    });

    it('create() rethrows non-23505 errors unchanged', async () => {
        // A NOT NULL violation (23502) on body_sh should propagate as-is,
        // exercising the `else { throw err; }` path distinct from the
        // conflict-mapping branch (code === '23505' false).
        await expect(
            guardrailScriptsService.create({
                id: 'check-null-violation',
                name: 'Bad',
                body_sh: null as unknown as string,
                body_ps1: 'exit 0',
            }),
        ).rejects.not.toBeInstanceOf(GuardrailScriptIdConflictError);
    });

    it('remove() deletes the row', async () => {
        await guardrailScriptsService.create({
            id: 'check-remove',
            name: 'ToRemove',
            body_sh: 'exit 0',
            body_ps1: 'exit 0',
        });
        await guardrailScriptsService.remove('check-remove');
        expect(await guardrailScriptsService.get('check-remove')).toBeUndefined();
    });
});
