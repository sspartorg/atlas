/**
 * W12 spec 3 — Secrets encrypted at rest.
 *
 * Verifies that service-layer writes encrypt sensitive values before storing.
 * Each test:
 *   1. Creates a row through the SERVICE layer (which calls encrypt()).
 *   2. Reads the raw column value from the DB using `testDb` (bypasses decrypt).
 *   3. Asserts the raw column does NOT contain the plaintext secret.
 *
 * Covers:
 *   - credentials.token_encrypted    (via credentialsService.create)
 *   - environment_secrets.value_encrypted  (via environmentSecretsService.replaceAll)
 *   - project_env_vars.value_encrypted     (via projectEnvFileService.dbUpsert)
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';
import { credentialsService } from './credentials.js';
import { environmentSecretsService } from './environment-secrets.js';
import { projectEnvFileService } from './project-env-file.js';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

// ---------------------------------------------------------------------------
// 1. credentials.token_encrypted
// ---------------------------------------------------------------------------
describe('credentials — token_encrypted is not plaintext', () => {
    it('create stores an encrypted token: raw column != plaintext', async () => {
        const plaintext = 'sk-secret-12345';
        const cred = await credentialsService.create({
            label: 'Test PAT',
            host: 'github',
            kind: 'pat',
            username: 'x-access-token',
            token: plaintext,
            scope: 'repo',
            expires_at: null,
        });

        // Fetch the raw encrypted column directly — bypasses the service's decrypt.
        const row = await testDb
            .selectFrom('credentials')
            .select('token_encrypted')
            .where('id', '=', cred.id)
            .executeTakeFirstOrThrow();

        expect(row.token_encrypted).not.toBe(plaintext);
        expect(row.token_encrypted).not.toContain(plaintext);
        // AES-256-GCM output is base64; the ciphertext should be a long non-trivial string.
        expect(row.token_encrypted.length).toBeGreaterThan(20);
    });

    it('update re-encrypts: new raw token_encrypted != new plaintext', async () => {
        const original = 'sk-original-token';
        const cred = await credentialsService.create({
            label: 'Cred',
            host: 'github',
            kind: 'pat',
            username: 'x-access-token',
            token: original,
            scope: 'repo',
            expires_at: null,
        });

        const newPlaintext = 'sk-updated-token-xyz';
        await credentialsService.update(cred.id, { token: newPlaintext });

        const row = await testDb
            .selectFrom('credentials')
            .select('token_encrypted')
            .where('id', '=', cred.id)
            .executeTakeFirstOrThrow();

        expect(row.token_encrypted).not.toContain(newPlaintext);
        expect(row.token_encrypted).not.toContain(original);
    });
});

// ---------------------------------------------------------------------------
// 2. environment_secrets.value_encrypted
// ---------------------------------------------------------------------------
describe('environment_secrets — value_encrypted is not plaintext', () => {
    it('replaceAll encrypts the value: raw column != plaintext', async () => {
        const plaintext = 'plaintext-789';
        await environmentSecretsService.replaceAll([
            { key: 'SECRET_KEY', value: plaintext },
        ]);

        const row = await testDb
            .selectFrom('environment_secrets')
            .select('value_encrypted')
            .where('key', '=', 'SECRET_KEY')
            .executeTakeFirstOrThrow();

        expect(row.value_encrypted).not.toBe(plaintext);
        expect(row.value_encrypted).not.toContain(plaintext);
        expect(row.value_encrypted.length).toBeGreaterThan(20);
    });

    it('two replaceAll calls with the same value produce different ciphertexts (random IV)', async () => {
        const plaintext = 'same-secret-value';
        await environmentSecretsService.replaceAll([{ key: 'ALPHA', value: plaintext }]);
        const row1 = await testDb
            .selectFrom('environment_secrets')
            .select('value_encrypted')
            .where('key', '=', 'ALPHA')
            .executeTakeFirstOrThrow();

        await environmentSecretsService.replaceAll([{ key: 'ALPHA', value: plaintext }]);
        const row2 = await testDb
            .selectFrom('environment_secrets')
            .select('value_encrypted')
            .where('key', '=', 'ALPHA')
            .executeTakeFirstOrThrow();

        // AES-256-GCM with random IV: same plaintext → different ciphertext on each call.
        expect(row1.value_encrypted).not.toBe(row2.value_encrypted);
    });
});

// ---------------------------------------------------------------------------
// 3. project_env_vars.value_encrypted
// ---------------------------------------------------------------------------
describe('project_env_vars — value_encrypted is not plaintext', () => {
    it('dbUpsert encrypts the value: raw column != plaintext', async () => {
        await insertProject('enc-p1', 'ENC');
        const plaintext = 'my-db-password-secret';
        await projectEnvFileService.dbUpsert('enc-p1', [
            { key: 'DB_PASSWORD', value: plaintext },
        ]);

        const row = await testDb
            .selectFrom('project_env_vars')
            .select('value_encrypted')
            .where('project_id', '=', 'enc-p1')
            .where('key', '=', 'DB_PASSWORD')
            .executeTakeFirstOrThrow();

        expect(row.value_encrypted).not.toBe(plaintext);
        expect(row.value_encrypted).not.toContain(plaintext);
        expect(row.value_encrypted.length).toBeGreaterThan(20);
    });

    it('dbUpsert update re-encrypts with new plaintext', async () => {
        await insertProject('enc-p2', 'ENB');
        const v1 = 'api-key-version-1';
        const v2 = 'api-key-version-2';

        await projectEnvFileService.dbUpsert('enc-p2', [{ key: 'API_KEY', value: v1 }]);
        await projectEnvFileService.dbUpsert('enc-p2', [{ key: 'API_KEY', value: v2 }]);

        const row = await testDb
            .selectFrom('project_env_vars')
            .select('value_encrypted')
            .where('project_id', '=', 'enc-p2')
            .where('key', '=', 'API_KEY')
            .executeTakeFirstOrThrow();

        // Neither old nor new plaintext should appear verbatim.
        expect(row.value_encrypted).not.toContain(v1);
        expect(row.value_encrypted).not.toContain(v2);
    });
});
