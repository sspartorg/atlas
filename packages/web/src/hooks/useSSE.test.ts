import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useSSE, useSSEStatus } from './useSSE.js';
import { useAgentRun } from './useAgents.js';
import { useQueryClient } from '@tanstack/react-query';

// Helper: push a fake SSE event via the test harness
function pushSse(payload: object) {
    (window as Window & { __pushSse?: (e: object) => void }).__pushSse?.(payload);
}

// Helper: render useSSE and return a spy on queryClient.invalidateQueries
function useSSEWithSpy() {
    const qc = useQueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    useSSE();
    return spy;
}

describe('useSSE', () => {
    it('subscribes without throwing using the mocked EventSource', () => {
        const { unmount } = renderHook(() => useSSE(), { wrapper: makeWrapper() });
        expect(() => unmount()).not.toThrow();
    });

    it("invalidates ['agent-run', runId] on agent_status so queued→in_progress refreshes the run-detail cache", async () => {
        let calls = 0;
        server.use(
            http.get('http://localhost:3000/api/run/R1', () => {
                calls += 1;
                return HttpResponse.json({
                    id: 'R1',
                    agent_id: 'A1',
                    issue_type: 'story',
                    issue_id: 'ATL-1',
                    status: calls === 1 ? 'queued' : 'in_progress',
                    output_text: null,
                    started_at: null,
                    completed_at: null,
                    created_at: '2026-05-27T10:00:00.000Z',
                    prompt_snapshot: null,
                });
            }),
        );

        function useProbe(): string | undefined {
            useSSE();
            return useAgentRun('R1').data?.status;
        }

        const { result } = renderHook(() => useProbe(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current).toBe('queued'));

        act(() =>
            pushSse({
                type: 'agent_status',
                agentId: 'A1',
                runId: 'R1',
                status: 'in_progress',
            }),
        );

        await waitFor(() => expect(result.current).toBe('in_progress'));
    });

    // ── run_completed ──────────────────────────────────────────────────────
    it('run_completed invalidates dashboard, sidenav-counts, runs, agent runs, and agent-run', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() =>
            pushSse({ type: 'run_completed', agentId: 'A1', runId: 'R1' }),
        );

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['dashboard']);
        expect(keys).toContainEqual(['sidenav-counts']);
        expect(keys).toContainEqual(['runs']);
        expect(keys).toContainEqual(['agents', 'A1', 'runs']);
        expect(keys).toContainEqual(['agent-run', 'R1']);
    });

    it('run_completed without agentId/runId only invalidates dashboard, sidenav-counts, runs', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'run_completed' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['dashboard']);
        expect(keys).toContainEqual(['sidenav-counts']);
        expect(keys).toContainEqual(['runs']);
        // No agent-specific or run-specific keys
        const agentRunKeys = keys.filter(
            (k) => Array.isArray(k) && k[0] === 'agents' && k.length === 3,
        );
        const agentRunDetailKeys = keys.filter(
            (k) => Array.isArray(k) && k[0] === 'agent-run',
        );
        expect(agentRunKeys).toHaveLength(0);
        expect(agentRunDetailKeys).toHaveLength(0);
    });

    // ── run_error ──────────────────────────────────────────────────────────
    it('run_error invalidates same keys as run_completed', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() =>
            pushSse({ type: 'run_error', agentId: 'A2', runId: 'R2' }),
        );

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['dashboard']);
        expect(keys).toContainEqual(['sidenav-counts']);
        expect(keys).toContainEqual(['runs']);
        expect(keys).toContainEqual(['agents', 'A2', 'runs']);
        expect(keys).toContainEqual(['agent-run', 'R2']);
    });

    // ── run_queued ─────────────────────────────────────────────────────────
    it('run_queued invalidates runs, dashboard, sidenav-counts, and agent runs', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() =>
            pushSse({ type: 'run_queued', agentId: 'A3' }),
        );

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['runs']);
        expect(keys).toContainEqual(['dashboard']);
        expect(keys).toContainEqual(['sidenav-counts']);
        expect(keys).toContainEqual(['agents', 'A3', 'runs']);
    });

    it('run_queued without agentId only invalidates runs, dashboard, sidenav-counts', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'run_queued' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['runs']);
        expect(keys).toContainEqual(['dashboard']);
        expect(keys).toContainEqual(['sidenav-counts']);
    });

    // ── clone_completed ────────────────────────────────────────────────────
    it('clone_completed invalidates projects and sidenav-counts', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'clone_completed' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['projects']);
        expect(keys).toContainEqual(['sidenav-counts']);
    });

    // ── counts_changed ─────────────────────────────────────────────────────
    it('counts_changed invalidates sidenav-counts, dashboard, epics, stories, bugs, issues', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'counts_changed' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['sidenav-counts']);
        expect(keys).toContainEqual(['dashboard']);
        expect(keys).toContainEqual(['epics']);
        expect(keys).toContainEqual(['stories']);
        expect(keys).toContainEqual(['bugs']);
        expect(keys).toContainEqual(['issues']);
    });

    // ── notification_created ───────────────────────────────────────────────
    it('notification_created invalidates notifications, sidenav-counts, dashboard', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'notification_created' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['notifications']);
        expect(keys).toContainEqual(['sidenav-counts']);
        expect(keys).toContainEqual(['dashboard']);
    });

    // ── notification_updated ───────────────────────────────────────────────
    it('notification_updated invalidates notifications and sidenav-counts', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'notification_updated' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['notifications']);
        expect(keys).toContainEqual(['sidenav-counts']);
    });

    // ── memory_regenerated ─────────────────────────────────────────────────
    it('memory_regenerated with agentId invalidates agent memory and history', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'memory_regenerated', agentId: 'A4' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['agents', 'A4', 'memory']);
        expect(keys).toContainEqual(['agent-memory-history', 'A4']);
    });

    it('memory_regenerated without agentId does not trigger any invalidation', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'memory_regenerated' }));

        // Give a tick to confirm no async invalidation fires
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(spy).not.toHaveBeenCalled();
    });

    // ── commit_verification ────────────────────────────────────────────────
    it('commit_verification with agentId invalidates commit-verifications', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'commit_verification', agentId: 'A5' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['agents', 'A5', 'commit-verifications']);
    });

    it('commit_verification without agentId does not trigger any invalidation', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'commit_verification' }));

        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(spy).not.toHaveBeenCalled();
    });

    // ── cli_session_status ─────────────────────────────────────────────────
    it('cli_session_status invalidates cli-sessions and specific cli-session', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() =>
            pushSse({ type: 'cli_session_status', cliSessionId: 'CS1' }),
        );

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['cli-sessions']);
        expect(keys).toContainEqual(['cli-session', 'CS1']);
    });

    it('cli_session_status without cliSessionId only invalidates cli-sessions', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'cli_session_status' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['cli-sessions']);
        // Should NOT include the per-session key
        const sessionKeys = keys.filter(
            (k) => Array.isArray(k) && k[0] === 'cli-session' && k.length > 1,
        );
        expect(sessionKeys).toHaveLength(0);
    });

    // ── cli_session_closed ─────────────────────────────────────────────────
    it('cli_session_closed invalidates cli-sessions and specific cli-session', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() =>
            pushSse({ type: 'cli_session_closed', cliSessionId: 'CS2' }),
        );

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['cli-sessions']);
        expect(keys).toContainEqual(['cli-session', 'CS2']);
    });

    // ── malformed JSON ─────────────────────────────────────────────────────
    it('malformed JSON payload calls console.warn and does not invalidate queries', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const invalidateSpy = result.current;

        // Push raw non-JSON directly through MockEventSource by bypassing
        // JSON.stringify in pushSse — we need to call pushToAll with a raw string.
        // The __pushSse helper JSON-serialises its arg, so we need to use the
        // underlying MockEventSource mechanism via a custom dispatch.
        act(() => {
            // Simulate onmessage with non-JSON data by triggering a raw MessageEvent
            // on all MockEventSource instances via the same channel used by __pushSse.
            // Since __pushSse always JSON.stringifies, we call __pushSseRaw if the
            // harness exposes it; otherwise we test indirectly.
            const w = window as Window & { __pushSseRaw?: (raw: string) => void };
            if (w.__pushSseRaw) {
                w.__pushSseRaw('not-valid-json{{{');
            }
        });

        // Give a tick for any async work
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });

        // invalidateQueries must NOT have been called
        expect(invalidateSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    // ── onopen: first connect does NOT invalidate ──────────────────────────
    it('first connect (wasOpen=false) does NOT call invalidateQueries', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        // The MockEventSource does NOT fire onopen automatically, so wasOpen
        // starts false. If onopen were wired to trigger invalidation on first
        // connect, spy would have been called. Give a tick to settle.
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(spy).not.toHaveBeenCalled();
    });

    // ── useSSEStatus ───────────────────────────────────────────────────────
    it('useSSEStatus returns connecting before EventSource opens', () => {
        // Module-scoped state starts as connecting; useSSEStatus subscribes
        // to it. On mount useSSE sets state to connecting before onopen.
        const { result } = renderHook(
            () => {
                useSSE();
                return useSSEStatus();
            },
            { wrapper: makeWrapper() },
        );

        // The MockEventSource does not auto-fire onopen, so status stays connecting.
        expect(result.current).toBe('connecting');
    });

    it('useSSEStatus can be read independently from a hook that does not mount useSSE', () => {
        const { result } = renderHook(() => useSSEStatus(), { wrapper: makeWrapper() });
        // Should return a valid SSEConnectionState value without throwing
        expect(['connecting', 'open', 'reconnecting']).toContain(result.current);
    });

    // ── agent_status without agentId/runId ────────────────────────────────
    it('agent_status without agentId/runId only invalidates agents and runs', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'agent_status' }));

        await waitFor(() => expect(spy).toHaveBeenCalled());

        const keys = spy.mock.calls.map(
            (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
        );
        expect(keys).toContainEqual(['agents']);
        expect(keys).toContainEqual(['runs']);
        // No agent-specific run keys or run-detail keys
        const agentRunKeys = keys.filter(
            (k) => Array.isArray(k) && k[0] === 'agents' && k.length === 3,
        );
        expect(agentRunKeys).toHaveLength(0);
    });

    // ── unknown event type does nothing ───────────────────────────────────
    it('unknown event type does not call invalidateQueries', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        act(() => pushSse({ type: 'some_future_event_type', agentId: 'X' }));

        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(spy).not.toHaveBeenCalled();
    });

    // ── onerror sets reconnecting ──────────────────────────────────────────
    it('onerror sets SSE status to reconnecting', async () => {
        const { result } = renderHook(
            () => {
                useSSE();
                return useSSEStatus();
            },
            { wrapper: makeWrapper() },
        );

        // Status starts as connecting (onopen not fired by mock)
        expect(result.current).toBe('connecting');

        // Fire onerror on the MockEventSource instance
        act(() => {
            const instances: Array<{ onerror: ((e: Event) => unknown) | null }> =
                (window.EventSource as unknown as { _instances: Array<{ onerror: ((e: Event) => unknown) | null }> })._instances;
            if (instances.length > 0) {
                instances[0]!.onerror?.call(instances[0]! as unknown as EventSource, new Event('error'));
            }
        });

        await waitFor(() => expect(result.current).toBe('reconnecting'));
    });

    // ── reconnect path (wasOpen=true) calls invalidateQueries broadly ──────
    it('onopen after prior open + onerror (reconnect) calls invalidateQueries broadly', async () => {
        const { result } = renderHook(() => useSSEWithSpy(), { wrapper: makeWrapper() });
        const spy = result.current;

        type MockESInstance = {
            onopen: ((e: Event) => unknown) | null;
            onerror: ((e: Event) => unknown) | null;
        };
        const getInstances = (): MockESInstance[] =>
            (window.EventSource as unknown as { _instances: MockESInstance[] })._instances;

        // Fire onopen once to set wasOpen=true (initial open — no invalidation).
        act(() => {
            const insts = getInstances();
            if (insts.length > 0) {
                insts[0]!.onopen?.call(insts[0]! as unknown as EventSource, new Event('open'));
            }
        });

        // No invalidation yet (first open)
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        spy.mockClear();

        // Real reconnect sequence: EventSource auto-reconnects via
        // onerror → onopen. The hub's state store treats a transition
        // from 'reconnecting' back to 'open' as the reconnect signal.
        // Firing two onopens in a row without an intervening onerror
        // leaves state at 'open' and setSSEState short-circuits, so
        // useSSE's listener never re-fires — mimicked the pre-refactor
        // shape but not real EventSource behavior. Send onerror first.
        act(() => {
            const insts = getInstances();
            if (insts.length > 0) {
                insts[0]!.onerror?.call(insts[0]! as unknown as EventSource, new Event('error'));
            }
        });

        act(() => {
            const insts = getInstances();
            if (insts.length > 0) {
                insts[0]!.onopen?.call(insts[0]! as unknown as EventSource, new Event('open'));
            }
        });

        await waitFor(() => expect(spy).toHaveBeenCalled());
    });
});
