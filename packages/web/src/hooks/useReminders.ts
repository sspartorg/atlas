import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SetReminderInput, UpdateReminderInput } from '@atlas/shared';
import { api } from '../api/api.js';

export function useReminders() {
    return useQuery({
        queryKey: ['reminders'],
        queryFn: () => api.reminders.list(),
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
