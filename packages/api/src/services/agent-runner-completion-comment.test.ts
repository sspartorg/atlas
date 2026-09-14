import { describe, expect, it } from 'vitest';
import {
    buildCompletionCommentBody,
    buildOrchestratorRunCompletedBody,
} from './agent-runner-completion-comment.js';

// 2026-06-08 — Two body shapes only:
//   * `buildOrchestratorRunCompletedBody` is the success-path Run-link pin.
//   * `buildCompletionCommentBody` is the error-path body (`errorRun`).
// The old done / rejected / asked_question / no-signal branches are gone;
// the agent's own MCP-posted structured comment is now the authoritative
// success-path comment.

describe('buildOrchestratorRunCompletedBody', () => {
    it('carries a rejection reason and summary so the next workflow step can act on it', () => {
        const body = buildOrchestratorRunCompletedBody({
            agentId: 'agent-code-reviewer',
            agentName: 'Code Reviewer',
            runId: 'c641589b-8f12-4f11-b79f-130225e0eeb6',
            issueType: 'story',
            outcome: { kind: 'rejected', reason: 'No test covers `todo done 99`.', summary: 'Walked the checklist.' },
        });
        expect(body).toBe(
            '**Code Reviewer** sent the work back (`rejected`).\n\n' +
                '**Reason:** No test covers `todo done 99`.\n\n' +
                'Walked the checklist.\n\n' +
                'Run: [c641589b](/agents/agent-code-reviewer/runs/c641589b-8f12-4f11-b79f-130225e0eeb6)',
        );
    });

    it('says so when the agent emitted no outcome block', () => {
        const body = buildOrchestratorRunCompletedBody({
            agentId: 'agent-coder',
            agentName: 'Coder',
            runId: 'r1',
            issueType: 'story',
            outcome: null,
        });
        expect(body).toBe('**Coder** — orchestrator: run completed on this story without an outcome block.\nRun: [r1](/agents/agent-coder/runs/r1)');
    });

    it('names the agent, the outcome, its summary, and the run id', () => {
        const body = buildOrchestratorRunCompletedBody({
            agentId: 'agent-po-reviewer',
            agentName: 'PO Reviewer',
            runId: 'c641589b-8f12-4f11-b79f-130225e0eeb6',
            issueType: 'epic',
            outcome: { kind: 'done', summary: 'Split the epic into 3 stories.' },
        });
        expect(body).toBe(
            '**PO Reviewer** finished (`done`).\n\n' +
                'Split the epic into 3 stories.\n\n' +
                'Run: [c641589b](/agents/agent-po-reviewer/runs/c641589b-8f12-4f11-b79f-130225e0eeb6)',
        );
    });

    it('short run ids (under 8 chars) pass through verbatim', () => {
        const body = buildOrchestratorRunCompletedBody({
            agentId: 'agent-architect',
            agentName: 'Architect',
            runId: 'r1',
            issueType: 'story',
        });
        expect(body).toContain('Run: [r1](/agents/agent-architect/runs/r1)');
    });

});

describe('buildCompletionCommentBody (error path)', () => {
    it('surfaces the crash message and the run link', () => {
        const body = buildCompletionCommentBody({
            agentId: 'agent-coder',
            agentName: 'Coder',
            runId: '340e4984-1f99-44a0-8d17-1d62ad560fe4',
            issueType: 'story',
            errorMsg: 'Failed to spawn copilot: spawn ENAMETOOLONG',
        });
        expect(body).toContain('**Coder** errored:');
        expect(body).toContain('Failed to spawn copilot: spawn ENAMETOOLONG');
        expect(body).toContain(
            'Run: [340e4984](/agents/agent-coder/runs/340e4984-1f99-44a0-8d17-1d62ad560fe4)',
        );
    });

    it('clips very long error messages to keep comments scannable', () => {
        const longErr = 'b'.repeat(2000);
        const body = buildCompletionCommentBody({
            agentId: 'agent-coder',
            agentName: 'Coder',
            runId: 'r-err-clip',
            issueType: 'story',
            errorMsg: longErr,
        });
        expect(body).toContain('…');
        expect(body.length).toBeLessThan(longErr.length);
    });
});
