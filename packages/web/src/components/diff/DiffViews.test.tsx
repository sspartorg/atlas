import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { parseUnifiedDiff } from './parseUnifiedDiff.js';
import { buildSplitRows, buildUnifiedRows } from './diffRows.js';
import { SplitDiffView, UnifiedDiffView } from './DiffViews.js';

const PATCH = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,3 +1,3 @@',
    ' keep',
    '-const alpha = 1;',
    '+const beta = 2;',
].join('\n');

const TWO_HUNKS = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,2 +1,2 @@',
    '-a',
    '+A',
    '@@ -20,2 +20,2 @@',
    '-b',
    '+B',
].join('\n');

const fileOf = (patch: string) => parseUnifiedDiff(patch).files[0]!;

describe('UnifiedDiffView', () => {
    it('renders every line of the hunk', () => {
        renderWithProviders(
            <UnifiedDiffView
                rows={buildUnifiedRows(fileOf(PATCH))}
                path="src/foo.ts"
                wrap={false}
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        expect(screen.getByText('keep')).toBeInTheDocument();
        expect(screen.getByText('alpha')).toBeInTheDocument();
        expect(screen.getByText('beta')).toBeInTheDocument();
    });

    it('renders +/− sigils', () => {
        renderWithProviders(
            <UnifiedDiffView
                rows={buildUnifiedRows(fileOf(PATCH))}
                path="src/foo.ts"
                wrap={false}
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        expect(screen.getByText('+')).toBeInTheDocument();
        expect(screen.getByText('−')).toBeInTheDocument();
    });

    it('renders both gutters', () => {
        renderWithProviders(
            <UnifiedDiffView
                rows={buildUnifiedRows(fileOf(PATCH))}
                path="src/foo.ts"
                wrap={false}
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        // The context line carries old=1 and new=1.
        expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    });

    it('renders an empty row set without crashing', () => {
        renderWithProviders(
            <UnifiedDiffView
                rows={[]}
                path="src/foo.ts"
                wrap={false}
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        expect(screen.queryByText('keep')).not.toBeInTheDocument();
    });
});

describe('SplitDiffView', () => {
    it('renders both sides of a paired change', () => {
        renderWithProviders(
            <SplitDiffView
                rows={buildSplitRows(fileOf(PATCH))}
                path="src/foo.ts"
                wrap
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        expect(screen.getByText('alpha')).toBeInTheDocument();
        expect(screen.getByText('beta')).toBeInTheDocument();
    });

    it('renders context on both sides', () => {
        renderWithProviders(
            <SplitDiffView
                rows={buildSplitRows(fileOf(PATCH))}
                path="src/foo.ts"
                wrap
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        expect(screen.getAllByText('keep')).toHaveLength(2);
    });

    it('renders a filler cell for an unpaired deletion', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1,3 +1,1 @@',
            '-one',
            '-two',
            '+ONE',
        ].join('\n');
        renderWithProviders(
            <SplitDiffView
                rows={buildSplitRows(fileOf(patch))}
                path="x.ts"
                wrap
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        expect(screen.getByText('one')).toBeInTheDocument();
        expect(screen.getByText('two')).toBeInTheDocument();
        expect(screen.getByText('ONE')).toBeInTheDocument();
    });
});

// Above the threshold the renderer switches to windowing. jsdom's noop
// ResizeObserver means no rows actually paint here, but the branch still has
// to execute without throwing and still has to reserve the full scroll height
// — and this is the path every genuinely large diff takes in production.
describe('windowed rendering above the threshold', () => {
    function bigFile(lines: number) {
        const body = Array.from({ length: lines }, (_, i) => `+line ${i}`).join('\n');
        const patch = [
            'diff --git a/big.ts b/big.ts',
            '--- a/big.ts',
            '+++ b/big.ts',
            `@@ -0,0 +1,${lines} @@`,
            body,
        ].join('\n');
        return parseUnifiedDiff(patch).files[0]!;
    }

    it('windows the rows instead of rendering all of them', () => {
        const rows = buildUnifiedRows(bigFile(600));
        expect(rows.length).toBeGreaterThan(500);
        const { container } = renderWithProviders(
            <UnifiedDiffView
                rows={rows}
                path="big.ts"
                wrap={false}
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        // The plain path would put every line in the DOM; the windowed path
        // renders only what fits the viewport (none, under jsdom's noop
        // ResizeObserver). Either way it must not dump 600 rows.
        expect(container.textContent).not.toContain('599');
    });

    it('renders split without throwing', () => {
        const rows = buildSplitRows(bigFile(600));
        expect(() =>
            renderWithProviders(
                <SplitDiffView
                    rows={rows}
                    path="big.ts"
                    wrap
                    onExpandContext={undefined}
                    canExpand={false}
                />,
            ),
        ).not.toThrow();
    });

    it('stays on the plain path exactly at the threshold', () => {
        const rows = buildUnifiedRows(bigFile(500));
        expect(rows).toHaveLength(500);
        const { container } = renderWithProviders(
            <UnifiedDiffView
                rows={rows}
                path="big.ts"
                wrap={false}
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        // Plain rendering emits every row, so the last line's number is there.
        // (The tokenizer splits `line 499` into separate spans, hence the
        // textContent check rather than a getByText.)
        expect(container.textContent).toContain('499');
    });
});

describe('hunk separator', () => {
    it('shows the skipped-line count between hunks', () => {
        renderWithProviders(
            <UnifiedDiffView
                rows={buildUnifiedRows(fileOf(TWO_HUNKS))}
                path="src/foo.ts"
                wrap={false}
                onExpandContext={undefined}
                canExpand={false}
            />,
        );
        expect(screen.getByText(/17 unchanged lines/)).toBeInTheDocument();
    });

    it('fires onExpandContext when expandable and clicked', () => {
        const onExpand = vi.fn();
        renderWithProviders(
            <UnifiedDiffView
                rows={buildUnifiedRows(fileOf(TWO_HUNKS))}
                path="src/foo.ts"
                wrap={false}
                onExpandContext={onExpand}
                canExpand
            />,
        );
        fireEvent.click(screen.getByText(/17 unchanged lines/));
        expect(onExpand).toHaveBeenCalledTimes(1);
    });

    it('does not fire when not expandable', () => {
        const onExpand = vi.fn();
        renderWithProviders(
            <UnifiedDiffView
                rows={buildUnifiedRows(fileOf(TWO_HUNKS))}
                path="src/foo.ts"
                wrap={false}
                onExpandContext={onExpand}
                canExpand={false}
            />,
        );
        fireEvent.click(screen.getByText(/17 unchanged lines/));
        expect(onExpand).not.toHaveBeenCalled();
    });
});
