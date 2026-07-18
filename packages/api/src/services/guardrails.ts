import { randomUUID } from 'crypto';
import { db } from '../db/kysely-client.js';
import type { GuardrailCategory, GuardrailSeverity, IGuardrailRule } from '@atlas/shared';

interface CreateInput {
    category: GuardrailCategory;
    rule_text: string;
    detail: string | null;
    severity: GuardrailSeverity;
}

interface UpdateInput {
    category?: GuardrailCategory | undefined;
    rule_text?: string | undefined;
    detail?: string | null | undefined;
    severity?: GuardrailSeverity | undefined;
}

export const guardrailsService = {
    async list(): Promise<IGuardrailRule[]> {
        const rows = await db
            .selectFrom('guardrail_rules')
            .selectAll()
            .orderBy('category', 'asc')
            .orderBy('sort_order', 'asc')
            .orderBy('created_at', 'asc')
            .execute();
        return rows as unknown as IGuardrailRule[];
    },

    async create(input: CreateInput): Promise<IGuardrailRule> {
        const id = randomUUID();
        const maxRow = await db
            .selectFrom('guardrail_rules')
            .select(({ fn }) => fn.max<number>('sort_order').as('m'))
            .where('category', '=', input.category)
            .executeTakeFirst();
        const sortOrder = (Number(maxRow?.m ?? 0) || 0) + 1;
        const row = await db
            .insertInto('guardrail_rules')
            .values({
                id,
                category: input.category,
                rule_text: input.rule_text,
                detail: input.detail,
                severity: input.severity,
                sort_order: sortOrder,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return row as unknown as IGuardrailRule;
    },

    async update(id: string, patch: UpdateInput): Promise<IGuardrailRule | null> {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) clean[k] = v;
        }
        if (Object.keys(clean).length === 0) {
            const row = await db
                .selectFrom('guardrail_rules')
                .selectAll()
                .where('id', '=', id)
                .executeTakeFirst();
            return row as unknown as IGuardrailRule | null;
        }
        const row = await db
            .updateTable('guardrail_rules')
            .set(clean as never)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();
        return row as unknown as IGuardrailRule | null;
    },

    async remove(id: string): Promise<void> {
        await db.deleteFrom('guardrail_rules').where('id', '=', id).execute();
    },

    async markSaved(): Promise<string> {
        const now = new Date().toISOString();
        await db
            .updateTable('settings')
            .set({ guardrails_published_at: now })
            .where('id', '=', 1)
            .execute();
        return now;
    },
};
