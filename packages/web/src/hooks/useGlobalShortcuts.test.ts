import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import { useGlobalShortcuts } from './useGlobalShortcuts.js';

// We need to capture navigate calls. Wrap useGlobalShortcuts with a hook that
// also returns the navigate function so we can spy on it via the router state.
// Instead, we spy on the real navigate function returned by useNavigate by
// recording calls through a shared ref exposed by a thin wrapper hook.

let navigateSpy: ReturnType<typeof vi.fn>;

vi.mock('react-router-dom', async (importOriginal) => {
    const original = await importOriginal<typeof ReactRouterDom>();
    return {
        ...original,
        useNavigate: () => navigateSpy,
    };
});

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('useGlobalShortcuts', () => {
    let onOpenShortcuts: () => void;

    beforeEach(() => {
        navigateSpy = vi.fn();
        onOpenShortcuts = vi.fn();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    function setup() {
        return renderHook(() => useGlobalShortcuts({ onOpenShortcuts }), {
            wrapper: MemoryRouter,
        });
    }

    it("pressing 'g' then 'd' navigates to /dashboard", () => {
        setup();
        fireKey('g');
        fireKey('d');
        expect(navigateSpy).toHaveBeenCalledWith('/dashboard');
    });

    it("pressing 'g' then 'p' navigates to /projects", () => {
        setup();
        fireKey('g');
        fireKey('p');
        expect(navigateSpy).toHaveBeenCalledWith('/projects');
    });

    it('pressing Ctrl+K calls onOpenShortcuts', () => {
        setup();
        fireKey('k', { ctrlKey: true });
        expect(onOpenShortcuts).toHaveBeenCalledOnce();
        expect(navigateSpy).not.toHaveBeenCalled();
    });

    it("pressing '?' calls onOpenShortcuts", () => {
        setup();
        fireKey('?');
        expect(onOpenShortcuts).toHaveBeenCalledOnce();
        expect(navigateSpy).not.toHaveBeenCalled();
    });

    it("pressing 'g' when target is INPUT does NOT navigate", () => {
        setup();
        const input = document.createElement('input');
        document.body.appendChild(input);
        // Dispatch with target = input; KeyboardEvent doesn't accept target in
        // constructor, so we dispatch directly on the element and bubble up.
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
        expect(navigateSpy).not.toHaveBeenCalled();
        document.body.removeChild(input);
    });

    it("pressing 'g' then 'z' (unmapped) does NOT navigate", () => {
        setup();
        fireKey('g');
        fireKey('z');
        expect(navigateSpy).not.toHaveBeenCalled();
    });

    it("pressing 'g' then timeout clears pending state so subsequent key does NOT navigate", () => {
        vi.useFakeTimers();
        setup();
        fireKey('g');
        // Advance past the 1200ms goto timeout.
        vi.advanceTimersByTime(1300);
        // Now pressing 'd' should NOT navigate (pending state was cleared).
        fireKey('d');
        expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('pressing Cmd+K (metaKey) calls onOpenShortcuts (mac path)', () => {
        setup();
        fireKey('k', { metaKey: true });
        expect(onOpenShortcuts).toHaveBeenCalledOnce();
    });

    it('bare key with altKey held does NOT trigger goto-pending state', () => {
        setup();
        fireKey('g', { altKey: true });
        // Alt+G should NOT set gotoPending — subsequent 'd' must not navigate
        fireKey('d');
        expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('non-g bare key (no goto-pending) does nothing', () => {
        setup();
        fireKey('x');
        expect(navigateSpy).not.toHaveBeenCalled();
        expect(onOpenShortcuts).not.toHaveBeenCalled();
    });

    it("pressing 'g' then 'e' navigates to /epics", () => {
        setup();
        fireKey('g');
        fireKey('e');
        expect(navigateSpy).toHaveBeenCalledWith('/epics');
    });

    it("pressing 'g' then 'i' navigates to /issues", () => {
        setup();
        fireKey('g');
        fireKey('i');
        expect(navigateSpy).toHaveBeenCalledWith('/issues');
    });

    it("pressing 'g' when target is TEXTAREA does NOT navigate", () => {
        setup();
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
        expect(navigateSpy).not.toHaveBeenCalled();
        document.body.removeChild(textarea);
    });

    it('pressing key when target is contentEditable does NOT navigate', () => {
        setup();
        const div = document.createElement('div');
        // jsdom doesn't enforce contentEditable, so define a getter
        Object.defineProperty(div, 'isContentEditable', { value: true });
        document.body.appendChild(div);
        div.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
        div.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
        expect(navigateSpy).not.toHaveBeenCalled();
        document.body.removeChild(div);
    });

    it('cleanup on unmount removes the keydown handler', () => {
        const { unmount } = setup();
        unmount();
        // After unmount, the listener is gone — pressing keys does nothing
        fireKey('g');
        fireKey('d');
        expect(navigateSpy).not.toHaveBeenCalled();
    });
});
