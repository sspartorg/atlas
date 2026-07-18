import { useEffect, useState } from 'react';

/**
 * Returns the current epoch ms, refreshing on a tick so relative-time labels
 * ("5m ago", "2h ago") update without needing the data to change. Default
 * cadence is 60s — coarser than the React render loop but accurate enough
 * for the minute / hour buckets that relativeShort / relativeDay use.
 */
export function useNow(intervalMs = 60_000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(id);
    }, [intervalMs]);
    return now;
}
