import { db } from '../db/kysely-client.js';
import type { IGuardrailScript } from '@atlas/shared';

// Phase 1.5b — Org-wide guardrail SCRIPTS. Independent of Articles.
// Each row carries name + description + paired bash + powershell
// bodies. Orchestrator emits to .atlas/scripts/{bash,powershell}/
// check-<id>.{sh,ps1} on every run.
//
// `id` is the kebab-case slug Owner supplies at create time — see
// CreateGuardrailScriptSchema. Validation lives in the schema layer
// (route uses safeParse); this service just persists. Duplicate ids
// raise `GuardrailScriptIdConflictError` so the route can return 409.

export class GuardrailScriptIdConflictError extends Error {
    constructor(public readonly id: string) {
        super(`Script id "${id}" already exists.`);
        this.name = 'GuardrailScriptIdConflictError';
    }
}

interface CreateInput {
    id: string;
    name: string;
    description?: string;
    body_sh: string;
    body_ps1: string;
    sort_order?: number;
}

interface UpdateInput {
    name?: string | undefined;
    description?: string | undefined;
    body_sh?: string | undefined;
    body_ps1?: string | undefined;
    sort_order?: number | undefined;
}

export const guardrailScriptsService = {
    async list(): Promise<IGuardrailScript[]> {
        const rows = await db
            .selectFrom('guardrail_scripts')
            .selectAll()
            .orderBy('sort_order', 'asc')
            .orderBy('created_at', 'asc')
            .execute();
        return rows as unknown as IGuardrailScript[];
    },

    async get(id: string): Promise<IGuardrailScript | undefined> {
        const row = await db
            .selectFrom('guardrail_scripts')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        return row as unknown as IGuardrailScript | undefined;
    },

    async create(data: CreateInput): Promise<IGuardrailScript> {
        try {
            const row = await db
                .insertInto('guardrail_scripts')
                .values({
                    id: data.id,
                    name: data.name,
                    description: data.description ?? '',
                    body_sh: data.body_sh,
                    body_ps1: data.body_ps1,
                    sort_order: data.sort_order ?? 0,
                })
                .returningAll()
                .executeTakeFirstOrThrow();
            return row as unknown as IGuardrailScript;
        } catch (err) {
            // PG SQLSTATE 23505 = unique_violation. Kysely / pg surface it
            // as a thrown DatabaseError with the code on the original error.
            const code = (err as { code?: string }).code;
            if (code === '23505') {
                throw new GuardrailScriptIdConflictError(data.id);
            }
            throw err;
        }
    },

    async update(id: string, patch: UpdateInput): Promise<IGuardrailScript | null> {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) clean[k] = v;
        }
        if (Object.keys(clean).length === 0) {
            return (await this.get(id)) ?? null;
        }
        clean['updated_at'] = new Date().toISOString();
        const row = await db
            .updateTable('guardrail_scripts')
            .set(clean as never)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();
        return (row as unknown as IGuardrailScript) ?? null;
    },

    async remove(id: string): Promise<void> {
        await db.deleteFrom('guardrail_scripts').where('id', '=', id).execute();
    },
};
