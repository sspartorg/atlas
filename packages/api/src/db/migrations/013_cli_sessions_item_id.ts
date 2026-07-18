import type { Knex } from 'knex';

// Terminal v2 — anchor a CLI session to a Atlas item.
//
// Optional FK so existing project-only sessions still work. ON DELETE
// SET NULL keeps a closed session row visible in history even if the
// item it referenced is deleted later. The partial index speeds up the
// "show me sessions for item X" lookup the item-detail rail will use.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions
            ADD COLUMN IF NOT EXISTS item_id text
                REFERENCES public.items(id) ON DELETE SET NULL;

        CREATE INDEX IF NOT EXISTS idx_cli_sessions_item_id
            ON public.cli_sessions (item_id)
            WHERE item_id IS NOT NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP INDEX IF EXISTS public.idx_cli_sessions_item_id;
        ALTER TABLE public.cli_sessions DROP COLUMN IF EXISTS item_id;
    `);
}
