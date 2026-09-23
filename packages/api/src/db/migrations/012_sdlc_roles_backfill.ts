import type { Knex } from 'knex';

// `roles` — seed the five slugs that existed only in the type.
//
// `SdlcRole` has declared ten slugs since A08, but the baseline only ever
// seeded five rows (`po`, `architect`, `engineer`, `qa`, `automation`).
// `agents.role_id` is an FK into `roles`, so the other five were unusable:
// `agentsService.create` rejects them with `400 ROLE_NOT_IN_CATALOG`, and a
// catalog bundle claiming one could not be installed at all. That is why the
// bundle schema carried a hand-written five-slug subset rather than the union.
//
// The SDLC v1 fleet needs four of them for real — a coverage fixer is a
// `tester`, a performance fixer is `devops`, a hygiene/security fixer is
// `security`, a visual reviewer is a `designer` — plus `docs` for the
// documentation pair, which is new to the type in this change.
//
// `spec-writer` is deliberately still absent. Its job was folded into
// Architect (`.agents/role-catalog.md`) and seeding a row for a role with no
// agent would invite someone to wire it back up.
//
// `default_status` is a curation signal read at seed time only, never a
// runtime guard: the Owner flips `agents.status` freely and nothing re-disables
// a runtime-enabled agent. These ship `active` because every one of them is a
// step in the delivery graph, not an optional scout.
//
// `default_prompt_md` is left empty on purpose. It is the starting point for an
// agent created by hand in the UI, and the real prompts live in the catalog
// bundles where they are versioned with their checklists. A curated duplicate
// here would be a second source of truth that nothing keeps in sync.

const ROLES = [
    { id: 'tester', label: 'Exploratory Tester', description: 'Closes measured coverage gaps with tests that would fail if the behaviour broke.', sort_order: 6 },
    { id: 'devops', label: 'DevOps Engineer', description: 'Brings touched routes back inside their performance budget without trading correctness.', sort_order: 8 },
    { id: 'security', label: 'Security Review Lead', description: 'Lint, types, secrets and debug residue: the hygiene a branch must clear before it ships.', sort_order: 9 },
    { id: 'designer', label: 'UX/Visual Designer', description: 'Reads captured screens across viewports and themes, and owns the visual baseline.', sort_order: 10 },
    { id: 'docs', label: 'Technical Writer', description: 'Documents what a branch actually shipped, verified against the diff rather than the request.', sort_order: 11 },
] as const;

export async function up(knex: Knex): Promise<void> {
    for (const r of ROLES) {
        await knex.raw(
            // NB: there is no `default_reviewer_prompt_md` column. `.agents/
            // role-catalog.md` documents one, but the table has never had it —
            // the doc is corrected in this change.
            `INSERT INTO roles (id, label, description, default_prompt_md, default_status, sort_order)
             VALUES (?, ?, ?, '', 'active', ?)
             ON CONFLICT (id) DO NOTHING`,
            [r.id, r.label, r.description, r.sort_order]
        );
    }
}

export async function down(knex: Knex): Promise<void> {
    // `agents.role_id` is ON DELETE SET NULL, so an agent pointing at one of
    // these survives the delete with a null role rather than blocking it. Null
    // is the autonomous shape and is valid, so nothing has to be rewritten
    // first — unlike migration 004, where the FK is ON DELETE RESTRICT.
    await knex.raw(`DELETE FROM roles WHERE id = ANY(?)`, [ROLES.map((r) => r.id)]);
}
