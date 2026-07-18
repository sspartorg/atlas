import { useEffect, useState } from 'react';
import { subscribeToEvents } from './sse-hub.js';

interface RunOutputTail {
    lines: string[];
    isLive: boolean;
    /** Flips true the first time an `agent_output` SSE event lands for this run. */
    hasReceivedFirstEvent: boolean;
}

export function useRunOutputTail(runId: string | null | undefined): RunOutputTail {
    const [lines, setLines] = useState<string[]>([]);
    const [isLive, setIsLive] = useState<boolean>(false);
    const [hasReceivedFirstEvent, setHasReceivedFirstEvent] = useState<boolean>(false);

    useEffect(() => {
        setLines([]);
        setHasReceivedFirstEvent(false);
        if (!runId) {
            setIsLive(false);
            return;
        }
        setIsLive(true);

        // Shares the tab-wide EventSource via sse-hub — see useCloneJob.
        const unsubscribe = subscribeToEvents((event) => {
            if (event.runId !== runId) return;
            if (event.type === 'agent_output' && typeof event.output === 'string') {
                const outputLine = event.output;
                setLines((prev) => [...prev, outputLine]);
                setHasReceivedFirstEvent(true);
            } else if (event.type === 'run_completed' || event.type === 'run_error') {
                setIsLive(false);
            }
        });

        return unsubscribe;
    }, [runId]);

    return { lines, isLive, hasReceivedFirstEvent };
}
