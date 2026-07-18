import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

export function useCredentials() {
    return useQuery({ queryKey: ['credentials'], queryFn: () => api.credentials.list() });
}
