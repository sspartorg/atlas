import { db } from '../db/kysely-client.js';
import type { IWorkflowGraph } from '@atlas/shared';
import { marketplaceService } from './marketplace.js';
import { adoptStarterTests } from './agent-starter-tests.js';

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

    const installed = await installAgentsWorkflowsNeed();
    const tests = await adoptShippedFixtures();
    if (stats.prompts_updated > 0 || installed > 0 || tests > 0) {
        console.log(
            `[catalog-sync] applied: ${stats.prompts_updated} prompt(s), ${installed} agent(s) installed, ` +
                `${tests} shipped fixture(s) adopted.`,
        );
    }
}

/**
 * Install catalog agents that an ALREADY-INSTALLED workflow names.
 *
 * `createFromTemplate` installs the agents a template needs at install time, so
 * this only ever fires when a workflow gained a step after the Owner installed
 * it. ADR 0024 is the case it was written for: migration 020 rewrote every
 * saved `gate` node to name a checker agent, and without this the Owner's
 * existing Delivery would park on its first gate with "agent-tests-check is
 * missing or inactive".
 *
 * Deliberately narrow. It installs only ids the catalog publishes and only ids
 * a workflow already refers to by name — never the whole catalog — so it
 * completes a migration rather than making a decision the Owner did not.
 */
async function installAgentsWorkflowsNeed(): Promise<number> {
    const [workflows, agents, catalog] = await Promise.all([
        db.selectFrom('workflows').select('graph').execute(),
        db.selectFrom('agents').select('id').execute(),
        db.selectFrom('marketplace_agents').select('id').execute(),
    ]);
    const have = new Set(agents.map((a) => a.id));
    const publishable = new Set(catalog.map((c) => c.id));

    const wanted = new Set<string>();
    for (const row of workflows) {
        const graph = (typeof row.graph === 'string' ? JSON.parse(row.graph) : row.graph) as IWorkflowGraph;
        for (const n of graph?.nodes ?? []) {
            if (n.agent_id && !have.has(n.agent_id) && publishable.has(n.agent_id)) wanted.add(n.agent_id);
        }
    }

    let installed = 0;
    for (const id of wanted) {
        try {
            await marketplaceService.install(id);
            installed += 1;
        } catch (err) {
            // Boot must not fail over this. A model the Owner pruned from the
            // registry is the realistic case, and the run parks with a clear
            // message if the agent is still missing when the step is reached.
            console.warn(`[catalog-sync] could not install ${id}:`, (err as Error).message);
        }
    }
    return installed;
}

/**
 * Give every installed agent the fixtures its bundle ships (migration 021).
 *
 * `marketplaceService.install` adopts them for a fresh install; this is what
 * gives the Owner's EXISTING installs theirs, without a data migration that
 * would have to read catalog files from inside a `knex` transaction. Idempotent
 * and edit-preserving — `adoptStarterTests` decides — so running it every boot
 * costs one query per agent and changes nothing once it has caught up.
 */
async function adoptShippedFixtures(): Promise<number> {
    const agents = await db
        .selectFrom('agents')
        .select(['id', 'marketplace_source_id'])
        .execute();
    let adopted = 0;
    for (const a of agents) {
        // An agent the Owner wrote themselves has no bundle to adopt from. The
        // fallback to `id` matches the starter-tests route: an agent installed
        // under its catalog id and then unlinked still reads its own bundle.
        const source = a.marketplace_source_id ?? a.id;
        try {
            const r = await adoptStarterTests(a.id, source);
            adopted += r.inserted + r.upgraded;
        } catch (err) {
            console.warn(`[catalog-sync] could not adopt fixtures for ${a.id}:`, (err as Error).message);
        }
    }
    return adopted;
}
