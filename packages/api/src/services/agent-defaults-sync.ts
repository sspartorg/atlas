import { db } from '../db/kysely-client.js';

// Per-boot reconciliation of installed agent prompts. `runSeed` in db/seed.ts
// only syncs the marketplace catalog into `marketplace_agents` — it never
// creates rows in `agents`. Rows land in `agents` exclusively via
// `marketplaceService.install()` (which copies `prompt_md` from
// `marketplace_agents` at install time).
//
// This function handles the orthogonal case: agents the Owner installed
// from the marketplace but hasn't edited (`prompt_version === 1`). When
// the catalog `prompt.md` evolves between releases, push the latest body
// onto those rows so they stay in sync with the published source of
// truth. Owner-edited prompts (`prompt_version > 1`) are never touched.
//
// Task 12 — source of truth flipped from the legacy `AGENT_SEEDS` array
// (`db/seed.ts`) to the `marketplace_agents` table. The seed array
// duplicated catalog content and silently overwrote catalog updates on
// boot. Reading directly from the catalog-backed table means a fresh
// install and a per-boot reconciliation now use identical bytes.

export async function syncAgentDefaults(): Promise<void> {
    const stats = { prompts_updated: 0 };

    // Snapshot every published marketplace entry — `marketplace_agents` is
    // the table runSeed populates from `catalog/<id>/prompt.md`. Joining
    // here instead of looping with per-id queries keeps the boot cost
    // bounded (one query) regardless of catalog size.
    const catalogRows = await db
        .selectFrom('marketplace_agents')
        .select(['id', 'prompt_md'])
        .execute();

    for (const cat of catalogRows) {
        if (typeof cat.prompt_md !== 'string' || cat.prompt_md.length === 0) {
            continue;
        }

        const existing = await db
            .selectFrom('agents')
            .select(['id', 'prompt_md', 'prompt_version'])
            .where('id', '=', cat.id)
            .executeTakeFirst();

        // Only patch agents the Owner has installed from the marketplace.
        // `runSeed` never creates them, so a missing row means "Owner
        // hasn't installed this agent" and the sync is a no-op.
        if (!existing) continue;

        // Patch the prompt only when the Owner hasn't edited it.
        // `prompt_version` starts at 1 on install and bumps on every PATCH
        // that includes `prompt_md` (see services/agents.ts). Comparing
        // strings handles the edge case where someone reverted manually —
        // if the prompt body already matches catalog, treat it as
        // up-to-date even at version 1.
        if (
            existing.prompt_version === 1 &&
            existing.prompt_md !== cat.prompt_md
        ) {
            await db.transaction().execute(async (trx) => {
                await trx
                    .updateTable('agents')
                    .set({ prompt_md: cat.prompt_md })
                    .where('id', '=', cat.id)
                    .execute();
                // Snapshot the new prompt body into agent_prompt_versions
                // so the prompt history shows when the catalog update
                // landed. T1 dropped `agent_prompt_versions.kind`;
                // uniqueness key is now (agent_id, version).
                await trx
                    .insertInto('agent_prompt_versions')
                    .values({
                        agent_id: cat.id,
                        version: 1,
                        body_md: cat.prompt_md,
                        edited_by: 'Owner (catalog sync)',
                    })
                    .onConflict((oc) =>
                        oc.columns(['agent_id', 'version']).doUpdateSet({
                            body_md: cat.prompt_md,
                        }),
                    )
                    .execute();
            });
            stats.prompts_updated += 1;
        }
    }

    if (stats.prompts_updated > 0) {
        console.log(`[catalog-sync] applied: ${stats.prompts_updated} prompt(s).`);
    }
}
