import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SetReminderInput, UpdateReminderInput } from '@atlas/shared';
import { api } from '../api/api.js';

/** Active + paused: the reminders that can still fire. Always small. */
export function useReminders() {
    return useQuery({
        queryKey: ['reminders', 'live'],
        queryFn: () => api.reminders.list({ status: ['active', 'paused'] }),
    });
}

const REMINDER_HISTORY_PAGE = 50;

/** Cancelled + completed, most recently finished first, 50 at a time. Fetched only while shown. */
export function useReminderHistory(enabled: boolean) {
    return useInfiniteQuery({
        queryKey: ['reminders', 'history'],
        queryFn: ({ pageParam }) =>
            api.reminders.list({
                status: ['cancelled', 'completed'],
                limit: REMINDER_HISTORY_PAGE,
                offset: pageParam,
            }),
        initialPageParam: 0,
        getNextPageParam: (last, pages) =>
            last.length < REMINDER_HISTORY_PAGE ? undefined : pages.length * REMINDER_HISTORY_PAGE,
        enabled,
    });
}

export function useReminderFires(id: number, enabled: boolean) {
    return useQuery({
        queryKey: ['reminders', id, 'fires'],
        queryFn: () => api.reminders.fires(id),
        enabled,
    });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
    void qc.invalidateQueries({ queryKey: ['reminders'] });
}

export function useCreateReminder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: SetReminderInput) => api.reminders.create(input),
        onSuccess: () => invalidate(qc),
    });
}

export function useUpdateReminder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: number; patch: UpdateReminderInput }) =>
            api.reminders.update(id, patch),
        onSuccess: () => invalidate(qc),
    });
}

export function useCancelReminder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.reminders.cancel(id),
        onSuccess: () => invalidate(qc),
    });
}

export function useSetReminderPaused() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, paused }: { id: number; paused: boolean }) =>
            api.reminders.update(id, { status: paused ? 'paused' : 'active' }),
        onSuccess: () => invalidate(qc),
    });
}

export function useSnoozeReminder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, minutes }: { id: number; minutes: number }) =>
            api.reminders.snooze(id, minutes),
        onSuccess: () => invalidate(qc),
    });
}

export function useDeleteReminder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.reminders.hardDelete(id),
        onSuccess: () => invalidate(qc),
    });
}
