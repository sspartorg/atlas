// Unit tests for worktree-stage.ts (stageCliWorktree).
// All five assembler dependencies are mocked so this is a pure
// coordination-logic test — no real filesystem writes.

import { describe, expect, it, vi, beforeEach } from 'vitest';

// -- Mock every assembler dependency before the module under test loads --

const assembleConstitutionMock = vi.fn().mockResolvedValue({
    constitutionMarkdown: 'constitution body',
});

const assembleTemplatesMock = vi.fn().mockResolvedValue({ templatePaths: [] });

const assembleCommandsMock = vi.fn().mockResolvedValue({});

const writeCurrentTaskMock = vi.fn().mockResolvedValue({
    currentTaskPath: '/worktree/.atlas/current-task.md',
});

const assembleHandoffMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./constitution-assembler.js', () => ({
    assembleConstitution: assembleConstitutionMock,
}));
vi.mock('./templates-assembler.js', () => ({
    assembleTemplates: assembleTemplatesMock,
}));
vi.mock('./commands-assembler.js', () => ({
    assembleCommands: assembleCommandsMock,
}));
vi.mock('./current-task-writer.js', () => ({
    writeCurrentTask: writeCurrentTaskMock,
}));
vi.mock('./handoff-assembler.js', () => ({
    assembleHandoff: assembleHandoffMock,
}));

const { stageCliWorktree } = await import('./worktree-stage.js');

const WORKTREE = '/test/worktree';
const PROJECT_ID = 'proj-123';

describe('stageCliWorktree', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        assembleConstitutionMock.mockResolvedValue({ constitutionMarkdown: 'constitution body' });
        assembleCommandsMock.mockResolvedValue({});
        writeCurrentTaskMock.mockResolvedValue({
            currentTaskPath: `${WORKTREE}/.atlas/current-task.md`,
        });
    });

    it('calls all mandatory assemblers and returns constitutionMarkdown', async () => {
        const result = await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
        });

        expect(assembleConstitutionMock).toHaveBeenCalledWith({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
        });
        expect(assembleTemplatesMock).toHaveBeenCalledWith({ worktreePath: WORKTREE });
        expect(assembleCommandsMock).toHaveBeenCalledWith({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
        });
        expect(result.constitutionMarkdown).toBe('constitution body');
        expect(result.currentTaskPath).toBeNull();
        expect(result.copilotUserAgentPath).toBeUndefined();
    });

    it('writes current-task.md when item is provided (hasItem branch)', async () => {
        const result = await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            item: { type: 'story', id: 'story-123' },
        });

        expect(writeCurrentTaskMock).toHaveBeenCalledWith(
            expect.objectContaining({
                worktreePath: WORKTREE,
                issueType: 'story',
                issueId: 'story-123',
            }),
        );
        expect(result.currentTaskPath).toBe(`${WORKTREE}/.atlas/current-task.md`);
    });

    it('writes current-task.md when userPrompt is provided (hasPrompt branch, no item)', async () => {
        // This exercises the `hasPrompt` truthy path AND the `hasItem ? ... : {}` false branch.
        const result = await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            userPrompt: 'please do something useful',
        });

        expect(writeCurrentTaskMock).toHaveBeenCalledWith(
            expect.objectContaining({
                worktreePath: WORKTREE,
                userPrompt: 'please do something useful',
            }),
        );
        // issueType / issueId must NOT be present (hasItem was false).
        const callArg = writeCurrentTaskMock.mock.calls[0]![0] as Record<string, unknown>;
        expect(callArg['issueType']).toBeUndefined();
        expect(callArg['issueId']).toBeUndefined();
        expect(result.currentTaskPath).toBe(`${WORKTREE}/.atlas/current-task.md`);
    });

    it('skips writeCurrentTask when both item and userPrompt are absent', async () => {
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
        });
        expect(writeCurrentTaskMock).not.toHaveBeenCalled();
    });

    it('skips writeCurrentTask when userPrompt is blank (whitespace-only)', async () => {
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            userPrompt: '   ',
        });
        expect(writeCurrentTaskMock).not.toHaveBeenCalled();
    });

    it('assembles handoff when includeHandoff is provided', async () => {
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            includeHandoff: { agentId: 'agent-coder' },
        });

        expect(assembleHandoffMock).toHaveBeenCalledWith({
            worktreePath: WORKTREE,
            agentId: 'agent-coder',
        });
    });

    it('does NOT assemble handoff when includeHandoff is absent', async () => {
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
        });
        expect(assembleHandoffMock).not.toHaveBeenCalled();
    });

    it('passes activeRunCopilotAgent to assembleCommands when provided', async () => {
        const activeRunCopilotAgent = { runId: 'run-xyz', agentId: 'agent-copilot' };
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            activeRunCopilotAgent,
        });

        expect(assembleCommandsMock).toHaveBeenCalledWith({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            activeRunCopilotAgent,
        });
    });

    it('does NOT pass activeRunCopilotAgent to assembleCommands when absent', async () => {
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
        });

        const callArg = assembleCommandsMock.mock.calls[0]![0] as Record<string, unknown>;
        expect(callArg['activeRunCopilotAgent']).toBeUndefined();
    });

    it('surfaces copilotUserAgentPath when assembleCommands returns one', async () => {
        assembleCommandsMock.mockResolvedValue({
            copilotUserAgentPath: '/home/user/.copilot/agents/atlas-run-xyz.md',
        });

        const result = await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            activeRunCopilotAgent: { runId: 'run-xyz', agentId: 'agent-copilot' },
        });

        expect(result.copilotUserAgentPath).toBe(
            '/home/user/.copilot/agents/atlas-run-xyz.md',
        );
    });

    it('omits copilotUserAgentPath from result when assembleCommands returns none', async () => {
        assembleCommandsMock.mockResolvedValue({});

        const result = await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
        });

        expect(result.copilotUserAgentPath).toBeUndefined();
    });
});
