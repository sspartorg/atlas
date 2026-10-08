import type { Knex } from 'knex';

// Claude 5.5 models join the claude CLI registry and the 4.x rows (plus the
// bare `haiku` alias) leave it. `agents (cli, model)` is an ON DELETE RESTRICT
// FK into `cli_models`, so agents on a retired model are moved to its
// successor first. Only seed rows are touched — a model the Owner added stays.

const ADDED = [
    ['seed-claude-opus-5-5', 'claude-opus-5-5', 'Strongest general model and the default. Plans, designs, complex refactors.', 1],
    ['seed-claude-opus-5-5-1m', 'claude-opus-5-5[1m]', 'Opus 5.5 with 1M context. Pick for very large repos or long histories.', 2],
    ['seed-claude-sonnet-5-5', 'claude-sonnet-5-5', 'Faster and cheaper than Opus. Good for routine sub-tasks and reviews.', 3],
    ['seed-claude-haiku-5-5', 'claude-haiku-5-5', 'Cheapest and fastest. Short, well-scoped tasks only.', 4],
] as const;

const RETIRED: Record<string, { id: string; successor: string }> = {
    'claude-opus-4-7': { id: 'seed-claude-opus-4-7', successor: 'claude-opus-5-5' },
    'claude-opus-4-7[1m]': { id: 'seed-claude-opus-4-7-1m', successor: 'claude-opus-5-5[1m]' },
    'claude-opus-4-6': { id: 'seed-claude-opus-4-6', successor: 'claude-opus-5-5' },
    'claude-sonnet-4-6': { id: 'seed-claude-sonnet-4-6', successor: 'claude-sonnet-5-5' },
    haiku: { id: 'seed-claude-haiku', successor: 'claude-haiku-5-5' },
};

const KEPT_ORDER: Record<string, number> = {
    'seed-claude-fable-5-1': 5,
    'seed-claude-opus-5': 6,
    'seed-claude-opus-5[1m]': 7,
    'seed-claude-sonnet-5': 8,
};

export async function up(knex: Knex): Promise<void> {
    for (const [id, model_name, note, sort_order] of ADDED) {
        await knex('cli_models')
            .insert({ id, cli: 'claude', model_name, note, sort_order })
            .onConflict(['cli', 'model_name'])
            .ignore();
    }
    for (const [model, { id, successor }] of Object.entries(RETIRED)) {
        await knex('agents').where({ cli: 'claude', model }).update({ model: successor });
        await knex('cli_models').where({ id }).delete();
    }
    for (const [id, sort_order] of Object.entries(KEPT_ORDER)) {
        await knex('cli_models').where({ id }).update({ sort_order });
    }
}

export async function down(): Promise<void> {
    // Agents were moved off the retired models; restoring the rows would not
    // move them back, so there is nothing faithful to undo.
}
