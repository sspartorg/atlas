import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/api.js';

export type PushState =
    | 'unsupported'
    | 'denied'
    | 'default'
    | 'granted-subscribed'
    | 'granted-unsubscribed';

function urlBase64ToUint8Array(base64: string): Uint8Array {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const cleaned = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(cleaned);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

function isSupported(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        typeof window !== 'undefined' &&
        'PushManager' in window &&
        'Notification' in window
    );
}

function keyToBase64(buffer: ArrayBuffer | null | undefined): string | null {
    if (!buffer) return null;
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface UsePushSubscriptionResult {
    state: PushState;
    busy: boolean;
    error: string | null;
    enable: () => Promise<void>;
    disable: () => Promise<void>;
    sendTest: () => Promise<{ ok: boolean; delivered: number; subscriptions: number; error?: string }>;
}

export function usePushSubscription(): UsePushSubscriptionResult {
    const [state, setState] = useState<PushState>('default');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!isSupported()) {
            setState('unsupported');
            return;
        }
        if (Notification.permission === 'denied') {
            setState('denied');
            return;
        }
        try {
            const reg = await navigator.serviceWorker.ready;
            const existing = await reg.pushManager.getSubscription();
            if (Notification.permission !== 'granted') {
                setState('default');
                return;
            }
            setState(existing ? 'granted-subscribed' : 'granted-unsubscribed');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setState('default');
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const enable = useCallback(async () => {
        setError(null);
        if (!isSupported()) {
            setState('unsupported');
            return;
        }
        setBusy(true);
        try {
            const { publicKey } = await api.push.getVapidPublicKey();
            if (!publicKey) {
                setError('Server failed to provide a VAPID public key. Check API logs.');
                return;
            }

            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                setState(perm === 'denied' ? 'denied' : 'default');
                return;
            }

            const reg = await navigator.serviceWorker.ready;
            // If something else (e.g. a previous failed enable) left a stale
            // local sub the server never saw, clear it so the new sub matches
            // the freshly-fetched VAPID key.
            const stale = await reg.pushManager.getSubscription();
            if (stale) {
                await stale.unsubscribe().catch(() => {});
            }

            // The PushManager type wants BufferSource; ArrayBufferLike from
            // Uint8Array satisfies it at runtime but the TS narrowing trips
            // on SharedArrayBuffer. Slice into a fresh ArrayBuffer to match.
            const keyBytes = urlBase64ToUint8Array(publicKey);
            const applicationServerKey = keyBytes.buffer.slice(
                keyBytes.byteOffset,
                keyBytes.byteOffset + keyBytes.byteLength,
            ) as ArrayBuffer;
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey,
            });

            const json = sub.toJSON();
            const p256dh = (json.keys && json.keys['p256dh']) || keyToBase64(sub.getKey('p256dh'));
            const auth = (json.keys && json.keys['auth']) || keyToBase64(sub.getKey('auth'));
            if (!p256dh || !auth) {
                throw new Error('Subscription missing p256dh/auth keys');
            }

            await api.push.subscribe({
                endpoint: sub.endpoint,
                p256dh,
                auth,
                userAgent: navigator.userAgent,
            });

            setState('granted-subscribed');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            await refresh();
        } finally {
            setBusy(false);
        }
    }, [refresh]);

    const disable = useCallback(async () => {
        setError(null);
        if (!isSupported()) return;
        setBusy(true);
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await api.push.unsubscribe(sub.endpoint).catch(() => {});
                await sub.unsubscribe().catch(() => {});
            }
            setState(
                Notification.permission === 'granted' ? 'granted-unsubscribed' : 'default',
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            await refresh();
        } finally {
            setBusy(false);
        }
    }, [refresh]);

    const sendTest = useCallback(async () => {
        return api.push.test();
    }, []);

    return { state, busy, error, enable, disable, sendTest };
}
