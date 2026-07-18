import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import type * as ReactRouterDom from 'react-router-dom';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useGlobalShortcuts } from './useGlobalShortcuts.js';

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

describe('useGlobalShortcuts', () => {
    it('calls onOpenShortcuts on "?"', () => {
        const onOpenShortcuts = vi.fn();
        renderHook(() => useGlobalShortcuts({ onOpenShortcuts }), {
            wrapper: makeWrapper(),
        });
        fireEvent.keyDown(window, { key: '?' });
        expect(onOpenShortcuts).toHaveBeenCalled();
    });

    it('calls onOpenShortcuts on Cmd+K', () => {
        const onOpenShortcuts = vi.fn();
        renderHook(() => useGlobalShortcuts({ onOpenShortcuts }), {
            wrapper: makeWrapper(),
        });
        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        expect(onOpenShortcuts).toHaveBeenCalled();
    });

    it('ignores keys when typing in an input', () => {
        const onOpenShortcuts = vi.fn();
        renderHook(() => useGlobalShortcuts({ onOpenShortcuts }), {
            wrapper: makeWrapper(),
        });
        const input = document.createElement('input');
        document.body.appendChild(input);
        fireEvent.keyDown(input, { key: '?' });
        expect(onOpenShortcuts).not.toHaveBeenCalled();
        document.body.removeChild(input);
    });

    it('does not fire bare-key shortcuts with modifiers held', () => {
        const onOpenShortcuts = vi.fn();
        renderHook(() => useGlobalShortcuts({ onOpenShortcuts }), {
            wrapper: makeWrapper(),
        });
        fireEvent.keyDown(window, { key: 'g', altKey: true });
        fireEvent.keyDown(window, { key: 'd' });
        expect(onOpenShortcuts).not.toHaveBeenCalled();
    });
});
