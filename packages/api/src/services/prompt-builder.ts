import { db } from '../db/kysely-client.js';
import { commentsService } from './comments.js';
import { itemLinks } from './item-links.js';
import { COMMIT_DISCIPLINE_PROMPT_SECTION, buildHumanAttributionSection } from './commit-discipline.js';

// Theme 09 — render `{{ key }}` placeholders in an agent's prompt
// body against its `settings_json`. Missing keys render as `(unset)`
// so the agent sees plainly what it has to work with rather than a
// stray placeholder. Used by both freedom-run prompts (autonomous
// agents) and item-attached prompts (custom agents that template
// their role against per-agent settings).
function applyAgentSettingsSubstitution(
    body: string,
    settings: Record<string, unknown> | null | undefined,
): string {
    // reason: every call site only invokes this after `agent.prompt_md.trim()`
    // is truthy and passes that trimmed value in, so `body` is never falsy
    // in practice; this guard is defensive against future callers.
    /* v8 ignore next */
    if (!body) return body;
    const data = settings ?? {};
    return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
        if (key in data) {
            const v = (data as Record<string, unknown>)[key];
            if (v === null || v === undefined) return '(unset)';
            return typeof v === 'string' ? v : JSON.stringify(v);
        }
        return '(unset)';
    });
}
import {
    GUARDRAIL_CATEGORIES,
    GUARDRAIL_CATEGORY_META,
    GUARDRAIL_SEVERITY_META,
} from '@atlas/shared';
import type {
    IGuardrailRule,
    IProjectGuardrail,
    IAgent,
    IComment,
    IssueType,
} from '@atlas/shared';

export interface IssueContext {
    title: string;
    description: string;
    spec_md?: string | undefined;
    epicTitle?: string | undefined;
    epicDescription?: string | undefined;
    projectName?: string | undefined;
    comments: IComment[];
}

export async function getIssueContext(issueType: IssueType, issueId: string): Promise<IssueContext | null> {
    // Always pull the comment thread in parallel — the owner's working
    // assumption is that the description is a starting point and the comments
    // are how the spec actually evolves. Agents need both.
    const commentsPromise = commentsService.list(issueType, issueId);

    if (issueType === 'story') {
        const row = await db
            .selectFrom('items as s')
            .leftJoin('items as e', 'e.id', 's.parent_id')
            .leftJoin('projects as p', 'p.id', 's.project_id')
            .select([
                's.title as title',
                's.description as description',
                's.spec_md as spec_md',
                'e.title as epic_title',
                'e.description as epic_description',
                'p.name as project_name',
            ])
            .where('s.id', '=', issueId)
            .where('s.type', '=', 'story')
            .executeTakeFirst();
        if (!row) return null;
        // reason: `items.project_id` is NOT NULL and FK-enforced
        // (ON DELETE CASCADE), and the `items_check_parent` trigger
        // requires every story to have a `parent_id` pointing at an
        // existing epic — so the `e`/`p` leftJoins above can never
        // actually miss, and the `?? undefined` fallbacks on
        // epicTitle/epicDescription/projectName are unreachable
        // defensively (see migrations/001_baseline.sql).
        return {
            title: row.title as string,
            description: (row.description as string | null) ?? '',
            spec_md: (row.spec_md as string | null) ?? undefined,
            /* v8 ignore next */
            epicTitle: (row.epic_title as string | null) ?? undefined,
            /* v8 ignore next */
            epicDescription: (row.epic_description as string | null) ?? undefined,
            /* v8 ignore next */
            projectName: (row.project_name as string | null) ?? undefined,
            comments: await commentsPromise,
        };
    }

    if (issueType === 'epic') {
        const row = await db
            .selectFrom('items as e')
            .leftJoin('projects as p', 'p.id', 'e.project_id')
            .select(['e.title as title', 'e.description as description', 'p.name as project_name'])
            .where('e.id', '=', issueId)
            .where('e.type', '=', 'epic')
            .executeTakeFirst();
        if (!row) return null;
        return {
            title: row.title as string,
            description: (row.description as string | null) ?? '',
            // reason: `items.project_id` is NOT NULL and FK-enforced
            // (ON DELETE CASCADE), so the `p` leftJoin above can never
            // actually miss for an existing epic row.
            /* v8 ignore next */
            projectName: (row.project_name as string | null) ?? undefined,
            comments: await commentsPromise,
        };
    }

    if (issueType === 'bug') {
        const row = await db
            .selectFrom('items')
            .select(['title', 'description'])
            .where('id', '=', issueId)
            .where('type', '=', 'bug')
            .executeTakeFirst();
        if (!row) return null;
        return {
            title: row.title as string,
            description: (row.description as string | null) ?? '',
            comments: await commentsPromise,
        };
    }

    return null;
}

export function formatComments(comments: IComment[]): string {
    if (comments.length === 0) return '_(no comments yet — the description above is the starting point.)_';
    return comments
        .map((c) => {
            const who = c.author === 'owner' ? 'Owner' : c.agent_id ?? 'agent';
            return `**${who}** · ${c.created_at}\n${c.body}`;
        })
        .join('\n\n---\n\n');
}

// Hard-coded refusal list every agent inherits. Added to the constitution
// after per-agent allowlists were dropped 2026-05-27 — the spawned CLI now
// inherits Owner's user-level MCP config (Atlas + Atlassian + Playwright
// + …) and can technically call any Atlas MCP tool, so the safety net
// moved to a prompt-level clause.
//
// 2026-06-01 (Plan E) — `mcp__atlas__execGitHub` was removed. The
// orchestrator regains ownership of `git push` and `gh pr create`:
// `pushWorktree` always fires at run-end, and `openPullRequest` fires
// when the agent row has `raises_pr = true` AND the run exited cleanly.
// Agents commit only. The constitution mirrors that contract.
const FORBIDDEN_TOOLS_SECTION = `## One run = one model session

You may not dispatch sub-agents from this session. Concretely:

- Do not call Claude Code's \`Task\` tool (the sub-agent dispatcher).
- Do not \`Bash\`-spawn \`claude\`, \`gh copilot\`, or any other model CLI.
- Do not call \`mcp__atlas__crud_agent\` with \`op\` in
  {\`create\`, \`update\`, \`delete\`} to spin up a worker for yourself.

Sub-agents spawned from inside this run do not close cleanly when this
run ends — they keep their model session alive, burn tokens against
the Owner's quota with no run-row to itemize the spend, and orphan
their partially-finished work outside the orchestrator's visibility.
There is no safe variant of this. The orchestrator already
parallelizes by dispatching independent top-level runs; if your scope
is too large for one session, post a clarifying comment on the item
and stop.

All work belongs to **you**, the model currently running.

## Forbidden Atlas MCP tool calls

You must never call the following operations under any circumstances. They
mutate the Atlas control plane and are reserved for the Owner via the UI:

- \`crud_agent\` with \`op: 'create'\`, \`'update'\`, or \`'delete'\` — agent
  management. (Reading via \`op: 'search'\` / \`'get'\` is permitted.)
- Any project-lifecycle mutation (no MCP tool exposes these today, but if one
  appears later, refuse).
- Any global-settings, guardrail, or credential mutation tool.

If the Owner or a prompt asks you to perform one of these, refuse and
explain that this is an Owner-only action.

## Repository operations (every agent, no exceptions)

**You commit. The orchestrator pushes and opens the PR.** This split
is non-negotiable and identical for every role; do not duplicate or
vary it in a per-agent prompt.

**Commit your own work.** Every commit must use the Husky workaround
\`git -c core.hooksPath=.husky/_ commit\` (the sandbox can't spawn
\`.husky/pre-commit\` directly). Every commit must include the
\`Co-Authored-By: Claude <noreply@anthropic.com>\` trailer so the audit
trail credits the AI for the work. Stage with \`git add\` (no
\`--no-verify\`, no skipped hooks).

**Do NOT run \`git push\`, \`gh pr create\`, \`gh pr edit\`, or any
other remote-mutating git/gh command — via Bash or anywhere else.**
The orchestrator owns those:

- After your run ends — success OR failure — it pushes the worktree
  HEAD to \`origin/<worktree_branch>\` so nothing strands on disk.
- On a clean exit (run status \`completed\`), when your agent row has
  \`raises_pr = true\`, it opens a pull request against the project's
  default branch (typically \`main\`). The PR URL is written to
  \`items.pr_url\` automatically; you do not need to mention it in a
  comment.
- The orchestrator uses the API server's stored GitHub credential
  (HTTPS \`http.extraheader\`) — no token is exposed to your shell.

Local reads are fine: \`git status\`, \`git diff\`, \`git log\`,
\`gh pr view\` (read-only). Anything that mutates origin is the
orchestrator's job. If you find yourself reaching for \`git push\`,
stop and finish committing instead.

## Replying on the ticket

The orchestrator posts a single completion comment composed from the
\`summary\` field of your terminal \`atlas-outcome\` block (see the
**Run Outcome Contract** section below). You do **not** post a
duplicate summary comment via \`mcp__atlas__update_item\` with
\`action: 'add_comment'\` — one auto-post per run keeps the activity log
readable.

Do still post functional / domain-specific comments during your run
when they're consumed downstream (handoff markers, "Spec ready on …"
pointers, "not automated:" roll-ups grepped by the next agent). Those
are not your end-of-run summary; they're tools.

The \`summary\` body should follow this shape:

- **What I did** — concrete actions you took on this run (1–4
  bullets, not prose).
- **What I verified** — checks you ran (tests, link traversals,
  file diffs, comment-thread reads) and what they showed. Empty
  section is fine if nothing applied this run.
- **Open questions / next steps** — empty if your handoff is clean;
  otherwise one bullet per item the next agent or the Owner needs to
  resolve.

Skip this only when there is no item to comment on (project-scope or
freedom-mode runs with no item id) or when an unrecoverable error
fired before you could compose a summary.`;

// P10 — Per-agent self-memory injection.
//
// `buildPrompt` and `buildReviewerPrompt` append the agent's
// `agent_memory.body_md` to the rendered prompt under a
// `## Self-memory (your past course-corrections)` heading. Memory is
// role-scoped self-improvement (the agent's own past course-corrections);
// it is NOT product/project-fact storage (that lives in items + comments).
//
// The cap keeps token cost predictable. The existing regeneration cadence
// (`agent_memory.runs_since_regen`) compacts memory over time; this just
// caps a runaway memory body from inflating every prompt.
//
// Roughly 4 chars ≈ 1 token for English markdown, so 2,000 tokens ≈ 8,000
// chars. Truncation keeps the tail (newer entries) on the assumption that
// `appendLesson` writes to the bottom — see
// `agent-memory.applyAppendLesson`.
const SELF_MEMORY_HEADING = '## Self-memory (your past course-corrections)';
const SELF_MEMORY_TOKEN_CAP = 2000;
// Exported so `prompt-builder.test.ts` can build truncation-trigger
// payloads at exactly the cap. Knip flags it as an unused export
// because its only consumer is a `.test.ts` file; that's a knip
// limitation, not dead code — keep the export.
export const SELF_MEMORY_CHAR_CAP = SELF_MEMORY_TOKEN_CAP * 4;

function truncateMemoryFromTop(body: string): { body: string; truncated: boolean } {
    if (body.length <= SELF_MEMORY_CHAR_CAP) return { body, truncated: false };
    // Keep the tail (newer entries). Slice from the right so the most
    // recent lessons survive. Round the slice to a line boundary so the
    // first surviving line is not a half-sentence.
    const tail = body.slice(body.length - SELF_MEMORY_CHAR_CAP);
    const firstNewline = tail.indexOf('\n');
    const aligned = firstNewline === -1 ? tail : tail.slice(firstNewline + 1);
    return { body: aligned, truncated: true };
}

/**
 * Render an agent's self-memory as a markdown section ready to append to
 * the rendered prompt. Returns an empty string when the agent has no
 * memory row, or when the body is empty/whitespace — buildPrompt callers
 * skip the section entirely in that case so prompts stay small for fresh
 * agents.
 */
export async function renderSelfMemorySection(agentId: string): Promise<string> {
    const row = await db
        .selectFrom('agent_memory')
        .select(['body_md'])
        .where('agent_id', '=', agentId)
        .executeTakeFirst();
    const body = (row?.body_md as string | null) ?? '';
    if (!body.trim()) return '';
    const { body: capped, truncated } = truncateMemoryFromTop(body);
    const trailer = truncated
        ? '\n\n_(truncated — older entries dropped to fit the prompt budget.)_'
        : '';
    return `${SELF_MEMORY_HEADING}\n\n${capped.trim()}${trailer}`;
}

/**
 * Render the **run outcome contract** as a markdown section appended to
 * every dispatched agent's prompt regardless of role. There is no
 * separate performer / reviewer surface — both shapes are unified into a
 * single fenced `atlas-outcome` block that the orchestrator parses out
 * of the agent's CLI output after the run ends.
 *
 * Task 12 — the `performer_done` / `submit_review` MCP tools were
 * retired. The agent no longer calls back with its own run id (which
 * was hallucinable from the prompt's activity log). Instead the agent's
 * final fenced block is the single source of truth for the outcome,
 * and the orchestrator — which already knows the run id from dispatch —
 * persists it, posts the formatted comment, and applies the right
 * handoff.
 *
 * When the agent has any `agent_checklists` rows the section lists
 * them with their numeric ids so the agent can report per-row
 * `passed` / `evidence`. With no checklist rows the section still
 * renders (every agent must signal an outcome).
 */
export async function renderRunOutcomeContract(agentId: string): Promise<string> {
    const rows = await db
        .selectFrom('agent_checklists')
        .select(['id', 'label', 'required', 'sort_order'])
        .where('agent_id', '=', agentId)
        .orderBy('sort_order', 'asc')
        .execute();
    const lines: string[] = [
        '# Run Outcome Contract',
        '',
        'The orchestrator reads the **last** fenced ```atlas-outcome``` block in your output to decide what happens next. Nothing else in your output is read for routing — comments, tool calls, prose, intermediate logs are all ignored by the routing layer. Emit exactly one block, as the very last thing in your output.',
        '',
        '## Outcomes',
        '',
        '- `done` — your work this round is complete; the orchestrator applies your **on-pass** handoff (next agent in the chain).',
        '- `rejected` — you are explicitly bouncing the work back; the orchestrator applies your **on-fail** handoff (typically back to the prior agent). Provide `reason`.',
        '- `asked_question` — you cannot proceed without Owner input; the orchestrator parks the item in `waiting_for_info`. Provide `reason`.',
        '',
        '## Block format',
        '',
        '````',
        '```atlas-outcome',
        'outcome: done',
        'summary: |',
        '  Short multi-line description of what you did this round.',
        '  Markdown OK. The orchestrator posts this verbatim as a comment.',
        'reason: |',
        '  (only required for rejected / asked_question)',
        'checklist:',
        '  - id: 1',
        '    passed: true',
        '    evidence: "one-line proof, optional"',
        '  - id: 2',
        '    passed: false',
        '    evidence: "what was missing"',
        '```',
        '````',
        '',
    ];

    if (rows.length > 0) {
        lines.push(
            '## Your checklist (report one entry per row, by numeric id)',
            '',
        );
        for (const row of rows) {
            const tag = row.required ? '(required)' : '(optional)';
            lines.push(`- ${tag} [id: ${row.id}] ${row.label}`);
        }
        lines.push(
            '',
            '**Strict mode.** If you emit `outcome: done` and any **required** row is either missing from `checklist` or reports `passed: false`, the orchestrator treats your run as a checklist failure and applies the **on-fail** handoff instead (typically back to the prior agent with the failed labels named).',
            '',
        );
    } else {
        lines.push(
            'This agent has no required checklist rows; you can omit `checklist` entirely or pass an empty list.',
            '',
        );
    }

    lines.push(
        '## Reminders',
        '',
        '- The block is plain YAML inside the fence — no JSON, no surrounding prose, no leading/trailing whitespace inside `outcome:`.',
        '- `summary` is what the Owner reads. Keep it specific to this run.',
        '- The orchestrator persists the parsed outcome on the run row and auto-posts a comment composed from it; you do not need to post an extra summary comment yourself.',
    );

    return lines.join('\n');
}

export function buildConstitutionMarkdown(
    rules: IGuardrailRule[],
    projectArticles: IProjectGuardrail[] = [],
): string {
    const lines: string[] = ['# Atlas Constitution (System Rules — read first)'];
    for (const category of GUARDRAIL_CATEGORIES) {
        const inCategory = rules
            .filter((r) => r.category === category)
            .sort(
                (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
            );
        if (inCategory.length === 0) continue;
        lines.push('', `## ${GUARDRAIL_CATEGORY_META[category].label}`);
        for (const rule of inCategory) {
            const sev = GUARDRAIL_SEVERITY_META[rule.severity].label;
            lines.push(`- [${sev}] ${rule.rule_text}${rule.detail ? `  \n  ${rule.detail}` : ''}`);
        }
    }
    const enabledProjectArticles = projectArticles
        .filter((a) => a.enabled !== 0)
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    if (enabledProjectArticles.length > 0) {
        lines.push('', '## Project-Specific Rules');
        for (const article of enabledProjectArticles) {
            const body = article.body_md.trim();
            const bodyLines = body
                ? body.split('\n').map((l) => `  ${l}`).join('\n')
                : '';
            lines.push(`- **${article.title}**${body ? `  \n${bodyLines}` : ''}`);
        }
    }
    lines.push('', FORBIDDEN_TOOLS_SECTION);
    return lines.join('\n');
}

// Compile the linked-items context the agent will need ahead of time. The
// orchestrator owns this — agents don't have to fetch links via MCP at
// runtime; all information they need is baked into the prompt prior to
// dispatch. depends_on shows outgoing-only (items
// THIS task waits on); relates_to shows both directions because the
// relation is undirected.
//
// B04 — the `Depends on` subsection now also bakes in each dep's
// description + acceptance_criteria so the agent can plan against the dep
// without having to MCP-fetch it mid-run. `Blocks` and `Relates to` stay
// shallow on purpose: they're context, not actionable content, and inlining
// every related-item body would bloat the prompt without helping the agent.
// spec_md is intentionally NOT inlined either — it's the long-form design
// doc; the agent can call `getItemFull` if it really needs it.
export async function buildLinkedItemsSection(itemId: string): Promise<string> {
    const links = await itemLinks.list(itemId);
    if (links.length === 0) return '';

    const dependsOnUpstream = links.filter(
        (l) => l.relation_type === 'depends_on' && l.direction === 'outgoing',
    );
    const dependsOnDownstream = links.filter(
        (l) => l.relation_type === 'depends_on' && l.direction === 'incoming',
    );
    const relatesTo = links.filter((l) => l.relation_type === 'relates_to');

    // Pull description + acceptance_criteria for every dep we'll render in
    // the `Depends on` section. One query covers all deps; we partition on
    // item id afterward. Skipped when there are no upstream deps.
    const depDetailsById = new Map<string, { description: string | null; acceptance_criteria: string | null }>();
    if (dependsOnUpstream.length > 0) {
        const ids = dependsOnUpstream.map((l) => l.item_id);
        const rows = await db
            .selectFrom('items')
            .select(['id', 'description', 'acceptance_criteria'])
            .where('id', 'in', ids)
            .execute();
        for (const r of rows) {
            depDetailsById.set(r.id as string, {
                description: (r.description as string | null) ?? null,
                acceptance_criteria: (r.acceptance_criteria as string | null) ?? null,
            });
        }
    }

    function renderAcceptanceCriteria(ac: string | null): string[] {
        if (!ac || !ac.trim()) return [];
        // ACs are author-written as multiline markdown — typically dash- or
        // bullet-led. Render each non-empty line under a bold `Acceptance
        // criteria:` label so the agent reads them as discrete items rather
        // than one blob. If the input is a single line, that becomes one row.
        const items = ac
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        // reason: unreachable — the guard above already returns early when
        // `ac.trim()` is falsy, so if we get here `ac` has at least one
        // non-whitespace char, which guarantees at least one non-empty
        // trimmed line survives the filter above.
        /* v8 ignore next */
        if (items.length === 0) return [];
        const out: string[] = ['  Acceptance criteria:'];
        for (const item of items) {
            // Strip the author's bullet marker if present so we own the
            // indentation and the agent sees a consistent shape.
            const clean = item.replace(/^[-*]\s+/, '');
            out.push(`  - ${clean}`);
        }
        return out;
    }

    const lines: string[] = ['## Related items'];

    if (dependsOnUpstream.length > 0) {
        lines.push('', '### Depends on (these must reach `done` before this task can ship)');
        for (const l of dependsOnUpstream) {
            lines.push(`- \`${l.short_id}\` (status: ${l.status}) — ${l.title}`);
            const detail = depDetailsById.get(l.item_id);
            // reason: `itemLinks.list` inner-joins on `items`, so every id in
            // `dependsOnUpstream` is guaranteed to exist at query time, and
            // `depDetailsById` is built from a `where id in (...ids)` query
            // over those same ids — `detail` is always defined barring a
            // delete racing between the two queries (untestable without
            // mocking `db`).
            /* v8 ignore next */
            if (detail) {
                const desc = (detail.description ?? '').trim();
                if (desc) lines.push(`  Description: ${desc}`);
                lines.push(...renderAcceptanceCriteria(detail.acceptance_criteria));
            }
        }
    }
    if (dependsOnDownstream.length > 0) {
        lines.push('', '### Blocks (items that wait on this task to reach `done`)');
        for (const l of dependsOnDownstream) {
            lines.push(`- \`${l.short_id}\` (status: ${l.status}) — ${l.title}`);
        }
    }
    if (relatesTo.length > 0) {
        lines.push('', '### Relates to (context only — no blocking semantics)');
        for (const l of relatesTo) {
            lines.push(`- \`${l.short_id}\` (status: ${l.status}) — ${l.title}`);
        }
    }
    return lines.join('\n');
}

export interface BuildPromptInput {
    agent: IAgent;
    issueType: IssueType | null;
    issueId: string | null;
    /** Theme 09b — project-scope runs. Mutually exclusive with
     *  `issueId` in practice; the prompt-builder selects the third
     *  preamble shape when set with no item. */
    projectId?: string | null;
    constitutionMd: string;
    /** When true, the rendered prompt skips the constitution section.
     *  Plan E / run-artefact split: the agent runner writes the
     *  constitution to its own `MANDATE_CONSTITUTION.md` file in the
     *  worktree and passes a short CLI prompt that asks the agent to
     *  read both files. Skipping the constitution here keeps `WORK.md`
     *  focused on the role-specific instructions + item context. */
    omitConstitution?: boolean;
    /** Migration 025 — human co-authorship. When both are set, the
     *  prompt-builder appends a section instructing the agent to add
     *  `--trailer "Co-Authored-By: <humanName> <humanEmail>"` on every
     *  `git commit`. Populated by agent-runner from `buildGitAuth`. */
    humanName?: string | null | undefined;
    humanEmail?: string | null | undefined;
}

export async function buildPrompt(input: BuildPromptInput): Promise<string> {
    const {
        agent,
        issueType,
        issueId,
        projectId = null,
        constitutionMd: rawConstitution,
        omitConstitution = false,
        humanName = null,
        humanEmail = null,
    } = input;
    const constitutionMd = omitConstitution ? '' : rawConstitution;
    const humanAttrSection = buildHumanAttributionSection(humanName, humanEmail);

    // Theme 09b — project-scope run path. Reached when the agent
    // operates on a project (not an item) — e.g., the AI-Readiness
    // Agent. Renders a project preamble (name + description +
    // guardrails_md + epic list) so the agent has full PRD context
    // without an item to anchor to.
    if (!issueType && !issueId && projectId) {
        const project = await db
            .selectFrom('projects')
            .select(['id', 'name', 'description', 'guardrails_md', 'git_path'])
            .where('id', '=', projectId)
            .executeTakeFirst();
        if (!project) throw new Error(`Project ${projectId} not found`);
        const epics = await db
            .selectFrom('items')
            .select(['id', 'title', 'description', 'spec_md'])
            .where('project_id', '=', projectId)
            .where('type', '=', 'epic')
            .orderBy('created_at', 'asc')
            .execute();

        const sections: string[] = [];
        if (constitutionMd.trim()) {
            sections.push(constitutionMd.trim());
        }
        if (agent.prompt_md.trim()) {
            const role = applyAgentSettingsSubstitution(
                agent.prompt_md.trim(),
                (agent as IAgent).settings_json,
            );
            sections.push(`# Your Role\n\n${role}`);
        }
        const outcomeContract = await renderRunOutcomeContract(agent.id);
        // reason: renderRunOutcomeContract always starts its `lines` array
        // with a non-empty literal and joins with '\n', so it can never
        // return ''; the falsy arm is unreachable defensively.
        /* v8 ignore next */
        if (outcomeContract) sections.push(outcomeContract);
        // reason: `projects.git_path` / `description` / `guardrails_md` are
        // DB-level `NOT NULL DEFAULT ''` columns (see
        // migrations/001_baseline.sql), so the `??` fallbacks below can
        // never fire through a real query; they're defensive against the
        // column ever becoming nullable.
        /* v8 ignore next */
        const gitPath = project.git_path ?? '(unknown)';
        /* v8 ignore next */
        const projectDescription = (project.description ?? '').trim() || '_(no description set)_';
        const ctxLines: string[] = [
            `# Project Context`,
            ``,
            `**Project id:** ${project.id}`,
            `**Project name:** ${project.name}`,
            `**Repo path (your cwd):** ${gitPath}`,
            ``,
            `## Description`,
            projectDescription,
        ];
        /* v8 ignore next */
        if ((project.guardrails_md ?? '').trim()) {
            ctxLines.push('', `## Project guardrails`, project.guardrails_md.trim());
        }
        if (epics.length > 0) {
            ctxLines.push('', `## Epics under this project (additional PRD context)`);
            for (const e of epics) {
                ctxLines.push('', `### ${e.title} (${e.id})`);
                ctxLines.push((e.description ?? '').trim() || '_(no description)_');
                if ((e.spec_md ?? '').trim()) {
                    // reason: unreachable — entering this block already
                    // required `(e.spec_md ?? '').trim()` to be truthy,
                    // which is impossible when e.spec_md is null/undefined
                    // (that yields ''.trim() === ''), so e.spec_md is
                    // guaranteed non-null here and the `?? ''` never fires.
                    /* v8 ignore next */
                    ctxLines.push('', '_Spec:_', e.spec_md ?? '');
                }
            }
        } else {
            ctxLines.push('', `## Epics under this project`, '_(none yet)_');
        }
        sections.push(ctxLines.join('\n'));
        sections.push(
            `# Working Protocol\n\nFollow the protocol in your role prompt above exactly. Your run output is the transcript; the artifact you produce (e.g., a PR) is what the Owner reviews.`,
        );
        sections.push(COMMIT_DISCIPLINE_PROMPT_SECTION);
        if (humanAttrSection) sections.push(humanAttrSection);
        sections.push(
            `# Output Instructions\n\nProvide your complete summary at the end: what you detected, what you produced (file list / branch name / PR URL), and any follow-up the Owner needs to take.`,
        );
        // P10 — self-memory always lands at the bottom; the role prompt
        // tells the agent it lives there.
        const memSection = await renderSelfMemorySection(agent.id);
        if (memSection) sections.push(memSection);
        return sections.join('\n\n---\n\n');
    }

    // Theme 06: freedom-mode runs have no item. Build a short preamble that
    // names the agent + designation and notes the run is item-less. Skip
    // every issue-specific block (current task, discussion, related items).
    if (!issueType || !issueId) {
        const sections: string[] = [];
        if (constitutionMd.trim()) {
            sections.push(constitutionMd.trim());
        }
        if (agent.prompt_md.trim()) {
            // Theme 09 — render {{ key }} placeholders against
            // `settings_json` so autonomous-agent prompts can
            // reference their config (sources, competitors, etc.).
            const role = applyAgentSettingsSubstitution(
                agent.prompt_md.trim(),
                (agent as IAgent).settings_json,
            );
            sections.push(`# Your Role\n\n${role}`);
        }
        const outcomeContract = await renderRunOutcomeContract(agent.id);
        // reason: renderRunOutcomeContract always starts its `lines` array
        // with a non-empty literal and joins with '\n', so it can never
        // return ''; the falsy arm is unreachable defensively.
        /* v8 ignore next */
        if (outcomeContract) sections.push(outcomeContract);
        sections.push(
            `# Freedom Run\n\n` +
                `This is a scheduled run with no item attached. You were dispatched ` +
                `by the cron scheduler because your \`requires_item\` flag is off. Use ` +
                `your role prompt above to decide what to produce; results go into ` +
                `the run output and any side effects (comments, notifications, etc.) ` +
                `are at your discretion via the MCP tools your agent record grants.`,
        );
        sections.push(
            `# Output Instructions\n\n` +
                `Provide your complete response for this run. Be specific and actionable.`,
        );
        // P10 — self-memory at the bottom of freedom-run prompts too. Even
        // though the role-prompt clause skips freedom agents from drafting
        // new memory (no item to anchor against), they can still benefit
        // from reading their past course-corrections.
        const memSection = await renderSelfMemorySection(agent.id);
        if (memSection) sections.push(memSection);
        return sections.join('\n\n---\n\n');
    }

    const ctx = await getIssueContext(issueType, issueId);
    if (!ctx) throw new Error(`Issue ${issueType}/${issueId} not found`);

    const sections: string[] = [];

    if (constitutionMd.trim()) {
        sections.push(constitutionMd.trim());
    }

    if (agent.prompt_md.trim()) {
        const role = applyAgentSettingsSubstitution(
            agent.prompt_md.trim(),
            (agent as IAgent).settings_json,
        );
        sections.push(`# Your Role\n\n${role}`);
    }

    const outcomeContract = await renderRunOutcomeContract(agent.id);
    // reason: renderRunOutcomeContract always starts its `lines` array with
    // a non-empty literal and joins with '\n', so it can never return '';
    // the falsy arm is unreachable defensively.
    /* v8 ignore next */
    if (outcomeContract) sections.push(outcomeContract);

    const contextLines: string[] = [
        `# Current Task\n`,
        `**Issue type:** ${issueType}`,
        `**Issue ID:** ${issueId}`,
    ];

    if (ctx.projectName) contextLines.push(`**Project:** ${ctx.projectName}`);
    if (ctx.epicTitle) contextLines.push(`**Epic:** ${ctx.epicTitle}`);
    if (ctx.epicDescription) contextLines.push(`**Epic description:** ${ctx.epicDescription}`);

    contextLines.push(
        '',
        `## Title`,
        ctx.title,
        '',
        `## Description (starting point — may be vague / incomplete on purpose)`,
        ctx.description || '_(none)_',
    );

    if (ctx.spec_md) {
        contextLines.push('', `## Existing Spec`, ctx.spec_md);
    }

    contextLines.push(
        '',
        `## Discussion (chronological — newer comments override older ones)`,
        formatComments(ctx.comments),
    );

    const linkedSection = await buildLinkedItemsSection(issueId);
    if (linkedSection) {
        contextLines.push('', linkedSection);
    }

    sections.push(contextLines.join('\n'));

    // System directive applied to every agent run. The owner's working model
    // is "description is the seed, comments are how the spec actually evolves",
    // and they want visibility into runs without tailing logs.
    sections.push(
        [
            `# Working Protocol (applies to every run)`,
            ``,
            `1. **Read the Discussion section above carefully.** The Description is just the seed; the Owner refines, clarifies, and corrects through comments. **When the description and a later comment disagree, the latest comment wins.** Treat the chronological comment thread as the authoritative source of truth.`,
            `2. **The orchestrator posts a single completion comment on this item after your run ends**, composed from the \`summary\` field of your terminal \`atlas-outcome\` block. **Do NOT post starting or closing comments yourself.** One persona = one auto-comment; agent-authored comments on top would just create noise. Focus on the work; the orchestrator owns the audit trail.`,
            `3. **Comment only to ask the Owner a question** you genuinely need an answer to before you can proceed. If you do, use \`addCommentToItem\` with \`author: 'agent'\` and your own \`agent_id\`; phrase it as a numbered list ("Answer Q1 first; I'll work down after each answer.") and exit without doing further work. The orchestrator will still post your completion comment.`,
            `4. Never assume; if the comments do not give you enough to proceed, ask via step 3 and exit — do not invent answers.`,
            // A06 — end-of-run memory draft. Optional, gated by the boundary
            // rule already embedded in the `updateAgentMemory` tool description.
            // Most runs skip it; the cadence regenerator is the safety net.
            `5. **End-of-run memory draft (optional).** If during this run you noticed a *generic behavioral lesson* about how you should approach future similar work — a process correction, an anti-pattern, an escalation trigger that would be true *regardless of which item or project hit this code path* — call \`updateAgentMemory\` with \`mode: 'append'\` and a single bullet (≤ 240 chars). Skip this for most runs; it should fire only when the lesson is reusable. **Examples** — ✅ "When AC is empty, escalate to Owner before drafting." ❌ "Story story_abc123 was about refunds" (project-specific facts belong in the item, not memory).`,
        ].join('\n'),
    );

    // Theme 11 — commit discipline. Issue-attached runs get the
    // commit-rule section; freedom runs do not (they don't typically
    // touch the repo and the verifier skips them).
    sections.push(COMMIT_DISCIPLINE_PROMPT_SECTION);
    if (humanAttrSection) sections.push(humanAttrSection);

    sections.push(
        `# Output Instructions\n\nProvide your complete response for this task. Be specific, actionable, and thorough. Your output will be saved and surfaced to the Owner for review.`,
    );

    // P10 — self-memory lands at the bottom of the item-attached prompt
    // too. The role-prompt clause tells the agent to read it once at run
    // start; Working Protocol bullet #5 covers the write-back path.
    const memSection = await renderSelfMemorySection(agent.id);
    if (memSection) sections.push(memSection);

    return sections.join('\n\n---\n\n');
}

// T1 — `buildReviewerPrompt` removed. The reviewer side of each SDLC
// role now lives on its own agent record (`agent-<role>-reviewer`)
// whose `prompt_md` contains the reviewer instructions; the standard
// `buildPrompt` above renders it just like any other agent's prompt.
// The reviewer agent reads the upstream performer's most recent work
// via the item's comment thread (the performer's auto-comment + any
// addCommentToItem calls the performer made during its run).
