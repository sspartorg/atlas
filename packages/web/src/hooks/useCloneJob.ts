import { useEffect, useState } from 'react';
import type { IProject } from '@atlas/shared';
import { subscribeToEvents } from './sse-hub.js';

export interface CloneState {
    status: 'idle' | 'cloning' | 'ready' | 'error';
    lines: string[];
    errorDetail: string | null;
    project: IProject | null;
}

const INITIAL: CloneState = {
    status: 'idle',
    lines: [],
    errorDetail: null,
    project: null,
};

/**
 * Subscribes to the shared SSE hub and surfaces only events matching
 * `cloneId`. Uses the ref-counted hub — no dedicated EventSource — so a
 * page with N in-flight clone / delete / reclone / run-tail hooks still
 * uses exactly one socket to /api/events per tab.
 */
export function useCloneJob(cloneId: string | null): CloneState {
    const [state, setState] = useState<CloneState>(INITIAL);

    useEffect(() => {
        if (!cloneId) {
            setState(INITIAL);
            return;
        }
        setState({ ...INITIAL, status: 'cloning' });
        const unsubscribe = subscribeToEvents((payload) => {
            if (payload.cloneId !== cloneId) return;
            if (payload.type === 'clone_output' && payload.output) {
                const line = payload.output;
                setState((s) => ({ ...s, lines: [...s.lines, line] }));
            } else if (payload.type === 'clone_completed' && payload.project) {
                const project = payload.project;
                setState((s) => ({ ...s, status: 'ready', project }));
            } else if (payload.type === 'clone_error') {
                const errorDetail = payload.errorDetail ?? 'Clone failed';
                setState((s) => ({ ...s, status: 'error', errorDetail }));
            } else if (payload.type === 'clone_status' && payload.status === 'cloning') {
                setState((s) => ({ ...s, status: 'cloning' }));
            }
        });
        return unsubscribe;
    }, [cloneId]);

    return state;
}
