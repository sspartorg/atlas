import { db } from '../db/kysely-client.js';
import type { IProjectGuardrail } from '@atlas/shared';
import { randomUUID } from 'crypto';

interface CreateInput {
    title: string;
    body_md: string;
    icon?: string;
    enabled?: number;
    sort_order?: number;
}

interface UpdateInput {
    title?: string | undefined;
    body_md?: string | undefined;
    icon?: string | undefined;
    enabled?: number | undefined;
    sort_order?: number | undefined;
}

export const projectGuardrailsService = {
    async list(projectId: string): Promise<IProjectGuardrail[]> {
        const rows = await db
            .selectFrom('project_guardrails')
            .selectAll()
            .where('project_id', '=', projectId)
            .orderBy('sort_order', 'asc')
            .orderBy('created_at', 'asc')
            .execute();
        return rows as unknown as IProjectGuardrail[];
    },

    async get(id: string): Promise<IProjectGuardrail | undefined> {
        const row = await db
            .selectFrom('project_guardrails')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        return row as unknown as IProjectGuardrail | undefined;
    },

    async create(projectId: string, data: CreateInput): Promise<IProjectGuardrail> {
        const id = randomUUID();
        await db
            .insertInto('project_guardrails')
            .values({
                id,
                project_id: projectId,
                title: data.title,
                body_md: data.body_md,
                icon: data.icon ?? 'shield',
                enabled: data.enabled ?? 1,
                sort_order: data.sort_order ?? 0,
            })
            .execute();
        return (await this.get(id))!;
    },

    async update(id: string, data: UpdateInput): Promise<IProjectGuardrail> {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) {
            if (v !== undefined) clean[k] = v;
        }
        if (Object.keys(clean).length === 0) return (await this.get(id))!;
        await db.updateTable('project_guardrails').set(clean as never).where('id', '=', id).execute();
        return (await this.get(id))!;
    },

    async toggle(id: string, enabled: number): Promise<IProjectGuardrail> {
        await db
            .updateTable('project_guardrails')
            .set({ enabled })
            .where('id', '=', id)
            .execute();
        return (await this.get(id))!;
    },

    async delete(id: string): Promise<void> {
        await db.deleteFrom('project_guardrails').where('id', '=', id).execute();
    },

    async activeCount(projectId: string): Promise<number> {
        const r = await db
            .selectFrom('project_guardrails')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('project_id', '=', projectId)
            .where('enabled', '=', 1)
            .executeTakeFirst();
        // countAll() + executeTakeFirst() always returns exactly one row.
        /* v8 ignore next */
        return Number(r?.n ?? 0);
    },
};
