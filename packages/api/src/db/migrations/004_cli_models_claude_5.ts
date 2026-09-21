import type { Knex } from 'knex';

// `cli_models` — add the current-generation Claude models for the `claude` CLI.
//
// The seeded catalog in `001_baseline.sql` was captured 2026-06-02 and tops out
// at Opus 4.7. That is not cosmetic: `agents_cli_model_fk` is a composite FK
// `agents (cli, model) → cli_models (cli, model_name)`, so a model missing from
// this table cannot be selected for an agent at all. Every agent on this install
// was therefore pinned to a superseded generation with no way to move forward
// from the UI.
//
// Model strings are the CLI's own full names (`claude --model <name>`), which is
// what `cli-model-naming.ts` passes through verbatim — not Anthropic API ids.
// The `[1m]` suffix follows the existing `claude-opus-4-7[1m]` row.
//
// Existing rows are kept and shifted down rather than removed: an agent may
// still reference one, and pinning a known-good older model stays legitimate.

const NEW_CLAUDE_MODELS = [
    {
        model_name: 'claude-opus-5',
        note: 'Strongest general model. Best default for plans, designs and complex refactors.',
        sort_order: 1,
    },
    {
        model_name: 'claude-opus-5[1m]',
        note: 'Opus 5 with 1M context. Pick for very large repos or long histories.',
        sort_order: 2,
    },
    {
        model_name: 'claude-sonnet-5',
        note: 'Faster and cheaper than Opus 5. Good for routine sub-tasks and reviewers.',
        sort_order: 3,
    },
    {
        model_name: 'claude-fable-5-1',
        note: 'Most capable, and the most expensive. For the hardest reasoning and long-horizon work.',
        sort_order: 4,
    },
] as const;

const SHIFT = NEW_CLAUDE_MODELS.length;

export async function up(knex: Knex): Promise<void> {
    // Make room at the top so the current generation sorts above the old rows.
    await knex.raw(`UPDATE cli_models SET sort_order = sort_order + ? WHERE cli = 'claude'`, [
        SHIFT,
    ]);
    for (const m of NEW_CLAUDE_MODELS) {
        // ON CONFLICT against the (cli, model_name) unique key keeps this
        // idempotent if a row was added by hand before the migration ran.
        await knex.raw(
            `INSERT INTO cli_models (id, cli, model_name, note, sort_order)
             VALUES (?, 'claude', ?, ?, ?)
             ON CONFLICT (cli, model_name) DO NOTHING`,
            [`seed-${m.model_name}`, m.model_name, m.note, m.sort_order]
        );
    }
}

export async function down(knex: Knex): Promise<void> {
    // agents_cli_model_fk is ON DELETE RESTRICT, so any agent still pointing at
    // one of these would block the delete. Move them back to the previous
    // default first — dropping the row silently is not an option.
    const names = NEW_CLAUDE_MODELS.map((m) => m.model_name);
    await knex.raw(
        `UPDATE agents SET model = 'claude-opus-4-7' WHERE cli = 'claude' AND model = ANY(?)`,
        [names]
    );
    await knex.raw(`DELETE FROM cli_models WHERE cli = 'claude' AND model_name = ANY(?)`, [names]);
    await knex.raw(`UPDATE cli_models SET sort_order = sort_order - ? WHERE cli = 'claude'`, [
        SHIFT,
    ]);
}
