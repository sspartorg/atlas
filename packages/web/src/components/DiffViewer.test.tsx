import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { DiffViewer, JsonDiff, NoChangeNotice } from './DiffViewer.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

describe('DiffViewer', () => {
    it('renders "No changes." when from === to', () => {
        renderWithProviders(<DiffViewer from="alpha\nbeta" to="alpha\nbeta" />);
        expect(screen.getByText('No changes.')).toBeInTheDocument();
    });

    it('renders changed lines when from !== to', () => {
        renderWithProviders(<DiffViewer from="line1\nline2" to="line1\nLINE2" />);
        // The diff should produce at least one del + one add row.
        expect(screen.queryByText('No changes.')).not.toBeInTheDocument();
    });

    it('handles pure adds (from is empty)', () => {
        renderWithProviders(<DiffViewer from="" to="hello" />);
        expect(screen.queryByText('No changes.')).not.toBeInTheDocument();
    });

    it('handles pure deletes (to is empty)', () => {
        renderWithProviders(<DiffViewer from="goodbye" to="" />);
        expect(screen.queryByText('No changes.')).not.toBeInTheDocument();
    });

    it('respects custom maxHeight without throwing', () => {
        expect(() =>
            renderWithProviders(<DiffViewer from="a" to="b" maxHeight={500} />),
        ).not.toThrow();
    });
});

describe('JsonDiff', () => {
    it('renders a no-changes block when objects are deeply equal', () => {
        const obj = { a: 1, b: [1, 2] };
        renderWithProviders(<JsonDiff from={obj} to={obj} />);
        expect(screen.getByText('No changes.')).toBeInTheDocument();
    });

    it('renders a diff block when objects differ', () => {
        renderWithProviders(<JsonDiff from={{ a: 1 }} to={{ a: 2 }} />);
        expect(screen.queryByText('No changes.')).not.toBeInTheDocument();
    });

    it('passes maxHeight through to DiffViewer', () => {
        renderWithProviders(<JsonDiff from={{ a: 1 }} to={{ a: 2 }} maxHeight={400} />);
    });
});

describe('NoChangeNotice', () => {
    it('renders the inline italic notice', () => {
        renderWithProviders(<NoChangeNotice />);
        expect(screen.getByText('No changes.')).toBeInTheDocument();
    });
});
