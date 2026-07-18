import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { usePushSubscription } from './usePushSubscription.js';
import type * as ApiModule from '../api/api.js';

// Mock push API methods so enable/disable/sendTest can be tested without a live server.
// getVapidPublicKey defaults to returning a valid key so that enable() can proceed.
// Individual tests can override with mockResolvedValueOnce / mockRejectedValueOnce.
const mockGetVapidPublicKey = vi.fn().mockResolvedValue({ publicKey: 'dGVzdA' });
const mockSubscribePush = vi.fn().mockResolvedValue(undefined);
const mockUnsubscribePush = vi.fn().mockResolvedValue(undefined);
const mockTestPush = vi.fn().mockResolvedValue({ ok: true, delivered: 1, subscriptions: 1 });

vi.mock('../api/api.js', async (importOriginal) => {
    const actual = await importOriginal<typeof ApiModule>();
    return {
        ...actual,
        api: {
            ...actual.api,
            push: {
                ...actual.api.push,
                getVapidPublicKey: (...args: Parameters<typeof actual.api.push.getVapidPublicKey>) =>
                    mockGetVapidPublicKey(...args),
                subscribe: (...args: Parameters<typeof actual.api.push.subscribe>) =>
                    mockSubscribePush(...args),
                unsubscribe: (...args: Parameters<typeof actual.api.push.unsubscribe>) =>
                    mockUnsubscribePush(...args),
                test: (...args: Parameters<typeof actual.api.push.test>) =>
                    mockTestPush(...args),
            },
        },
    };
});

describe('usePushSubscription', () => {
    beforeEach(() => {
        // jsdom has no serviceWorker / PushManager / Notification — isSupported() returns false
        // Remove any stubs from previous tests
        vi.unstubAllGlobals();
        // Reset mock implementations to defaults
        mockGetVapidPublicKey.mockResolvedValue({ publicKey: 'dGVzdA' });
        mockSubscribePush.mockResolvedValue(undefined);
        mockUnsubscribePush.mockResolvedValue(undefined);
        mockTestPush.mockResolvedValue({ ok: true, delivered: 1, subscriptions: 1 });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('state is "unsupported" when browser APIs are absent (jsdom default)', async () => {
        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('unsupported'));
        expect(result.current.busy).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('exposes enable, disable, sendTest functions', () => {
        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        expect(typeof result.current.enable).toBe('function');
        expect(typeof result.current.disable).toBe('function');
        expect(typeof result.current.sendTest).toBe('function');
    });

    it('enable() sets state unsupported when APIs absent', async () => {
        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('unsupported'));
        // calling enable when unsupported should be a no-op (sets unsupported again)
        await result.current.enable();
        expect(result.current.state).toBe('unsupported');
    });

    it('disable() is a no-op when APIs absent', async () => {
        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('unsupported'));
        await result.current.disable();
        expect(result.current.state).toBe('unsupported');
    });

    it('state is "denied" when Notification.permission is denied', async () => {
        // Stub the browser APIs to make isSupported() pass but permission denied
        vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('denied'), { timeout: 1000 });
    });

    it('state is "default" when Notification.permission is "default" (not granted, not denied)', async () => {
        // permission === 'default' → after refresh, state stays 'default' (line 65)
        vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('default'), { timeout: 1000 });
    });

    it('state is "granted-subscribed" when an existing subscription exists', async () => {
        // permission granted + existing subscription → granted-subscribed (line 68 truthy branch)
        vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: async () => ({ endpoint: 'https://example.com/ep' }),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-subscribed'), {
            timeout: 1000,
        });
    });

    it('state is "granted-unsubscribed" when permission granted but no subscription', async () => {
        // permission granted + no existing subscription → granted-unsubscribed (line 68 falsy branch)
        vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: { getSubscription: async () => null },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), {
            timeout: 1000,
        });
    });

    it('refresh catches errors thrown by getSubscription and sets state to default', async () => {
        // pushManager.getSubscription throws → catch branch (lines 69-72)
        vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: () => Promise.reject(new Error('SW error')),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.error).toMatch(/SW error/), { timeout: 1000 });
        expect(result.current.state).toBe('default');
    });

    it('sendTest() delegates to api.push.test and returns its result', async () => {
        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('unsupported'));

        const response = await result.current.sendTest();
        expect(response).toEqual({ ok: true, delivered: 1, subscriptions: 1 });
    });

    it('enable(): !publicKey branch sets error and returns', async () => {
        // Override the module-level mock to return null publicKey.
        mockGetVapidPublicKey.mockResolvedValue({ publicKey: null });

        vi.stubGlobal('Notification', {
            permission: 'granted',
            requestPermission: vi.fn().mockResolvedValue('granted'),
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: vi.fn().mockResolvedValue(null),
                        subscribe: vi.fn(),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        // Wait for initial refresh to settle (granted + no sub → granted-unsubscribed)
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), { timeout: 1000 });

        await result.current.enable();
        // getVapidPublicKey returned null key → setError(VAPID message) + return
        await waitFor(() => expect(result.current.error).toBeTruthy(), { timeout: 500 });
        expect(result.current.error).toContain('VAPID');
    });

    it('enable(): Notification.requestPermission denied sets state to denied', async () => {
        // requestPermission returns 'denied' — enable() sets state='denied' and returns (no refresh)
        vi.stubGlobal('Notification', {
            permission: 'granted',
            requestPermission: vi.fn().mockResolvedValue('denied'),
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn() },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});
        // getVapidPublicKey returns valid key (default mock) → proceed to requestPermission

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        // Wait for initial refresh to settle (granted + no sub → granted-unsubscribed)
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), { timeout: 1000 });
        await result.current.enable();
        // enable() at line 95: perm === 'denied' → setState('denied'); return (no refresh call)
        await waitFor(() => expect(result.current.state).toBe('denied'), { timeout: 500 });
    });

    it('enable(): Notification.requestPermission default (not denied) sets state to default', async () => {
        // requestPermission returns 'default' — enable() sets state='default' and returns
        vi.stubGlobal('Notification', {
            permission: 'granted',
            requestPermission: vi.fn().mockResolvedValue('default'),
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn() },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        // Wait for initial refresh to settle (granted + no sub → granted-unsubscribed)
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), { timeout: 1000 });
        await result.current.enable();
        // enable() at line 95: perm !== 'denied' → setState('default'); return (no refresh call)
        await waitFor(() => expect(result.current.state).toBe('default'), { timeout: 500 });
    });

    it('disable(): sub exists path — calls api.push.unsubscribe and sub.unsubscribe', async () => {
        const unsubscribeFn = vi.fn().mockResolvedValue(true);
        vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: async () => ({
                            endpoint: 'https://example.com/ep',
                            unsubscribe: unsubscribeFn,
                        }),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});
        // mockUnsubscribePush is the module-level mock for api.push.unsubscribe

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-subscribed'), { timeout: 1000 });
        await result.current.disable();
        expect(mockUnsubscribePush).toHaveBeenCalledWith('https://example.com/ep');
        expect(unsubscribeFn).toHaveBeenCalled();
    });

    it('disable(): sub is null — skips unsubscribe, sets state to default', async () => {
        vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: { getSubscription: async () => null },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('default'), { timeout: 1000 });
        await result.current.disable();
        // No sub → state stays at default (Notification.permission is not 'granted')
        expect(result.current.state).toBe('default');
    });

    it('enable(): full subscribe path with stale subscription cleaned up (lines 99-135)', async () => {
        // Cover the stale sub path (line 104 `if (stale)`) and the full subscribe path
        const staleUnsubscribeFn = vi.fn().mockResolvedValue(true);
        const mockSub = {
            endpoint: 'https://example.com/new-ep',
            toJSON: () => ({ keys: { p256dh: 'cDI1NmRo', auth: 'YXV0aA' } }),
            getKey: vi.fn().mockReturnValue(null),
        };
        vi.stubGlobal('Notification', {
            permission: 'granted',
            requestPermission: vi.fn().mockResolvedValue('granted'),
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: vi
                            .fn()
                            .mockResolvedValueOnce({
                                // first call (refresh): existing sub
                                endpoint: 'https://old.ep',
                                unsubscribe: staleUnsubscribeFn,
                            })
                            .mockResolvedValueOnce({
                                // second call (enable stale check): stale sub present
                                endpoint: 'https://old.ep',
                                unsubscribe: staleUnsubscribeFn,
                            })
                            .mockResolvedValue(mockSub), // subscribe result
                        subscribe: vi.fn().mockResolvedValue(mockSub),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-subscribed'), { timeout: 1000 });

        await result.current.enable();
        await waitFor(() => expect(result.current.state).toBe('granted-subscribed'), { timeout: 1000 });
        // stale unsubscribe was called
        expect(staleUnsubscribeFn).toHaveBeenCalled();
        // api.push.subscribe was called with the new endpoint
        expect(mockSubscribePush).toHaveBeenCalledWith(
            expect.objectContaining({ endpoint: 'https://example.com/new-ep' }),
        );
    });

    it('enable(): catch block sets error when subscribe throws with a non-Error value', async () => {
        // Cover err instanceof Error false branch (line 137: String(err))
        const mockSub = {
            endpoint: 'https://example.com/ep',
            toJSON: () => ({ keys: { p256dh: 'cDI1NmRo', auth: 'YXV0aA' } }),
            getKey: vi.fn().mockReturnValue(null),
        };
        vi.stubGlobal('Notification', {
            permission: 'granted',
            requestPermission: vi.fn().mockResolvedValue('granted'),
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: vi.fn().mockResolvedValue(null),
                        subscribe: vi.fn().mockResolvedValue(mockSub),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});
        // api.push.subscribe throws a plain string (non-Error)
        mockSubscribePush.mockRejectedValueOnce('plain-string-error');

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), { timeout: 1000 });

        await result.current.enable();
        await waitFor(() => expect(result.current.error).toBeTruthy(), { timeout: 1000 });
        expect(result.current.error).toBe('plain-string-error');
    });

    it('disable(): catch block sets error on getSubscription throw (lines 159-160)', async () => {
        // Cover the disable() catch branch
        vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: vi.fn()
                            .mockResolvedValueOnce(null) // first call during refresh
                            .mockRejectedValueOnce(new Error('SW gone')), // second call during disable
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), { timeout: 1000 });

        await result.current.disable();
        await waitFor(() => expect(result.current.error).toMatch(/SW gone/), { timeout: 1000 });
    });

    it('enable(): p256dh/auth missing in json.keys — falls back to keyToBase64(sub.getKey(...))', async () => {
        // Cover the `|| keyToBase64(...)` false branch on lines 122-123
        // When json.keys is present but missing p256dh/auth, falls back to getKey()
        const keyBytes = new Uint8Array([1, 2, 3, 4]);
        const mockSub = {
            endpoint: 'https://example.com/ep',
            // toJSON returns empty keys — forces the `|| keyToBase64(sub.getKey(...))` fallback
            toJSON: () => ({ keys: {} }),
            getKey: vi.fn().mockReturnValue(keyBytes.buffer),
        };
        vi.stubGlobal('Notification', {
            permission: 'granted',
            requestPermission: vi.fn().mockResolvedValue('granted'),
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: vi.fn().mockResolvedValue(null),
                        subscribe: vi.fn().mockResolvedValue(mockSub),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), { timeout: 1000 });
        await result.current.enable();
        await waitFor(() => expect(result.current.state).toBe('granted-subscribed'), { timeout: 1000 });
        // getKey was called for both p256dh and auth
        expect(mockSub.getKey).toHaveBeenCalledWith('p256dh');
        expect(mockSub.getKey).toHaveBeenCalledWith('auth');
    });

    it('refresh catch: non-Error rejection uses String(err) branch (line 70)', async () => {
        // Cover err instanceof Error === false in refresh()'s catch block
        vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: () => Promise.reject('plain-string-rejection'),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.error).toBe('plain-string-rejection'), { timeout: 1000 });
        expect(result.current.state).toBe('default');
    });

    it('disable() catch: non-Error rejection uses String(err) branch (line 159)', async () => {
        // Cover err instanceof Error === false in disable()'s catch block
        vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: vi.fn()
                            .mockResolvedValueOnce(null) // first call during refresh
                            .mockRejectedValueOnce('plain-disable-error'), // second call during disable
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), { timeout: 1000 });

        await result.current.disable();
        await waitFor(() => expect(result.current.error).toBe('plain-disable-error'), { timeout: 1000 });
    });

    it('enable(): p256dh/auth missing entirely throws "Subscription missing p256dh/auth keys"', async () => {
        // Lines 124-126: if (!p256dh || !auth) throw new Error(...)
        const mockSub = {
            endpoint: 'https://example.com/ep',
            toJSON: () => ({ keys: {} }), // empty keys
            getKey: vi.fn().mockReturnValue(null), // null buffer → keyToBase64 returns null
        };
        vi.stubGlobal('Notification', {
            permission: 'granted',
            requestPermission: vi.fn().mockResolvedValue('granted'),
        });
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ready: Promise.resolve({
                    pushManager: {
                        getSubscription: vi.fn().mockResolvedValue(null),
                        subscribe: vi.fn().mockResolvedValue(mockSub),
                    },
                }),
            },
            configurable: true,
        });
        vi.stubGlobal('PushManager', class {});

        const { result } = renderHook(() => usePushSubscription(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.state).toBe('granted-unsubscribed'), { timeout: 1000 });
        await result.current.enable();
        // The thrown Error is caught in the catch block → sets error
        await waitFor(() => expect(result.current.error).toMatch(/p256dh\/auth/), { timeout: 1000 });
    });
});
