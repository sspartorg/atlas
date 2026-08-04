import { describe, expect, it } from 'vitest';
import {
    describeCode,
    describeStatus,
    formatStats,
    statusColor,
    statusLetter,
    type DiffFileStatus,
} from './fileStatus.js';

// `describeCode` moved here from StopSessionModal so the modal, the file list,
// and the header stats share one vocabulary. Its branch cases came with it.

describe('describeCode', () => {
    it.each([
        ['??', 'untracked'],
        [' M', 'modified'],
        [' D', 'deleted'],
        ['D ', 'deleted'],
        ['A ', 'added'],
        ['R ', 'renamed'],
        ['M ', 'staged'],
        ['MM', 'staged'],
    ])('maps %s to %s', (code, expected) => {
        expect(describeCode(code)).toBe(expected);
    });

    it('falls back to the trimmed code for an unknown pair', () => {
        expect(describeCode('XY')).toBe('XY');
    });

    it('falls back to "changed" for a blank code', () => {
        expect(describeCode('  ')).toBe('changed');
    });

    it('tolerates a short code without throwing', () => {
        expect(describeCode('')).toBe('changed');
        expect(describeCode('A')).toBe('added');
    });
});

describe('describeStatus', () => {
    it.each([
        ['added', 'added'],
        ['deleted', 'deleted'],
        ['renamed', 'renamed'],
        ['copied', 'copied'],
        ['type_changed', 'type changed'],
        ['untracked', 'untracked'],
        ['modified', 'modified'],
    ] as Array<[DiffFileStatus, string]>)('describes %s', (status, expected) => {
        expect(describeStatus(status)).toBe(expected);
    });
});

describe('statusLetter', () => {
    it.each([
        ['added', 'A'],
        ['deleted', 'D'],
        ['renamed', 'R'],
        ['copied', 'C'],
        ['type_changed', 'T'],
        ['untracked', 'U'],
        ['modified', 'M'],
    ] as Array<[DiffFileStatus, string]>)('letters %s as %s', (status, expected) => {
        expect(statusLetter(status)).toBe(expected);
    });
});

describe('statusColor', () => {
    it('groups added and untracked onto the success colour', () => {
        expect(statusColor('added')).toBe(statusColor('untracked'));
    });

    it('groups renamed and copied onto the accent colour', () => {
        expect(statusColor('renamed')).toBe(statusColor('copied'));
    });

    it('gives deleted and modified distinct colours', () => {
        expect(statusColor('deleted')).not.toBe(statusColor('modified'));
    });

    it('returns a CSS variable reference for every status', () => {
        const all: DiffFileStatus[] = [
            'added',
            'deleted',
            'renamed',
            'copied',
            'type_changed',
            'untracked',
            'modified',
        ];
        for (const s of all) expect(statusColor(s)).toMatch(/^var\(--atlas-/);
    });
});

describe('formatStats', () => {
    it('singularises a one-file summary', () => {
        expect(formatStats(1, 3, 0)).toBe('1 file · +3 −0');
    });

    it('pluralises everything else', () => {
        expect(formatStats(0, 0, 0)).toBe('0 files · +0 −0');
        expect(formatStats(4, 12, 7)).toBe('4 files · +12 −7');
    });
});
