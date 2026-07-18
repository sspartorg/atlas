import { beforeEach, describe, expect, it } from 'vitest';
import { truncateAll, testDb } from '../../tests/_pg-db.js';
import { environmentSecretsService } from './environment-secrets.js';
import { decrypt } from './crypto.js';

describe('environmentSecretsService', () => {
    beforeEach(async () => {
        await truncateAll();
    });

    it('list() returns [] when the table is empty', async () => {
        expect(await environmentSecretsService.list()).toEqual([]);
    });

    it('replaceAll() inserts new rows encrypted on disk', async () => {
        await environmentSecretsService.replaceAll([
            { key: 'TOKEN', value: 's3cret' },
            { key: 'REGISTRY_URL', value: 'https://registry.local' },
        ]);

        const stored = await testDb
            .selectFrom('environment_secrets')
            .select(['key', 'value_encrypted'])
            .orderBy('key', 'asc')
            .execute();
        expect(stored.map((r) => r.key)).toEqual(['REGISTRY_URL', 'TOKEN']);
        // Ciphertext must not equal the plaintext.
        expect(stored[0]?.value_encrypted).not.toBe('https://registry.local');
        expect(stored[1]?.value_encrypted).not.toBe('s3cret');
        // Round-trip via the same crypto helper the service uses.
        expect(decrypt(stored[1]!.value_encrypted)).toBe('s3cret');
    });

    it('list() returns decrypted values sorted by key ascending', async () => {
        await environmentSecretsService.replaceAll([
            { key: 'ZED', value: 'z' },
            { key: 'ALPHA', value: 'a' },
            { key: 'MIDDLE', value: 'm' },
        ]);
        expect(await environmentSecretsService.list()).toEqual([
            { key: 'ALPHA', value: 'a' },
            { key: 'MIDDLE', value: 'm' },
            { key: 'ZED', value: 'z' },
        ]);
    });

    it('replaceAll() updates an existing key when its value changes', async () => {
        await environmentSecretsService.replaceAll([{ key: 'API', value: 'old' }]);
        await environmentSecretsService.replaceAll([{ key: 'API', value: 'new' }]);
        const out = await environmentSecretsService.list();
        expect(out).toEqual([{ key: 'API', value: 'new' }]);
    });

    it('replaceAll() removes keys that are absent from the new set', async () => {
        await environmentSecretsService.replaceAll([
            { key: 'KEEP', value: '1' },
            { key: 'DROP', value: '2' },
        ]);
        await environmentSecretsService.replaceAll([{ key: 'KEEP', value: '1' }]);
        expect(await environmentSecretsService.list()).toEqual([{ key: 'KEEP', value: '1' }]);
    });

    it('replaceAll([]) clears the entire table', async () => {
        await environmentSecretsService.replaceAll([
            { key: 'A', value: '1' },
            { key: 'B', value: '2' },
        ]);
        await environmentSecretsService.replaceAll([]);
        expect(await environmentSecretsService.list()).toEqual([]);
    });

    it('decryptAll() returns a Map ready for mergeSecrets', async () => {
        await environmentSecretsService.replaceAll([
            { key: 'X', value: '1' },
            { key: 'Y', value: '2' },
        ]);
        const m = await environmentSecretsService.decryptAll();
        expect(m).toBeInstanceOf(Map);
        expect(m.get('X')).toBe('1');
        expect(m.get('Y')).toBe('2');
        expect(m.size).toBe(2);
    });
});
