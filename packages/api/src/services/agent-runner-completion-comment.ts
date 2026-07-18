import type { IssueType } from '@atlas/shared';

// 2026-06-08 — Two body shapes only:
//
// 1) `buildOrchestratorRunCompletedBody` — the success-path Run-link pin.
//    Posted by the runner once per run on top of the agent's own MCP
//    `What I did / verified / Open questions` structured comment.
//    Pure metadata, no AI content — gives the Owner a one-click jump to
//    the run-detail page from the comment thread.
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
}

export function buildOrchestratorRunCompletedBody(
    input: OrchestratorRunCompletedInput,
): string {
    const { agentId, agentName, runId, issueType } = input;
    const tail = `\nRun: [${shortRunId(runId)}](/agents/${agentId}/runs/${runId})`;
    return `**${agentName}** — orchestrator: run completed on this ${issueType}.${tail}`;
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
