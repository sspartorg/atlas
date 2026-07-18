import { db, closeDb } from '../db/kysely-client.js';
import { createItem, rowToEpic, rowToStory, searchItems } from '../services/items.js';
import { itemLinks } from '../services/item-links.js';
import { assertNoOpenBlockers, notifyDependentsUnblocked } from '../services/dependency-guard.js';

async function ensureProject(id: string, prefix: string): Promise<void> {
    await db
        .insertInto('projects')
        .values({
            id,
            name: `Smoke ${id}`,
            issue_key_prefix: prefix,
            status: 'active',
            clone_status: 'ready',
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
    await db
        .insertInto('project_issue_counters')
        .values({ project_id: id, last_seq: 0 })
        .onConflict((oc) => oc.column('project_id').doNothing())
        .execute();
}

async function cleanup(projectId: string): Promise<void> {
    await db.deleteFrom('projects').where('id', '=', projectId).execute();
}

async function main(): Promise<void> {
    const PROJECT_ID = 'proj-smoke';
    await cleanup(PROJECT_ID);
    await ensureProject(PROJECT_ID, 'SMK');

    console.log('=== Creating items ===');
    const epicRow = await createItem({
        project_id: PROJECT_ID,
        type: 'epic',
        title: 'Smoke Epic — search me later',
        description: 'A test epic for end-to-end smoke verification of unified items.',
        priority: 'high',
    });
    const epic = rowToEpic(epicRow);
    console.log(' epic:', epic.id, epic.title, 'priority=', epic.priority);

    const storyARow = await createItem({
        project_id: PROJECT_ID,
        type: 'story',
        parent_id: epic.id,
        title: 'Story A — blocking work',
        acceptance_criteria: 'AC for A',
    });
    const storyA = rowToStory(storyARow);
    console.log(' story A:', storyA.id, 'epic_id=', storyA.epic_id);

    const storyBRow = await createItem({
        project_id: PROJECT_ID,
        type: 'story',
        parent_id: epic.id,
        title: 'Story B — depends on Story A',
    });
    const storyB = rowToStory(storyBRow);
    console.log(' story B:', storyB.id);

    console.log('\n=== Creating depends_on link (B blocked by A) ===');
    const linkResult = await itemLinks.create(storyB.id, storyA.id, 'depends_on');
    console.log(' link:', linkResult);

    console.log('\n=== Cycle detection: A -> B should be rejected ===');
    const cycle = await itemLinks.create(storyA.id, storyB.id, 'depends_on');
    console.log(' cycle attempt:', cycle);

    console.log('\n=== Open blockers of B ===');
    const blockers = await itemLinks.openBlockers(storyB.id);
    console.log(' blockers:', blockers);

    console.log('\n=== assertNoOpenBlockers(B, in_progress) — should throw ===');
    try {
        await assertNoOpenBlockers(storyB.id, 'in_progress');
        console.log(' UNEXPECTED: did not throw');
    } catch (e) {
        const err = e as Error & { code?: string };
        console.log(` blocked as expected: code=${err.code} msg=${err.message}`);
    }

    console.log('\n=== Resolve A (done) -> auto-unblock dependents ===');
    await db
        .updateTable('items')
        .set({ status: 'done' })
        .where('id', '=', storyA.id)
        .execute();
    const unblocked = await notifyDependentsUnblocked(storyA.id);
    console.log(' unblocked:', unblocked);

    console.log('\n=== assertNoOpenBlockers(B, in_progress) — should now pass ===');
    await assertNoOpenBlockers(storyB.id, 'in_progress');
    console.log(' OK: no blockers');

    console.log('\n=== Search ===');
    const hits = await searchItems({ q: 'smoke' });
    console.log(' hits:', hits.map((h) => `${h.id} (${h.type}) rank=${h.rank.toFixed(3)}`));

    console.log('\n=== Side-table cascade on item delete ===');
    await db.insertInto('comments').values({ author: 'owner', item_id: storyB.id, body: 'a comment' }).execute();
    await db.insertInto('issue_events').values({ item_id: storyB.id, event_type: 'created', detail: null }).execute();
    const before = await db.selectFrom('comments').selectAll().where('item_id', '=', storyB.id).execute();
    console.log(' comments before delete:', before.length);
    await db.deleteFrom('items').where('id', '=', storyB.id).execute();
    const after = await db.selectFrom('comments').selectAll().where('item_id', '=', storyB.id).execute();
    console.log(' comments after delete:', after.length);

    console.log('\n=== Cleanup ===');
    await cleanup(PROJECT_ID);
    await closeDb();
    console.log('Smoke test complete.');
}

void main().catch((err) => {
    console.error('Smoke test failed:', err);
    process.exit(1);
});
