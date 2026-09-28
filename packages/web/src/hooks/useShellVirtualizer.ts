import { createContext, useContext, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * The app shell's scroll container.
 *
 * The window never scrolls in Atlas: `App.tsx` pins the shell to 100vh and
 * scrolls an inner Box. A list virtualised against `window` therefore never
 * heard a scroll event and rendered only its first screen of rows — the rest
 * of a long table was blank space.
 */
export const ShellScrollContext = createContext<RefObject<HTMLElement | null> | null>(null);

/**
 * A virtualizer for a list that scrolls with the page, i.e. with the shell.
 *
 * `scrollMargin` is where the list starts inside the scroller, measured after
 * layout rather than read off a ref during render (which is null on the first
 * pass). Rows position themselves at `start - scrollMargin`.
 *
 * With no shell around it (a component test), it renders one window-height of
 * rows, which is what a first paint shows anyway.
 */
export function useShellVirtualizer(count: number, rowHeight: number) {
    const shell = useContext(ShellScrollContext);
    const parentRef = useRef<HTMLDivElement | null>(null);
    const [scrollMargin, setScrollMargin] = useState(0);

    useLayoutEffect(() => {
        const list = parentRef.current;
        const scroller = shell?.current;
        if (!list || !scroller) return;
        const next = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        setScrollMargin((m) => (Math.abs(m - next) > 1 ? next : m));
        // Not on every render: a scroll re-renders the list, and reading
        // layout each frame forced a reflow per frame. What sits above the
        // list changes when its rows do, not when it scrolls.
    }, [shell, count]);

    const virtualizer = useVirtualizer({
        count,
        estimateSize: () => rowHeight,
        overscan: 8,
        // Let React batch scroll renders instead of flushing each one
        // synchronously inside the scroll event.
        useFlushSync: false,
        scrollMargin,
        getScrollElement: () => shell?.current ?? null,
        initialRect: { width: 0, height: typeof window === 'undefined' ? 800 : window.innerHeight },
    });
    return { parentRef, virtualizer, scrollMargin };
}
