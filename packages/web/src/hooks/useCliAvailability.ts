import { useQuery } from '@tanstack/react-query';
import type { AgentCli, ICliAvailability } from '@atlas/shared';
import { api } from '../api/api.js';

export function useCliAvailability() {
    return useQuery({
        queryKey: ['cli-availability'],
        queryFn: () => api.cli.availability(),
        // Installing a binary is rare and out-of-band; a minute is fresh enough.
        staleTime: 60_000,
    });
}

export interface IMissingCli {
    missing: ICliAvailability;
    /** A CLI that IS runnable here, to suggest switching to. */
    alternative: AgentCli | null;
}

/** Non-null only when availability is known AND `cli`'s binary is missing. */
export function findMissingCli(
    rows: ICliAvailability[] | undefined,
    cli: AgentCli | null | undefined,
): IMissingCli | null {
    const missing = rows?.find((a) => a.cli === cli && !a.available);
    if (!missing) return null;
    return { missing, alternative: rows?.find((a) => a.available)?.cli ?? null };
}

export function useMissingCli(cli: AgentCli | null | undefined): IMissingCli | null {
    return findMissingCli(useCliAvailability().data, cli);
}

export function cliUnavailableMessage(
    { missing, alternative }: IMissingCli,
    opts: { beforeInstall?: boolean } = {},
): string {
    const switchHint = alternative
        ? `, or switch the agent to ${alternative}${opts.beforeInstall ? ' after installing' : ''}`
        : '';
    return `${missing.binary} is not installed on this machine — runs will fail until it is${switchHint}.`;
}
