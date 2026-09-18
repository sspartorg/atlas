// Current-task writer — extracts the per-run item snapshot to
// `<worktree>/.atlas/current-task.md` so the slash-command body can
// `Read` it instead of having the same blob inlined into a 25 KB prompt
// envelope.
//
// Phase 4 of the /commands framework redesign. The body shape is the
// same one `prompt-builder.ts:buildPrompt` inlines as the `# Current
// Task` section. This service just splits it out to disk — the helpers
// (`getIssueContext`, `renderIssueContext`, `buildLinkedItemsSection`)
// are reused verbatim from prompt-builder so we have a single source of
// truth.
//
// Wipe + rewrite per run, matching the constitution-assembler pattern:
// `mkdirSync({ recursive: true })` for the `.atlas/` parent, then
// `writeFileSync` overwrites any stale file from a prior run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IssueType } from '@atlas/shared';
import {
    buildLinkedItemsSection,
    getIssueContext,
    renderIssueContext,
} from './prompt-builder.js';

export interface WriteCurrentTaskInput {
    /** Absolute path to the worktree root. The .atlas/ tree is written here. */
    worktreePath: string;
    /** Item kind — `task` or `sub_task`. Required together with `issueId`;
     *  omit BOTH for prompt-only writes (e.g. ad-hoc terminal sessions). */
    issueType?: IssueType;
    /** Item id (e.g. `ATL-12`). Pairs with `issueType`. */
    issueId?: string;
    /** Optional free-text instruction (e.g. the user's initial prompt from
     *  the Terminal Start dialog). Rendered as a `## User's initial prompt`
     *  section appended after the item snapshot. Either this or the item
     *  pair must be provided. */
    userPrompt?: string;
}

export interface WriteCurrentTaskOutput {
    /** Absolute path of the written current-task.md. */
    currentTaskPath: string;
}

/**
 * Build the `# Current Task` markdown body and write it to
 * `<worktreePath>/.atlas/current-task.md`. Two flavours, by what the
 * caller passed:
 *   - `issueType` + `issueId` (agent-runner path): renders the existing
 *     item snapshot (title / description / spec / discussion / linked items).
 *   - `userPrompt` (terminal-session path): appends a `## User's initial
 *     prompt` section. Can be combined with the item snapshot — both
 *     sections then land in one file.
 *
 * Throws when neither is provided (programmer error — the shared
 * `stageCliWorktree` caller already gates on this). Throws when the
 * item is referenced but can't be located.
 */
export async function writeCurrentTask(
    input: WriteCurrentTaskInput,
): Promise<WriteCurrentTaskOutput> {
    const hasItem = !!(input.issueType && input.issueId);
    const hasPrompt = !!(input.userPrompt && input.userPrompt.trim().length > 0);
    if (!hasItem && !hasPrompt) {
        throw new Error('writeCurrentTask: at least one of (issueType+issueId, userPrompt) is required');
    }

    const contextLines: string[] = [`# Current Task\n`];

    if (hasItem) {
        const ctx = await getIssueContext(input.issueType!, input.issueId!);
        if (!ctx) {
            throw new Error(`Issue ${input.issueType}/${input.issueId} not found`);
        }
        contextLines.push(...renderIssueContext(input.issueType!, input.issueId!, ctx));

        const linkedSection = await buildLinkedItemsSection(input.issueId!);
        if (linkedSection) {
            contextLines.push('', linkedSection);
        }
    }

    if (hasPrompt) {
        contextLines.push('', `## User's initial prompt`, input.userPrompt!.trim());
    }

    const body = contextLines.join('\n');

    const atlasDir = join(input.worktreePath, '.atlas');
    mkdirSync(atlasDir, { recursive: true });
    const currentTaskPath = join(atlasDir, 'current-task.md');
    writeFileSync(currentTaskPath, body, 'utf8');

    return { currentTaskPath };
}
