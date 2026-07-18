// Renders the centralized "read these files" preamble that the agent
// runner prepends to every item-attached agent's WORK.md. Replaces the
// per-agent copy that previously lived at the top of every marketplace
// catalog prompt.md (lines 7-12). New custom agents inherit the same
// behavior for free as long as their `requires_item` column is true.
//
// Kept as a pure function (no I/O, no DB) so callers compose it with
// `buildPrompt` output without worrying about ordering side-effects.

export function assemblePreamble(agentId: string): string {
    return [
        `You are agent \`${agentId}\`. Before doing anything else, read these files at the worktree root:`,
        '',
        '1. `.atlas/constitution.md` — the project\'s rules of engagement',
        '2. `.atlas/handoff.md` — your routing contract (what MCP calls to make on pass / fail)',
        '3. `.atlas/current-task.md` — the item this run targets',
        '4. `.atlas/self-memory.md` — your past course-corrections (append a one-liner at the end of this run if you learn something non-obvious)',
    ].join('\n');
}
