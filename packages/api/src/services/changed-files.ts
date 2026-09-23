import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const exec = promisify(execFile);

// `.atlas/changed-files.md` — what this branch has touched, staged once per run.
//
// The PR1 baseline measured where the tokens actually go: 18.25M cache-read
// tokens against 550 uncached input tokens, averaging ~480K cached tokens per
// dispatch. Almost none of that is the prompt — it is the agent pulling the
// repository into context turn after turn, and every reviewer and fixer that
// runs after a performer re-derives the same diff from scratch.
//
// So the saving is not a shorter prompt (a 1.5K prompt is 0.3% of one
// dispatch's context). It is handing the agent the answer to "what changed?"
// before it starts looking. `git diff --name-status` plus a `--stat` summary is
// a few hundred tokens and replaces an exploratory crawl.
//
// Written for every run, not only reviewer runs: a Coder benefits from seeing
// what earlier sub-tasks already committed on the same branch (ADR 0015 runs
// them one at a time in one worktree), which is exactly the context it
// otherwise rediscovers with `git log` and a handful of reads.

/** Keep the file bounded — a rename-heavy refactor can touch thousands of paths. */
export const MAX_LISTED_FILES = 300;

export interface ChangedFilesInput {
    /** The ref the branch diverged from, e.g. `origin/main`. */
    base: string;
    /** `git diff --name-status <mergeBase>..HEAD` output. */
    committed: string;
    /** `git diff --stat <mergeBase>..HEAD` output (last line is the summary). */
    stat: string;
    /** `git status --porcelain` output — work not yet committed. */
    dirty: string;
}

const STATUS_LABELS: Record<string, string> = {
    A: 'added',
    M: 'modified',
    D: 'deleted',
    R: 'renamed',
    C: 'copied',
    T: 'type changed',
};

function describe(code: string): string {
    // Rename/copy codes carry a similarity score (`R096`); the letter is the verb.
    const letter = code.charAt(0);
    return STATUS_LABELS[letter] ?? code;
}

/**
 * Render the staged markdown. Pure — every git call happens in the caller, so
 * the formatting that agents actually read is unit-testable without a repo.
 */
export function renderChangedFiles(input: ChangedFilesInput): string {
    const lines: string[] = ['# Changed files', ''];
    lines.push(
        `Everything this branch has touched relative to \`${input.base}\`. ` +
            'Read this before searching the repository — it is the answer to "what changed?".',
        '',
    );

    const rows = input.committed
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
            const parts = l.split(/\t+/);
            const code = parts[0] ?? '';
            // A rename row is `R096\told\tnew`; the destination is what exists now.
            const path = (parts.length > 2 ? parts[parts.length - 1] : parts[1]) ?? '';
            return { code, path };
        })
        .filter((r) => r.path.length > 0);

    if (rows.length === 0) {
        lines.push('## Committed on this branch', '', '_Nothing yet._', '');
    } else {
        const shown = rows.slice(0, MAX_LISTED_FILES);
        lines.push(`## Committed on this branch (${rows.length})`, '');
        for (const r of shown) lines.push(`- \`${r.path}\` — ${describe(r.code)}`);
        if (rows.length > shown.length) {
            lines.push(`- _…and ${rows.length - shown.length} more; run \`git diff --name-status ${input.base}...HEAD\` for the full list._`);
        }
        lines.push('');
    }

    // `--stat`'s final line is the "N files changed, …" summary; the per-file
    // rows above it duplicate the list we just rendered.
    const statLines = input.stat.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const summary = statLines[statLines.length - 1];
    if (summary && /files? changed/.test(summary)) {
        lines.push(`**${summary}**`, '');
    }

    const dirtyRows = input.dirty.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (dirtyRows.length > 0) {
        const shown = dirtyRows.slice(0, MAX_LISTED_FILES);
        lines.push(`## Uncommitted in the working tree (${dirtyRows.length})`, '');
        for (const r of shown) lines.push(`- \`${r.trim()}\``);
        if (dirtyRows.length > shown.length) {
            lines.push(`- _…and ${dirtyRows.length - shown.length} more._`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
}

/**
 * Resolve the ref this branch diverged from.
 *
 * `origin/HEAD` is the honest answer but is only present when the clone set it
 * up, so `main` and `master` are tried in turn. Returning null when none
 * resolve is deliberate: a worktree with no remote is a legitimate state (a
 * fresh local repo in a test), and staging nothing is better than staging a
 * diff against the wrong ref.
 */
export async function resolveBaseRef(cwd: string): Promise<string | null> {
    try {
        const head = (await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
        if (head) return head;
    } catch {
        /* not set up — fall through to the conventional names */
    }
    for (const candidate of ['origin/main', 'origin/master']) {
        try {
            await git(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
            return candidate;
        } catch {
            /* try the next one */
        }
    }
    return null;
}

/**
 * Write `<worktree>/.atlas/changed-files.md`. Returns the path, or null when
 * the diff could not be computed.
 *
 * Best-effort: this is context, not correctness. A repo with no remote, a
 * detached HEAD, or a git that errors for any reason must not fail the run —
 * the agent simply explores the way it did before.
 */
export async function writeChangedFiles(worktreePath: string): Promise<string | null> {
    try {
        const base = await resolveBaseRef(worktreePath);
        if (!base) return null;
        const mergeBase = (await git(worktreePath, ['merge-base', 'HEAD', base])).trim();
        if (!mergeBase) return null;

        const [committed, stat, dirty] = await Promise.all([
            git(worktreePath, ['diff', '--name-status', `${mergeBase}..HEAD`]),
            git(worktreePath, ['diff', '--stat', `${mergeBase}..HEAD`]),
            git(worktreePath, ['status', '--porcelain']),
        ]);

        const atlasDir = join(worktreePath, '.atlas');
        mkdirSync(atlasDir, { recursive: true });
        const path = join(atlasDir, 'changed-files.md');
        writeFileSync(path, renderChangedFiles({ base, committed, stat, dirty }), 'utf8');
        return path;
    } catch (err) {
        console.warn('[changed-files] could not stage the diff summary:', err);
        return null;
    }
}
