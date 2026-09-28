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

/** How long a burst of events is collected before its invalidations go out. */
const SSE_FLUSH_MS = 150;

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

        // Events arrive in bursts — one agent step is agent_status, run_queued,
        // counts_changed… — and each names the same broad keys, so every page
        // refetched the same lists several times per step. Collect the keys
        // and flush once per burst: each key once, and none that a shorter
        // pending key (a prefix, e.g. ['agents'] over ['agents', id, 'runs'])
        // already covers.
        const pending = new Map<string, unknown[]>();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
            timer = null;
            const keys = [...pending.values()].sort((a, b) => a.length - b.length);
            pending.clear();
            const sent: unknown[][] = [];
            for (const key of keys) {
                const covered = sent.some((p) => p.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i])));
                if (covered) continue;
                sent.push(key);
                void queryClient.invalidateQueries({ queryKey: key });
            }
        };
        const invalidate = (queryKey: unknown[]) => {
            pending.set(JSON.stringify(queryKey), queryKey);
            timer ??= setTimeout(flush, SSE_FLUSH_MS);
        };

        const unsubEvents = subscribeToEvents((event: SSEEvent) => {
            // Invalidate relevant queries based on event type.
            if (event.type === 'run_completed' || event.type === 'run_error') {
                // A workflow run view lists its steps' statuses (ADR 0014).
                invalidate(['workflow-run']);
                invalidate(['dashboard']);
                invalidate(['sidenav-counts']);
                invalidate(['runs']);
                if (event.agentId) {
                    invalidate(['agents', event.agentId, 'runs']);
                }
                if (event.runId) {
                    // Pull the freshly-populated output_text into the run-detail
                    // viewer so the user sitting on /agents/:id/runs/:runId sees
                    // the master-detail viewer fill in the moment the run ends —
                    // no manual reload, no navigate-away-and-back.
                    invalidate(['agent-run', event.runId]);
                }
            }
            if (event.type === 'agent_status') {
                invalidate(['workflow-run']);
                invalidate(['agents']);
                invalidate(['runs']);
                if (event.agentId) {
                    invalidate(['agents', event.agentId, 'runs']);
                }
                if (event.runId) {
                    // Pick up the freshly-updated row in the run-detail viewer so the
                    // user sitting on /agents/:id/runs/:runId sees the status flip
                    // from queued → in_progress (and the live log panel mount) the
                    // moment the runner picks the row up — without this, the cache
                    // sticks at queued until run_completed lands.
                    invalidate(['agent-run', event.runId]);
                }
            }
            if (event.type === 'run_queued') {
                invalidate(['runs']);
                invalidate(['dashboard']);
                invalidate(['sidenav-counts']);
                if (event.agentId) {
                    invalidate(['agents', event.agentId, 'runs']);
                }
            }
            if (event.type === 'clone_completed') {
                invalidate(['projects']);
                invalidate(['sidenav-counts']);
            }
            if (event.type === 'counts_changed') {
                invalidate(['sidenav-counts']);
                invalidate(['dashboard']);
                // Item-list queries also need to react: a transition/assign/create
                // changes an item's row, and pages like /queue derive UI off the
                // joined items + runs view. Without this, freshly-created items
                // never appear in `itemsById` until a manual refetch.
                invalidate(['tasks']);
                invalidate(['sub-tasks']);
                // Project Detail reads `['issues', 'tree', ...]` — keep it
                // honest after any item mutation.
                invalidate(['issues']);
                // The same event reports the `agents` and `projects` badge
                // counts, but neither list query was invalidated — so a
                // marketplace install (which broadcasts this) left an open
                // /agents page showing the pre-install set while the badge
                // next to it moved. That reads as "the agent wasn't added".
                invalidate(['agents']);
                invalidate(['projects']);
                // Workflow create/update/delete broadcast this event too.
                invalidate(['workflows']);
                // Task status / workflow changes and paused workflows move the Queue page.
                invalidate(['workflow-queue']);
            }
            if (event.type === 'agent_test_judged') {
                if (event.agentId) invalidate(['agent-tests', event.agentId]);
                if (event.agentTestId) {
                    invalidate(['agent-test-batches', event.agentTestId]);
                }
                invalidate(['agent-qualification']);
            }
            if (event.type === 'notification_created') {
                invalidate(['notifications']);
                invalidate(['sidenav-counts']);
                invalidate(['dashboard']);
            }
            if (event.type === 'notification_updated') {
                invalidate(['notifications']);
                invalidate(['sidenav-counts']);
            }
            // Theme 08 — memory regenerated (cadence / high_signal /
            // manual / mcp_update). Refresh both the memory body view
            // and the regen-history list so the Memory tab updates
            // without a manual refetch.
            if (event.type === 'memory_regenerated' && event.agentId) {
                invalidate(['agents', event.agentId, 'memory']);
                invalidate(['agent-memory-history', event.agentId]);
            }
            // Theme 11 — commit verifier emitted a new audit row.
            // Refresh the Agent Detail Overview tile.
            if (event.type === 'commit_verification' && event.agentId) {
                invalidate(['agents', event.agentId, 'commit-verifications']);
            }
            // ADR 0014 — a workflow run moved node or changed status. Item
            // status changes the engine makes arrive separately as
            // `counts_changed`, so only workflow reads are refreshed here.
            if (event.type === 'workflow_run_updated') {
                invalidate(['workflows']);
                invalidate(['workflow-queue']);
                if (event.workflowRunId) {
                    invalidate(['workflow-run', event.workflowRunId]);
                }
                // A sub-task's run moving also moves its Task run's view.
                if (event.parentWorkflowRunId) {
                    invalidate(['workflow-run', event.parentWorkflowRunId]);
                }
                if (event.workflowId) {
                    invalidate(['workflow-runs', event.workflowId]);
                }
                if (event.issueId) {
                    invalidate(['item-workflow-runs', event.issueId]);
                }
            }
            // 2026-06-22 — Terminal v1 events. The PTY byte stream goes
            // over a dedicated WebSocket; these SSE events only carry the
            // metadata transitions that affect cached queries.
            if (
                event.type === 'cli_session_status' ||
                event.type === 'cli_session_closed'
            ) {
                invalidate(['cli-sessions']);
                if (event.cliSessionId) {
                    invalidate(['cli-session', event.cliSessionId]);
                }
            }
        });

        return () => {
            if (timer) clearTimeout(timer);
            unsubEvents();
            unsubState();
        };
    }, [queryClient]);
}
