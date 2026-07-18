import { db } from '../db/kysely-client.js';
import type { IProjectGuardrailScript } from '@atlas/shared';

// Phase 1.5b — Per-project guardrail SCRIPTS. Same shape as the
// org-wide table but scoped to a project_id (ON DELETE CASCADE).
//
// `id` is the kebab-case slug Owner supplies at create time. The
// (project_id, id) composite must be unique — duplicate within a
// project raises `ProjectGuardrailScriptIdConflictError` so the route
// can return 409.

export class ProjectGuardrailScriptIdConflictError extends Error {
    constructor(
        public readonly projectId: string,
        public readonly id: string,
    ) {
        super(`Script id "${id}" already exists in project "${projectId}".`);
        this.name = 'ProjectGuardrailScriptIdConflictError';
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

export const projectGuardrailScriptsService = {
    async list(projectId: string): Promise<IProjectGuardrailScript[]> {
        const rows = await db
            .selectFrom('project_guardrail_scripts')
            .selectAll()
            .where('project_id', '=', projectId)
            .orderBy('sort_order', 'asc')
            .orderBy('created_at', 'asc')
            .execute();
        return rows as unknown as IProjectGuardrailScript[];
    },

    async get(id: string): Promise<IProjectGuardrailScript | undefined> {
        const row = await db
            .selectFrom('project_guardrail_scripts')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        return row as unknown as IProjectGuardrailScript | undefined;
    },

    async create(projectId: string, data: CreateInput): Promise<IProjectGuardrailScript> {
        try {
            const row = await db
                .insertInto('project_guardrail_scripts')
                .values({
                    id: data.id,
                    project_id: projectId,
                    name: data.name,
                    description: data.description ?? '',
                    body_sh: data.body_sh,
                    body_ps1: data.body_ps1,
                    sort_order: data.sort_order ?? 0,
                })
                .returningAll()
                .executeTakeFirstOrThrow();
            return row as unknown as IProjectGuardrailScript;
        } catch (err) {
            const code = (err as { code?: string }).code;
            if (code === '23505') {
                throw new ProjectGuardrailScriptIdConflictError(projectId, data.id);
            }
            throw err;
        }
    },

    async update(id: string, patch: UpdateInput): Promise<IProjectGuardrailScript | null> {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) clean[k] = v;
        }
        if (Object.keys(clean).length === 0) {
            return (await this.get(id)) ?? null;
        }
        clean['updated_at'] = new Date().toISOString();
        const row = await db
            .updateTable('project_guardrail_scripts')
            .set(clean as never)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();
        return (row as unknown as IProjectGuardrailScript) ?? null;
    },

    async remove(id: string): Promise<void> {
        await db.deleteFrom('project_guardrail_scripts').where('id', '=', id).execute();
    },
};
