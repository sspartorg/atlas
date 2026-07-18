import { db } from '../db/kysely-client.js';
import type { IRole, SdlcRole } from '@atlas/shared';

// A08 — SDLC role catalog service. Reads + curated default-prompt edits.
// The catalog is seeded by migration 025; this service never inserts new
// rows or deletes existing ones (the catalog shape is governed by
// `SdlcRole` in shared, not by runtime data). Owner can edit per-role
// defaults via `PATCH /api/roles/:id` — these edits affect the catalog
// snapshot only, not any agent that previously copied a default into its
// own `prompt_md`.

export interface IRoleUpdateInput {
    label?: string | undefined;
    description?: string | undefined;
    default_prompt_md?: string | undefined;
}

const ROLE_SCALAR_FIELDS = [
    'label',
    'description',
    'default_prompt_md',
] as const;

function pickRoleScalars(input: IRoleUpdateInput): Record<string, unknown> {
    const src = input as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of ROLE_SCALAR_FIELDS) {
        if (key in src && src[key] !== undefined) {
            out[key] = src[key];
        }
    }
    return out;
}

export const rolesService = {
    async list(): Promise<IRole[]> {
        const rows = await db.selectFrom('roles').selectAll().orderBy('sort_order', 'asc').execute();
        return rows as unknown as IRole[];
    },

    async get(id: SdlcRole): Promise<IRole | undefined> {
        const row = await db
            .selectFrom('roles')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        return row as unknown as IRole | undefined;
    },

    async update(id: SdlcRole, input: IRoleUpdateInput): Promise<IRole | undefined> {
        const scalars = pickRoleScalars(input);
        if (Object.keys(scalars).length === 0) {
            // No-op update — return the current row so callers don't 404
            // on a body that only carried unknown fields (Zod already
            // stripped them).
            return this.get(id);
        }
        await db
            .updateTable('roles')
            .set({ ...scalars, updated_at: new Date().toISOString() })
            .where('id', '=', id)
            .execute();
        return this.get(id);
    },
};
