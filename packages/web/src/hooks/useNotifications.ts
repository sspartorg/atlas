import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
