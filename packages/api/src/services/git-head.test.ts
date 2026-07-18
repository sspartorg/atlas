import { describe, expect, it } from 'vitest';
import { parseGitHeadOutput, GIT_HEAD_FORMAT } from './git-head.js';

describe('parseGitHeadOutput', () => {
    it('uses the unit-separator (US, \\x1f) field delimiter', () => {
        // Guard against silent format drift: the format must include the
        // unit-separator placeholders, or stdout has no field boundary and
        // we re-introduce the "9.9 · . (E)" parsing bug.
        expect(GIT_HEAD_FORMAT).toBe('%h%x1f%s%x1f%cr');
    });

    it('returns short_sha, subject, relative_time from a well-formed line', () => {
        const stdout = 'abc1234\x1ffeat: add login flow\x1f2 hours ago';
        expect(parseGitHeadOutput(stdout)).toEqual({
            short_sha: 'abc1234',
            subject: 'feat: add login flow',
            relative_time: '2 hours ago',
        });
    });

    it('trims surrounding whitespace and trailing newlines from git output', () => {
        const stdout = '  abc1234\x1ffix: thing\x1f5 minutes ago\n';
        expect(parseGitHeadOutput(stdout)).toEqual({
            short_sha: 'abc1234',
            subject: 'fix: thing',
            relative_time: '5 minutes ago',
        });
    });

    it('handles subjects that contain colons, parens, and middle-dots without truncation', () => {
        const stdout =
            '9a91b2c\x1ffeat(api): wire agent-memory · regen on save (#42)\x1f3 days ago';
        expect(parseGitHeadOutput(stdout)).toEqual({
            short_sha: '9a91b2c',
            subject: 'feat(api): wire agent-memory · regen on save (#42)',
            relative_time: '3 days ago',
        });
    });

    it('returns all-null when stdout is empty', () => {
        expect(parseGitHeadOutput('')).toEqual({
            short_sha: null,
            subject: null,
            relative_time: null,
        });
    });

    it('returns all-null when stdout is whitespace only', () => {
        expect(parseGitHeadOutput('   \n\n')).toEqual({
            short_sha: null,
            subject: null,
            relative_time: null,
        });
    });

    it('returns nulls for missing fields when only some delimiters are present', () => {
        // A degenerate output with one field — short_sha only, no subject or time.
        expect(parseGitHeadOutput('abc1234')).toEqual({
            short_sha: 'abc1234',
            subject: null,
            relative_time: null,
        });
    });
});
