// Shared CLI-worktree staging.
//
// A terminal session and an agent run are the same thing under the hood:
// a CLI process spawned inside a Atlas worktree. Both want the same
// "project ground rules" baked into the worktree so the CLI can read
// them on its first turn. Without a shared helper the two call sites
// (`spawnAgentRun` and the cli-sessions create route) drifted in the
// past — one had the constitution, the other had a separate item brief.
// This module is the single source of truth for everything that lands
// in the worktree before the spawn.
//
// What this stages, unconditionally:
//   - `.atlas/constitution.md` + guardrail scripts (constitution-assembler)
//   - `.atlas/templates/<filename>` (templates-assembler)
//   - `.claude/commands/atlas-<slug>.md` + `.github/prompts/atlas-<slug>.prompt.md`
//     for every agent in the catalog (commands-assembler)
//
// What this stages conditionally, by flag:
//   - `.atlas/current-task.md` — when `item` and/or `userPrompt` is set.
//     The item snapshot uses the orchestrator's existing shape; an optional
//     user prompt is appended as a `## User's initial prompt` section.
//   - `~/.copilot/agents/atlas-<runId>.md` — when `activeRunCopilotAgent`
//     is set (agent-runner with copilot + `--agent` only).
//   - `.atlas/handoff.md` — when `includeHandoff` is set (agent-runner
//     when the agent's `requires_item` is true). Terminals never set it.
//
// What this does NOT do (caller-owned because of cleanup semantics):
//   - `runProjectSetup` — a failed setup must roll back the worktree, and
//     the route owns that rollback path.
//   - `buildGitConfig` — the tmp config has lifetime tied to the PTY (or
//     the agent run), cleaned up by the host / runner respectively.

import type { IssueType } from '@atlas/shared';
import { assembleConstitution } from './constitution-assembler.js';
import { assembleTemplates } from './templates-assembler.js';
import { assembleCommands } from './commands-assembler.js';
import { writeCurrentTask } from './current-task-writer.js';
import { assembleHandoff } from './handoff-assembler.js';

export interface StageCliWorktreeOpts {
    worktreePath: string;
    /** Project id for the worktree. Drives project-level guardrail merging
     *  in the constitution. Null when staging outside any project context
     *  (rare; agent-runner uses null for some freedom agents). */
    projectId: string | null;
    /** Optional item link. When set, `current-task.md` includes the item
     *  snapshot. Either this or `userPrompt` (or both) triggers the write. */
    item?: { type: IssueType; id: string } | null;
    /** Optional user instruction. When set, appended to `current-task.md`
     *  as a "User's initial prompt" section. Terminal sessions use this;
     *  agent runs leave it undefined. */
    userPrompt?: string | null;
    /** Agent runs only — staging the per-run user-level Copilot agent file
     *  so the CLI can resolve `--agent atlas-<runId>`. Caller is
     *  responsible for cleaning the resulting file up on finalize/error
     *  (the returned `copilotUserAgentPath` is the cleanup target). */
    activeRunCopilotAgent?: { runId: string; agentId: string };
    /** Agent runs only — writes `.atlas/handoff.md` with the routing
     *  checklist + on-pass/on-fail rules. */
    includeHandoff?: { agentId: string };
}

export interface StageCliWorktreeResult {
    /** Set when `current-task.md` was written. Null when neither `item` nor
     *  `userPrompt` was provided — in which case the caller should not type
     *  any "read current-task.md" auto-prompt. */
    currentTaskPath: string | null;
    /** Set when `activeRunCopilotAgent` was provided. Caller (agent-runner)
     *  rmSyncs this file when the run finalizes. Undefined otherwise. */
    copilotUserAgentPath?: string;
    /** The merged constitution body — surfaced so the agent-runner can
     *  embed it in the spawn-time prompt envelope without re-reading from
     *  disk. Terminal sessions don't need this (the CLI reads the file
     *  itself via the slash-command preamble). */
    constitutionMarkdown: string;
}

export async function stageCliWorktree(
    opts: StageCliWorktreeOpts,
): Promise<StageCliWorktreeResult> {
    const constitutionResult = await assembleConstitution({
        worktreePath: opts.worktreePath,
        projectId: opts.projectId,
    });
    await assembleTemplates({ worktreePath: opts.worktreePath });
    const cmd = await assembleCommands({
        worktreePath: opts.worktreePath,
        projectId: opts.projectId,
        ...(opts.activeRunCopilotAgent
            ? { activeRunCopilotAgent: opts.activeRunCopilotAgent }
            : {}),
    });

    let currentTaskPath: string | null = null;
    const hasItem = !!(opts.item && opts.item.id);
    const hasPrompt = !!(opts.userPrompt && opts.userPrompt.trim().length > 0);
    if (hasItem || hasPrompt) {
        const out = await writeCurrentTask({
            worktreePath: opts.worktreePath,
            ...(hasItem
                ? { issueType: opts.item!.type, issueId: opts.item!.id }
                : {}),
            ...(hasPrompt ? { userPrompt: opts.userPrompt! } : {}),
        });
        currentTaskPath = out.currentTaskPath;
    }

    if (opts.includeHandoff) {
        await assembleHandoff({
            worktreePath: opts.worktreePath,
            agentId: opts.includeHandoff.agentId,
        });
    }

    return {
        currentTaskPath,
        constitutionMarkdown: constitutionResult.constitutionMarkdown,
        ...(cmd.copilotUserAgentPath ? { copilotUserAgentPath: cmd.copilotUserAgentPath } : {}),
    };
}
