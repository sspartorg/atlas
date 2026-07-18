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
    it('names the agent, the item kind, and the run id', () => {
        const body = buildOrchestratorRunCompletedBody({
            agentId: 'agent-po-reviewer',
            agentName: 'PO Reviewer',
            runId: 'c641589b-8f12-4f11-b79f-130225e0eeb6',
            issueType: 'epic',
        });
        expect(body).toBe(
            '**PO Reviewer** — orchestrator: run completed on this epic.\n' +
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

    it('does not include any "completed work" phrasing or AI summary content', () => {
        const body = buildOrchestratorRunCompletedBody({
            agentId: 'agent-architect',
            agentName: 'Architect',
            runId: 'r2',
            issueType: 'story',
        });
        expect(body).not.toContain('completed work on');
        expect(body).not.toMatch(/What I (did|verified)/);
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
