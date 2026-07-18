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

    async dbUpsert(
        projectId: string,
        next: Array<{ key: string; value: string }>,
    ): Promise<void> {
        const now = new Date().toISOString();
        const desiredKeys = new Set(next.map((u) => u.key));

        await db.transaction().execute(async (trx) => {
            // Read existing keys INSIDE the transaction so a concurrent
            // insert between the read and the tx-open can't survive the
            // upsert — see environment-secrets.ts:replaceAll for the same
            // fix rationale.
            const existingRows = await trx
                .selectFrom('project_env_vars')
                .select('key')
                .where('project_id', '=', projectId)
                .execute();
            const removed = existingRows.map((r) => r.key).filter((k) => !desiredKeys.has(k));
            if (removed.length > 0) {
                await trx
                    .deleteFrom('project_env_vars')
                    .where('project_id', '=', projectId)
                    .where('key', 'in', removed)
                    .execute();
            }
            for (const v of next) {
                await trx
                    .insertInto('project_env_vars')
                    .values({
                        id: randomUUID(),
                        project_id: projectId,
                        key: v.key,
                        value_encrypted: encrypt(v.value),
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
