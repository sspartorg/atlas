import { useState } from 'react';
import Button from '@mui/material/Button';
import { TOUCH } from '../theme/tokens.js';

// Long lists render a page at a time: on a 2,100-task workspace a phone
// rendered 33k DOM nodes and spent ~3 s of main thread (4x CPU) laying out
// cards nobody had scrolled to (ADR 0030). For rows of varying height, where
// a fixed-row virtualiser doesn't fit.
const PAGE = 50;

/** The first `shown` rows, and a way to show the next page. */
export function usePaged<T>(rows: readonly T[], page = PAGE) {
    const [shown, setShown] = useState(page);
    return {
        visible: rows.slice(0, shown),
        remaining: Math.max(0, rows.length - shown),
        more: () => setShown((n) => n + page),
        page,
    };
}

export function ShowMoreButton({
    remaining,
    page = PAGE,
    onMore,
}: {
    remaining: number;
    page?: number;
    onMore: () => void;
}) {
    if (remaining <= 0) return null;
    return (
        <Button fullWidth variant="text" onClick={onMore} sx={{ mt: 2, minHeight: TOUCH.cta }}>
            Show {Math.min(page, remaining)} more of {remaining}
        </Button>
    );
}
