// Commands assembler — writes every catalog agent's `prompt_md` to the
// CLI-canonical slash-command locations inside the worktree.
//
// Mirrors the spec-kit pattern (Phase 1 of the /commands framework
// redesign): slash-command bodies live at the path the CLI itself
// auto-discovers, while reference data (constitution, handoff,
// templates, scripts, current-task snapshot) stays under `.atlas/`.
//
// Per run we write each agent's body to TWO paths:
//   `<worktree>/.claude/commands/atlas-<slug>.md`         (Claude Code)
//   `<worktree>/.github/prompts/atlas-<slug>.prompt.md`   (Copilot CLI)
//
// `<slug>` is derived from `agents.id` by stripping the `agent-` prefix
// (so `agent-architect` becomes `architect`, registered as
// `/atlas-architect` by the CLI's slash-command resolver).
//
// Wipe-rewrite per run: any existing `atlas-*.md` (Claude) or
// `atlas-*.prompt.md` (Copilot) files are removed before writing so
// stale commands from prior runs / deleted agents don't linger. Files
// without the `atlas-` prefix are left alone — those are user-authored
// commands the Owner has dropped in manually.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { db } from '../db/kysely-client.js';
import { assemblePreamble } from './preamble-assembler.js';

export interface AssembleCommandsInput {
    /** Absolute path to the worktree root. The .claude/ + .github/ trees are written here. */
    worktreePath: string;
    /**
     * Reserved for future project-scoped command overrides. Currently
     * unused — every catalog agent ships the same body across all
     * projects. Kept on the input so the signature matches the other
     * assemblers and Phase 4's runner wiring is a no-op rename.
     */
    projectId: string | null;
    /**
     * Phase 4 — when set, the assembler ALSO writes the active agent's
     * body to the USER-LEVEL `~/.copilot/agents/atlas-<runId>.md` so
     * Copilot CLI's `--agent` flag can resolve it.
     *
     * Phase 0 spike confirmed the Copilot CLI's `--agent <name>`
     * resolver only reads from `~/.copilot/agents/<name>.md` — it does
     * NOT honour worktree-local `.github/prompts/`. Because that
     * location is shared across every worktree on the host, we
     * namespace each concurrent run with its own UUID-unique filename
     * (`atlas-<runId>.md`). The runner cleans the file up on run
     * finalize / error.
     *
     * Leave unset for Claude-only runs, dry-runs, or any test path
     * that should not pollute the developer's real
     * `~/.copilot/agents/` directory.
     */
    activeRunCopilotAgent?: {
        runId: string;
        agentId: string;
    };
}

export interface AssembleCommandsOutput {
    /** Absolute paths of every Claude command file written. */
    claudeCommandPaths: string[];
    /** Absolute paths of every Copilot prompt file written. */
    copilotPromptPaths: string[];
    /**
     * Absolute path of the per-run user-level Copilot agent file when
     * `activeRunCopilotAgent` was set; undefined otherwise. The runner
     * stashes this so it can `rmSync` the file on finalize/error.
     */
    copilotUserAgentPath?: string;
}

interface AgentRow {
    id: string;
    name: string;
    prompt_md: string;
    requires_item: boolean;
}

const CLAUDE_COMMANDS_SUBDIR = join('.claude', 'commands');
const COPILOT_PROMPTS_SUBDIR = join('.github', 'prompts');

// Slug filename charset. Agent ids come from user-controllable input
// (POST /api/agents) so the derived filename MUST reject any character
// that could turn `atlas-${slug}.md` into a path-traversal payload
// (path separators, `..`, drive letters). Kebab-case ASCII is the
// intersection of what every filesystem allows and what the slash-
// command resolver of both Claude Code and Copilot CLI accepts.
const SLUG_SAFE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Strip the `agent-` prefix from an agent id so the result can drop
 * into the slash-command filename. `agent-architect` → `architect`.
 * Ids that don't carry the prefix pass through unchanged (defensive —
 * the catalog uses `agent-*` consistently but custom agents could
 * carry any id shape).
 *
 * The result is validated against SLUG_SAFE_RE. Any slug carrying a
 * path separator, `..`, or a drive letter — the shapes that could
 * expand `atlas-${slug}.md` into a write outside the worktree — is
 * rejected with a thrown `AgentSlugUnsafeError`, and the caller
 * (`assembleCommands`) skips that agent so one malicious id can't
 * plant files in `~/.claude/hooks/` or `.git/hooks/`.
 */
export class AgentSlugUnsafeError extends Error {
    constructor(id: string) {
        super(`Agent id ${JSON.stringify(id)} does not produce a filesystem-safe slug`);
        this.name = 'AgentSlugUnsafeError';
    }
}

export function agentIdToSlug(id: string): string {
    const raw = id.startsWith('agent-') ? id.slice('agent-'.length) : id;
    if (!SLUG_SAFE_RE.test(raw)) {
        throw new AgentSlugUnsafeError(id);
    }
    return raw;
}

export async function assembleCommands(
    input: AssembleCommandsInput,
): Promise<AssembleCommandsOutput> {
    // `projectId` is reserved for future project-scoped overrides; the
    // current implementation reads the same catalog bodies for every
    // project. Reference the param so TS noUnusedParameters stays happy.
    void input.projectId;

    const agents = (await db
        .selectFrom('agents')
        .select(['id', 'name', 'prompt_md', 'requires_item'])
        .where('prompt_md', 'is not', null)
        .where('prompt_md', '<>', '')
        .execute()) as AgentRow[];

    const claudeDir = join(input.worktreePath, CLAUDE_COMMANDS_SUBDIR);
    const copilotDir = join(input.worktreePath, COPILOT_PROMPTS_SUBDIR);
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(copilotDir, { recursive: true });

    // Wipe atlas-prefixed files from prior runs before writing. Leave
    // any non-atlas files alone — those are user-authored commands.
    wipeAtlasFiles(claudeDir, /^atlas-.*\.md$/);
    wipeAtlasFiles(copilotDir, /^atlas-.*\.prompt\.md$/);

    const claudeCommandPaths: string[] = [];
    const copilotPromptPaths: string[] = [];
    const bodyByAgentId = new Map<string, string>();

    for (const agent of agents) {
        // Skip any agent whose id doesn't produce a filesystem-safe slug —
        // agent ids are user-controllable (POST /api/agents), and an id
        // shaped like `agent-../../../.claude/hooks/PostToolUse` would
        // otherwise let `atlas-${slug}.md` write outside the worktree.
        // The slug helper throws AgentSlugUnsafeError on such shapes.
        let slug: string;
        try {
            slug = agentIdToSlug(agent.id);
        } catch (err) {
            if (err instanceof AgentSlugUnsafeError) {
                // Log and skip — writing a command file for this agent
                // would be a path-traversal write. Other agents in the
                // same batch continue normally.
                console.warn(`[commands-assembler] ${err.message} — skipping`);
                continue;
            }
            throw err;
        }
        const body = renderCommandBody(agent);
        bodyByAgentId.set(agent.id, body);

        const claudePath = join(claudeDir, `atlas-${slug}.md`);
        const copilotPath = join(copilotDir, `atlas-${slug}.prompt.md`);
        writeFileSync(claudePath, body, 'utf8');
        writeFileSync(copilotPath, body, 'utf8');
        claudeCommandPaths.push(claudePath);
        copilotPromptPaths.push(copilotPath);
    }

    // Phase 4 — opt-in per-run write to the USER-LEVEL Copilot agents
    // directory. Only fires when the caller is dispatching a real
    // Copilot run AND that run's agent body was just rendered above.
    // The filename is keyed by `runId` (not by agent slug) so concurrent
    // runs in different worktrees don't collide on the shared
    // `~/.copilot/agents/` location.
    let copilotUserAgentPath: string | undefined;
    if (input.activeRunCopilotAgent) {
        const { runId, agentId } = input.activeRunCopilotAgent;
        const body = bodyByAgentId.get(agentId);
        if (body) {
            const userAgentsDir = join(homedir(), '.copilot', 'agents');
            mkdirSync(userAgentsDir, { recursive: true });
            copilotUserAgentPath = join(userAgentsDir, `atlas-${runId}.md`);
            writeFileSync(copilotUserAgentPath, body, 'utf8');
        }
    }

    return {
        claudeCommandPaths,
        copilotPromptPaths,
        ...(copilotUserAgentPath ? { copilotUserAgentPath } : {}),
    };
}

function wipeAtlasFiles(dir: string, pattern: RegExp): void {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        // Directory didn't exist before mkdirSync (shouldn't happen
        // since we just created it). Best-effort tolerate.
        return;
    }
    for (const entry of entries) {
        if (pattern.test(entry)) {
            try {
                rmSync(join(dir, entry), { force: true });
            } catch {
                // Best-effort — a wipe failure shouldn't sink the run.
            }
        }
    }
}

function renderCommandBody(agent: AgentRow): string {
    const description = renderDescription(agent.name);
    // Item-attached agents read `.atlas/handoff.md` + sibling files
    // for routing + context. The "read these files" preamble is
    // auto-prepended at run time so individual agent prompts don't
    // need to repeat it. Skipped for freedom-mode agents (scout-style)
    // because their runs have no `.atlas/handoff.md` to read.
    const preamble = agent.requires_item ? `${assemblePreamble(agent.id)}\n\n` : '';
    return `---\ndescription: "${description}"\n---\n\n${preamble}${agent.prompt_md}`;
}

function renderDescription(name: string): string {
    // Escape any double-quotes in the agent name so the frontmatter
    // stays valid YAML. The frontmatter body is the only consumer-facing
    // surface for this string — it shows up in Claude's `/` picker and
    // in Copilot's prompt list.
    const safe = name.replace(/"/g, '\\"');
    return (
        `Atlas SDLC agent — ${safe}. Reads .atlas/{constitution,handoff,current-task}.md, ` +
        `fills the relevant .atlas/templates/<x>.md, runs .atlas/scripts/bash/check-<agent>.sh, ` +
        `then posts the structured comment + emits outcome.`
    );
}
