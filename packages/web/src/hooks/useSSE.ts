import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SSEEvent } from '@atlas/shared';
import {
    getSSEState,
    subscribeSSEState,
    subscribeToEvents,
    type SSEConnectionState,
} from './sse-hub.js';

export type { SSEConnectionState } from './sse-hub.js';

/**
 * Live connection-state pill (topbar). Reads the hub's shared state so
 * every mounted component sees the same "connecting / open / reconnecting"
 * value without prop-drilling.
 */
export function useSSEStatus(): SSEConnectionState {
    return useSyncExternalStore(subscribeSSEState, getSSEState, () => 'connecting');
}

/**
 * App-level SSE consumer. Mounted once at AppShell; owns the TanStack
 * Query invalidation policy driven by SSE event types. The underlying
 * EventSource is managed by sse-hub.ts — this hook is now purely a
 * subscriber, sharing the socket with every job-specific hook
 * (useCloneJob / useDeleteJob / useRecloneJob / useRunOutputTail).
 */
export function useSSE() {
    const queryClient = useQueryClient();
    const wasOpenRef = useRef(false);

    useEffect(() => {
        // Track "was ever open" so we only invalidate on reconnect, not
        // initial open (F-006 fix, 2026-06-13). On initial open,
        // downstream hooks like useSettings have just fetched — a
        // duplicate invalidate here would trigger a wasted round-trip.
        //
        // Reconnect detection uses the hub's state store, not the raw
        // EventSource events, because the hub may have been open before
        // this hook mounted (e.g. a job-hook opened the connection first).
        const unsubState = subscribeSSEState(() => {
            const state = getSSEState();
            if (state === 'open') {
                const wasOpen = wasOpenRef.current;
                wasOpenRef.current = true;
                if (wasOpen) {
                    // Reconnected after a drop. TanStack's
                    // refetchOnReconnect:'always' handles the mounted
                    // per-item / per-run queries; we scope this
                    // invalidation to the low-cardinality singletons that
                    // don't have an SSE-driven update path (Batch 4 audit
                    // — the previous unqualified invalidateQueries()
                    // produced a double refetch storm on flaky links).
                    void queryClient.invalidateQueries({ queryKey: ['settings'] });
                    void queryClient.invalidateQueries({ queryKey: ['sidenav-counts'] });
                    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                }
            }
        });

        // Initial connect: seed wasOpenRef if the hub is already open when
        // this hook mounts (a job-hook may have opened it first).
        if (getSSEState() === 'open') {
            wasOpenRef.current = true;
        }

        const unsubEvents = subscribeToEvents((event: SSEEvent) => {
            // Invalidate relevant queries based on event type.
            if (event.type === 'run_completed' || event.type === 'run_error') {
                void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                void queryClient.invalidateQueries({ queryKey: ['sidenav-counts'] });
                void queryClient.invalidateQueries({ queryKey: ['runs'] });
                if (event.agentId) {
                    void queryClient.invalidateQueries({
                        queryKey: ['agents', event.agentId, 'runs'],
                    });
                }
                if (event.runId) {
                    // Pull the freshly-populated output_text into the run-detail
                    // viewer so the user sitting on /agents/:id/runs/:runId sees
                    // the master-detail viewer fill in the moment the run ends —
                    // no manual reload, no navigate-away-and-back.
                    void queryClient.invalidateQueries({
                        queryKey: ['agent-run', event.runId],
                    });
                }
            }
            if (event.type === 'agent_status') {
                void queryClient.invalidateQueries({ queryKey: ['agents'] });
                void queryClient.invalidateQueries({ queryKey: ['runs'] });
                if (event.agentId) {
                    void queryClient.invalidateQueries({
                        queryKey: ['agents', event.agentId, 'runs'],
                    });
                }
                if (event.runId) {
                    // Pick up the freshly-updated row in the run-detail viewer so the
                    // user sitting on /agents/:id/runs/:runId sees the status flip
                    // from queued → in_progress (and the live log panel mount) the
                    // moment the runner picks the row up — without this, the cache
                    // sticks at queued until run_completed lands.
                    void queryClient.invalidateQueries({
                        queryKey: ['agent-run', event.runId],
                    });
                }
            }
            if (event.type === 'run_queued') {
                void queryClient.invalidateQueries({ queryKey: ['runs'] });
                void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                void queryClient.invalidateQueries({ queryKey: ['sidenav-counts'] });
                if (event.agentId) {
                    void queryClient.invalidateQueries({
                        queryKey: ['agents', event.agentId, 'runs'],
                    });
                }
            }
            if (event.type === 'clone_completed') {
                void queryClient.invalidateQueries({ queryKey: ['projects'] });
                void queryClient.invalidateQueries({ queryKey: ['sidenav-counts'] });
            }
            if (event.type === 'counts_changed') {
                void queryClient.invalidateQueries({ queryKey: ['sidenav-counts'] });
                void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                // Item-list queries also need to react: a transition/assign/create
                // changes an item's row, and pages like /queue derive UI off the
                // joined items + runs view. Without this, freshly-created items
                // never appear in `itemsById` until a manual refetch.
                void queryClient.invalidateQueries({ queryKey: ['epics'] });
                void queryClient.invalidateQueries({ queryKey: ['stories'] });
                void queryClient.invalidateQueries({ queryKey: ['bugs'] });
                // The Issues page reads `['issues', 'tree', ...]` — keep it
                // honest after any item mutation. Without this, updates made
                // from a detail page only show up on /issues after the 30s
                // staleTime expires or the tab regains focus.
                void queryClient.invalidateQueries({ queryKey: ['issues'] });
            }
            if (event.type === 'notification_created') {
                void queryClient.invalidateQueries({ queryKey: ['notifications'] });
                void queryClient.invalidateQueries({ queryKey: ['sidenav-counts'] });
                void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            }
            if (event.type === 'notification_updated') {
                void queryClient.invalidateQueries({ queryKey: ['notifications'] });
                void queryClient.invalidateQueries({ queryKey: ['sidenav-counts'] });
            }
            // Theme 08 — memory regenerated (cadence / high_signal /
            // manual / mcp_update). Refresh both the memory body view
            // and the regen-history list so the Memory tab updates
            // without a manual refetch.
            if (event.type === 'memory_regenerated' && event.agentId) {
                void queryClient.invalidateQueries({
                    queryKey: ['agents', event.agentId, 'memory'],
                });
                void queryClient.invalidateQueries({
                    queryKey: ['agent-memory-history', event.agentId],
                });
            }
            // Theme 11 — commit verifier emitted a new audit row.
            // Refresh the Agent Detail Overview tile.
            if (event.type === 'commit_verification' && event.agentId) {
                void queryClient.invalidateQueries({
                    queryKey: ['agents', event.agentId, 'commit-verifications'],
                });
            }
            // 2026-06-22 — Terminal v1 events. The PTY byte stream goes
            // over a dedicated WebSocket; these SSE events only carry the
            // metadata transitions that affect cached queries.
            if (
                event.type === 'cli_session_status' ||
                event.type === 'cli_session_closed'
            ) {
                void queryClient.invalidateQueries({ queryKey: ['cli-sessions'] });
                if (event.cliSessionId) {
                    void queryClient.invalidateQueries({
                        queryKey: ['cli-session', event.cliSessionId],
                    });
                }
            }
        });

        return () => {
            unsubEvents();
            unsubState();
        };
    }, [queryClient]);
}
