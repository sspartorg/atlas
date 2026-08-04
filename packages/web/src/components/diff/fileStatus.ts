// 2026-08-04 — Terminal finalize diff. One vocabulary for file status,
// shared by the modal, the file list, and the header stats. `describeCode`
// moved here from `StopSessionModal.tsx` so the three surfaces can't drift.

import type { CliSessionDiffFile } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export type DiffFileStatus = CliSessionDiffFile['status'];

/**
 * `git status --porcelain` two-char code -> a word. Index column first,
 * worktree column second.
 */
export function describeCode(code: string): string {
    const idx = code[0] ?? ' ';
    const tree = code[1] ?? ' ';
    if (idx === '?' && tree === '?') return 'untracked';
    if (idx === ' ' && tree === 'M') return 'modified';
    // Both columns, not just the worktree one. A STAGED deletion is `D `, and
    // the original version of this function only checked the worktree column,
    // so it fell through and rendered the raw code letter.
    if (tree === 'D' || idx === 'D') return 'deleted';
    if (idx === 'A') return 'added';
    if (idx === 'R') return 'renamed';
    if (idx === 'M') return 'staged';
    return code.trim() || 'changed';
}

export function describeStatus(status: DiffFileStatus): string {
    switch (status) {
        case 'added':
            return 'added';
        case 'deleted':
            return 'deleted';
        case 'renamed':
            return 'renamed';
        case 'copied':
            return 'copied';
        case 'type_changed':
            return 'type changed';
        case 'untracked':
            return 'untracked';
        default:
            return 'modified';
    }
}

/** Single letter for the compact badge in the file list. */
export function statusLetter(status: DiffFileStatus): string {
    switch (status) {
        case 'added':
            return 'A';
        case 'deleted':
            return 'D';
        case 'renamed':
            return 'R';
        case 'copied':
            return 'C';
        case 'type_changed':
            return 'T';
        case 'untracked':
            return 'U';
        default:
            return 'M';
    }
}

export function statusColor(status: DiffFileStatus): string {
    switch (status) {
        case 'added':
        case 'untracked':
            return ATLAS_PALETTE.successFg;
        case 'deleted':
            return ATLAS_PALETTE.dangerFg;
        case 'renamed':
        case 'copied':
            return ATLAS_PALETTE.accentFg;
        default:
            return ATLAS_PALETTE.warnFg;
    }
}

/** `N files · +X −Y` for the modal header. */
export function formatStats(files: number, additions: number, deletions: number): string {
    return `${files} file${files === 1 ? '' : 's'} · +${additions} −${deletions}`;
}
