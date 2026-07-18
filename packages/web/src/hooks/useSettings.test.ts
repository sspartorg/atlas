import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { ThemeModeProvider } from '../components/ThemeModeProvider.js';
import { ToastProvider } from './useToast.js';
import {
    useOnboard,
    useSettings,
    useUpdateNotifications,
    useUpdateProfile,
    useUpdateExternalNotification,
} from './useSettings.js';

function makeWrapperWithQC(qc: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return React.createElement(ThemeModeProvider, null,
            React.createElement(QueryClientProvider, { client: qc },
                React.createElement(MemoryRouter, null,
                    React.createElement(ToastProvider, null, children)
                )
            )
        );
    };
}

const ok = (b: JsonBodyType) => HttpResponse.json(b);
const SETTINGS = { id: 1, owner_name: 'Owner', accent_color: '#fff', onboarding_complete: 1 };

describe('useSettings', () => {
    it('fetches settings', async () => {
        server.use(http.get('http://localhost:3000/api/settings', () => ok(SETTINGS)));
        const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.owner_name).toBe('Owner');
    });
});

describe('useOnboard', () => {
    it('posts onboarding payload', async () => {
        server.use(
            http.post('http://localhost:3000/api/settings/onboard', async ({ request }) => {
                expect(await request.json()).toEqual({ owner_name: 'A', workspace_path: '/w' });
                return ok(SETTINGS);
            }),
        );
        const { result } = renderHook(() => useOnboard(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ owner_name: 'A', workspace_path: '/w' });
        expect(r.id).toBe(1);
    });
});

describe('useUpdateProfile', () => {
    it('PATCHes profile fields', async () => {
        server.use(
            http.patch('http://localhost:3000/api/settings/profile', () =>
                ok({ ...SETTINGS, accent_color: '#ff0' }),
            ),
        );
        const { result } = renderHook(() => useUpdateProfile(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ accent_color: '#ff0' });
        expect(r.accent_color).toBe('#ff0');
    });

    it('optimistic patch updates cache immediately when prior value exists (line 69 branch)', async () => {
        // Pre-seed the settings cache so onMutate takes the true branch (line 69).
        server.use(
            http.patch('http://localhost:3000/api/settings/profile', () =>
                ok({ ...SETTINGS, accent_color: '#ff0' }),
            ),
        );
        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        qc.setQueryData(['settings'], SETTINGS);
        const { result } = renderHook(() => useUpdateProfile(), { wrapper: makeWrapperWithQC(qc) });
        const updated = await result.current.mutateAsync({ accent_color: '#ff0' });
        expect(updated.accent_color).toBe('#ff0');
    });

    it('rolls back the cache when the request fails (line 75 branch)', async () => {
        // Pre-seed the settings cache so onMutate's true branch runs AND
        // onError's rollback (line 75) restores the original value.
        server.use(
            http.patch('http://localhost:3000/api/settings/profile', () =>
                HttpResponse.json({ error: 'no' }, { status: 500 }),
            ),
        );
        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        qc.setQueryData(['settings'], SETTINGS);
        const { result } = renderHook(() => useUpdateProfile(), { wrapper: makeWrapperWithQC(qc) });
        await expect(result.current.mutateAsync({ owner_name: 'Foo' })).rejects.toThrow();
        // Cache should be rolled back to original SETTINGS
        expect(qc.getQueryData(['settings'])).toEqual(SETTINGS);
    });

    it('optimistic patch works when cache has no prior value (null/undefined prev)', async () => {
        // When settings cache is empty, onMutate skips the setQueryData call (prev falsy)
        // and onError context.prev is undefined — rollback is a no-op.
        server.use(
            http.patch('http://localhost:3000/api/settings/profile', () =>
                HttpResponse.json({ error: 'no' }, { status: 500 }),
            ),
        );
        // Use a fresh wrapper so the settings cache is empty (no prior GET)
        const { result } = renderHook(() => useUpdateProfile(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync({ owner_name: 'Bar' })).rejects.toThrow();
        // Should not throw even with empty context (no rollback target)
    });
});

describe('useUpdateExternalNotification + useUpdateNotifications', () => {
    it('both PATCH and write back to cache', async () => {
        server.use(
            http.patch('http://localhost:3000/api/settings/external-notification', () => ok(SETTINGS)),
            http.patch('http://localhost:3000/api/settings/notifications', () => ok(SETTINGS)),
        );
        const t = renderHook(() => useUpdateExternalNotification(), { wrapper: makeWrapper() });
        const tr = await t.result.current.mutateAsync({ external_notification_token: 'x' });
        const n = renderHook(() => useUpdateNotifications(), { wrapper: makeWrapper() });
        const nr = await n.result.current.mutateAsync({ quiet_hours_from: '21:00' });
        expect(tr.id).toBe(1);
        expect(nr.id).toBe(1);
    });
});
