import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmpKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-penv-key-'));
process.env['ATLAS_DATA_DIR'] = tmpKeyDir;

import { sql } from 'kysely';
import { projectEnvFileService, UnknownEnvKeyError } from './project-env-file.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
// ADR 0018 — git fields moved to project_repos; use the shared fixture.
import { insertProject } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
});

afterAll(async () => {
    await closeTestDb();
});

describe('projectEnvFileService — db round-trip', () => {
    it('dbList returns [] initially', async () => {
        expect(await projectEnvFileService.dbList('p1')).toEqual([]);
    });

    it('dbUpsert encrypts each value and dbList decrypts back to plaintext', async () => {
        await projectEnvFileService.dbUpsert('p1', [
            { key: 'API_KEY', value: 'secret-1' },
            { key: 'DB_URL', value: 'postgres://x' },
        ]);
        const list = await projectEnvFileService.dbList('p1');
        const map = Object.fromEntries(list.map((x) => [x.key, x.value]));
        expect(map['API_KEY']).toBe('secret-1');
        expect(map['DB_URL']).toBe('postgres://x');
        const raw = (
            await sql<{ value_encrypted: string }>`SELECT value_encrypted FROM project_env_vars WHERE project_id = ${'p1'} AND key = ${'API_KEY'}`.execute(
                testDb,
            )
        ).rows[0]!;
        expect(raw.value_encrypted).not.toBe('secret-1');
    });

    it('dbUpsert removes keys missing from the next set', async () => {
        await projectEnvFileService.dbUpsert('p1', [
            { key: 'A', value: '1' },
            { key: 'B', value: '2' },
        ]);
        await projectEnvFileService.dbUpsert('p1', [{ key: 'A', value: '1-updated' }]);
        const list = await projectEnvFileService.dbList('p1');
        expect(list).toHaveLength(1);
        expect(list[0]!.key).toBe('A');
        expect(list[0]!.value).toBe('1-updated');
    });

    it('a keep row leaves the stored ciphertext and updated_at untouched', async () => {
        await projectEnvFileService.dbUpsert('p1', [
            { key: 'A', value: '1' },
            { key: 'B', value: '2' },
        ]);
        const before = await rawRows();
        await projectEnvFileService.dbUpsert('p1', [
            { key: 'A', keep: 'A' },
            { key: 'B', value: '2-new' },
        ]);
        const after = await rawRows();
        expect(after['A']).toEqual(before['A']);
        expect(after['B']!.value_encrypted).not.toBe(before['B']!.value_encrypted);
        expect(Object.fromEntries((await projectEnvFileService.dbList('p1')).map((x) => [x.key, x.value]))).toEqual({
            A: '1',
            B: '2-new',
        });
    });

    it('a keep row under a new key renames the secret and keeps its value', async () => {
        await projectEnvFileService.dbUpsert('p1', [{ key: 'OLD', value: 'v' }]);
        await projectEnvFileService.dbUpsert('p1', [{ key: 'NEW', keep: 'OLD' }]);
        expect(await projectEnvFileService.dbList('p1')).toEqual([{ key: 'NEW', value: 'v' }]);
    });

    it('keeping a key that is not stored throws and changes nothing', async () => {
        await projectEnvFileService.dbUpsert('p1', [{ key: 'A', value: '1' }]);
        await expect(projectEnvFileService.dbUpsert('p1', [{ key: 'B', keep: 'GHOST' }])).rejects.toBeInstanceOf(
            UnknownEnvKeyError,
        );
        expect(await projectEnvFileService.dbList('p1')).toEqual([{ key: 'A', value: '1' }]);
    });
});

async function rawRows(): Promise<Record<string, { value_encrypted: string; updated_at: string }>> {
    const { rows } = await sql<{ key: string; value_encrypted: string; updated_at: string }>`
        SELECT key, value_encrypted, updated_at::text AS updated_at FROM project_env_vars WHERE project_id = 'p1'`.execute(testDb);
    return Object.fromEntries(rows.map((r) => [r.key, { value_encrypted: r.value_encrypted, updated_at: r.updated_at }]));
}
