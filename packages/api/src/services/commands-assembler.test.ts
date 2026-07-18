import { describe, expect, it, beforeEach, afterAll, afterEach } from 'vitest';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentIdToSlug, assembleCommands } from './commands-assembler.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertAgent } from '../../tests/_items.js';

let worktreePath: string;
const cleanupDirs: string[] = [];

function makeWorktree(): string {
    const p = mkdtempSync(join(tmpdir(), 'atlas-commands-test-'));
    cleanupDirs.push(p);
    return p;
}

beforeEach(async () => {
    await truncateAll();
    worktreePath = makeWorktree();
});

afterEach(() => {
    while (cleanupDirs.length > 0) {
        const p = cleanupDirs.pop()!;
        try {
            rmSync(p, { recursive: true, force: true });
        } catch {
            // ignore — tmpdir cleanup is best-effort
        }
    }
});

afterAll(async () => {
    await closeTestDb();
});

describe('agentIdToSlug', () => {
    it('strips the agent- prefix', () => {
        expect(agentIdToSlug('agent-architect')).toBe('architect');
        expect(agentIdToSlug('agent-po-writer')).toBe('po-writer');
    });

    it('passes through ids without the agent- prefix', () => {
        expect(agentIdToSlug('custom-id')).toBe('custom-id');
    });

    it('rejects ids that would produce a filesystem-unsafe slug', () => {
        // Batch 3 audit: agent ids come from user-controllable input, so
        // the slug MUST match `^[a-z0-9][a-z0-9-]{0,63}$` to prevent
        // `atlas-${slug}.md` writing outside the worktree. Shapes to
        // reject: empty (produces `atlas-.md`), path separators, `..`,
        // Windows drive letters, uppercase.
        expect(() => agentIdToSlug('')).toThrow(/filesystem-safe slug/);
        expect(() => agentIdToSlug('agent-../hack')).toThrow(/filesystem-safe slug/);
        expect(() => agentIdToSlug('agent-a/b')).toThrow(/filesystem-safe slug/);
        expect(() => agentIdToSlug('agent-C:\\Windows')).toThrow(/filesystem-safe slug/);
        expect(() => agentIdToSlug('agent-UPPER')).toThrow(/filesystem-safe slug/);
    });
});

describe('assembleCommands', () => {
    it('writes each agent body to both .claude/commands/ and .github/prompts/', async () => {
        await insertAgent({
            id: 'agent-architect',
            name: 'Architect',
            prompt_md: '# Architect\n\nDo the thing.',
        });
        await insertAgent({
            id: 'agent-coder',
            name: 'Coder',
            prompt_md: '# Coder\n\nImplement the plan.',
        });

        const result = await assembleCommands({ worktreePath, projectId: null });

        const claudeDir = join(worktreePath, '.claude', 'commands');
        const copilotDir = join(worktreePath, '.github', 'prompts');

        const architectClaude = join(claudeDir, 'atlas-architect.md');
        const architectCopilot = join(copilotDir, 'atlas-architect.prompt.md');
        const coderClaude = join(claudeDir, 'atlas-coder.md');
        const coderCopilot = join(copilotDir, 'atlas-coder.prompt.md');

        expect(existsSync(architectClaude)).toBe(true);
        expect(existsSync(architectCopilot)).toBe(true);
        expect(existsSync(coderClaude)).toBe(true);
        expect(existsSync(coderCopilot)).toBe(true);

        expect(result.claudeCommandPaths).toEqual(
            expect.arrayContaining([architectClaude, coderClaude]),
        );
        expect(result.copilotPromptPaths).toEqual(
            expect.arrayContaining([architectCopilot, coderCopilot]),
        );
    });

    it('prepends the auto-handoff preamble for item-attached agents (requires_item=true)', async () => {
        const promptBody =
            '# Architect\n\nYou are the Architect.\n\nDo: thing one, thing two.\n';
        await insertAgent({
            id: 'agent-architect',
            name: 'Architect',
            prompt_md: promptBody,
            requires_item: true,
        });

        await assembleCommands({ worktreePath, projectId: null });

        const claudePath = join(worktreePath, '.claude', 'commands', 'atlas-architect.md');
        const copilotPath = join(
            worktreePath,
            '.github',
            'prompts',
            'atlas-architect.prompt.md',
        );

        const claudeBody = readFileSync(claudePath, 'utf8');
        const copilotBody = readFileSync(copilotPath, 'utf8');

        // Both surfaces get the same body.
        expect(claudeBody).toBe(copilotBody);

        // Frontmatter present with description line.
        expect(claudeBody.startsWith('---\n')).toBe(true);
        expect(claudeBody).toContain('description: "Atlas SDLC agent — Architect.');
        // Preamble is auto-prepended for item-attached agents.
        expect(claudeBody).toContain('You are agent `agent-architect`.');
        expect(claudeBody).toContain('.atlas/handoff.md');
        // The original prompt body still appears after the preamble.
        expect(claudeBody).toContain(promptBody);
        // Preamble lands BEFORE the prompt body.
        const preambleIdx = claudeBody.indexOf('You are agent `agent-architect`.');
        const promptIdx = claudeBody.indexOf(promptBody);
        expect(preambleIdx).toBeGreaterThan(0);
        expect(promptIdx).toBeGreaterThan(preambleIdx);
    });

    it('skips the preamble for freedom-mode agents (requires_item=false)', async () => {
        const promptBody = '# Scout\n\nFetch the news and digest.';
        await insertAgent({
            id: 'agent-ai-news',
            name: 'AI News Scout',
            prompt_md: promptBody,
            requires_item: false,
        });

        await assembleCommands({ worktreePath, projectId: null });

        const claudePath = join(worktreePath, '.claude', 'commands', 'atlas-ai-news.md');
        const body = readFileSync(claudePath, 'utf8');

        // Frontmatter is still rendered.
        expect(body.startsWith('---\n')).toBe(true);
        // No preamble for freedom-mode agents.
        expect(body).not.toContain('You are agent `agent-ai-news`.');
        expect(body).not.toContain('.atlas/handoff.md');
        // Closing fence sits before the prompt body — verbatim, no prefix.
        const fenceIdx = body.indexOf('---\n\n');
        expect(fenceIdx).toBeGreaterThan(0);
        expect(body.slice(fenceIdx + '---\n\n'.length)).toBe(promptBody);
    });

    it('wipes stale atlas-* commands from prior runs but preserves user-authored files', async () => {
        // Seed the worktree directories first.
        const claudeDir = join(worktreePath, '.claude', 'commands');
        const copilotDir = join(worktreePath, '.github', 'prompts');
        mkdirSync(claudeDir, { recursive: true });
        mkdirSync(copilotDir, { recursive: true });

        // Stale atlas files from a previous run that should be wiped.
        const staleClaude = join(claudeDir, 'atlas-deleted.md');
        const staleCopilot = join(copilotDir, 'atlas-deleted.prompt.md');
        writeFileSync(staleClaude, 'stale claude content', 'utf8');
        writeFileSync(staleCopilot, 'stale copilot content', 'utf8');

        // User-authored files that must survive.
        const userClaude = join(claudeDir, 'user-authored.md');
        const userCopilot = join(copilotDir, 'user-authored.prompt.md');
        writeFileSync(userClaude, 'user claude content', 'utf8');
        writeFileSync(userCopilot, 'user copilot content', 'utf8');

        // Seed an agent so assemble has something to write.
        await insertAgent({
            id: 'agent-architect',
            name: 'Architect',
            prompt_md: '# Architect\n\nbody',
        });

        await assembleCommands({ worktreePath, projectId: null });

        // Stale atlas files are gone.
        expect(existsSync(staleClaude)).toBe(false);
        expect(existsSync(staleCopilot)).toBe(false);

        // User-authored files are preserved.
        expect(existsSync(userClaude)).toBe(true);
        expect(existsSync(userCopilot)).toBe(true);
        expect(readFileSync(userClaude, 'utf8')).toBe('user claude content');
        expect(readFileSync(userCopilot, 'utf8')).toBe('user copilot content');

        // The fresh agent's atlas file was written.
        expect(existsSync(join(claudeDir, 'atlas-architect.md'))).toBe(true);
        expect(existsSync(join(copilotDir, 'atlas-architect.prompt.md'))).toBe(true);
    });

    it('escapes double-quotes in agent name for the YAML description', async () => {
        // renderDescription must escape `"` so the frontmatter YAML
        // stays valid. Without the escape, a name like `Say "hi"` would
        // close the description string early and break the picker.
        await insertAgent({
            id: 'agent-quoter',
            name: 'Say "hello"',
            prompt_md: '# body',
        });

        await assembleCommands({ worktreePath, projectId: null });

        const body = readFileSync(
            join(worktreePath, '.claude', 'commands', 'atlas-quoter.md'),
            'utf8',
        );
        // The frontmatter description contains the escaped form,
        // never the raw double-quote.
        expect(body).toContain('description: "Atlas SDLC agent — Say \\"hello\\".');
        // Sanity: the raw sequence `"hello"` (unescaped) must NOT appear
        // on the description line — that would signal YAML corruption.
        const descLine = body.split('\n').find((l) => l.startsWith('description:'))!;
        expect(descLine).not.toContain('"hello"');
    });

    it('preserves user-authored files that share a name with a not-yet-created atlas agent', async () => {
        // Guards `wipeAtlasFiles` regex against wiping files whose
        // name doesn't match `atlas-*.md` — e.g. `atlas.md` (no
        // hyphen) is user content and must survive.
        const claudeDir = join(worktreePath, '.claude', 'commands');
        mkdirSync(claudeDir, { recursive: true });
        const nonMatch = join(claudeDir, 'atlas.md');
        writeFileSync(nonMatch, 'user content', 'utf8');
        // A file that IS atlas-prefixed with valid pattern must be wiped.
        const stale = join(claudeDir, 'atlas-stale.md');
        writeFileSync(stale, 'stale', 'utf8');

        await insertAgent({
            id: 'agent-architect',
            name: 'Architect',
            prompt_md: '# body',
        });
        await assembleCommands({ worktreePath, projectId: null });
        expect(existsSync(nonMatch)).toBe(true);
        expect(existsSync(stale)).toBe(false);
    });

    it('skips agents whose prompt_md is empty', async () => {
        await insertAgent({
            id: 'agent-architect',
            name: 'Architect',
            prompt_md: '# Architect\n\nbody',
        });
        await insertAgent({
            id: 'agent-empty',
            name: 'Empty',
            prompt_md: '',
        });

        const result = await assembleCommands({ worktreePath, projectId: null });

        const claudeDir = join(worktreePath, '.claude', 'commands');
        const copilotDir = join(worktreePath, '.github', 'prompts');

        // The non-empty agent is written.
        expect(existsSync(join(claudeDir, 'atlas-architect.md'))).toBe(true);
        expect(existsSync(join(copilotDir, 'atlas-architect.prompt.md'))).toBe(true);

        // The empty-prompt agent is skipped.
        expect(existsSync(join(claudeDir, 'atlas-empty.md'))).toBe(false);
        expect(existsSync(join(copilotDir, 'atlas-empty.prompt.md'))).toBe(false);

        expect(result.claudeCommandPaths).toHaveLength(1);
        expect(result.copilotPromptPaths).toHaveLength(1);

        // And no other accidental files landed.
        expect(readdirSync(claudeDir).sort()).toEqual(['atlas-architect.md']);
        expect(readdirSync(copilotDir).sort()).toEqual(['atlas-architect.prompt.md']);
    });

});

describe('assembleCommands — Phase 4 user-level Copilot agent write', () => {
    // Isolate `os.homedir()` to a tmpdir so the tests can't pollute the
    // developer's real ~/.copilot/agents/. `os.homedir()` is non-
    // configurable on the node:os module (vi.spyOn fails with "Cannot
    // redefine property"), but its underlying libuv implementation
    // reads USERPROFILE on Windows and HOME on POSIX — overriding both
    // env vars steers the lookup deterministically. We save + restore
    // the original values so other tests aren't affected.
    let fakeHome: string;
    let savedHome: string | undefined;
    let savedUserProfile: string | undefined;

    beforeEach(() => {
        fakeHome = mkdtempSync(join(tmpdir(), 'atlas-fake-home-'));
        cleanupDirs.push(fakeHome);
        savedHome = process.env['HOME'];
        savedUserProfile = process.env['USERPROFILE'];
        process.env['HOME'] = fakeHome;
        process.env['USERPROFILE'] = fakeHome;
    });

    afterEach(() => {
        if (savedHome === undefined) delete process.env['HOME'];
        else process.env['HOME'] = savedHome;
        if (savedUserProfile === undefined) delete process.env['USERPROFILE'];
        else process.env['USERPROFILE'] = savedUserProfile;
    });

    it('writes ~/.copilot/agents/atlas-<runId>.md when activeRunCopilotAgent is set', async () => {
        const promptBody = '# Architect\n\nbody-for-active-run';
        await insertAgent({
            id: 'agent-architect',
            name: 'Architect',
            prompt_md: promptBody,
        });
        await insertAgent({
            id: 'agent-coder',
            name: 'Coder',
            prompt_md: '# Coder\n\nshould-not-leak',
        });

        const runId = '11111111-2222-3333-4444-555555555555';
        const result = await assembleCommands({
            worktreePath,
            projectId: null,
            activeRunCopilotAgent: { runId, agentId: 'agent-architect' },
        });

        const userAgentPath = join(fakeHome, '.copilot', 'agents', `atlas-${runId}.md`);
        expect(result.copilotUserAgentPath).toBe(userAgentPath);
        expect(existsSync(userAgentPath)).toBe(true);

        const fileBody = readFileSync(userAgentPath, 'utf8');
        // Frontmatter + the active agent's verbatim prompt.
        expect(fileBody.startsWith('---\n')).toBe(true);
        expect(fileBody).toContain('description: "Atlas SDLC agent — Architect.');
        expect(fileBody).toContain(promptBody);
        // The OTHER agent's body must not leak into the active-run file.
        expect(fileBody).not.toContain('should-not-leak');
    });

    it('does not create a user-level file when activeRunCopilotAgent is unset', async () => {
        await insertAgent({
            id: 'agent-architect',
            name: 'Architect',
            prompt_md: '# Architect\n\nbody',
        });

        const result = await assembleCommands({ worktreePath, projectId: null });

        expect(result.copilotUserAgentPath).toBeUndefined();
        const userAgentsDir = join(fakeHome, '.copilot', 'agents');
        if (existsSync(userAgentsDir)) {
            expect(readdirSync(userAgentsDir)).toEqual([]);
        }
    });

    it('skips the user-level write when the agentId does not match any loaded agent', async () => {
        await insertAgent({
            id: 'agent-architect',
            name: 'Architect',
            prompt_md: '# Architect\n\nbody',
        });

        const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        const result = await assembleCommands({
            worktreePath,
            projectId: null,
            activeRunCopilotAgent: { runId, agentId: 'agent-not-loaded' },
        });

        expect(result.copilotUserAgentPath).toBeUndefined();
        const userAgentPath = join(fakeHome, '.copilot', 'agents', `atlas-${runId}.md`);
        expect(existsSync(userAgentPath)).toBe(false);
    });
});
