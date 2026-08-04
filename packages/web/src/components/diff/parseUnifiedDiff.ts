// 2026-08-04 — Terminal finalize diff.
//
// Parses git's own unified-diff output. It does NOT re-derive a diff: git
// already decided what changed (including rename detection), so this is a
// single linear pass that reads structure out of the patch text.
//
// Gotchas this handles that a naive parser gets wrong:
//
//   * An EMPTY context line is emitted by git as a ZERO-LENGTH line, not as
//     a single space. `line[0] === ' '` misclassifies it, which desynchronises
//     every line number after the first blank line in a file.
//   * `\r` must survive on content lines — for a CRLF file that byte IS file
//     content. Only header candidates get a trailing `\r` stripped.
//   * `@@ -1 +1 @@` is legal; omitted counts default to 1.
//   * Paths can contain spaces, so `diff --git a/x b/y` must never be split
//     on whitespace. `--- a/…` / `+++ b/…` are authoritative instead.

type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
    kind: DiffLineKind;
    /** 1-based line in the OLD file; null for additions. */
    oldLine: number | null;
    /** 1-based line in the NEW file; null for deletions. */
    newLine: number | null;
    /** Content WITHOUT the leading +/-/space sigil. Never contains '\n'. */
    content: string;
    /** git emitted `\ No newline at end of file` right after this line. */
    noNewline: boolean;
}

export interface DiffHunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    /** Trailing text on the @@ header — git's enclosing-function hint. */
    heading: string;
    lines: DiffLine[];
}

type ParsedFileStatus =
    | 'added'
    | 'deleted'
    | 'modified'
    | 'renamed'
    | 'copied'
    | 'type_changed';

export interface ParsedFile {
    /** null when /dev/null (file added). */
    oldPath: string | null;
    /** null when /dev/null (file deleted). */
    newPath: string | null;
    /** Display path: newPath ?? oldPath ?? ''. */
    path: string;
    status: ParsedFileStatus;
    binary: boolean;
    /** `similarity index N%` from a rename/copy header, else null. */
    similarity: number | null;
    hunks: DiffHunk[];
    additions: number;
    deletions: number;
    truncated: boolean;
}

export interface ParsedPatch {
    files: ParsedFile[];
    truncated: boolean;
}

/**
 * Defence in depth behind the server's own cap. A patch bigger than this in
 * the browser means a locked tab, and nobody reviews 50k lines in a modal.
 */
const DEFAULT_MAX_LINES = 50_000;

/** Strip one trailing CR — only ever applied to header candidates. */
function header(line: string): string {
    return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Decode git's C-quoted path form (`"a/caf\303\251.ts"`). git only quotes when
 * `core.quotepath` is on and the path has non-ASCII or control bytes; the
 * octal escapes are UTF-8 BYTES, so they're collected and decoded together.
 */
function unquotePath(raw: string): string {
    if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
    const body = raw.slice(1, -1);
    const bytes: number[] = [];
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch !== '\\') {
            for (const b of new TextEncoder().encode(ch)) bytes.push(b);
            continue;
        }
        const next = body[++i];
        if (next === undefined) break;
        if (next >= '0' && next <= '7') {
            const oct = next + (body[i + 1] ?? '') + (body[i + 2] ?? '');
            const m = /^[0-7]{1,3}/.exec(oct)?.[0] ?? next;
            i += m.length - 1;
            bytes.push(parseInt(m, 8));
            continue;
        }
        const simple: Record<string, number> = {
            t: 0x09, n: 0x0a, r: 0x0d, '"': 0x22, '\\': 0x5c,
        };
        bytes.push(simple[next] ?? next.charCodeAt(0));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `--- a/src/x.ts` -> `src/x.ts`; `--- /dev/null` -> null. */
function sidePath(rest: string): string | null {
    const value = unquotePath(rest.trim());
    if (value === '/dev/null') return null;
    if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2);
    return value;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function blankFile(): ParsedFile {
    return {
        oldPath: null,
        newPath: null,
        path: '',
        status: 'modified',
        binary: false,
        similarity: null,
        hunks: [],
        additions: 0,
        deletions: 0,
        truncated: false,
    };
}

export function parseUnifiedDiff(
    patchText: string,
    opts?: { maxLines?: number },
): ParsedPatch {
    const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES;
    const files: ParsedFile[] = [];
    let patchTruncated = false;

    if (!patchText || patchText.trim().length === 0) {
        return { files: [], truncated: false };
    }

    const lines = patchText.split('\n');
    // A patch ends with a newline, so `split` leaves one trailing empty
    // element. Inside a hunk we read a zero-length line as an EMPTY CONTEXT
    // line, so that artifact would otherwise append a phantom context row and
    // shift the trailing gutter numbers by one. Drop exactly one: a genuine
    // empty context line at the end of a hunk is still followed by the
    // patch's own trailing newline, so it produces TWO empties and survives.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    let current: ParsedFile | null = null;
    let hunk: DiffHunk | null = null;
    let oldNo = 0;
    let newNo = 0;
    /** Set while skipping a combined (merge) diff we can't render. */
    let skippingCombined = false;

    const finishFile = (): void => {
        if (current) files.push(current);
        current = null;
        hunk = null;
        skippingCombined = false;
    };
    const ensureFile = (): ParsedFile => {
        if (!current) current = blankFile();
        return current;
    };
    const settlePaths = (f: ParsedFile): void => {
        f.path = f.newPath ?? f.oldPath ?? '';
    };

    for (let i = 0; i < lines.length; i++) {
        if (i > maxLines) {
            patchTruncated = true;
            if (current) current.truncated = true;
            break;
        }
        const raw = lines[i] ?? '';
        const h = header(raw);

        if (h.startsWith('diff --git ')) {
            finishFile();
            current = blankFile();
            continue;
        }

        // Combined diffs (`@@@`) only occur for merge commits, which neither
        // of our two scopes can produce. Skip rather than crash if one shows up.
        if (h.startsWith('@@@')) {
            const f = ensureFile();
            f.truncated = true;
            patchTruncated = true;
            skippingCombined = true;
            hunk = null;
            continue;
        }

        const hunkMatch = HUNK_RE.exec(h);
        if (hunkMatch) {
            skippingCombined = false;
            const f = ensureFile();
            const oldStart = Number(hunkMatch[1]);
            // Omitted count means 1 (`@@ -1 +1 @@`).
            const oldCount = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
            const newStart = Number(hunkMatch[3]);
            const newCount = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
            hunk = {
                oldStart,
                oldCount,
                newStart,
                newCount,
                heading: hunkMatch[5] ?? '',
                lines: [],
            };
            f.hunks.push(hunk);
            // Numbers are WALKED from the starts, never trusted from the
            // counts — a malformed count must not desync the gutters.
            oldNo = oldStart;
            newNo = newStart;
            continue;
        }

        if (skippingCombined) continue;

        if (hunk) {
            if (h.startsWith('\\')) {
                // `\ No newline at end of file` attaches to the line before.
                // git emits it after the `-` variant AND the `+` variant, so
                // both can carry it.
                const last = hunk.lines[hunk.lines.length - 1];
                if (last) last.noNewline = true;
                continue;
            }
            // A new file header ends the hunk even without a blank separator.
            if (h.startsWith('diff --git ')) {
                i--;
                hunk = null;
                continue;
            }
            const sigil = raw.length === 0 ? ' ' : raw[0];
            if (sigil === '+') {
                hunk.lines.push({
                    kind: 'add',
                    oldLine: null,
                    newLine: newNo++,
                    content: raw.slice(1),
                    noNewline: false,
                });
                ensureFile().additions++;
                continue;
            }
            if (sigil === '-') {
                hunk.lines.push({
                    kind: 'del',
                    oldLine: oldNo++,
                    newLine: null,
                    content: raw.slice(1),
                    noNewline: false,
                });
                ensureFile().deletions++;
                continue;
            }
            if (sigil === ' ') {
                // Zero-length line == empty context line. `raw.slice(1)` on an
                // empty string is '' either way, which is what we want.
                hunk.lines.push({
                    kind: 'context',
                    oldLine: oldNo++,
                    newLine: newNo++,
                    content: raw.length === 0 ? '' : raw.slice(1),
                    noNewline: false,
                });
                continue;
            }
            // Anything else terminates the hunk (trailing junk, next header).
            hunk = null;
            i--;
            continue;
        }

        if (h.startsWith('--- ')) {
            const f = ensureFile();
            f.oldPath = sidePath(h.slice(4));
            settlePaths(f);
            continue;
        }
        if (h.startsWith('+++ ')) {
            const f = ensureFile();
            f.newPath = sidePath(h.slice(4));
            settlePaths(f);
            continue;
        }
        if (h.startsWith('new file mode')) {
            ensureFile().status = 'added';
            continue;
        }
        if (h.startsWith('deleted file mode')) {
            ensureFile().status = 'deleted';
            continue;
        }
        if (h.startsWith('similarity index')) {
            const pct = /(\d+)%/.exec(h);
            if (pct) ensureFile().similarity = Number(pct[1]);
            continue;
        }
        if (h.startsWith('rename from ')) {
            const f = ensureFile();
            f.status = 'renamed';
            f.oldPath = unquotePath(h.slice('rename from '.length));
            settlePaths(f);
            continue;
        }
        if (h.startsWith('rename to ')) {
            const f = ensureFile();
            f.status = 'renamed';
            f.newPath = unquotePath(h.slice('rename to '.length));
            settlePaths(f);
            continue;
        }
        if (h.startsWith('copy from ')) {
            const f = ensureFile();
            f.status = 'copied';
            f.oldPath = unquotePath(h.slice('copy from '.length));
            settlePaths(f);
            continue;
        }
        if (h.startsWith('copy to ')) {
            const f = ensureFile();
            f.status = 'copied';
            f.newPath = unquotePath(h.slice('copy to '.length));
            settlePaths(f);
            continue;
        }
        if (h.startsWith('old mode ') || h.startsWith('new mode ')) {
            const f = ensureFile();
            if (f.status === 'modified') f.status = 'type_changed';
            continue;
        }
        if (h.startsWith('Binary files ') || h.startsWith('GIT binary patch')) {
            const f = ensureFile();
            f.binary = true;
            // Never attempt the base85 payload.
            continue;
        }
        // `index <sha>..<sha>`, mode lines, and any other metadata: ignored.
    }

    finishFile();

    for (const f of files) {
        if (f.path === '') settlePaths(f);
        if (f.status === 'modified') {
            if (f.oldPath === null && f.newPath !== null) f.status = 'added';
            else if (f.newPath === null && f.oldPath !== null) f.status = 'deleted';
        }
    }

    return { files, truncated: patchTruncated };
}
