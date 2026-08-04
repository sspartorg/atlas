// 2026-08-04 — Terminal finalize diff.
//
// Feeds the Stop-session review modal, which is the gate before Atlas commits,
// pushes, and (optionally) opens a PR. Two scopes:
//
//   uncommitted — `git diff HEAD` in the session worktree, plus untracked
//                 files. These are the stageable files the checkboxes drive.
//   committed   — `git diff <merge-base(base, HEAD)> HEAD`; work already
//                 committed inside the session. Read-only.
//
// Design notes that are load-bearing:
//
//   * `git diff HEAD` (single ref, no `--cached`) is ALREADY worktree-vs-HEAD
//     and merges staged + unstaged into one record per path. Running
//     `diff` + `diff --cached` and merging by hand gets the awkward cases
//     wrong (staged-add-then-modified, staged-rename-then-edited).
//
//   * Every git call reads stdout as a Buffer. Node's default utf8 decode is
//     chunk-by-chunk, so a multi-byte codepoint straddling a chunk boundary
//     becomes U+FFFD — silently corrupting both patch text and path bytes. We
//     split on NUL at the Buffer level and decode fields individually.
//
//   * The worktree is agent-controlled and the agent has a live shell in it,
//     so `--no-ext-diff` / `--no-textconv` are security controls, not hygiene:
//     `git config diff.external <exe>` or a `.gitattributes` textconv driver
//     would otherwise get executed by this process on every diff.
//
//   * This module never touches the network. A stale `origin/main` is fine —
//     same posture as `commitsAhead` in routes/cli-sessions.ts.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
    CliSessionDiffFile,
    CliSessionDiffScope,
    CliSessionDiffScopeName,
    CliSessionDiffSummaryResponse,
    CliSessionFilePatchResponse,
} from '@atlas/shared';
import { gitInvokeEnv } from './git-env.js';

const exec = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_FILES_PER_SCOPE = 500;
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_PATCH_LINES = 20_000;
const MAX_UNTRACKED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 32 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

/** git's canonical empty tree — the left-hand side when HEAD is unborn. */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * `--no-ext-diff` / `--no-textconv` block config-driven code execution (see
 * the header). `--no-color` stops a developer's `color.diff = always` from
 * injecting ANSI escapes into the patch — we deliberately do NOT set
 * GIT_CONFIG_GLOBAL here, so the developer's own ~/.gitconfig applies.
 */
const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color'] as const;

export class WorktreeDiffError extends Error {
    constructor(
        message: string,
        readonly code: 'worktree_missing' | 'invalid_path',
    ) {
        super(message);
        this.name = 'WorktreeDiffError';
    }
}

interface GitResult {
    code: number;
    stdout: Buffer;
    stderr: string;
}

/**
 * Never rejects. Non-zero exit is a normal outcome here: `git diff --no-index`
 * exits 1 when the files differ, which IS the success path, and `rev-parse
 * --verify --quiet` exits 1 for a ref that simply doesn't exist.
 */
async function runGit(worktreePath: string, args: string[]): Promise<GitResult> {
    try {
        const res = await exec('git', ['-C', worktreePath, ...args], {
            encoding: 'buffer',
            env: gitInvokeEnv(null),
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: GIT_MAX_BUFFER,
        });
        return { code: 0, stdout: res.stdout, stderr: res.stderr.toString('utf8') };
    } catch (err) {
        const e = err as NodeJS.ErrnoException & {
            code?: number | string;
            stdout?: Buffer;
            stderr?: Buffer;
        };
        return {
            code: typeof e.code === 'number' ? e.code : -1,
            stdout: e.stdout ?? Buffer.alloc(0),
            stderr: e.stderr?.toString('utf8') ?? e.message,
        };
    }
}

/**
 * Split NUL-separated git output at the BYTE level, then decode each field.
 * Decoding first would risk mangling path bytes before the record boundary is
 * found. The final NUL yields a trailing empty slice, which we drop.
 */
function splitNulFields(buf: Buffer): string[] {
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0) {
            out.push(buf.subarray(start, i).toString('utf8'));
            start = i + 1;
        }
    }
    if (start < buf.length) out.push(buf.subarray(start).toString('utf8'));
    return out;
}

interface NumstatEntry {
    path: string;
    oldPath: string | null;
    additions: number;
    deletions: number;
    binary: boolean;
}

/**
 * `git diff --numstat -z` has TWO record layouts:
 *   normal  `adds\tdels\tpath` NUL
 *   rename  `adds\tdels\t`     NUL `old` NUL `new` NUL   <- third field empty
 * Binary files report `-` for both counts. A naive split mis-associates every
 * file after the first rename, so this has to be a pointer walk.
 */
export function parseNumstatZ(buf: Buffer): NumstatEntry[] {
    const fields = splitNulFields(buf);
    const out: NumstatEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
        const rec = fields[i] ?? '';
        if (rec.length === 0) continue;
        const t1 = rec.indexOf('\t');
        const t2 = rec.indexOf('\t', t1 + 1);
        if (t1 < 0 || t2 < 0) continue;
        const addStr = rec.slice(0, t1);
        const delStr = rec.slice(t1 + 1, t2);
        const inline = rec.slice(t2 + 1);
        let oldPath: string | null = null;
        let path: string;
        if (inline === '') {
            oldPath = fields[++i] ?? '';
            path = fields[++i] ?? '';
        } else {
            path = inline;
        }
        const binary = addStr === '-' || delStr === '-';
        out.push({
            path,
            oldPath,
            additions: binary ? 0 : Number(addStr) || 0,
            deletions: binary ? 0 : Number(delStr) || 0,
            binary,
        });
    }
    return out;
}

type TrackedStatus = Exclude<CliSessionDiffFile['status'], 'untracked'>;

interface NameStatusEntry {
    path: string;
    oldPath: string | null;
    status: TrackedStatus;
}

function statusFromLetter(letter: string): TrackedStatus {
    switch (letter) {
        case 'A':
            return 'added';
        case 'D':
            return 'deleted';
        case 'R':
            return 'renamed';
        case 'C':
            return 'copied';
        case 'T':
            return 'type_changed';
        default:
            return 'modified';
    }
}

/**
 * `git diff --name-status -z` alternates status token and path(s):
 *   `M` NUL `path` NUL
 *   `R100` NUL `old` NUL `new` NUL     <- rename/copy spend TWO path fields
 */
export function parseNameStatusZ(buf: Buffer): NameStatusEntry[] {
    const fields = splitNulFields(buf);
    const out: NameStatusEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
        const token = fields[i] ?? '';
        if (token.length === 0) continue;
        const letter = token[0] ?? 'M';
        if (letter === 'R' || letter === 'C') {
            const oldPath = fields[++i] ?? '';
            const path = fields[++i] ?? '';
            out.push({ path, oldPath, status: statusFromLetter(letter) });
        } else {
            const path = fields[++i] ?? '';
            if (path.length === 0) continue;
            out.push({ path, oldPath: null, status: statusFromLetter(letter) });
        }
    }
    return out;
}

interface PorcelainEntry {
    code: string;
    path: string;
    untracked: boolean;
}

/**
 * `git status --porcelain -z`. A rename/copy (`R`/`C` in either column) spends
 * an EXTRA NUL field on the origin path, with no `XY ` prefix — and in `-z`
 * the order is `to` then `from`, reversed from the human-readable format.
 */
export function parsePorcelainZ(buf: Buffer): PorcelainEntry[] {
    const fields = splitNulFields(buf);
    const out: PorcelainEntry[] = [];
    for (let i = 0; i < fields.length; i++) {
        const raw = fields[i] ?? '';
        if (raw.length < 4) continue;
        const code = raw.slice(0, 2);
        const path = raw.slice(3);
        if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') i++;
        out.push({ code, path, untracked: code === '??' });
    }
    return out;
}

/**
 * Rejects anything that could escape the worktree or be read as a git flag.
 * `--` placement in the argv is the primary defence and the changed-file
 * membership check is the real access control; this is the third layer.
 */
export function normalizeRelPath(input: string): string {
    if (input.length === 0) throw new WorktreeDiffError('empty path', 'invalid_path');
    for (let i = 0; i < input.length; i++) {
        if (input.charCodeAt(i) < 0x20) {
            throw new WorktreeDiffError('path contains a control character', 'invalid_path');
        }
    }
    if (input.startsWith('-')) {
        throw new WorktreeDiffError('path may not start with "-"', 'invalid_path');
    }
    if (
        input.startsWith('/') ||
        input.startsWith('\\') ||
        /^[A-Za-z]:/.test(input)
    ) {
        throw new WorktreeDiffError('path must be worktree-relative', 'invalid_path');
    }
    const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = normalized.split('/');
    if (segments.some((s) => s === '..')) {
        throw new WorktreeDiffError('path may not traverse upward', 'invalid_path');
    }
    if (segments[0] === '.git') {
        throw new WorktreeDiffError('path may not reach into .git', 'invalid_path');
    }
    return normalized;
}

function emptyScope(): CliSessionDiffScope {
    return { files: [], total_files: 0, truncated: false, additions: 0, deletions: 0 };
}

/** Sort, cap, and total a scope's files. Totals span the UNCAPPED set. */
function finalizeScope(all: CliSessionDiffFile[]): CliSessionDiffScope {
    // Byte order, not locale — Windows dev and Linux CI must agree.
    all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    let additions = 0;
    let deletions = 0;
    for (const f of all) {
        additions += f.additions;
        deletions += f.deletions;
    }
    return {
        files: all.slice(0, MAX_FILES_PER_SCOPE),
        total_files: all.length,
        truncated: all.length > MAX_FILES_PER_SCOPE,
        additions,
        deletions,
    };
}

/** Merge name-status (authoritative for status/old_path) with numstat counts. */
function mergeTracked(
    nameStatus: NameStatusEntry[],
    numstat: NumstatEntry[],
    codeByPath: Map<string, string> | null,
): Map<string, CliSessionDiffFile> {
    const map = new Map<string, CliSessionDiffFile>();
    for (const ns of nameStatus) {
        if (!ns.path) continue;
        map.set(ns.path, {
            path: ns.path,
            old_path: ns.oldPath,
            status: ns.status,
            code: codeByPath?.get(ns.path) ?? null,
            additions: 0,
            deletions: 0,
            binary: false,
            too_large: false,
        });
    }
    for (const n of numstat) {
        const entry = map.get(n.path);
        if (!entry) continue;
        entry.additions = n.additions;
        entry.deletions = n.deletions;
        entry.binary = n.binary;
    }
    return map;
}

/**
 * Count lines in an untracked file without spawning a subprocess per path —
 * on Windows each `git` spawn is ~30-60 ms, so 200 new files would cost 10+
 * seconds. Slight imprecision vs `--numstat` for a file with no trailing
 * newline; the authoritative number is in the patch the user actually opens.
 */
async function describeUntracked(
    worktreePath: string,
    paths: string[],
): Promise<CliSessionDiffFile[]> {
    const out: CliSessionDiffFile[] = [];
    let budget = MAX_UNTRACKED_TOTAL_BYTES;
    for (const p of paths) {
        const base: CliSessionDiffFile = {
            path: p,
            old_path: null,
            status: 'untracked',
            code: '??',
            additions: 0,
            deletions: 0,
            binary: false,
            too_large: false,
        };
        try {
            const info = await stat(join(worktreePath, p));
            if (!info.isFile()) continue;
            if (info.size > MAX_UNTRACKED_FILE_BYTES || info.size > budget) {
                out.push({ ...base, too_large: true });
                continue;
            }
            budget -= info.size;
            const buf = await readFile(join(worktreePath, p));
            const sniff = buf.subarray(0, BINARY_SNIFF_BYTES);
            if (sniff.includes(0)) {
                out.push({ ...base, binary: true });
                continue;
            }
            let lines = 0;
            for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) lines++;
            if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) lines++;
            out.push({ ...base, additions: lines });
        } catch {
            // The live PTY can delete a file between the status call and the
            // read. Skip it rather than reporting a file that no longer exists.
            continue;
        }
    }
    return out;
}

async function refExists(worktreePath: string, ref: string): Promise<boolean> {
    const res = await runGit(worktreePath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return res.code === 0 && res.stdout.length > 0;
}

/**
 * Resolve the ref the committed scope is measured against. Ordered most- to
 * least-specific, ending in "no base at all" (a `git init`'d project with no
 * remote and a non-standard branch name) rather than an error.
 */
async function resolveBaseRef(
    worktreePath: string,
    defaultBranch: string | null,
): Promise<string | null> {
    const candidates: string[] = [];
    if (defaultBranch) candidates.push(`origin/${defaultBranch}`);
    const symbolic = await runGit(worktreePath, [
        'symbolic-ref',
        '--quiet',
        'refs/remotes/origin/HEAD',
    ]);
    if (symbolic.code === 0) {
        const ref = symbolic.stdout.toString('utf8').trim();
        if (ref) candidates.push(ref);
    }
    candidates.push('origin/main', 'origin/master');
    if (defaultBranch) candidates.push(defaultBranch);
    candidates.push('main', 'master');

    for (const cand of candidates) {
        if (await refExists(worktreePath, cand)) return cand;
    }
    return null;
}

/** `HEAD` normally; the empty tree when HEAD is unborn (no commits yet). */
async function resolveHeadRef(worktreePath: string): Promise<string> {
    return (await refExists(worktreePath, 'HEAD')) ? 'HEAD' : EMPTY_TREE_SHA;
}

function assertWorktree(worktreePath: string): void {
    // Closed sessions deliberately RETAIN worktree_path after the directory is
    // deleted (see the comment in routes/cli-sessions.ts), so this is a real
    // runtime case, not a defensive check.
    if (!worktreePath || !existsSync(join(worktreePath, '.git'))) {
        throw new WorktreeDiffError(
            `worktree at ${worktreePath} is missing or not a git repo`,
            'worktree_missing',
        );
    }
}

interface ScopeRefs {
    /** Left-hand side of the diff. */
    baseSha: string | null;
    headRef: string;
}

async function committedRefs(
    worktreePath: string,
    defaultBranch: string | null,
): Promise<{ baseRef: string | null; refs: ScopeRefs }> {
    const headRef = await resolveHeadRef(worktreePath);
    const baseRef = await resolveBaseRef(worktreePath, defaultBranch);
    if (!baseRef || headRef === EMPTY_TREE_SHA) {
        return { baseRef: null, refs: { baseSha: null, headRef } };
    }
    const mb = await runGit(worktreePath, ['merge-base', baseRef, headRef]);
    const baseSha = mb.code === 0 ? mb.stdout.toString('utf8').trim() : '';
    if (!/^[0-9a-f]{40}$/.test(baseSha)) {
        return { baseRef: null, refs: { baseSha: null, headRef } };
    }
    return { baseRef, refs: { baseSha, headRef } };
}

export async function getWorktreeDiffSummary(opts: {
    worktreePath: string;
    defaultBranch: string | null;
}): Promise<CliSessionDiffSummaryResponse> {
    const { worktreePath, defaultBranch } = opts;
    assertWorktree(worktreePath);

    const headRef = await resolveHeadRef(worktreePath);

    const [numstatRes, nameStatusRes, porcelainRes, branchRes] = await Promise.all([
        runGit(worktreePath, [
            '--no-pager', 'diff', ...DIFF_FLAGS, '--numstat', '-z', '--find-renames', headRef,
        ]),
        runGit(worktreePath, [
            '--no-pager', 'diff', ...DIFF_FLAGS, '--name-status', '-z', '--find-renames', headRef,
        ]),
        // `--untracked-files=all` (not the default `normal`) so an untracked
        // DIRECTORY lists its individual files instead of collapsing to `dir/`.
        // `git add -- <file>` still works, so staging semantics are unchanged.
        runGit(worktreePath, ['status', '--porcelain', '-z', '--untracked-files=all']),
        runGit(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    ]);

    const porcelain = parsePorcelainZ(porcelainRes.stdout);
    const codeByPath = new Map<string, string>();
    const untrackedPaths: string[] = [];
    for (const p of porcelain) {
        if (p.untracked) untrackedPaths.push(p.path);
        else codeByPath.set(p.path, p.code);
    }

    const uncommittedMap = mergeTracked(
        parseNameStatusZ(nameStatusRes.stdout),
        parseNumstatZ(numstatRes.stdout),
        codeByPath,
    );
    for (const u of await describeUntracked(worktreePath, untrackedPaths)) {
        // `git diff HEAD` never reports an untracked path, so a collision is
        // impossible; guard anyway so a race can't double-list a file.
        if (!uncommittedMap.has(u.path)) uncommittedMap.set(u.path, u);
    }

    const { baseRef, refs } = await committedRefs(worktreePath, defaultBranch);
    let committed = emptyScope();
    let commitsAhead = 0;
    if (baseRef && refs.baseSha) {
        const [cNumstat, cNameStatus, cCount] = await Promise.all([
            runGit(worktreePath, [
                '--no-pager', 'diff', ...DIFF_FLAGS, '--numstat', '-z', '--find-renames',
                refs.baseSha, refs.headRef,
            ]),
            runGit(worktreePath, [
                '--no-pager', 'diff', ...DIFF_FLAGS, '--name-status', '-z', '--find-renames',
                refs.baseSha, refs.headRef,
            ]),
            runGit(worktreePath, ['rev-list', '--count', `${refs.baseSha}..${refs.headRef}`]),
        ]);
        committed = finalizeScope([
            ...mergeTracked(
                parseNameStatusZ(cNameStatus.stdout),
                parseNumstatZ(cNumstat.stdout),
                null,
            ).values(),
        ]);
        const n = Number(cCount.stdout.toString('utf8').trim());
        commitsAhead = Number.isFinite(n) ? n : 0;
    }

    return {
        uncommitted: finalizeScope([...uncommittedMap.values()]),
        committed,
        current_branch: branchRes.stdout.toString('utf8').trim(),
        base_ref: baseRef,
        base_sha: refs.baseSha,
        commits_ahead_of_base: commitsAhead,
    };
}

/** Cheap membership probe — index-only, no content scan. */
async function findInScope(
    worktreePath: string,
    defaultBranch: string | null,
    scope: CliSessionDiffScopeName,
    path: string,
): Promise<{ file: CliSessionDiffFile; refs: ScopeRefs } | null> {
    const headRef = await resolveHeadRef(worktreePath);
    if (scope === 'uncommitted') {
        const [nameStatusRes, porcelainRes] = await Promise.all([
            runGit(worktreePath, [
                '--no-pager', 'diff', ...DIFF_FLAGS, '--name-status', '-z', '--find-renames', headRef,
            ]),
            runGit(worktreePath, ['status', '--porcelain', '-z', '--untracked-files=all']),
        ]);
        for (const ns of parseNameStatusZ(nameStatusRes.stdout)) {
            if (ns.path !== path) continue;
            return {
                file: {
                    path: ns.path,
                    old_path: ns.oldPath,
                    status: ns.status,
                    code: null,
                    additions: 0,
                    deletions: 0,
                    binary: false,
                    too_large: false,
                },
                refs: { baseSha: null, headRef },
            };
        }
        for (const p of parsePorcelainZ(porcelainRes.stdout)) {
            if (!p.untracked || p.path !== path) continue;
            return {
                file: {
                    path: p.path,
                    old_path: null,
                    status: 'untracked',
                    code: p.code,
                    additions: 0,
                    deletions: 0,
                    binary: false,
                    too_large: false,
                },
                refs: { baseSha: null, headRef },
            };
        }
        return null;
    }

    const { baseRef, refs } = await committedRefs(worktreePath, defaultBranch);
    if (!baseRef || !refs.baseSha) return null;
    const nameStatusRes = await runGit(worktreePath, [
        '--no-pager', 'diff', ...DIFF_FLAGS, '--name-status', '-z', '--find-renames',
        refs.baseSha, refs.headRef,
    ]);
    for (const ns of parseNameStatusZ(nameStatusRes.stdout)) {
        if (ns.path !== path) continue;
        return {
            file: {
                path: ns.path,
                old_path: ns.oldPath,
                status: ns.status,
                code: null,
                additions: 0,
                deletions: 0,
                binary: false,
                too_large: false,
            },
            refs,
        };
    }
    return null;
}

const BINARY_MARKER = /^Binary files .* differ$/m;

function buildPatchResponse(
    path: string,
    scope: CliSessionDiffScopeName,
    stdout: Buffer,
): CliSessionFilePatchResponse {
    const byteSize = stdout.length;
    const head = stdout.subarray(0, BINARY_SNIFF_BYTES);
    if (head.includes(0) || BINARY_MARKER.test(head.toString('utf8'))) {
        return { path, scope, patch: null, binary: true, truncated: false, byte_size: byteSize };
    }
    if (byteSize > MAX_PATCH_BYTES) {
        return { path, scope, patch: null, binary: false, truncated: true, byte_size: byteSize };
    }
    let lines = 0;
    for (let i = 0; i < stdout.length; i++) if (stdout[i] === 0x0a) lines++;
    if (lines > MAX_PATCH_LINES) {
        return { path, scope, patch: null, binary: false, truncated: true, byte_size: byteSize };
    }
    return {
        path,
        scope,
        patch: stdout.toString('utf8'),
        binary: false,
        truncated: false,
        byte_size: byteSize,
    };
}

/** Returns null when `path` is not a changed file in `scope` (route -> 404). */
export async function getWorktreeFilePatch(opts: {
    worktreePath: string;
    defaultBranch: string | null;
    scope: CliSessionDiffScopeName;
    path: string;
    context: number;
}): Promise<CliSessionFilePatchResponse | null> {
    const { worktreePath, defaultBranch, scope, context } = opts;
    assertWorktree(worktreePath);
    const path = normalizeRelPath(opts.path);

    const found = await findInScope(worktreePath, defaultBranch, scope, path);
    if (!found) return null;
    const { file, refs } = found;

    // A rename must pass BOTH sides in the pathspec. `-- <newPath>` alone
    // filters out the pre-image, which kills rename detection and renders the
    // file as a wholesale add.
    const pathspec = file.old_path ? [file.old_path, path] : [path];

    let res: GitResult;
    if (file.status === 'untracked') {
        // `git diff` cannot see untracked files. `--no-index /dev/null <path>`
        // yields a real git patch (new file mode, --- /dev/null, hunks) rather
        // than one we hand-synthesize. git special-cases the literal
        // "/dev/null" internally, so this works on Windows too.
        //
        // It exits 1 when the files differ — that IS success here. runGit
        // never throws, so `code` just distinguishes 0/1 (fine) from >=2.
        res = await runGit(worktreePath, [
            '--no-pager', 'diff', ...DIFF_FLAGS, '--no-index', `--unified=${context}`,
            '--', '/dev/null', path,
        ]);
        if (res.code !== 0 && res.code !== 1) {
            return { path, scope, patch: null, binary: false, truncated: true, byte_size: 0 };
        }
    } else if (scope === 'uncommitted') {
        res = await runGit(worktreePath, [
            '--no-pager', 'diff', ...DIFF_FLAGS, `--unified=${context}`, '--find-renames',
            refs.headRef, '--', ...pathspec,
        ]);
    } else {
        // `findInScope` returns null for the committed scope whenever the base
        // didn't resolve, so reaching here guarantees a 40-hex baseSha. TS
        // can't see that across the function boundary.
        res = await runGit(worktreePath, [
            '--no-pager', 'diff', ...DIFF_FLAGS, `--unified=${context}`, '--find-renames',
            refs.baseSha as string, refs.headRef, '--', ...pathspec,
        ]);
    }

    return buildPatchResponse(path, scope, res.stdout);
}
