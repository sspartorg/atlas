import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

// Settings is session-stable in MOST fields — owner_name, accent_color,
// external_notification_chat_id, etc. only change via the user-initiated
// useOnboard / useUpdateProfile / useUpdateExternalNotification /
// useUpdateNotifications mutations below, every one of which calls
// qc.setQueryData(['settings'], …) to refresh the cache in place.
//
// The exception is `ai_enabled`, which the API derives at request time
// from `process.env['ATLAS_AI_ENABLED']` (see
// `packages/api/src/routes/settings.ts:18`). If the Owner edits the
// root `.env` and restarts the API, the cached `ai_enabled: false`
// from before the restart would persist forever — the SimulatedBadge
// in the Topbar stays stuck "on" until the user hard-reloads the tab.
//
// Fix: refetch on window focus. Cost is one cheap GET per tab focus,
// which paints over the env-restart staleness without thrashing on
// cold-load (`refetchOnMount: false` still de-dupes the 4 mounts that
// happen during the initial render). Mutations still keep the cache
// authoritative for the owner-controlled fields.
export function useSettings() {
    return useQuery({
        queryKey: ['settings'],
        queryFn: () => api.settings.get(),
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        // The QueryClient default is `refetchOnMount: 'always'`, which would
        // override staleTime and re-fetch every time a new component mounts
        // (RouteGuard + Sidenav + Topbar + page = 4 mounts on cold load).
        // We want one fetch per session, not one per mount.
        refetchOnMount: false,
        // Refetch when the tab regains focus — picks up `ai_enabled`
        // changes after an env edit + API restart without forcing a
        // browser hard-reload.
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
    });
}

export function useOnboard() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { owner_name: string; workspace_path: string }) =>
            api.settings.onboard(data),
        onSuccess: (settings) => {
            queryClient.setQueryData(['settings'], settings);
        },
    });
}

export function useUpdateProfile() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            owner_name?: string;
            accent_color?: string;
            workspace_path?: string;
        }) => api.settings.updateProfile(data),
        // Optimistic patch — paint the cache with the new value before the
        // server round-trips, so the picker / inputs feel instant on mobile.
        // Roll back on error; replace with the server-canonical response on
        // success.
        onMutate: async (data) => {
            await qc.cancelQueries({ queryKey: ['settings'] });
            const prev = qc.getQueryData<unknown>(['settings']);
            if (prev && typeof prev === 'object') {
                qc.setQueryData(['settings'], { ...(prev as object), ...data });
            }
            return { prev };
        },
        onError: (_err, _data, ctx) => {
            if (ctx && 'prev' in ctx && ctx.prev !== undefined) {
                qc.setQueryData(['settings'], ctx.prev);
            }
        },
        onSuccess: (settings) => {
            qc.setQueryData(['settings'], settings);
        },
    });
}

export function useUpdateExternalNotification() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            external_notification_provider?: 'telegram' | 'teams';
            external_notification_token?: string | null;
            external_notification_chat_id?: string | null;
            external_notification_webhook_url?: string | null;
        }) => api.settings.updateExternalNotification(data),
        onSuccess: (settings) => {
            qc.setQueryData(['settings'], settings);
        },
    });
}

export function useUpdateNotifications() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: {
            external_notification_event_toggles?: Record<string, boolean>;
            quiet_hours_from?: string | null;
            quiet_hours_to?: string | null;
            quiet_hours_timezone?: string | null;
            quiet_hours_enabled?: number;
            terminal_idle_notify_seconds?: number;
        }) => api.settings.updateNotifications(data),
        onSuccess: (settings) => {
            qc.setQueryData(['settings'], settings);
        },
    });
}
