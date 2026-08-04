import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { CliSessionDiffFile } from '@atlas/shared';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { DiffFileList } from './DiffFileList.js';

function file(overrides: Partial<CliSessionDiffFile> = {}): CliSessionDiffFile {
    return {
        path: 'src/foo.ts',
        old_path: null,
        status: 'modified',
        code: ' M',
        additions: 3,
        deletions: 1,
        binary: false,
        too_large: false,
        ...overrides,
    };
}

function renderList(overrides: Partial<React.ComponentProps<typeof DiffFileList>> = {}) {
    const props: React.ComponentProps<typeof DiffFileList> = {
        files: [file(), file({ path: 'src/bar.ts', status: 'untracked', additions: 5, deletions: 0 })],
        selectable: true,
        selected: { 'src/foo.ts': true, 'src/bar.ts': true },
        onToggle: vi.fn(),
        onToggleAll: vi.fn(),
        activePath: 'src/foo.ts',
        onActivate: vi.fn(),
        onPrefetch: undefined,
        truncated: false,
        totalFiles: 2,
        ...overrides,
    };
    renderWithProviders(<DiffFileList {...props} />);
    return props;
}

describe('DiffFileList', () => {
    it('renders the basename and directory of each path', () => {
        renderList();
        expect(screen.getByText('foo.ts')).toBeInTheDocument();
        expect(screen.getByText('bar.ts')).toBeInTheDocument();
        expect(screen.getAllByText('src/')).toHaveLength(2);
    });

    it('renders a status letter per file', () => {
        renderList();
        expect(screen.getByText('M')).toBeInTheDocument();
        expect(screen.getByText('U')).toBeInTheDocument();
    });

    it('renders the +/− counts', () => {
        renderList();
        expect(screen.getByText('+3')).toBeInTheDocument();
        expect(screen.getByText('−1')).toBeInTheDocument();
        expect(screen.getByText('+5')).toBeInTheDocument();
    });

    it('shows "bin" instead of counts for a binary file', () => {
        renderList({ files: [file({ binary: true })] });
        expect(screen.getByText('bin')).toBeInTheDocument();
        expect(screen.queryByText('+3')).not.toBeInTheDocument();
    });

    it('shows the previous path for a rename', () => {
        renderList({ files: [file({ status: 'renamed', old_path: 'src/old.ts' })] });
        expect(screen.getByText('← src/old.ts')).toBeInTheDocument();
        expect(screen.getByText('R')).toBeInTheDocument();
    });

    it('renders checkboxes when selectable', () => {
        renderList();
        expect(screen.getByRole('checkbox', { name: /stage src\/foo\.ts/i })).toBeInTheDocument();
    });

    it('hides checkboxes when not selectable', () => {
        renderList({ selectable: false });
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('fires onToggle with the path and next state', () => {
        const props = renderList();
        fireEvent.click(screen.getByRole('checkbox', { name: /stage src\/bar\.ts/i }));
        expect(props.onToggle).toHaveBeenCalledWith('src/bar.ts', false);
    });

    // The row click selects a file for VIEWING; the checkbox means "stage
    // this". Without stopPropagation the two fight and clicking a checkbox
    // also re-activates the row.
    it('does not fire onActivate when the checkbox is clicked', () => {
        const props = renderList();
        fireEvent.click(screen.getByRole('checkbox', { name: /stage src\/bar\.ts/i }));
        expect(props.onActivate).not.toHaveBeenCalled();
    });

    it('fires onActivate when the row is clicked', () => {
        const props = renderList();
        fireEvent.click(screen.getByText('bar.ts'));
        expect(props.onActivate).toHaveBeenCalledWith('src/bar.ts');
    });

    it('fires onPrefetch on hover', () => {
        const onPrefetch = vi.fn();
        renderList({ onPrefetch });
        fireEvent.mouseEnter(screen.getByText('bar.ts'));
        expect(onPrefetch).toHaveBeenCalledWith('src/bar.ts');
    });

    it('shows the selected count and an Uncheck all action', () => {
        const props = renderList();
        expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /uncheck all/i }));
        expect(props.onToggleAll).toHaveBeenCalledWith(false);
    });

    it('offers Check all when nothing is selected', () => {
        const props = renderList({ selected: {} });
        expect(screen.getByText('0 of 2 selected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /check all/i }));
        expect(props.onToggleAll).toHaveBeenCalledWith(true);
    });

    it('renders an empty state', () => {
        renderList({ files: [] });
        expect(screen.getByText(/no changes in this view/i)).toBeInTheDocument();
    });

    it('reports truncation against the true total', () => {
        renderList({ truncated: true, totalFiles: 900 });
        expect(screen.getByText(/showing 2 of 900 changed files/i)).toBeInTheDocument();
    });

    it('does not report truncation when the list is complete', () => {
        renderList();
        expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
    });
});
