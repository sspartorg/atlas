import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

export function useDashboard() {
    return useQuery({
        queryKey: ['dashboard'],
        queryFn: () => api.counts.dashboard(),
    });
}
