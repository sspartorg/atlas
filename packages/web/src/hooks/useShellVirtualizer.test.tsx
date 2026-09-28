import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { ShellScrollContext, useShellVirtualizer } from './useShellVirtualizer.js';

// The list starts somewhere down the shell's scroller; rows are positioned
// relative to that, so the offset has to be measured, not assumed.
function List({ count }: { count: number }) {
    const { parentRef, virtualizer, scrollMargin } = useShellVirtualizer(count, 40);
    return (
        <div ref={parentRef}>
            <span>margin {scrollMargin}</span>
            <span>rows {virtualizer.getVirtualItems().length}</span>
        </div>
    );
}

function Shell({ count }: { count: number }) {
    const ref = useRef<HTMLDivElement | null>(null);
    return (
        <div ref={ref} data-top="50">
            <ShellScrollContext.Provider value={ref}>
                <List count={count} />
            </ShellScrollContext.Provider>
        </div>
    );
}

afterEach(() => vi.restoreAllMocks());

describe('useShellVirtualizer', () => {
    it('measures where the list starts inside the shell scroller', async () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            return { top: Number(this.dataset['top'] ?? 170) } as DOMRect;
        });
        // In the app the shell is mounted long before any list: render once
        // so its ref is attached, then again as a list's data would.
        const { rerender } = render(<Shell count={100} />);
        rerender(<Shell count={101} />);
        expect(await screen.findByText('margin 120')).toBeInTheDocument();
    });

    it('renders a first screen of rows with no shell around it', () => {
        render(<List count={100} />);
        expect(screen.getByText('margin 0')).toBeInTheDocument();
        expect(screen.getByText(/^rows [1-9]/)).toBeInTheDocument();
    });
});
