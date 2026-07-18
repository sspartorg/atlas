import { describe, expect, it } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useRunOutputTail } from './useRunOutputTail.js';

const pushSse = (e: object) =>
    (window as Window & { __pushSse?: (e: object) => void }).__pushSse!(e);

describe('useRunOutputTail', () => {

    it('returns empty lines and isLive=false when runId is null', () => {
        const { result } = renderHook(() => useRunOutputTail(null), { wrapper: makeWrapper() });
        expect(result.current.lines).toEqual([]);
        expect(result.current.isLive).toBe(false);
        expect(result.current.hasReceivedFirstEvent).toBe(false);
    });

    it('returns empty lines and isLive=false when runId is undefined', () => {
        const { result } = renderHook(() => useRunOutputTail(undefined), { wrapper: makeWrapper() });
        expect(result.current.lines).toEqual([]);
        expect(result.current.isLive).toBe(false);
    });

    it('starts with isLive=true when runId is provided', () => {
        const { result } = renderHook(() => useRunOutputTail('run-abc'), { wrapper: makeWrapper() });
        expect(result.current.isLive).toBe(true);
        expect(result.current.lines).toEqual([]);
    });

    it('appends output line on agent_output SSE event for matching runId', async () => {
        const { result } = renderHook(() => useRunOutputTail('run-abc'), { wrapper: makeWrapper() });
        expect(result.current.isLive).toBe(true);

        act(() => {
            pushSse({
                type: 'agent_output',
                runId: 'run-abc',
                output: 'Hello from agent',
            });
        });

        await waitFor(() => expect(result.current.lines.length).toBe(1));
        expect(result.current.lines[0]).toBe('Hello from agent');
        expect(result.current.hasReceivedFirstEvent).toBe(true);
    });

    it('ignores agent_output event for different runId', async () => {
        const { result } = renderHook(() => useRunOutputTail('run-abc'), { wrapper: makeWrapper() });

        act(() => {
            pushSse({
                type: 'agent_output',
                runId: 'run-xyz',
                output: 'Should not appear',
            });
        });

        // Give a moment for any state update
        await new Promise(r => setTimeout(r, 20));
        expect(result.current.lines).toEqual([]);
        expect(result.current.hasReceivedFirstEvent).toBe(false);
    });

    it('sets isLive=false on run_completed event', async () => {
        const { result } = renderHook(() => useRunOutputTail('run-abc'), { wrapper: makeWrapper() });
        expect(result.current.isLive).toBe(true);

        act(() => {
            pushSse({
                type: 'run_completed',
                runId: 'run-abc',
            });
        });

        await waitFor(() => expect(result.current.isLive).toBe(false));
    });

    it('sets isLive=false on run_error event', async () => {
        const { result } = renderHook(() => useRunOutputTail('run-abc'), { wrapper: makeWrapper() });
        expect(result.current.isLive).toBe(true);

        act(() => {
            pushSse({
                type: 'run_error',
                runId: 'run-abc',
            });
        });

        await waitFor(() => expect(result.current.isLive).toBe(false));
    });

    it('resets lines when runId changes', async () => {
        const { result, rerender } = renderHook(
            ({ runId }: { runId: string | null }) => useRunOutputTail(runId),
            { wrapper: makeWrapper(), initialProps: { runId: 'run-abc' } }
        );

        act(() => {
            pushSse({
                type: 'agent_output',
                runId: 'run-abc',
                output: 'Line 1',
            });
        });
        await waitFor(() => expect(result.current.lines.length).toBe(1));

        // Change runId
        rerender({ runId: 'run-xyz' });

        await waitFor(() => expect(result.current.lines).toEqual([]));
        expect(result.current.isLive).toBe(true);
    });

    it('ignores agent_output event when output is not a string (null)', async () => {
        const { result } = renderHook(() => useRunOutputTail('run-abc'), { wrapper: makeWrapper() });

        act(() => {
            pushSse({
                type: 'agent_output',
                runId: 'run-abc',
                output: null, // not a string — typeof null !== 'string', branch not taken
            });
        });

        await new Promise(r => setTimeout(r, 20));
        expect(result.current.lines).toEqual([]);
        expect(result.current.hasReceivedFirstEvent).toBe(false);
    });

    it('resets state when runId changes to null', async () => {
        const { result, rerender } = renderHook(
            ({ runId }: { runId: string | null }) => useRunOutputTail(runId),
            { wrapper: makeWrapper(), initialProps: { runId: 'run-abc' } as { runId: string | null } }
        );
        expect(result.current.isLive).toBe(true);

        rerender({ runId: null });

        await waitFor(() => expect(result.current.isLive).toBe(false));
        expect(result.current.lines).toEqual([]);
    });
});
