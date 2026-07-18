import fs from 'node:fs';
import path from 'node:path';
import { db, closeDb } from '../db/kysely-client.js';
import { eventsLog } from '../services/events-log.js';

// Inlined helper — recovery scripts are agent-specific by design; the
// orchestrator must stay generic, so this helper lives here, not in services.
function findSpecFile(worktreePath: string): string | null {
    const specsDir = path.join(worktreePath, 'specs');
    if (!fs.existsSync(specsDir)) return null;
    const entries = fs.readdirSync(specsDir, { withFileTypes: true });
    const candidates: Array<{ file: string; mtime: number }> = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const specFile = path.join(specsDir, entry.name, 'spec.md');
        if (fs.existsSync(specFile)) {
            candidates.push({ file: specFile, mtime: fs.statSync(specFile).mtimeMs });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]!.file;
}

// One-shot admin recovery for stranded Architect runs (e.g. MON-2).
//
// When an Architect run errors mid-flight AND a manual transition
// flipped the item out of `in_progress` before the crash, the
// orchestrator's error-handler skips the recovery (see B2 in this
// workstream's plan). The item ends up in `in_review` with
// `assignee_agent_id = agent-architect` and a NULL `spec_md` column —
// even if the spec.md file was committed to the worktree before the
// crash.
//
// This script unsticks one item:
//
//   • If a `specs/*/spec.md` file exists on the item's worktree,
//     read it into `items.spec_md`, route to Architect Reviewer with
//     status `ready` (the canonical happy-path state).
//   • Otherwise, reset to `ready` with `agent-architect` so the
//     Owner can re-dispatch from scratch.
//
// Idempotent: re-running on an already-recovered item is a no-op
// (returns "already recovered").
//
// Usage:
//   pnpm -F @atlas/api exec tsx src/scripts/recover-architect-stranded.ts <ITEM_ID>

const ARCHITECT_REVIEWER_AGENT_ID = 'agent-architect-reviewer';
const ARCHITECT_AGENT_ID = 'agent-architect';

interface IItemRow {
    id: string;
    type: string;
    status: string;
    assignee_agent_id: string | null;
    spec_md: string | null;
    worktree_path: string | null;
}

async function recoverItem(itemId: string): Promise<{
    outcome: 'recovered_with_spec' | 'reset_no_spec' | 'already_recovered' | 'not_found' | 'not_stranded';
    detail: string;
}> {
    const row = (await db
        .selectFrom('items')
        .select(['id', 'type', 'status', 'assignee_agent_id', 'spec_md', 'worktree_path'])
        .where('id', '=', itemId)
        .executeTakeFirst()) as IItemRow | undefined;

    if (!row) {
        return { outcome: 'not_found', detail: `item ${itemId} does not exist` };
    }

    // Idempotency guard — if the item is already past Architect (assignee
    // is Reviewer or the spec is persisted), don't reset it.
    const isStranded =
        row.status === 'in_review' &&
        row.assignee_agent_id === ARCHITECT_AGENT_ID &&
        row.spec_md == null;

    if (!isStranded) {
        const already =
            row.spec_md != null && row.assignee_agent_id === ARCHITECT_REVIEWER_AGENT_ID;
        if (already) {
            return {
                outcome: 'already_recovered',
                detail: `item ${itemId} is already in ready/Architect-Reviewer with spec_md persisted`,
            };
        }
        return {
            outcome: 'not_stranded',
            detail: `item ${itemId} is in status=${row.status}, assignee=${row.assignee_agent_id ?? 'null'}, spec_md=${row.spec_md == null ? 'null' : 'set'} — not the in_review/Architect/null-spec stranded shape; refusing to touch`,
        };
    }

    if (!row.worktree_path) {
        await db
            .updateTable('items')
            .set({ status: 'ready', assignee_agent_id: ARCHITECT_AGENT_ID })
            .where('id', '=', itemId)
            .execute();
        await eventsLog.record({
            item_id: itemId,
            event_type: 'status_changed',
            field: 'status',
            from_value: 'in_review',
            to_value: 'ready',
            detail: 'recover-architect-stranded: reset to ready/Architect (no worktree_path on row)',
        });
        return {
            outcome: 'reset_no_spec',
            detail: `item ${itemId} reset to ready/Architect (worktree_path is null)`,
        };
    }

    const specFile = findSpecFile(row.worktree_path);

    if (specFile) {
        const content = fs.readFileSync(specFile, 'utf8');
        await db
            .updateTable('items')
            .set({
                spec_md: content,
                status: 'ready',
                assignee_agent_id: ARCHITECT_REVIEWER_AGENT_ID,
            })
            .where('id', '=', itemId)
            .execute();
        await eventsLog.record({
            item_id: itemId,
            event_type: 'status_changed',
            field: 'status',
            from_value: 'in_review',
            to_value: 'ready',
            detail: `recover-architect-stranded: routed to Architect Reviewer; spec backfilled from ${path.relative(row.worktree_path, specFile)}`,
        });
        return {
            outcome: 'recovered_with_spec',
            detail: `item ${itemId}: spec_md backfilled from ${specFile} (${content.length} chars); routed to ${ARCHITECT_REVIEWER_AGENT_ID} with status ready`,
        };
    }

    await db
        .updateTable('items')
        .set({ status: 'ready', assignee_agent_id: ARCHITECT_AGENT_ID })
        .where('id', '=', itemId)
        .execute();
    await eventsLog.record({
        item_id: itemId,
        event_type: 'status_changed',
        field: 'status',
        from_value: 'in_review',
        to_value: 'ready',
        detail: `recover-architect-stranded: reset to ready/Architect (no spec.md found under ${row.worktree_path}/specs/)`,
    });
    return {
        outcome: 'reset_no_spec',
        detail: `item ${itemId}: no spec.md on worktree; reset to ready/${ARCHITECT_AGENT_ID} for re-dispatch`,
    };
}

async function main(): Promise<void> {
    const itemId = process.argv[2];
    if (!itemId) {
        console.error('usage: recover-architect-stranded <ITEM_ID>');
        process.exit(2);
    }

    try {
        const result = await recoverItem(itemId);
        console.log(`[${result.outcome}] ${result.detail}`);
        process.exit(result.outcome === 'not_found' ? 1 : 0);
    } finally {
        await closeDb();
    }
}

// Export for testing.
export { recoverItem };

// Only run main when invoked directly (not when imported by tests).
// Both ESM (`import.meta.url`) and tsx-with-source-maps shapes are
// handled — the file is executed if `process.argv[1]` ends with this
// script's basename.
const invokedAsScript =
    typeof process !== 'undefined' &&
    process.argv[1] != null &&
    process.argv[1].endsWith('recover-architect-stranded.ts');

if (invokedAsScript) {
    void main();
}
