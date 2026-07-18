// Renders the agent's handoff contract — required checklist + on-pass /
// on-fail routing rules — into `.atlas/handoff.md` per run. The pilot
// PO Writer reads this file, self-verifies, posts its own comment via
// `mcp__atlas__update_item` (`action: 'add_comment'`), and self-routes
// via `update_item` (`action: 'change_status'` + `action: 'assign'`).
// The orchestrator no longer parses YAML out of the agent's stdout for
// migrated agents.
//
// Source of truth stays in the DB tables `agent_checklists` and
// `agent_handoff_rules`. This assembler is purely a renderer that the
// agent reads from disk inside its worktree — same pattern as
// `constitution-assembler.ts`.
//
// 2026-06-12 — Fallback model: both on-pass and on-fail sections are
// always rendered. When a rule exists, the primary 3-step block is
// emitted with a sub-bullet telling the agent to fall back to Owner +
// "Waiting for Info" if the MCP `update_item action='assign'` call errors
// (e.g. the target agent isn't installed). When the rule is missing
// entirely, only the bare "park with Owner + Waiting for Info" fallback
// is emitted. No DB join against `agents` — the renderer trusts the MCP
// layer to surface bad targets at call time.
//
// 2026-07 — Tool consolidation: the old per-action tool names
// (`addCommentToItem`, `transitionItemStatus`, `assignItem`) collapsed
// into a single `update_item` tool keyed by `action`. The handoff
// markdown reflects the new contract; the routing semantics are
// unchanged.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStatusLabel } from '@atlas/shared';
import { db } from '../db/kysely-client.js';

export interface AssembleHandoffInput {
    /** Absolute path to the worktree root. `.atlas/handoff.md` is written here. */
    worktreePath: string;
    /** Agent whose checklist + rules drive the render. */
    agentId: string;
}

export interface AssembleHandoffOutput {
    handoffMarkdown: string;
    handoffPath: string;
}

interface ChecklistRow {
    label: string;
    sort_order: number;
}

interface HandoffRuleRow {
    target_agent_id: string;
    status: string;
}

const FALLBACK_STATUS = 'waiting_for_info';

export async function assembleHandoff(
    input: AssembleHandoffInput,
): Promise<AssembleHandoffOutput> {
    const [checklist, onPass, onFail] = await Promise.all([
        db
            .selectFrom('agent_checklists')
            .select(['label', 'sort_order'])
            .where('agent_id', '=', input.agentId)
            .where('required', '=', true)
            .orderBy('sort_order', 'asc')
            .execute() as Promise<ChecklistRow[]>,
        db
            .selectFrom('agent_handoff_rules')
            .select(['target_agent_id', 'status'])
            .where('agent_id', '=', input.agentId)
            .where('kind', '=', 'on-pass')
            .executeTakeFirst() as Promise<HandoffRuleRow | undefined>,
        db
            .selectFrom('agent_handoff_rules')
            .select(['target_agent_id', 'status'])
            .where('agent_id', '=', input.agentId)
            .where('kind', '=', 'on-fail')
            .executeTakeFirst() as Promise<HandoffRuleRow | undefined>,
    ]);

    const handoffMarkdown = renderHandoffMarkdown(input.agentId, checklist, onPass, onFail);

    const atlasDir = join(input.worktreePath, '.atlas');
    mkdirSync(atlasDir, { recursive: true });
    const handoffPath = join(atlasDir, 'handoff.md');
    writeFileSync(handoffPath, handoffMarkdown, 'utf8');

    return { handoffMarkdown, handoffPath };
}

function renderHandoffMarkdown(
    agentId: string,
    checklist: ChecklistRow[],
    onPass: HandoffRuleRow | undefined,
    onFail: HandoffRuleRow | undefined,
): string {
    const lines: string[] = [];
    lines.push(`# Handoff contract — ${agentId}`);
    lines.push('');
    lines.push(
        'You are responsible for completing the work AND for routing the item when you finish. ' +
            'The orchestrator does NOT parse your stdout for routing decisions — you must call MCP tools ' +
            'to post your comment and update the item. If a routing rule is missing or the target agent ' +
            'cannot be assigned, follow the fallback steps below — park the item with the Owner so it ' +
            'never goes silent.',
    );
    lines.push('');

    if (checklist.length > 0) {
        lines.push('## Required checklist');
        lines.push('');
        checklist.forEach((row, i) => {
            lines.push(`${i + 1}. ${row.label}`);
        });
        lines.push('');
    }

    lines.push('## When all required items pass');
    lines.push('');
    renderRoutingBlock(lines, 'on-pass', onPass);
    lines.push('');

    lines.push('## When any required item fails');
    lines.push('');
    renderRoutingBlock(lines, 'on-fail', onFail);
    lines.push('');

    lines.push('## Run output to the orchestrator');
    lines.push('');
    lines.push(
        'Your stdout should be a one-paragraph prose summary of what you did. ' +
            'Do NOT emit a fenced YAML block, do NOT emit JSON, do NOT emit a structured outcome. ' +
            'The orchestrator only logs your prose for the run-detail view; routing is whatever the MCP calls above did.',
    );
    lines.push('');

    lines.push('## Example comment body');
    lines.push('');
    lines.push(
        "Use this skeleton as the `body` of your single `update_item` call with `action: 'add_comment'`. " +
            'Headings are mandatory, in this order. Use `[PASS]` / `[FAIL]` verbatim — one bullet per checklist row.',
    );
    lines.push('');
    lines.push('    ## Summary');
    lines.push('    <1–2 sentences of what you did or verified.>');
    lines.push('');
    lines.push('    ## Checklist verdict');
    lines.push('    - [PASS] <row label> — <evidence>');
    lines.push('    - [FAIL] <row label> — <evidence>');
    lines.push('');
    lines.push('    ## Artifacts');
    lines.push('    - spec: specs/42-foo/spec.md');
    lines.push('    - PR: https://github.com/.../pull/123');
    lines.push('');
    lines.push('    ## Next');
    lines.push(
        '    <On pass: "Handing off to <next-agent>." On fail: "Parked — <fix needed>.">',
    );
    lines.push('');

    return lines.join('\n');
}

function renderRoutingBlock(
    lines: string[],
    kind: 'on-pass' | 'on-fail',
    rule: HandoffRuleRow | undefined,
): void {
    const fallbackStatusLabel = getStatusLabel(FALLBACK_STATUS as never);
    const commentVerb =
        kind === 'on-pass'
            ? 'a structured summary: what you did, what you verified, and a per-item verdict line for each checklist row with one-line evidence.'
            : 'an explanation of which items failed, the evidence for each failure, and what the next actor needs to fix.';

    if (rule) {
        const ruleLabel = getStatusLabel(rule.status as never);
        lines.push(
            `1. Call \`mcp__atlas__update_item\` with \`action: 'add_comment'\` on this item with ${commentVerb}`,
        );
        lines.push(
            `2. Call \`mcp__atlas__update_item\` with \`action: 'change_status'\` and status EXACTLY: "${ruleLabel}".`,
        );
        lines.push(
            `   The literal string above is what you pass to the API. Do NOT substitute any other status name — only "${ruleLabel}" routes this item correctly.`,
        );
        lines.push(
            `3. Call \`mcp__atlas__update_item\` with \`action: 'assign'\` and assignee_agent_id: ${renderAssignee(rule.target_agent_id)}.`,
        );
        lines.push('');
        lines.push(
            `   **Fallback if step 3 errors** (e.g. the target agent is not installed): ` +
                `call \`mcp__atlas__update_item\` (\`action: 'assign'\`) with assignee_agent_id: null, ` +
                `then \`mcp__atlas__update_item\` (\`action: 'change_status'\`) with status EXACTLY: "${fallbackStatusLabel}", ` +
                `then \`mcp__atlas__update_item\` (\`action: 'add_comment'\`) explaining: unable to assign to ${renderAssignee(rule.target_agent_id)}, parked with Owner.`,
        );
    } else {
        const reason =
            kind === 'on-pass'
                ? 'No on-pass routing rule is configured for this agent. Park the item with the Owner:'
                : 'No on-fail routing rule is configured for this agent. Park the item with the Owner:';
        lines.push(reason);
        lines.push('');
        lines.push(
            `1. Call \`mcp__atlas__update_item\` (\`action: 'add_comment'\`) with ${commentVerb}`,
        );
        lines.push(
            `2. Call \`mcp__atlas__update_item\` (\`action: 'assign'\`) with assignee_agent_id: null.`,
        );
        lines.push(
            `3. Call \`mcp__atlas__update_item\` (\`action: 'change_status'\`) with status EXACTLY: "${fallbackStatusLabel}".`,
        );
    }
}

function renderAssignee(targetAgentId: string): string {
    // `'owner'` is the sentinel in agent_handoff_rules that means "park
    // with the Owner". The MCP `update_item action='assign'` tool accepts
    // `null` as `assignee_agent_id` to park with the Owner.
    if (targetAgentId === 'owner' || targetAgentId === '') return 'null';
    return `"${targetAgentId}"`;
}
