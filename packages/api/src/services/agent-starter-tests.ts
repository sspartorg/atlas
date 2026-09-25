import { createHash, randomUUID } from 'node:crypto';
import { db } from '../db/kysely-client.js';
import { starterTests, type CatalogEntryStarterTest } from '../marketplace/catalog-loader.js';

// Adoption of the fixtures an agent ships with (migration 021).
//
// Before this, `tests.json` was a template the Owner clicked "Add" on. The
// consequence was measurable and bad: 8 of 24 agents shipped a fixture, nobody
// had clicked, and every agent page read "No tests yet" — indistinguishable
// from an agent with no tests at all, which is what the Owner reported.
//
// Adoption runs at install, on every boot, and on upgrade, so it must be
// idempotent and must never overwrite the Owner. The rules:
//
//   no row for (agent, source_test_id)            → insert
//   row whose body still hashes to `source_hash`  → Atlas's; update it
//   row whose body no longer matches              → the Owner's; leave it
//   fixture removed from the bundle               → leave the row
//
// The last one is deliberate. Deleting a fixture — and with it the run history
// that proves when this agent last did its job — because an upgrade dropped it
// upstream would be destroying the Owner's evidence to tidy up ours.

export interface AdoptionResult {
    inserted: number;
    upgraded: number;
    skipped_edited: number;
}

/**
 * Key-order-independent JSON, which this hash cannot do without.
 *
 * `item_template` and `expectations` are `jsonb`, and Postgres stores jsonb
 * object keys sorted by length then bytewise — so `{issue_type, title}` comes
 * back as `{title, issue_type}`. Hashing `JSON.stringify` of the round-trip
 * would therefore differ from hashing the catalog object that produced it, and
 * every adopted fixture would read as "edited by you" the instant it was
 * written. Sorting makes the two agree.
 */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([k, v]) => [k, canonical(v)]),
        );
    }
    return value;
}

/**
 * The hash that answers "has the Owner edited this?".
 *
 * Over the three fields adoption writes and the UI lets the Owner change. Not
 * over `id`/`created_at`/run history, which are ours and move on their own.
 */
function bodyHash(body: { name: string; item_template: unknown; expectations: unknown }): string {
    return createHash('sha256')
        .update(
            JSON.stringify(
                canonical({
                    name: body.name,
                    item_template: body.item_template,
                    expectations: body.expectations,
                }),
            ),
        )
        .digest('hex');
}

function rowFrom(t: CatalogEntryStarterTest): { name: string; item_template: unknown; expectations: unknown } {
    return { name: t.name, item_template: t.item_template, expectations: t.expectations };
}

/**
 * Bring `agentId`'s adopted fixtures in line with what `catalogId` ships.
 *
 * `project_id` and `repo_id` stay null: the fixture belongs to the agent and
 * binds to a project when it runs. Nothing here picks a project, because a
 * fixture materialises a real item that consumes a real issue key, and
 * choosing where to spend that is the Owner's.
 */
export async function adoptStarterTests(agentId: string, catalogId: string): Promise<AdoptionResult> {
    const result: AdoptionResult = { inserted: 0, upgraded: 0, skipped_edited: 0 };
    const shipped = starterTests(catalogId);
    if (shipped.length === 0) return result;

    const existing = await db
        .selectFrom('agent_tests')
        .select(['id', 'name', 'item_template', 'expectations', 'source_test_id', 'source_hash'])
        .where('agent_id', '=', agentId)
        .where('source_test_id', 'is not', null)
        .execute();
    const bySource = new Map(existing.map((r) => [r.source_test_id as string, r]));

    for (const t of shipped) {
        const want = rowFrom(t);
        const hash = bodyHash(want);
        const row = bySource.get(t.id);

        if (!row) {
            await db
                .insertInto('agent_tests')
                .values({
                    id: randomUUID(),
                    agent_id: agentId,
                    project_id: null,
                    repo_id: null,
                    name: want.name,
                    item_template: JSON.stringify(want.item_template) as never,
                    expectations: JSON.stringify(want.expectations) as never,
                    source_test_id: t.id,
                    source_hash: hash,
                })
                .onConflict((oc) => oc.doNothing())
                .execute();
            result.inserted += 1;
            continue;
        }

        const current = bodyHash({
            name: row.name,
            item_template: row.item_template,
            expectations: row.expectations,
        });
        if (current !== row.source_hash) {
            // The Owner changed it. Theirs now, and the card says so.
            result.skipped_edited += 1;
            continue;
        }
        if (hash === row.source_hash) continue;

        await db
            .updateTable('agent_tests')
            .set({
                name: want.name,
                item_template: JSON.stringify(want.item_template) as never,
                expectations: JSON.stringify(want.expectations) as never,
                source_hash: hash,
                updated_at: new Date().toISOString(),
            })
            .where('id', '=', row.id)
            .execute();
        result.upgraded += 1;
    }
    return result;
}

/** Whether an adopted row still matches what it was adopted from. */
export function isOwnerEdited(row: {
    name: string;
    item_template: unknown;
    expectations: unknown;
    source_test_id: string | null;
    source_hash: string | null;
}): boolean {
    if (!row.source_test_id || !row.source_hash) return false;
    return bodyHash(row) !== row.source_hash;
}

/** The adoption hash, for tests that need to write one by hand. */
export const bodyHashForTest = bodyHash;
