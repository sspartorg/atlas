import { beforeEach, describe, expect, it, vi, afterAll, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type * as NodeOs from 'node:os';

// --- node:os mock: redirect homedir() to our tmp fixture directory. Must
// be hoisted before any import that may transitively pull in homedir. ---
const { fakeHome } = vi.hoisted(() => ({ fakeHome: { current: '' } }));
vi.mock('node:os', async (importOrig) => {
    const orig = await importOrig<typeof NodeOs>();
    return { ...orig, homedir: () => fakeHome.current };
});

import { ingestTranscript, encodeClaudeProjectDir } from './cli-transcript-ingest.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

// CTI = cli-transcript-ingest; unique prefix avoids PG FK collisions.
const SESSION_PREFIX = 'cti';
let tmpRoot = '';
let allTmpDirs: string[] = [];

beforeEach(async () => {
    await truncateAll();
    tmpRoot = await mkdtemp(join(tmpdir(), 'cti-'));
    allTmpDirs.push(tmpRoot);
    fakeHome.current = tmpRoot;
});

afterEach(async () => {
    vi.restoreAllMocks();
});

afterAll(async () => {
    await closeTestDb();
    for (const d of allTmpDirs) {
        try { await rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

// Helper: insert a project + cli_sessions row.
async function insertSession(overrides: {
    id: string;
    cli?: 'claude' | 'copilot';
    worktree_path?: string | null;
    claude_session_id?: string | null;
    transcript_jsonl?: string | null;
    model?: string;
}): Promise<void> {
    await insertProject('p-cti', 'CTI');
    await testDb
        .insertInto('cli_sessions')
        .values({
            id: overrides.id,
            project_id: 'p-cti',
            title: 'Test session',
            status: 'paused',
            cli: overrides.cli ?? 'claude',
            worktree_path: overrides.worktree_path !== undefined ? overrides.worktree_path : '/tmp/worktree',
            worktree_branch: `atlas/terminal/cti-test-${overrides.id}`,
            claude_session_id: overrides.claude_session_id !== undefined
                ? overrides.claude_session_id
                : 'claude-sid-111',
            model: overrides.model ?? 'claude-opus-4-7',
            initial_prompt: null,
            transcript_jsonl: overrides.transcript_jsonl ?? null,
        })
        .execute();
}

// ---------------------------------------------------------------------------
// encodeClaudeProjectDir — pure string transform
// ---------------------------------------------------------------------------
describe('encodeClaudeProjectDir', () => {
    it('replaces drive colon, backslashes, and dots with dashes (CTI-ENC-1)', () => {
        // 'C:\\Users\\X' in JS is the string C:\Users\X (single backslash).
        // The regex /[^a-zA-Z0-9-]/g replaces EVERY non-alphanumeric (and
        // non-dash) char with `-`, so the drive colon turns into a dash
        // sitting next to the backslash's dash -> `C--Users` (double dash).
        expect(encodeClaudeProjectDir('C:\\Users\\X\\Projects\\atlas')).toBe(
            'C--Users-X-Projects-atlas',
        );
    });

    it('replaces forward slashes with dashes for POSIX paths (CTI-ENC-2)', () => {
        expect(encodeClaudeProjectDir('/home/user/projects/atlas')).toBe(
            '-home-user-projects-atlas',
        );
    });

    it('leaves a path with only alphanumerics and dashes unchanged (CTI-ENC-3)', () => {
        expect(encodeClaudeProjectDir('flat-path')).toBe('flat-path');
    });

    it('replaces dots and underscores with dashes too (CTI-ENC-4)', () => {
        // Discovered empirically: atlas worktrees contain `sspart`
        // (dot in user name) and `atlas__terminal__<short>` (double
        // underscores from branch-slash escaping). Claude's encoder turns
        // both into dashes -- the previous "only colon/slash" rule meant
        // the on-disk folder name diverged from what atlas computed, and
        // every claude transcript lookup failed.
        expect(
            encodeClaudeProjectDir(
                'C:\\Users\\sspart\\AIPrograms\\atlas__terminal__abcd1234',
            ),
        ).toBe('C--Users-sspart-AIPrograms-atlas--terminal--abcd1234');
    });
});

// ---------------------------------------------------------------------------
// ingestTranscript — session not found → null
// ---------------------------------------------------------------------------
describe('ingestTranscript — row not found', () => {
    it('returns null when the session row does not exist (CTI-NOFOUND)', async () => {
        const result = await ingestTranscript(`${SESSION_PREFIX}-no-row`);
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// ingestTranscript — no path can be derived (resolved.path = null)
// ---------------------------------------------------------------------------
describe('ingestTranscript — no derived path', () => {
    it('returns DB content when claude row has no claude_session_id (CTI-NOCSID)', async () => {
        await insertSession({
            id: `${SESSION_PREFIX}-nocsid`,
            cli: 'claude',
            claude_session_id: null,
            transcript_jsonl: 'prior content',
        });
        const result = await ingestTranscript(`${SESSION_PREFIX}-nocsid`);
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBe('prior content');
        expect(result!.source).toBe('claude');
    });

    it('returns null DB content when claude row has no worktree_path (CTI-NOWTP)', async () => {
        await insertSession({
            id: `${SESSION_PREFIX}-nowtp`,
            cli: 'claude',
            worktree_path: null,
            claude_session_id: 'some-sid',
            transcript_jsonl: null,
        });
        const result = await ingestTranscript(`${SESSION_PREFIX}-nowtp`);
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBeNull();
        expect(result!.source).toBe('claude');
    });

    it('uses overrides.worktreePath=null to force no-path branch (CTI-OVERRIDE-NULL)', async () => {
        // Row has a worktree_path, but we pass overrides.worktreePath = null —
        // with claude_session_id also null, resolved.path is null.
        await insertSession({
            id: `${SESSION_PREFIX}-ovrnull`,
            cli: 'claude',
            worktree_path: '/tmp/real-worktree',
            claude_session_id: null,
            transcript_jsonl: 'override fallback',
        });
        const result = await ingestTranscript(`${SESSION_PREFIX}-ovrnull`, {
            worktreePath: null,
        });
        expect(result).not.toBeNull();
        // overrides.worktreePath=null → resolvedWorktreePath = null → resolved.path=null
        expect(result!.jsonl_content).toBe('override fallback');
    });

    it('uses overrides.worktreePath string over row.worktree_path (CTI-OVERRIDE-PATH)', async () => {
        const sessionId = `${SESSION_PREFIX}-ovrpath`;
        const claudeSid = 'abcd1234-aaaa-bbbb-cccc-ddddeeee0001';
        // Row has a worktree_path but we want to use a different one via overrides.
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: '/old/path',
            claude_session_id: claudeSid,
        });

        // Create the file under the overridden worktree path (encoded).
        const overriddenPath = '/new/worktree/path';
        const encoded = encodeClaudeProjectDir(overriddenPath);
        const claudeDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(claudeDir, { recursive: true });
        const content = '{"type":"msg"}\n';
        await writeFile(join(claudeDir, `${claudeSid}.jsonl`), content, 'utf8');

        const result = await ingestTranscript(sessionId, { worktreePath: overriddenPath });
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBe(content);
        expect(result!.source).toBe('claude');
    });
});

// ---------------------------------------------------------------------------
// ingestTranscript — copilot happy path
// ---------------------------------------------------------------------------
describe('ingestTranscript — copilot', () => {
    it('resolves copilot path from claude_session_id and ingests events.jsonl (CTI-COPILOT)', async () => {
        const sessionId = `${SESSION_PREFIX}-cop1`;
        const copilotSid = 'ffff0000-2222-3333-4444-555566667777';
        await insertSession({
            id: sessionId,
            cli: 'copilot',
            // worktree_path not required for copilot's layout.
            worktree_path: null,
            claude_session_id: copilotSid,
        });

        // copilot path: <home>/.copilot/session-state/<claude_session_id>/events.jsonl
        // Note: the dir is named after `claude_session_id`, NOT the Atlas
        // row PK — that was the original bug.
        const copilotDir = join(tmpRoot, '.copilot', 'session-state', copilotSid);
        await mkdir(copilotDir, { recursive: true });
        const content = '{"type":"message","role":"user","content":"hello"}\n';
        await writeFile(join(copilotDir, 'events.jsonl'), content, 'utf8');

        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        expect(result!.source).toBe('copilot');
        expect(result!.jsonl_content).toBe(content);
        expect(result!.ingested_at).toBeTruthy();

        // Verify DB was updated.
        const row = await testDb
            .selectFrom('cli_sessions')
            .select(['transcript_jsonl'])
            .where('id', '=', sessionId)
            .executeTakeFirst();
        expect(row?.transcript_jsonl).toBe(content);
    });

    it('populates total_cost_usd + token columns from session.shutdown event (CTI-COPILOT-COST)', async () => {
        // Wire-level test: ingest finds the session.shutdown event in
        // events.jsonl, runs parseCopilotEventsUsage, persists the result.
        const sessionId = `${SESSION_PREFIX}-cop-cost`;
        const copilotSid = 'ffff1111-2222-3333-4444-555566667777';
        await insertSession({
            id: sessionId,
            cli: 'copilot',
            worktree_path: null,
            claude_session_id: copilotSid,
            model: 'gpt-5.4-mini',
        });

        const copilotDir = join(tmpRoot, '.copilot', 'session-state', copilotSid);
        await mkdir(copilotDir, { recursive: true });
        // Real shape from a atlas copilot session: 1.1223 AIU × $0.04 = $0.044892.
        const content =
            JSON.stringify({ type: 'session.start', data: {} }) +
            '\n' +
            JSON.stringify({
                type: 'session.shutdown',
                data: {
                    totalNanoAiu: 1_122_300_000,
                    tokenDetails: {
                        input: { tokenCount: 14802 },
                        output: { tokenCount: 27 },
                        cache_read: { tokenCount: 0 },
                    },
                    modelMetrics: {
                        'gpt-5.4-mini': {
                            usage: { cacheWriteTokens: 0 },
                        },
                    },
                },
            });
        await writeFile(join(copilotDir, 'events.jsonl'), content, 'utf8');

        await ingestTranscript(sessionId);
        const row = await testDb
            .selectFrom('cli_sessions')
            .select([
                'total_cost_usd',
                'input_tokens',
                'output_tokens',
                'cache_creation_tokens',
                'cache_read_tokens',
            ])
            .where('id', '=', sessionId)
            .executeTakeFirst();
        expect(row?.input_tokens).toBe(14802);
        expect(row?.output_tokens).toBe(27);
        expect(row?.cache_read_tokens).toBe(0);
        expect(row?.cache_creation_tokens).toBe(0);
        expect(Number(row?.total_cost_usd)).toBeCloseTo(0.044892, 5);
    });

    it('returns null content for copilot row missing claude_session_id (CTI-COPILOT-NOSID)', async () => {
        // Atlas passes --session-id, so claude_session_id should always be
        // populated for fresh sessions. Defensive: a row without one cannot
        // resolve a transcript path; return DB content (null) unchanged.
        const sessionId = `${SESSION_PREFIX}-cop-nosid`;
        await insertSession({
            id: sessionId,
            cli: 'copilot',
            worktree_path: null,
            claude_session_id: null,
            transcript_jsonl: null,
        });
        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBeNull();
        expect(result!.source).toBe('copilot');
    });

    it('returns null content for copilot row when events.jsonl missing (CTI-COPILOT-ENOENT)', async () => {
        // Copilot writes events.jsonl lazily — only after the user interacts.
        // A quick-exit session leaves only the dir (workspace.yaml, lock,
        // empty subdirs) but no events.jsonl. Resolver should return null
        // content without throwing.
        const sessionId = `${SESSION_PREFIX}-cop-enoent`;
        const copilotSid = 'eeee1111-2222-3333-4444-555566667777';
        await insertSession({
            id: sessionId,
            cli: 'copilot',
            worktree_path: null,
            claude_session_id: copilotSid,
            transcript_jsonl: null,
        });
        // Create the session-state dir but NOT events.jsonl (mirrors a
        // no-interaction copilot session: dir exists with metadata, no
        // transcript file).
        const copilotDir = join(tmpRoot, '.copilot', 'session-state', copilotSid);
        await mkdir(copilotDir, { recursive: true });
        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBeNull();
        expect(result!.source).toBe('copilot');
    });
});

// ---------------------------------------------------------------------------
// ingestTranscript — claude happy path
// ---------------------------------------------------------------------------
describe('ingestTranscript — claude', () => {
    it('resolves claude path from worktree_path + claude_session_id and ingests (CTI-CLAUDE)', async () => {
        const sessionId = `${SESSION_PREFIX}-cl1`;
        const claudeSid = 'aabbccdd-1111-2222-3333-444455556666';
        const worktreePath = 'C:\\Users\\X\\Projects\\atlas';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
        });

        // claude path: <home>/.claude/projects/<encoded-cwd>/<claude_session_id>.jsonl
        const encoded = encodeClaudeProjectDir(worktreePath);
        const claudeDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(claudeDir, { recursive: true });
        const content = '{"type":"assistant_message","content":"hi"}\n';
        await writeFile(join(claudeDir, `${claudeSid}.jsonl`), content, 'utf8');

        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        expect(result!.source).toBe('claude');
        expect(result!.jsonl_content).toBe(content);
    });

    it('populates total_cost_usd + token columns from per-event usage (CTI-CLAUDE-COST)', async () => {
        // Wire-level check that the close-time ingest also runs the
        // pty-transcript-usage parser and persists its output. The parser
        // itself is exercised in detail in pty-transcript-usage.test.ts;
        // here we just verify the columns flow through ingest -> DB.
        const sessionId = `${SESSION_PREFIX}-cl-cost`;
        const claudeSid = 'aabbccdd-1111-2222-3333-aaaaaaaaaaaa';
        const worktreePath = 'C:\\Users\\X\\Projects\\cost-p';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            model: 'claude-haiku-4-5',
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const claudeDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(claudeDir, { recursive: true });
        // One assistant event: 1M output tokens on haiku-4-5 ($5/M output)
        // -> total_cost_usd === 5.0.
        const content = JSON.stringify({
            type: 'assistant',
            message: {
                model: 'claude-haiku-4-5',
                usage: { input_tokens: 0, output_tokens: 1_000_000 },
            },
        });
        await writeFile(join(claudeDir, `${claudeSid}.jsonl`), content, 'utf8');

        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBe(content);

        const row = await testDb
            .selectFrom('cli_sessions')
            .select([
                'total_cost_usd',
                'input_tokens',
                'output_tokens',
                'cache_creation_tokens',
                'cache_read_tokens',
            ])
            .where('id', '=', sessionId)
            .executeTakeFirst();
        expect(row?.output_tokens).toBe(1_000_000);
        expect(row?.input_tokens).toBe(0);
        expect(Number(row?.total_cost_usd)).toBeCloseTo(5.0, 4);
    });

    it('leaves cost columns null when transcript has no assistant events (CTI-CLAUDE-NO-USAGE)', async () => {
        const sessionId = `${SESSION_PREFIX}-cl-noasst`;
        const claudeSid = 'aabbccdd-1111-2222-3333-bbbbbbbbbbbb';
        const worktreePath = 'C:\\Users\\X\\Projects\\noasst';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            model: 'claude-haiku-4-5',
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const claudeDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(claudeDir, { recursive: true });
        // User-only transcript -> parser returns null -> no cost write.
        const content =
            JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n';
        await writeFile(join(claudeDir, `${claudeSid}.jsonl`), content, 'utf8');

        await ingestTranscript(sessionId);
        const row = await testDb
            .selectFrom('cli_sessions')
            .select(['total_cost_usd', 'input_tokens', 'output_tokens'])
            .where('id', '=', sessionId)
            .executeTakeFirst();
        expect(row?.total_cost_usd).toBeNull();
        expect(row?.input_tokens).toBeNull();
        expect(row?.output_tokens).toBeNull();
    });

    it('skips usage parsing entirely for a 0-byte transcript file (!content -> usage=null branch)', async () => {
        // An empty (but existing) file reads back as '' — falsy — which
        // short-circuits the `!content ? null : ...` ternary before either
        // parser is even considered, unlike CTI-CLAUDE-NO-USAGE above where
        // content is non-empty but parses to no assistant events.
        const sessionId = `${SESSION_PREFIX}-cl-empty`;
        const claudeSid = 'aabbccdd-1111-2222-3333-cccccccccccc';
        const worktreePath = 'C:\\Users\\X\\Projects\\empty-file';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const claudeDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(claudeDir, { recursive: true });
        await writeFile(join(claudeDir, `${claudeSid}.jsonl`), '', 'utf8');

        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBe('');

        const row = await testDb
            .selectFrom('cli_sessions')
            .select(['total_cost_usd', 'input_tokens', 'output_tokens'])
            .where('id', '=', sessionId)
            .executeTakeFirst();
        expect(row?.total_cost_usd).toBeNull();
        expect(row?.input_tokens).toBeNull();
        expect(row?.output_tokens).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// ingestTranscript — oversized file (stat.size > MAX_TRANSCRIPT_BYTES = 10MB)
// We write a real 10MB+1B file to avoid mocking; it runs in a few hundred ms.
// ---------------------------------------------------------------------------
describe('ingestTranscript — oversized file', () => {
    it('returns DB content without updating when file exceeds 10 MB (CTI-OVERSIZE)', async () => {
        const sessionId = `${SESSION_PREFIX}-big`;
        const claudeSid = 'bbbbcccc-1111-2222-3333-444455556666';
        const worktreePath = '/home/test/projects/over-p';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            transcript_jsonl: 'prior-db-content',
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const claudeDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(claudeDir, { recursive: true });
        // 10 MB + 1 byte to just exceed MAX_TRANSCRIPT_BYTES.
        const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 65 /* 'A' */);
        await writeFile(join(claudeDir, `${claudeSid}.jsonl`), oversized);

        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        // Returns the pre-existing DB content unchanged.
        expect(result!.jsonl_content).toBe('prior-db-content');
        expect(result!.source).toBe('claude');
    }, 30_000);

    it('returns null jsonl_content for an oversized file when the DB had no prior content (CTI-OVERSIZE-NULL)', async () => {
        // Exercises the `row.transcript_jsonl ?? null` fallback in the
        // oversized-file branch — the happy-path oversize test above always
        // has a truthy prior value, so the null side was never covered.
        const sessionId = `${SESSION_PREFIX}-big-null`;
        const claudeSid = 'bbbbcccc-1111-2222-3333-777788889999';
        const worktreePath = '/home/test/projects/over-p-null';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            transcript_jsonl: null,
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const claudeDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(claudeDir, { recursive: true });
        const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 65 /* 'A' */);
        await writeFile(join(claudeDir, `${claudeSid}.jsonl`), oversized);

        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBeNull();
        expect(result!.source).toBe('claude');
    }, 30_000);
});

// ---------------------------------------------------------------------------
// ingestTranscript — ENOENT (file missing → stat throws ENOENT)
// ---------------------------------------------------------------------------
describe('ingestTranscript — file missing', () => {
    it('returns DB content when transcript file does not exist (CTI-ENOENT)', async () => {
        const sessionId = `${SESSION_PREFIX}-enoent`;
        const claudeSid = 'ccccdddd-1111-2222-3333-444455556666';
        const worktreePath = '/home/test/projects/enoent-p';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            transcript_jsonl: null,
        });
        // Do NOT create the file — stat throws ENOENT.

        const result = await ingestTranscript(sessionId);
        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBeNull();
        expect(result!.source).toBe('claude');
    });
});

// ---------------------------------------------------------------------------
// ingestTranscript — non-ENOENT read error (console.warn branch)
// On Windows: readFile(directory) throws EPERM (not ENOENT).
// On POSIX:   readFile(directory) throws EISDIR (not ENOENT).
// Either way code !== 'ENOENT' triggers console.warn.
// ---------------------------------------------------------------------------
describe('ingestTranscript — non-ENOENT error', () => {
    it('logs a warning and returns DB content when stat succeeds but readFile throws non-ENOENT (CTI-NOENT-READ)', async () => {
        const sessionId = `${SESSION_PREFIX}-dirread`;
        const claudeSid = 'ddddeeeee-1111-2222-3333-eeeefff00001';
        const worktreePath = '/home/test/projects/dir-p';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            transcript_jsonl: 'fallback',
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const claudeDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(claudeDir, { recursive: true });
        // Create a DIRECTORY where the .jsonl file should be.
        // stat(dir) → size=0 (< 10MB) → passes the size check.
        // readFile(dir, 'utf8') → throws EPERM (Windows) or EISDIR (POSIX).
        // Both codes are !== 'ENOENT' → console.warn fires.
        await mkdir(join(claudeDir, `${claudeSid}.jsonl`));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await ingestTranscript(sessionId);
        const warned = warnSpy.mock.calls.length > 0;
        warnSpy.mockRestore();

        expect(result).not.toBeNull();
        expect(result!.jsonl_content).toBe('fallback');
        expect(result!.source).toBe('claude');
        expect(warned).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Subagent breakdown (Terminal v4) — `cli_session_subagents` rows.
//
// Why this path matters: the terminal-history page bills a session by
// subagent. If ingest stops writing these rows (or writes them with the
// wrong key), the Owner sees a session whose headline cost has no
// breakdown behind it — and because every failure here is swallowed with
// a console.warn so it can't block transcript persistence, a regression
// is SILENT. These tests are the only thing that fails loudly.
// ---------------------------------------------------------------------------

/** One assistant event, priced by `claude-haiku-4-5` ($5/M output). */
function assistantEvent(msgId: string, outputTokens: number, timestamp: string): string {
    return JSON.stringify({
        type: 'assistant',
        timestamp,
        message: {
            id: msgId,
            model: 'claude-haiku-4-5',
            usage: { input_tokens: 0, output_tokens: outputTokens },
        },
    });
}

/** Lay down `<home>/.claude/projects/<encoded>/<sid>/subagents/` and return it. */
async function makeClaudeSubagentDir(worktreePath: string, claudeSid: string): Promise<string> {
    const encoded = encodeClaudeProjectDir(worktreePath);
    const dir = join(tmpRoot, '.claude', 'projects', encoded, claudeSid, 'subagents');
    await mkdir(dir, { recursive: true });
    return dir;
}

function subagentRows(sessionId: string) {
    return testDb
        .selectFrom('cli_session_subagents')
        .selectAll()
        .where('cli_session_id', '=', sessionId)
        .orderBy('subagent_key')
        .execute();
}

describe('ingestTranscript — claude subagents', () => {
    it('writes one cli_session_subagents row per subagent JSONL with meta + priced tokens (CTI-SUB-CLAUDE)', async () => {
        const sessionId = `${SESSION_PREFIX}-sub-cl`;
        const claudeSid = 'a1111111-0000-0000-0000-00000000cl01';
        const worktreePath = '/home/test/projects/sub-cl';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            model: 'claude-haiku-4-5',
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const projectDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(projectDir, { recursive: true });
        await writeFile(
            join(projectDir, `${claudeSid}.jsonl`),
            assistantEvent('msg_parent', 100, '2026-09-01T10:00:00.000Z'),
            'utf8',
        );

        const subDir = await makeClaudeSubagentDir(worktreePath, claudeSid);
        // agent-aaa: 2 events (400k + 600k output => 1M => $5.00), has meta.
        await writeFile(
            join(subDir, 'agent-aaa.jsonl'),
            [
                assistantEvent('msg_a1', 400_000, '2026-09-01T10:01:00.000Z'),
                assistantEvent('msg_a2', 600_000, '2026-09-01T10:05:00.000Z'),
            ].join('\n'),
            'utf8',
        );
        await writeFile(
            join(subDir, 'agent-aaa.meta.json'),
            JSON.stringify({ agentType: 'Explore', description: 'find the graph code', spawnDepth: 1 }),
            'utf8',
        );
        // agent-bbb: 1 event, NO meta.json — the JSONL alone must still yield a row.
        await writeFile(
            join(subDir, 'agent-bbb.jsonl'),
            assistantEvent('msg_b1', 200_000, '2026-09-01T10:02:00.000Z'),
            'utf8',
        );
        // A stray non-jsonl file in the dir must be ignored, not turned into a row.
        await writeFile(join(subDir, 'notes.txt'), 'ignore me', 'utf8');

        await ingestTranscript(sessionId);

        const rows = await subagentRows(sessionId);
        expect(rows.map((r) => r.subagent_key)).toEqual(['agent-aaa', 'agent-bbb']);

        const aaa = rows[0]!;
        expect(aaa.source).toBe('claude_jsonl');
        expect(aaa.agent_type).toBe('Explore');
        expect(aaa.description).toBe('find the graph code');
        expect(aaa.spawn_depth).toBe(1);
        expect(aaa.output_tokens).toBe(1_000_000);
        expect(aaa.input_tokens).toBe(0);
        expect(Number(aaa.cost_usd)).toBeCloseTo(5.0, 4);
        // Real numbers, not a guess — the UI must not label them as estimates.
        expect(aaa.is_estimate).toBe(false);
        expect(new Date(aaa.started_at as unknown as string).toISOString()).toBe(
            '2026-09-01T10:01:00.000Z',
        );
        expect(new Date(aaa.ended_at as unknown as string).toISOString()).toBe(
            '2026-09-01T10:05:00.000Z',
        );

        const bbb = rows[1]!;
        expect(bbb.agent_type).toBeNull();
        expect(bbb.description).toBeNull();
        expect(bbb.spawn_depth).toBeNull();
        expect(bbb.output_tokens).toBe(200_000);
        expect(Number(bbb.cost_usd)).toBeCloseTo(1.0, 4);
    });

    it('re-ingesting the same session updates the row instead of tripping the unique index (CTI-SUB-CLAUDE-UPSERT)', async () => {
        // The lazy GET fallback re-runs ingest against an already-ingested
        // session. Without the ON CONFLICT clause that second run throws on
        // UNIQUE (cli_session_id, subagent_key), the warn swallows it, and
        // the breakdown silently freezes at its first-seen numbers.
        const sessionId = `${SESSION_PREFIX}-sub-upsert`;
        const claudeSid = 'a2222222-0000-0000-0000-00000000cl02';
        const worktreePath = '/home/test/projects/sub-upsert';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            model: 'claude-haiku-4-5',
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const projectDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(projectDir, { recursive: true });
        await writeFile(join(projectDir, `${claudeSid}.jsonl`), '{"type":"user"}', 'utf8');

        const subDir = await makeClaudeSubagentDir(worktreePath, claudeSid);
        await writeFile(
            join(subDir, 'agent-x.jsonl'),
            assistantEvent('msg_x1', 100_000, '2026-09-01T11:00:00.000Z'),
            'utf8',
        );
        await writeFile(
            join(subDir, 'agent-x.meta.json'),
            JSON.stringify({ agentType: 'Plan', description: 'first pass', spawnDepth: 0 }),
            'utf8',
        );
        await ingestTranscript(sessionId);

        // The subagent kept working after the first ingest: more tokens, new meta.
        await writeFile(
            join(subDir, 'agent-x.jsonl'),
            [
                assistantEvent('msg_x1', 100_000, '2026-09-01T11:00:00.000Z'),
                assistantEvent('msg_x2', 300_000, '2026-09-01T11:30:00.000Z'),
            ].join('\n'),
            'utf8',
        );
        await writeFile(
            join(subDir, 'agent-x.meta.json'),
            JSON.stringify({ agentType: 'Plan', description: 'second pass', spawnDepth: 2 }),
            'utf8',
        );
        await ingestTranscript(sessionId);

        const rows = await subagentRows(sessionId);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.output_tokens).toBe(400_000);
        expect(rows[0]!.description).toBe('second pass');
        expect(rows[0]!.spawn_depth).toBe(2);
        expect(Number(rows[0]!.cost_usd)).toBeCloseTo(2.0, 4);
        expect(new Date(rows[0]!.ended_at as unknown as string).toISOString()).toBe(
            '2026-09-01T11:30:00.000Z',
        );
    });

    it('persists the transcript even when the subagent insert fails (CTI-SUB-ISOLATED)', async () => {
        // A subagent event carrying a non-date `timestamp` makes the batch
        // INSERT blow up on the `timestamp with time zone` column. That must
        // cost the Owner the breakdown ONLY — the transcript itself is the
        // thing the history page can't be rendered without.
        const sessionId = `${SESSION_PREFIX}-sub-bad-ts`;
        const claudeSid = 'a3333333-0000-0000-0000-00000000cl03';
        const worktreePath = '/home/test/projects/sub-bad-ts';
        await insertSession({
            id: sessionId,
            cli: 'claude',
            worktree_path: worktreePath,
            claude_session_id: claudeSid,
            model: 'claude-haiku-4-5',
        });

        const encoded = encodeClaudeProjectDir(worktreePath);
        const projectDir = join(tmpRoot, '.claude', 'projects', encoded);
        await mkdir(projectDir, { recursive: true });
        const parentContent = assistantEvent('msg_p', 10, '2026-09-01T12:00:00.000Z');
        await writeFile(join(projectDir, `${claudeSid}.jsonl`), parentContent, 'utf8');

        const subDir = await makeClaudeSubagentDir(worktreePath, claudeSid);
        await writeFile(
            join(subDir, 'agent-bad.jsonl'),
            assistantEvent('msg_bad', 1000, 'not-a-timestamp'),
            'utf8',
        );

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await ingestTranscript(sessionId);
        const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
        warnSpy.mockRestore();

        expect(result!.jsonl_content).toBe(parentContent);
        expect(warnings.some((w) => w.includes('subagent ingest failed'))).toBe(true);
        expect(await subagentRows(sessionId)).toHaveLength(0);
        const row = await testDb
            .selectFrom('cli_sessions')
            .select(['transcript_jsonl'])
            .where('id', '=', sessionId)
            .executeTakeFirst();
        expect(row?.transcript_jsonl).toBe(parentContent);
    });
});

describe('ingestTranscript — copilot subagents', () => {
    it('collapses subagent.selected events into one estimate row per agent (CTI-SUB-COPILOT)', async () => {
        // Copilot's on-disk format carries no per-subagent tokens, so these
        // rows exist purely to tell the Owner WHICH agents ran and when.
        // They must be flagged `is_estimate` so the UI never sums them into
        // a cost the data can't support.
        const sessionId = `${SESSION_PREFIX}-sub-cop`;
        const copilotSid = 'b1111111-0000-0000-0000-00000000cp01';
        await insertSession({
            id: sessionId,
            cli: 'copilot',
            worktree_path: null,
            claude_session_id: copilotSid,
            model: 'gpt-5.4-mini',
        });

        const copilotDir = join(tmpRoot, '.copilot', 'session-state', copilotSid);
        await mkdir(copilotDir, { recursive: true });
        const content = [
            JSON.stringify({
                type: 'subagent.selected',
                timestamp: '2026-09-02T09:00:00.000Z',
                data: { agentName: 'reviewer', agentDisplayName: 'Design Reviewer', tools: ['read', 'grep'] },
            }),
            // Same agent re-selected later — one row, later lastSelectedAt.
            JSON.stringify({
                type: 'subagent.selected',
                timestamp: '2026-09-02T09:45:00.000Z',
                data: { agentName: 'reviewer', agentDisplayName: 'Design Reviewer', tools: [] },
            }),
            JSON.stringify({
                type: 'subagent.selected',
                timestamp: '2026-09-02T09:10:00.000Z',
                data: { agentName: 'scout', agentDisplayName: null, tools: [] },
            }),
        ].join('\n');
        await writeFile(join(copilotDir, 'events.jsonl'), content, 'utf8');

        await ingestTranscript(sessionId);

        const rows = await subagentRows(sessionId);
        expect(rows.map((r) => r.subagent_key)).toEqual(['reviewer', 'scout']);

        const reviewer = rows[0]!;
        expect(reviewer.source).toBe('copilot_list');
        expect(reviewer.agent_type).toBe('Design Reviewer');
        expect(reviewer.description).toBe('Tools: read, grep');
        expect(reviewer.is_estimate).toBe(true);
        expect(reviewer.input_tokens).toBeNull();
        expect(reviewer.output_tokens).toBeNull();
        expect(reviewer.cost_usd).toBeNull();
        expect(reviewer.spawn_depth).toBeNull();
        expect(new Date(reviewer.started_at as unknown as string).toISOString()).toBe(
            '2026-09-02T09:00:00.000Z',
        );
        expect(new Date(reviewer.ended_at as unknown as string).toISOString()).toBe(
            '2026-09-02T09:45:00.000Z',
        );

        // No tools on the event -> no synthetic description to show.
        expect(rows[1]!.agent_type).toBeNull();
        expect(rows[1]!.description).toBeNull();
    });

    it('writes no subagent rows for an empty copilot events.jsonl (CTI-SUB-COPILOT-EMPTY)', async () => {
        // Copilot creates events.jsonl before it has anything to say. An
        // empty read must not be mistaken for "the session had no agents"
        // in a way that throws — ingest still has to persist the row.
        const sessionId = `${SESSION_PREFIX}-sub-cop-empty`;
        const copilotSid = 'b2222222-0000-0000-0000-00000000cp02';
        await insertSession({
            id: sessionId,
            cli: 'copilot',
            worktree_path: null,
            claude_session_id: copilotSid,
        });
        const copilotDir = join(tmpRoot, '.copilot', 'session-state', copilotSid);
        await mkdir(copilotDir, { recursive: true });
        await writeFile(join(copilotDir, 'events.jsonl'), '', 'utf8');

        const result = await ingestTranscript(sessionId);
        expect(result!.jsonl_content).toBe('');
        expect(await subagentRows(sessionId)).toHaveLength(0);
    });

    it('writes no subagent rows when copilot events carry no subagent.selected (CTI-SUB-COPILOT-NONE)', async () => {
        const sessionId = `${SESSION_PREFIX}-sub-cop-none`;
        const copilotSid = 'b3333333-0000-0000-0000-00000000cp03';
        await insertSession({
            id: sessionId,
            cli: 'copilot',
            worktree_path: null,
            claude_session_id: copilotSid,
        });
        const copilotDir = join(tmpRoot, '.copilot', 'session-state', copilotSid);
        await mkdir(copilotDir, { recursive: true });
        await writeFile(
            join(copilotDir, 'events.jsonl'),
            JSON.stringify({ type: 'session.start', data: {} }),
            'utf8',
        );

        await ingestTranscript(sessionId);
        expect(await subagentRows(sessionId)).toHaveLength(0);
    });
});
