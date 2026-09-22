import type { Knex } from 'knex';

// `agents.marketplace_upgradable_hash` — a fingerprint of exactly the three
// fields a marketplace upgrade overwrites, as they stood when this agent last
// took its upstream.
//
// The automatic upgrade (the one an import performs, where nobody asked) must
// never destroy the Owner's work. That gate asked one question: "is there an
// `agent_prompt_versions` row with `edited_by = 'Owner'` past v1?" But
// `acceptUpgrade` overwrites THREE things — `prompt_md`, `settings_json` and
// `checklists` — and only the first leaves a prompt-version row behind.
//
// So an Owner who tuned an agent's checklist and never touched its prompt read
// as untouched, and the next import ran `DELETE FROM agent_checklists` over
// their work, reporting it as a clean upgrade.
//
// Why a hash and not a timestamp (the shape migration 008 used for workflows):
// `agents.updated_at` moves on ANY column, so pausing or renaming an agent
// would read as "edited" and block a content upgrade that would not have
// touched anything the Owner changed. A workflow has one editable body, so a
// timestamp is precise there; an agent does not. This hash answers the only
// question that matters — "would this upgrade overwrite something you
// changed?" — and ignores everything else.
//
// Checklists have no timestamps and live in their own table, so they are
// folded into the hash rather than tracked separately.
//
// Nullable: a hand-built agent has no upstream and nothing to compare against.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(
        `ALTER TABLE agents ADD COLUMN IF NOT EXISTS marketplace_upgradable_hash text`
    );
    // Deliberately NOT backfilled, and null reads as EDITED, not as untouched.
    //
    // For a row installed before this column existed there is no honest value:
    // hashing its current local fields would assert "untouched" about an agent
    // that may well have been edited, which is exactly the silent overwrite
    // this migration exists to stop. Hashing the catalog would assert the
    // opposite lie.
    //
    // So null means "we cannot prove this is safe to overwrite", and the
    // automatic path declines. Those agents are reported as `skipped_edited`
    // with the upgrade still offered in the Marketplace, where the Owner sees
    // what changes before accepting — one visible click instead of one silent
    // deletion. The hash becomes real at that first accept, or at install.
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE agents DROP COLUMN IF EXISTS marketplace_upgradable_hash`);
}
