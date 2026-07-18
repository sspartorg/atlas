// Git log format for the `GET /api/projects/:id/head` route. We embed an
// explicit unit-separator (`\x1f`, ASCII 0x1F) between fields so the subject
// can contain anything — colons, parens, mid-dots, the words "abc" — without
// poisoning the parse. A prior version used `%h%s%cr` (no delimiter at all)
// and split on the empty string, which yielded a one-character-per-field
// "abc1234fix: thing2 hours ago" → ['a','b','c',...] — exactly the symptom
// the user reported on the project card ("9.9 · . (E)").
export const GIT_HEAD_FORMAT = '%h%x1f%s%x1f%cr';

export interface GitHeadInfo {
    short_sha: string | null;
    subject: string | null;
    relative_time: string | null;
}

const NULL_HEAD: GitHeadInfo = { short_sha: null, subject: null, relative_time: null };

export function parseGitHeadOutput(stdout: string): GitHeadInfo {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return NULL_HEAD;
    const parts = trimmed.split('\x1f');
    return {
        // `parts[0]` always exists after split; the `?? null` null arm is unreachable.
        /* v8 ignore next */
        short_sha: parts[0] ?? null,
        subject: parts[1] ?? null,
        relative_time: parts[2] ?? null,
    };
}
