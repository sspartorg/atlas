// Theme 11 — SDLC commit discipline.
//
// One commit per chore. Every issue-attached agent run gets this
// section injected into its prompt (between Working Protocol and
// Output Instructions); the commit-verifier in `commit-verifier.ts`
// walks `git log --since <run.started_at>` after the run completes
// and audits compliance.

import type { ICommitProblem } from '@atlas/shared';

const KNOWN_TYPES = new Set([
    'feat',
    'fix',
    'refactor',
    'test',
    'docs',
    'chore',
    'perf',
    'style',
    'build',
    'ci',
]);

// Atlas issue ids look like `ATL-12` (short) or a UUID. We accept
// either. The `\b` boundaries keep partial matches from leaking.
const ATLAS_SHORT_ID_RE = /\b[A-Z]{2,4}-\d+\b/;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

// Conventional-commit subject: `type(scope): summary`. Scope is optional;
// some commits skip it (`docs: …`). The summary is whatever's after the
// colon.
const SUBJECT_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?:\s*(?<summary>.+)$/;

/**
 * Human-attribution instruction block. Injected into agent prompts by
 * `prompt-builder.ts` when the project's active credential is a
 * github_app kind with `human_name` + `human_email` set.
 *
 * We tell the agent to add the trailer via `git commit --trailer` (an
 * argv-level flag) rather than relying on a `prepare-commit-msg` hook
 * because agents follow the Husky workaround (`-c core.hooksPath=.husky/_`),
 * and that `-c` overrides any hooksPath our `GIT_CONFIG_GLOBAL` sets.
 * `--trailer` on argv is the one thing nothing can override.
 *
 * Emits the empty string when either input is missing so callers can
 * unconditionally `sections.push(buildHumanAttributionSection(...))` and
 * get a no-op fall-through for PAT-credential projects.
 */
export function buildHumanAttributionSection(
    humanName: string | null | undefined,
    humanEmail: string | null | undefined,
): string {
    if (!humanName || !humanEmail) return '';
    return [
        '# Human co-authorship trailer (MANDATORY)',
        '',
        `The developer driving this run is **${humanName}** <${humanEmail}>. Every commit you make MUST credit them via a \`Co-Authored-By:\` trailer alongside your own Claude/Copilot trailer.`,
        '',
        '## How',
        '',
        'Add a `--trailer` flag on every `git commit` invocation with the exact literal below (do not paraphrase the name or email):',
        '',
        '```bash',
        `git -c core.hooksPath=.husky/_ commit -m "..." \\`,
        `    --trailer "Co-Authored-By: ${humanName} <${humanEmail}>"`,
        '```',
        '',
        `Use \`--trailer\` (argv flag), not a hand-typed \`Co-Authored-By\` line at the bottom of the \`-m\` body — the flag is idempotent under \`--amend\` and git de-dupes matching entries. Also keep the existing \`Co-Authored-By: Claude <noreply@anthropic.com>\` trailer as a second \`--trailer\` flag on the same command; both authors then appear on the PR.`,
        '',
        '## Why',
        '',
        `The commit's primary author is the bot identity (pinned by \`user.name\` in \`GIT_CONFIG_GLOBAL\`), but every commit in this repo must also be traceable to the human developer who requested the automation. Skipping the trailer breaks the audit trail and is a compliance violation on the run, not just a stylistic issue.`,
    ].join('\n');
}

export const COMMIT_DISCIPLINE_PROMPT_SECTION = [
    '# Commit Discipline (applies to every chore)',
    '',
    'After every discrete chore — one item on your `TodoWrite` list, or one coherent file group when not using TodoWrite — you commit the change with a Conventional-Commit-style message before moving on. No batching, no dirty trees at run end.',
    '',
    '## Subject format',
    '',
    '```',
    '<type>(<scope>): <summary>',
    '```',
    '',
    '- `<type>` ∈ `feat | fix | refactor | test | docs | chore | perf | style | build | ci`',
    '- `<scope>` ∈ `api | web | shared | mcp | infra | docs` (or your role slug for cross-cutting work)',
    '- `<summary>` ≤ 60 chars, imperative mood ("add", not "added")',
    '',
    '## Body',
    '',
    'Required line: `Refs: <atlas-item-id-or-short-id>` (the item this work is against — e.g. `Refs: ATL-7`).',
    '',
    'Optional follow-on lines: WHY-the-change, not WHAT — the diff already says what.',
    '',
    '## Hard rules',
    '',
    '- Never use `git commit --no-verify`. The secretlint pre-commit hook is the last line of defense before history; fix the underlying issue if it fires.',
    '- Never amend a previous commit. Each chore = one new commit.',
    '- Empty diffs do not deserve a commit. If nothing changed, do not run `git commit`.',
    '',
    'The post-run commit verifier inspects `git log --since <your-run-start>` and surfaces compliance on the Agent Detail tab. A run that modifies files but never commits is flagged `silent`; commits with malformed subjects or a missing `Refs:` line are `partial`.',
].join('\n');

export interface ParsedCommit {
    type?: string;
    scope?: string;
    summary?: string;
    refs: string[];
    problems: ICommitProblem[];
}

/**
 * Parse a single commit message (subject + body separated by a blank
 * line). The first line is the subject; everything after is body.
 * Used by `verifyRunCommits` on each commit returned by `git log`.
 */
export function parseCommitMessage(raw: string): ParsedCommit {
    const lines = raw.split(/\r?\n/);
    // String.split always returns at least one element (even for '' or a
    // string with no separator matches), so lines[0] is never undefined —
    // the `?? ''` fallback only satisfies TS's noUncheckedIndexedAccess.
    /* v8 ignore next */
    const subject = (lines[0] ?? '').trim();
    const body = lines.slice(1).join('\n');
    const out: ParsedCommit = { refs: [], problems: [] };

    const subjectMatch = SUBJECT_RE.exec(subject);
    if (!subjectMatch || !subjectMatch.groups) {
        out.problems.push({ reason: 'subject-not-conventional' });
    } else {
        const { type, scope, summary } = subjectMatch.groups;
        // `type` is captured by the required `[a-z]+` group in SUBJECT_RE —
        // whenever subjectMatch exists, `type` is a non-empty string. The
        // falsy arm only satisfies the optional typing of `.groups`.
        /* v8 ignore next */
        if (type) out.type = type;
        if (scope) out.scope = scope;
        // `summary` is captured by the required `.+` group in SUBJECT_RE —
        // whenever subjectMatch exists, `summary` is a non-empty string. The
        // falsy arm only satisfies the optional typing of `.groups`.
        /* v8 ignore next */
        if (summary) out.summary = summary;
        if (type && !KNOWN_TYPES.has(type)) {
            out.problems.push({ reason: `unknown-type:${type}` });
        }
        if (summary && summary.length > 60) {
            out.problems.push({ reason: 'summary-too-long' });
        }
    }

    // Refs: line scan — accept either `Refs: ...` or `Ref: ...`,
    // case-insensitive. Multiple ids per line are fine.
    const refLineRe = /^\s*Refs?:\s*(.+)$/im;
    const refMatch = refLineRe.exec(body);
    if (refMatch && refMatch[1]) {
        const tokens = refMatch[1].split(/[\s,]+/).filter(Boolean);
        for (const tok of tokens) {
            if (ATLAS_SHORT_ID_RE.test(tok) || UUID_RE.test(tok)) {
                out.refs.push(tok);
            }
        }
    }

    return out;
}
