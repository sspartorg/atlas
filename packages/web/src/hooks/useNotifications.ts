import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationKind, NotificationDeliveryStatus } from '@atlas/shared';
import { api } from '../api/api.js';

interface UseNotificationsArgs {
    kind?: NotificationKind;
    external_status?: NotificationDeliveryStatus;
    limit?: number;
}

export function useNotifications(opts: UseNotificationsArgs = {}) {
    return useQuery({
        queryKey: [
            'notifications',
            opts.kind ?? null,
            opts.external_status ?? null,
            opts.limit ?? 50,
        ],
        queryFn: () => api.notifications.list(opts),
    });
}

const FEED_PAGE = 200;

/** The Notifications page's rows, newest first, 200 at a time ("Load more" walks the `before` cursor). */
export function useNotificationFeed() {
    const q = useInfiniteQuery({
        queryKey: ['notifications', 'feed-pages'],
        queryFn: ({ pageParam }) =>
            api.notifications.list({ limit: FEED_PAGE, ...(pageParam ? { before: pageParam } : {}) }),
        initialPageParam: 0,
        getNextPageParam: (last) => (last.length < FEED_PAGE ? undefined : last[last.length - 1]?.id),
    });
    return { ...q, rows: q.data?.pages.flat() ?? [] };
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
}

export function useMarkNotificationSent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.notifications.markSent(id),
        onSuccess: () => invalidateAll(qc),
    });
}

export function useResendNotification() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.notifications.resend(id),
        onSuccess: () => invalidateAll(qc),
    });
}

export function useCancelNotification() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.notifications.cancel(id),
        onSuccess: () => invalidateAll(qc),
    });
}

export function useMarkAllRead() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api.notifications.markAllRead(),
        onSuccess: () => invalidateAll(qc),
    });
}

export function useMarkNotificationRead() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.notifications.markRead(id),
        onSuccess: () => invalidateAll(qc),
    });
}
