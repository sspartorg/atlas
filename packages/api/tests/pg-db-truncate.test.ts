import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { closeTestDb, truncateAll } from './_pg-db.js';

afterAll(async () => {
    await closeTestDb();
});

describe('truncateAll lock handling', () => {
    it('fails fast naming the blocking query instead of hanging until the hook timeout', async () => {
        const blocker = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
        await blocker.connect();
        try {
            await blocker.query('BEGIN');
            await blocker.query('LOCK TABLE scratch_pad IN ACCESS SHARE MODE');
            await expect(truncateAll({ lockTimeoutMs: 200, attempts: 2 })).rejects.toThrow(
                /blocked by.*LOCK TABLE scratch_pad/s,
            );
        } finally {
            await blocker.query('ROLLBACK');
            await blocker.end();
        }
        await expect(truncateAll()).resolves.toBeUndefined();
    }, 20_000);
});
