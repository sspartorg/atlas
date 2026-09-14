import Alert from '@mui/material/Alert';
import type { SxProps, Theme } from '@mui/material/styles';
import type { AgentCli } from '@atlas/shared';
import { cliUnavailableMessage, useMissingCli } from '../hooks/useCliAvailability.js';

interface Props {
    cli: AgentCli | null | undefined;
    /** Marketplace copy: the agent isn't local yet, so "switch after installing". */
    beforeInstall?: boolean;
    sx?: SxProps<Theme>;
}

/** Renders nothing until availability is known and the CLI's binary is missing. */
export function CliUnavailableAlert({ cli, beforeInstall = false, sx }: Props) {
    const missing = useMissingCli(cli);
    if (!missing) return null;
    return (
        <Alert severity="warning" sx={sx ?? {}}>
            {cliUnavailableMessage(missing, { beforeInstall })}
        </Alert>
    );
}
