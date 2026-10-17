import { randomUUID } from 'node:crypto';
import { db } from '../db/kysely-client.js';
import { encrypt, decrypt } from './crypto.js';

// 2026-06-10 (Phase 5 of the secrets refactor) — disk-write of
// `{project.git_path}/.env` is GONE. The new flow stores values
// encrypted in `project_env_vars`, merges them with `environment_secrets`
// at setup time, and lets the user-authored `.sh` / `.ps1` materialise
// whatever config their stack needs. Any pre-existing `.env` files on
// disk are user territory and are not touched by this code.
//
// What remains here: DB-only CRUD. The `read` / `write` disk helpers
// (and the `assertInsideGitPath` guard) were removed.

export interface ProjectEnvVarMetadata {
    key: string;
    updated_at: string;
    has_value: true;
}

/** A row to save: a new value, or `keep` = an existing key whose stored value it keeps. */
export type EnvSaveRow = { key: string; value: string } | { key: string; keep: string };

export class UnknownEnvKeyError extends Error {
    constructor(readonly key: string) {
        super(`Cannot keep "${key}": no such stored secret`);
        this.name = 'UnknownEnvKeyError';
    }
}

export const projectEnvFileService = {
    async dbList(projectId: string): Promise<Array<{ key: string; value: string }>> {
        // Kept for INTERNAL callers (setup runner). Never expose on an
        // HTTP route — see the enterprise-secrets read model in
        // environment-secrets.ts.
        const rows = await db
            .selectFrom('project_env_vars')
            .select(['key', 'value_encrypted'])
            .where('project_id', '=', projectId)
            .orderBy('key', 'asc')
            .execute();
        return rows.map((r) => ({ key: r.key, value: decrypt(r.value_encrypted) }));
    },

    /** Metadata-only listing for the project Env Secrets UI. */
    async dbListMetadata(projectId: string): Promise<ProjectEnvVarMetadata[]> {
        const rows = await db
            .selectFrom('project_env_vars')
            .select(['key', 'updated_at'])
            .where('project_id', '=', projectId)
            .orderBy('key', 'asc')
            .execute();
        return rows.map((r) => ({
            key: r.key,
            updated_at: r.updated_at,
            has_value: true as const,
        }));
    },

    /** Decrypt a single value on demand. Returns null if unknown. */
    async dbRevealOne(projectId: string, key: string): Promise<string | null> {
        const row = await db
            .selectFrom('project_env_vars')
            .select('value_encrypted')
            .where('project_id', '=', projectId)
            .where('key', '=', key)
            .executeTakeFirst();
        return row ? decrypt(row.value_encrypted) : null;
    },

    /**
     * Replace the project's set of keys with `next`. A row with `keep` holds
     * on to the stored value of that existing key (under `key`, so a rename
     * keeps its value) without the caller ever reading it; such a row that
     * is neither renamed nor changed is left untouched, `updated_at` included.
     */
    async dbUpsert(projectId: string, next: EnvSaveRow[]): Promise<void> {
        const now = new Date().toISOString();
        const desiredKeys = new Set(next.map((u) => u.key));

        await db.transaction().execute(async (trx) => {
            // Read existing keys INSIDE the transaction so a concurrent
            // insert between the read and the tx-open can't survive the
            // upsert — see environment-secrets.ts:replaceAll for the same
            // fix rationale.
            const existingRows = await trx
                .selectFrom('project_env_vars')
                .select(['key', 'value_encrypted'])
                .where('project_id', '=', projectId)
                .execute();
            const stored = new Map(existingRows.map((r) => [r.key, r.value_encrypted]));
            for (const v of next) {
                if ('keep' in v && !stored.has(v.keep)) throw new UnknownEnvKeyError(v.keep);
            }
            const removed = [...stored.keys()].filter((k) => !desiredKeys.has(k));
            if (removed.length > 0) {
                await trx
                    .deleteFrom('project_env_vars')
                    .where('project_id', '=', projectId)
                    .where('key', 'in', removed)
                    .execute();
            }
            for (const v of next) {
                if ('keep' in v && v.keep === v.key) continue;
                await trx
                    .insertInto('project_env_vars')
                    .values({
                        id: randomUUID(),
                        project_id: projectId,
                        key: v.key,
                        value_encrypted: 'keep' in v ? stored.get(v.keep)! : encrypt(v.value),
                        updated_at: now,
                    })
                    .onConflict((oc) =>
                        oc.columns(['project_id', 'key']).doUpdateSet((eb) => ({
                            value_encrypted: eb.ref('excluded.value_encrypted'),
                            updated_at: eb.ref('excluded.updated_at'),
                        })),
                    )
                    .execute();
            }
        });
    },
};
