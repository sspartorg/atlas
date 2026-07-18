import { randomUUID } from 'node:crypto';
import { db } from '../db/kysely-client.js';
import { encrypt, decrypt } from './crypto.js';

// 2026-06-10 — Global tier of the two-scope secrets model. One row per
// org-wide key (e.g. shared registry tokens, common API keys). The
// setup runner merges this map with the per-project `project_env_vars`
// map (project wins on collision) and substitutes `${variable.KEY}`
// placeholders in the user-authored setup script before exec.
//
// Encryption mirrors `services/project-env-file.ts` — same AES-256-GCM
// helper (`services/crypto.ts`) so values stay readable across both
// tiers without a second key file. Replace-all PUT semantics inside a
// single transaction guard against partial writes.

export interface EnvironmentSecretMetadata {
    key: string;
    // ISO timestamp of the last write. Client-side UI shows this next
    // to each row so the Owner has a signal for stale secrets.
    updated_at: string;
    // Always true for rows in this list — a listed row means the value
    // is stored. `has_value: false` would be reserved for a future
    // "declared but empty" shape if we ever add one.
    has_value: true;
}

export const environmentSecretsService = {
    async list(): Promise<Array<{ key: string; value: string }>> {
        // Kept for INTERNAL callers only (setup runner, agent-run env
        // materialisation). Never expose this shape on an HTTP route —
        // routes must use `listMetadata()` + `revealOne()` per the
        // enterprise-secrets read model (Batch-9 audit).
        const rows = await db
            .selectFrom('environment_secrets')
            .select(['key', 'value_encrypted'])
            .orderBy('key', 'asc')
            .execute();
        return rows.map((r) => ({ key: r.key, value: decrypt(r.value_encrypted) }));
    },

    /**
     * Metadata-only listing for the Settings UI. No plaintext value crosses
     * the API surface unless the Owner explicitly calls `revealOne(key)`.
     * Matches the read model used by Vault / AWS Secrets Manager /
     * Doppler / 1Password — the enterprise-standard shape for secret
     * catalogues.
     */
    async listMetadata(): Promise<EnvironmentSecretMetadata[]> {
        const rows = await db
            .selectFrom('environment_secrets')
            .select(['key', 'updated_at'])
            .orderBy('key', 'asc')
            .execute();
        return rows.map((r) => ({
            key: r.key,
            updated_at: r.updated_at,
            has_value: true as const,
        }));
    },

    /**
     * Decrypt and return the value for a single key. Callers are
     * expected to be on-demand reveal endpoints — never a batch list
     * loop. Returns `null` if the key does not exist. The caller
     * (route layer) is responsible for the audit log / rate limit.
     */
    async revealOne(key: string): Promise<string | null> {
        const row = await db
            .selectFrom('environment_secrets')
            .select('value_encrypted')
            .where('key', '=', key)
            .executeTakeFirst();
        return row ? decrypt(row.value_encrypted) : null;
    },

    async replaceAll(next: Array<{ key: string; value: string }>): Promise<void> {
        const now = new Date().toISOString();
        const desiredKeys = new Set(next.map((u) => u.key));

        await db.transaction().execute(async (trx) => {
            // Read the existing keys INSIDE the transaction so a concurrent
            // insert between the read and the transaction can't survive the
            // replaceAll: previously this SELECT ran on the ambient `db`,
            // computed `removed`, then opened the transaction — a race window
            // during which another caller's INSERT would be missed by the
            // `removed` computation and left in place.
            const existingRows = await trx
                .selectFrom('environment_secrets')
                .select('key')
                .execute();
            const removed = existingRows.map((r) => r.key).filter((k) => !desiredKeys.has(k));
            if (removed.length > 0) {
                await trx
                    .deleteFrom('environment_secrets')
                    .where('key', 'in', removed)
                    .execute();
            }
            for (const v of next) {
                await trx
                    .insertInto('environment_secrets')
                    .values({
                        id: randomUUID(),
                        key: v.key,
                        value_encrypted: encrypt(v.value),
                        updated_at: now,
                    })
                    .onConflict((oc) =>
                        oc.column('key').doUpdateSet((eb) => ({
                            value_encrypted: eb.ref('excluded.value_encrypted'),
                            updated_at: eb.ref('excluded.updated_at'),
                        })),
                    )
                    .execute();
            }
        });
    },

    // Convenience for the setup runner — returns a Map ready for
    // `mergeSecrets()` in secret-substitution.ts.
    async decryptAll(): Promise<Map<string, string>> {
        const rows = await db
            .selectFrom('environment_secrets')
            .select(['key', 'value_encrypted'])
            .execute();
        const m = new Map<string, string>();
        for (const r of rows) m.set(r.key, decrypt(r.value_encrypted));
        return m;
    },
};
