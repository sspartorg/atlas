import { useEffect, useState } from 'react';
import { subscribeToEvents } from './sse-hub.js';

export interface RecloneState {
    status: 'idle' | 'running' | 'ready' | 'error';
    lines: string[];
    errorDetail: string | null;
    stashPath: string | null;
}

const INITIAL: RecloneState = {
    status: 'idle',
    lines: [],
    errorDetail: null,
    stashPath: null,
};

export function useRecloneJob(recloneId: string | null): RecloneState {
    const [state, setState] = useState<RecloneState>(INITIAL);

    useEffect(() => {
        if (!recloneId) {
            setState(INITIAL);
            return;
        }
        setState({ ...INITIAL, status: 'running' });
        // Shares the tab-wide EventSource via sse-hub — see useCloneJob.
        const unsubscribe = subscribeToEvents((payload) => {
            if (payload.recloneId !== recloneId) return;
            if (payload.type === 'reclone_output' && payload.output) {
                const line = payload.output;
                setState((s) => ({ ...s, lines: [...s.lines, line] }));
            } else if (payload.type === 'reclone_completed') {
                setState((s) => ({ ...s, status: 'ready', stashPath: payload.stashPath ?? null }));
            } else if (payload.type === 'reclone_error') {
                setState((s) => ({
                    ...s,
                    status: 'error',
                    errorDetail: payload.errorDetail ?? 'Re-clone failed',
                }));
            }
        });
        return unsubscribe;
    }, [recloneId]);

    return state;
}
