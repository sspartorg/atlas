// Templates assembler — writes every row from `agent_templates` to
// `<worktree>/.atlas/templates/<filename>` per run.
//
// Phase 2 of the atlas /commands framework redesign. Each slash-command
// body references a template at a known path (e.g. `.atlas/templates/
// spec.md`) so the model fills in a stable shape instead of re-deriving
// it from the prompt every run. The five seed rows live in `db/seed.ts`
// (`spec`, `plan`, `tasks`, `story`, `qa-plan`); Owner can edit them via
// direct DB writes until the follow-up Settings tab ships.
//
// Wipe-rewrite per run: any existing files under
// `<worktree>/.atlas/templates/` are removed before the new bodies
// land. Stale templates from prior runs (or from a row the Owner
// deleted) don't linger.
//
// Mirrors `constitution-assembler.ts` in shape — mkdirSync(recursive)
// + writeFileSync.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/kysely-client.js';

export interface AssembleTemplatesInput {
    /** Absolute path to the worktree root. The .atlas/templates/ tree is written here. */
    worktreePath: string;
}

export interface AssembleTemplatesOutput {
    /** Absolute paths of every template file written. */
    templatePaths: string[];
}

const TEMPLATES_SUBDIR = join('.atlas', 'templates');

export async function assembleTemplates(
    input: AssembleTemplatesInput,
): Promise<AssembleTemplatesOutput> {
    const rows = await db
        .selectFrom('agent_templates')
        .select(['id', 'filename', 'body_md'])
        .execute();

    const templatesDir = join(input.worktreePath, TEMPLATES_SUBDIR);
    mkdirSync(templatesDir, { recursive: true });

    // Wipe-rewrite: remove every file in the templates dir before
    // writing the current set. Stale rows / deleted templates from
    // prior runs don't linger.
    wipeDir(templatesDir);

    const templatePaths: string[] = [];
    for (const row of rows) {
        const target = join(templatesDir, row.filename);
        writeFileSync(target, row.body_md, 'utf8');
        templatePaths.push(target);
    }

    return { templatePaths };
}

function wipeDir(dir: string): void {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        // Directory didn't exist before mkdirSync (shouldn't happen
        // since we just created it). Best-effort tolerate.
        /* v8 ignore next */
        return;
    }
    for (const entry of entries) {
        try {
            rmSync(join(dir, entry), { force: true, recursive: true });
        } catch {
            // Best-effort — a wipe failure shouldn't sink the run.
        }
    }
}
