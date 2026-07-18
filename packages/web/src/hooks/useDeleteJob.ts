import { useEffect, useState } from 'react';
import { subscribeToEvents } from './sse-hub.js';

export interface DeleteState {
    status: 'idle' | 'running' | 'ready' | 'error';
    lines: string[];
    errorDetail: string | null;
    mode: 'unregister' | 'purge' | null;
}

const INITIAL: DeleteState = {
    status: 'idle',
    lines: [],
    errorDetail: null,
    mode: null,
};

export function useDeleteJob(deleteId: string | null): DeleteState {
    const [state, setState] = useState<DeleteState>(INITIAL);

    useEffect(() => {
        if (!deleteId) {
            setState(INITIAL);
            return;
        }
        setState({ ...INITIAL, status: 'running' });
        // Shares the tab-wide EventSource via sse-hub — see the docstring
        // on useCloneJob for the ref-counted rationale.
        const unsubscribe = subscribeToEvents((payload) => {
            if (payload.deleteId !== deleteId) return;
            if (payload.type === 'delete_output' && payload.output) {
                const line = payload.output;
                setState((s) => ({ ...s, lines: [...s.lines, line] }));
            } else if (payload.type === 'delete_completed') {
                setState((s) => ({ ...s, status: 'ready', mode: payload.mode ?? null }));
            } else if (payload.type === 'delete_error') {
                setState((s) => ({
                    ...s,
                    status: 'error',
                    errorDetail: payload.errorDetail ?? 'Delete failed',
                }));
            }
        });
        return unsubscribe;
    }, [deleteId]);

    return state;
}
