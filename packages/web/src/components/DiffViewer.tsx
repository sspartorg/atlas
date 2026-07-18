// Tiny line-diff viewer. We don't pull in `diff` or `react-diff-viewer`
// because the surfaces that need this are small (prompt body + settings
// JSON) and we want to keep the web bundle slim. The LCS-based row
// builder below handles modest texts well enough; the rendering is
// monospaced with red/green backgrounds for changed lines.

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

type RowKind = 'eq' | 'add' | 'del';
interface DiffRow {
    kind: RowKind;
    fromLine: number | null;
    toLine: number | null;
    text: string;
}

function lcsTable(a: string[], b: string[]): number[][] {
    const n = a.length;
    const m = b.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1]! + 1) : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
    }
    return dp;
}

// Guard against attacker-influenced diff sizes. LCS is O(n*m) time AND
// O(n*m) space — 10k × 10k lines allocates an 800 MB dp table (8 bytes
// per SMI) and locks the tab. JsonDiff / prompt-body diffs feed content
// that agents can generate, so any hostile-large payload would DoS the
// Owner's browser. When either side exceeds the cap, fall back to a
// naive line-by-line comparison (`removed` + `added` blocks) which is
// O(n+m) and produces a strictly-inferior but non-fatal diff. Cap is
// generous — real code review diffs never approach it.
const DIFF_LINE_CAP = 3_000;

function buildDiff(from: string, to: string): DiffRow[] {
    const a = from.split('\n');
    const b = to.split('\n');
    if (a.length > DIFF_LINE_CAP || b.length > DIFF_LINE_CAP) {
        // Degraded mode: emit `from` as removed then `to` as added.
        // No line-alignment, but the UI stays responsive.
        const rows: DiffRow[] = [];
        a.forEach((line, idx) =>
            rows.push({ kind: 'del', fromLine: idx + 1, toLine: null, text: line }),
        );
        b.forEach((line, idx) =>
            rows.push({ kind: 'add', fromLine: null, toLine: idx + 1, text: line }),
        );
        return rows;
    }
    const dp = lcsTable(a, b);
    const rows: DiffRow[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            rows.push({ kind: 'eq', fromLine: i + 1, toLine: j + 1, text: a[i]! });
            i++;
            j++;
        } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
            rows.push({ kind: 'del', fromLine: i + 1, toLine: null, text: a[i]! });
            i++;
        } else {
            rows.push({ kind: 'add', fromLine: null, toLine: j + 1, text: b[j]! });
            j++;
        }
    }
    while (i < a.length) {
        rows.push({ kind: 'del', fromLine: i + 1, toLine: null, text: a[i]! });
        i++;
    }
    while (j < b.length) {
        rows.push({ kind: 'add', fromLine: null, toLine: j + 1, text: b[j]! });
        j++;
    }
    return rows;
}

interface Props {
    from: string;
    to: string;
    maxHeight?: number;
}

export function DiffViewer({ from, to, maxHeight = 320 }: Props) {
    const rows = useMemo(() => buildDiff(from, to), [from, to]);
    const hasChanges = rows.some((r) => r.kind !== 'eq');

    return (
        <Box
            sx={{
                border: `1px solid ${ATLAS_PALETTE.slate06}`,
                borderRadius: 1.5,
                overflow: 'auto',
                maxHeight,
                bgcolor: ATLAS_PALETTE.surfaceRaised,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 12,
                lineHeight: 1.55,
            }}
        >
            {!hasChanges ? (
                <Box sx={{ p: 3, color: ATLAS_PALETTE.slate60 }}>No changes.</Box>
            ) : (
                rows.map((r, idx) => {
                    const bg =
                        r.kind === 'add' ? ATLAS_PALETTE.successSoft : r.kind === 'del' ? ATLAS_PALETTE.dangerSoft : 'transparent';
                    const sigil = r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' ';
                    const numColor = ATLAS_PALETTE.slate60;
                    return (
                        <Box
                            key={idx}
                            sx={{
                                display: 'flex',
                                bgcolor: bg,
                                px: 1,
                                whiteSpace: 'pre',
                            }}
                        >
                            <Box sx={{ width: 36, color: numColor, textAlign: 'right', pr: 1, flexShrink: 0 }}>
                                {r.fromLine ?? ''}
                            </Box>
                            <Box sx={{ width: 36, color: numColor, textAlign: 'right', pr: 1, flexShrink: 0 }}>
                                {r.toLine ?? ''}
                            </Box>
                            <Box sx={{ width: 16, flexShrink: 0, color: numColor }}>{sigil}</Box>
                            <Box sx={{ flex: 1 }}>{r.text || ' '}</Box>
                        </Box>
                    );
                })
            )}
        </Box>
    );
}

interface JsonDiffProps {
    from: unknown;
    to: unknown;
    maxHeight?: number;
}

export function JsonDiff({ from, to, maxHeight }: JsonDiffProps) {
    const fromText = JSON.stringify(from, null, 2);
    const toText = JSON.stringify(to, null, 2);
    const props: Props = { from: fromText, to: toText };
    if (maxHeight !== undefined) props.maxHeight = maxHeight;
    return <DiffViewer {...props} />;
}

export function NoChangeNotice() {
    return (
        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, fontStyle: 'italic' }}>
            No changes.
        </Typography>
    );
}
