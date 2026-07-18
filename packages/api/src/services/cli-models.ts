import { randomUUID } from 'crypto';
import { db } from '../db/kysely-client.js';
import type { ICliModel, AgentCli } from '@atlas/shared';

export const cliModelsService = {
    async list(): Promise<ICliModel[]> {
        const rows = await db
            .selectFrom('cli_models')
            .selectAll()
            .orderBy('cli', 'asc')
            .orderBy('sort_order', 'asc')
            .orderBy('model_name', 'asc')
            .execute();
        return rows as unknown as ICliModel[];
    },

    async create(input: { cli: AgentCli; model_name: string; note: string | null }): Promise<ICliModel> {
        const id = randomUUID();
        const maxRow = await db
            .selectFrom('cli_models')
            .select(({ fn }) => fn.max<number>('sort_order').as('m'))
            .where('cli', '=', input.cli)
            .executeTakeFirst();
        const sortOrder = (Number(maxRow?.m ?? 0) || 0) + 1;
        const row = await db
            .insertInto('cli_models')
            .values({
                id,
                cli: input.cli,
                model_name: input.model_name,
                note: input.note,
                sort_order: sortOrder,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return row as unknown as ICliModel;
    },

    async update(
        id: string,
        input: { note?: string | null | undefined; sort_order?: number | undefined },
    ): Promise<ICliModel | null> {
        const existing = await db
            .selectFrom('cli_models')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        if (!existing) return null;
        const patch: Record<string, unknown> = {};
        if (input.note !== undefined) patch['note'] = input.note;
        if (input.sort_order !== undefined) patch['sort_order'] = input.sort_order;
        if (Object.keys(patch).length === 0) return existing as unknown as ICliModel;
        const row = await db
            .updateTable('cli_models')
            .set(patch as never)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();
        return row as unknown as ICliModel;
    },

    async remove(id: string): Promise<void> {
        await db.deleteFrom('cli_models').where('id', '=', id).execute();
    },
};
