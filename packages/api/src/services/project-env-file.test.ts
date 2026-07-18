import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmpKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-penv-key-'));
process.env['ATLAS_DATA_DIR'] = tmpKeyDir;

import { sql } from 'kysely';
import { projectEnvFileService } from './project-env-file.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

async function insertProject(id: string, prefix: string): Promise<void> {
    await testDb
        .insertInto('projects')
        .values({ id, name: 'Project ' + id, issue_key_prefix: prefix, git_path: '', status: 'active' })
        .execute();
    await testDb
        .insertInto('project_issue_counters')
        .values({ project_id: id, last_seq: 0 })
        .execute();
}

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
});
