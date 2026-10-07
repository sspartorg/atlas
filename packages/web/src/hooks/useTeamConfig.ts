import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TeamConfigUpdate } from '../api/api.js';

const KEY = ['team-config'] as const;
const HELP_KEY = ['team-config', 'help'] as const;

export function useTeamConfig() {
    return useQuery({ queryKey: KEY, queryFn: () => api.teamConfig.get() });
}

export function useTeamConfigHelp() {
    return useQuery({ queryKey: HELP_KEY, queryFn: () => api.teamConfig.help() });
}

export function useUpdateTeamConfig() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: TeamConfigUpdate) => api.teamConfig.update(data),
        onSuccess: (cfg) => qc.setQueryData(KEY, cfg),
    });
}

export function useSyncTeamConfig() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api.teamConfig.sync(),
        // A pull can add or change projects, repos, workflows and agents anywhere.
        onSettled: () => qc.invalidateQueries(),
    });
}

/**
 * True when this machine pulls from a team repo and `managed` came from it —
 * the case where a local edit will be overwritten by the next sync.
 */
export function useIsTeamOverwritten(managed: boolean | undefined): boolean {
    const { data } = useTeamConfig();
    return Boolean(managed) && data?.role === 'subscriber';
}
