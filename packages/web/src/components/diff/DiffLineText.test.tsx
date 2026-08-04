import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { DiffLineText } from './DiffLineText.js';
import { HIGHLIGHT_CHAR_CAP } from './syntaxHighlight.js';

function render(props: Partial<React.ComponentProps<typeof DiffLineText>> = {}) {
    renderWithProviders(
        <DiffLineText
            text="const alpha = 1;"
            path="src/foo.ts"
            side="del"
            counterpart={null}
            {...props}
        />,
    );
}

describe('DiffLineText', () => {
    it('renders the line split into syntax tokens', () => {
        render();
        expect(screen.getByText('const')).toBeInTheDocument();
        expect(screen.getByText('alpha')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('reassembles to the original text', () => {
        const { container } = renderWithProviders(
            <DiffLineText text="const a = 1;" path="src/foo.ts" side="context" counterpart={null} />,
        );
        expect(container.textContent).toBe('const a = 1;');
    });

    it('renders an unknown extension as plain text', () => {
        const { container } = renderWithProviders(
            <DiffLineText text="anything at all" path="notes.zzz" side="context" counterpart={null} />,
        );
        expect(container.textContent).toBe('anything at all');
    });

    // An empty line still has to occupy its row height, so the component
    // emits whitespace rather than nothing.
    it('renders a blank line without collapsing the row', () => {
        const { container } = renderWithProviders(
            <DiffLineText text="" path="src/foo.ts" side="context" counterpart={null} />,
        );
        expect(container.textContent).not.toBe('');
        expect(container.textContent?.trim()).toBe('');
    });

    it('highlights only the changed token when a counterpart is given', () => {
        render({ counterpart: 'const beta = 1;', side: 'del' });
        const changed = screen.getByText('alpha');
        expect(changed).toBeInTheDocument();
        // The unchanged keyword must not carry the word-diff background.
        expect(screen.getByText('const')).toBeInTheDocument();
    });

    it('does not word-diff a context line even with a counterpart', () => {
        const { container } = renderWithProviders(
            <DiffLineText
                text="const alpha = 1;"
                path="src/foo.ts"
                side="context"
                counterpart="const beta = 1;"
            />,
        );
        expect(container.textContent).toBe('const alpha = 1;');
    });

    it('renders an over-long line as a single plain span', () => {
        const long = 'x'.repeat(HIGHLIGHT_CHAR_CAP + 10);
        const { container } = renderWithProviders(
            <DiffLineText text={long} path="src/foo.ts" side="add" counterpart={null} />,
        );
        expect(container.textContent).toBe(long);
        expect(container.querySelectorAll('span').length).toBe(1);
    });

    it('handles the add side of a pair', () => {
        const { container } = renderWithProviders(
            <DiffLineText
                text="const beta = 2;"
                path="src/foo.ts"
                side="add"
                counterpart="const alpha = 1;"
            />,
        );
        expect(container.textContent).toBe('const beta = 2;');
    });
});
