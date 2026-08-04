import type { Knex } from 'knex';

// Third CLI option — `ollama`.
//
// Ollama exposes an Anthropic-compatible API on http://localhost:11434
// (docs.ollama.com/integrations/claude-code), so `cli = 'ollama'` spawns the
// SAME `claude` binary with the same argv, repointed by three env vars
// (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY — see
// `services/ollama-env.ts`). Nothing about the run shape changes; only the
// model namespace and the fact that runs are free.
//
// Four CHECK constraints gate the value. `agents`, `cli_models`, and
// `marketplace_agents` come from the squashed baseline (001_baseline.sql:346,
// :365, :717); `cli_sessions` came from 017. Postgres has no ALTER CONSTRAINT
// for CHECK, so each is dropped and re-added with the extended allow-list.
//
// The seeded `cli_models` rows are Ollama's own documented examples, not a
// curated fleet — the Owner adds whatever `ollama pull` has fetched via
// Settings -> Model Registry. A row here that isn't pulled locally fails at
// spawn with the CLI's own error, which is the right place to find out.
// `qwen3.5` must exist because it is `DEFAULT_MODEL_BY_CLI.ollama` and the
// composite FK `agents (cli, model) -> cli_models (cli, model_name)` would
// otherwise reject the default.

const OLLAMA_SEED_MODELS: ReadonlyArray<{ id: string; model_name: string; note: string; sort_order: number }> = [
    {
        id: 'seed-ollama-qwen3-5',
        model_name: 'qwen3.5',
        note: 'Local. Ollama’s default coding pick — set a 64k+ context window for large repos.',
        sort_order: 1,
    },
    {
        id: 'seed-ollama-kimi-k2-7-code',
        model_name: 'kimi-k2.7-code:cloud',
        note: 'Cloud. Code-tuned; runs without downloading weights.',
        sort_order: 2,
    },
    {
        id: 'seed-ollama-gemma4',
        model_name: 'gemma4:cloud',
        note: 'Cloud. General-purpose; good for research and non-code work.',
        sort_order: 3,
    },
];

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.agents
            DROP CONSTRAINT IF EXISTS agents_cli_check;
        ALTER TABLE public.agents
            ADD CONSTRAINT agents_cli_check
            CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text, 'ollama'::text])));

        ALTER TABLE public.cli_models
            DROP CONSTRAINT IF EXISTS cli_models_cli_check;
        ALTER TABLE public.cli_models
            ADD CONSTRAINT cli_models_cli_check
            CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text, 'ollama'::text])));

        ALTER TABLE public.marketplace_agents
            DROP CONSTRAINT IF EXISTS marketplace_agents_cli_check;
        ALTER TABLE public.marketplace_agents
            ADD CONSTRAINT marketplace_agents_cli_check
            CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text, 'ollama'::text])));

        ALTER TABLE public.cli_sessions
            DROP CONSTRAINT IF EXISTS cli_sessions_cli_check;
        ALTER TABLE public.cli_sessions
            ADD CONSTRAINT cli_sessions_cli_check
            CHECK (cli IN ('claude', 'copilot', 'ollama'));
    `);

    for (const m of OLLAMA_SEED_MODELS) {
        await knex.raw(
            `INSERT INTO public.cli_models (id, cli, model_name, note, sort_order)
             VALUES (?, 'ollama', ?, ?, ?)
             ON CONFLICT (cli, model_name) DO NOTHING`,
            [m.id, m.model_name, m.note, m.sort_order],
        );
    }
}

export async function down(knex: Knex): Promise<void> {
    // Rows written under the extended constraint have to go before the
    // allow-list shrinks, or the ALTER fails on live data. Agents are moved
    // back to `claude` rather than deleted — losing an Owner's agent config
    // on a rollback would be far worse than losing its model choice. The
    // composite FK forces the model to move with the cli, so both columns
    // are rewritten together.
    await knex.raw(
        `UPDATE public.agents SET cli = 'claude', model = ? WHERE cli = 'ollama'`,
        ['claude-opus-4-7'],
    );
    await knex.raw(`UPDATE public.marketplace_agents SET cli = 'claude' WHERE cli = 'ollama'`);
    await knex.raw(`DELETE FROM public.cli_sessions WHERE cli = 'ollama'`);
    await knex.raw(`DELETE FROM public.cli_models WHERE cli = 'ollama'`);

    await knex.schema.raw(`
        ALTER TABLE public.agents
            DROP CONSTRAINT IF EXISTS agents_cli_check;
        ALTER TABLE public.agents
            ADD CONSTRAINT agents_cli_check
            CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text])));

        ALTER TABLE public.cli_models
            DROP CONSTRAINT IF EXISTS cli_models_cli_check;
        ALTER TABLE public.cli_models
            ADD CONSTRAINT cli_models_cli_check
            CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text])));

        ALTER TABLE public.marketplace_agents
            DROP CONSTRAINT IF EXISTS marketplace_agents_cli_check;
        ALTER TABLE public.marketplace_agents
            ADD CONSTRAINT marketplace_agents_cli_check
            CHECK ((cli = ANY (ARRAY['claude'::text, 'copilot'::text])));

        ALTER TABLE public.cli_sessions
            DROP CONSTRAINT IF EXISTS cli_sessions_cli_check;
        ALTER TABLE public.cli_sessions
            ADD CONSTRAINT cli_sessions_cli_check
            CHECK (cli IN ('claude', 'copilot'));
    `);
}
