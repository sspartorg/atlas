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

const renderOutcomeMock = vi.fn().mockResolvedValue('# Run Outcome Contract');
const renderMemoryMock = vi.fn().mockResolvedValue('');
const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const assembleProbesMock = vi.fn(() => []);

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
vi.mock('./probes-assembler.js', () => ({
    assembleProbes: assembleProbesMock,
}));
vi.mock('./prompt-builder.js', () => ({
    renderRunOutcomeContract: renderOutcomeMock,
    renderSelfMemorySection: renderMemoryMock,
}));
vi.mock('node:fs', () => ({
    writeFileSync: writeFileSyncMock,
    mkdirSync: mkdirSyncMock,
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
        // Unconditional: gate-perf and gate-visual fall through to these when
        // the project declares no perf or visual tooling of its own.
        expect(assembleProbesMock).toHaveBeenCalledWith(WORKTREE);
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

    it('writes outcome.md and self-memory.md when includeOutcome is provided', async () => {
        renderMemoryMock.mockResolvedValueOnce('## Self-memory\n\n- prefer small commits');
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            includeOutcome: { agentId: 'agent-coder' },
        });

        expect(renderOutcomeMock).toHaveBeenCalledWith('agent-coder');
        expect(writeFileSyncMock).toHaveBeenCalledWith(
            `${WORKTREE}/.atlas/outcome.md`,
            '# Run Outcome Contract\n',
            'utf8',
        );
        expect(writeFileSyncMock).toHaveBeenCalledWith(
            `${WORKTREE}/.atlas/self-memory.md`,
            '## Self-memory\n\n- prefer small commits\n',
            'utf8',
        );
    });

    it('writes a placeholder self-memory.md for an agent with no memory yet', async () => {
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
            includeOutcome: { agentId: 'agent-coder' },
        });
        expect(writeFileSyncMock).toHaveBeenCalledWith(
            `${WORKTREE}/.atlas/self-memory.md`,
            '# Self-memory\n\n_No entries yet._\n',
            'utf8',
        );
    });

    it('writes no outcome files when includeOutcome is absent (terminal sessions)', async () => {
        await stageCliWorktree({
            worktreePath: WORKTREE,
            projectId: PROJECT_ID,
        });
        expect(renderOutcomeMock).not.toHaveBeenCalled();
        expect(writeFileSyncMock).not.toHaveBeenCalled();
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
