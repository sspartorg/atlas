import { randomUUID } from 'crypto';
import { db } from '../db/kysely-client.js';
import type { ICliModel, AgentCli } from '@atlas/shared';

// `agents` has a composite FK on (cli, model) -> cli_models with ON DELETE
// RESTRICT, so Postgres already blocks removing a model an installed agent
// uses. `marketplace_agents` has no such FK, so a model referenced only by
// not-yet-installed catalog entries used to delete cleanly and then made
// those entries permanently uninstallable (raw FK 500 on install). Refuse
// here instead, naming what still depends on the model.
export class ModelInUseError extends Error {
    public readonly code = 'MODEL_IN_USE';
    constructor(
        message: string,
        public readonly agents: string[],
        public readonly catalogEntries: string[]
    ) {
        super(message);
        this.name = 'ModelInUseError';
    }
}

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

    async create(input: {
        cli: AgentCli;
        model_name: string;
        note: string | null;
    }): Promise<ICliModel> {
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
        input: { note?: string | null | undefined; sort_order?: number | undefined }
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
        const model = await db
            .selectFrom('cli_models')
            .select(['cli', 'model_name'])
            .where('id', '=', id)
            .executeTakeFirst();
        if (!model) return;
        const cli = model.cli as AgentCli;
        const [agentRows, catalogRows] = await Promise.all([
            db
                .selectFrom('agents')
                .select('id')
                .where('cli', '=', cli)
                .where('model', '=', model.model_name)
                .execute(),
            db
                .selectFrom('marketplace_agents')
                .select('id')
                .where('cli', '=', cli)
                .where('model', '=', model.model_name)
                .execute(),
        ]);
        const agentIds = agentRows.map((r) => String(r.id));
        const catalogIds = catalogRows.map((r) => String(r.id));
        if (agentIds.length > 0 || catalogIds.length > 0) {
            const parts: string[] = [];
            if (agentIds.length > 0)
                parts.push(`${agentIds.length} agent(s): ${agentIds.join(', ')}`);
            if (catalogIds.length > 0) {
                parts.push(`${catalogIds.length} marketplace entr(ies): ${catalogIds.join(', ')}`);
            }
            throw new ModelInUseError(
                `model '${model.model_name}' is still used by ${parts.join(' and ')} — reassign or uninstall them first`,
                agentIds,
                catalogIds
            );
        }
        await db.deleteFrom('cli_models').where('id', '=', id).execute();
    },
};
