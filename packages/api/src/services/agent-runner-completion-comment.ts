import type { IRunOutcome, IssueType } from '@atlas/shared';

// 2026-06-08 — Two body shapes only:
//
// 1) `buildOrchestratorRunCompletedBody` — the success-path comment: the
//    agent's `atlas-outcome` (result, summary, reason) plus a run link.
//    ADR 0014: this is how one workflow step hears from the previous one —
//    a retried Coder reads the reviewer's rejection reason from the
//    comment thread in `.atlas/current-task.md` — and the constitution
//    tells agents not to post a duplicate summary themselves.
//
// 2) `buildCompletionCommentBody` — the error-path body. The agent
//    crashed before it could emit the `atlas-outcome` block, so its
//    own MCP comment isn't there to read; the runner is the only voice
//    on the item. We surface the crash message so the Owner has something
//    actionable in the activity feed instead of silence.
//
// Pure functions. No DB, no SSE, no side effects.

const ERROR_CAP = 600;

function shortRunId(runId: string): string {
    return runId.length > 8 ? runId.slice(0, 8) : runId;
}

function clip(text: string, cap: number): string {
    if (text.length <= cap) return text;
    return text.slice(0, cap).trimEnd() + '…';
}

export interface OrchestratorRunCompletedInput {
    agentId: string;
    agentName: string;
    runId: string;
    issueType: IssueType;
    /** Parsed `atlas-outcome`; null when the agent emitted none. */
    outcome?: IRunOutcome | null;
}

const OUTCOME_LABEL: Record<IRunOutcome['kind'], string> = {
    done: 'finished',
    rejected: 'sent the work back',
    asked_question: 'needs an answer',
};

const SUMMARY_CAP = 4000;

export function buildOrchestratorRunCompletedBody(
    input: OrchestratorRunCompletedInput,
): string {
    const { agentId, agentName, runId, issueType, outcome } = input;
    const tail = `\nRun: [${shortRunId(runId)}](/agents/${agentId}/runs/${runId})`;
    if (!outcome) {
        return `**${agentName}** — orchestrator: run completed on this ${issueType} without an outcome block.${tail}`;
    }
    const parts = [`**${agentName}** ${OUTCOME_LABEL[outcome.kind]} (\`${outcome.kind}\`).`];
    if (outcome.reason?.trim()) parts.push(`**Reason:** ${clip(outcome.reason.trim(), SUMMARY_CAP)}`);
    if (outcome.summary?.trim()) parts.push(clip(outcome.summary.trim(), SUMMARY_CAP));
    return `${parts.join('\n\n')}\n${tail}`;
}

export interface ErrorCompletionCommentInput {
    agentId: string;
    agentName: string;
    runId: string;
    issueType: IssueType;
    errorMsg: string;
}

export function buildCompletionCommentBody(input: ErrorCompletionCommentInput): string {
    const { agentId, agentName, runId, issueType: _issueType, errorMsg } = input;
    void _issueType;
    const header = `**${agentName}**`;
    const tail = `\nRun: [${shortRunId(runId)}](/agents/${agentId}/runs/${runId})`;
    return `${header} errored: ${clip(errorMsg, ERROR_CAP)}${tail}`;
}
