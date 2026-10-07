import Alert from '@mui/material/Alert';
import type { SxProps, Theme } from '@mui/material/styles';
import { useIsTeamOverwritten } from '../hooks/useTeamConfig.js';

interface Props {
    managed: boolean | undefined;
    /** What the banner sits on: "project", "workflow", "agent". */
    noun: string;
    sx?: SxProps<Theme>;
}

/** Warns that this item comes from the team config repo and local edits won't stick. */
export function TeamManagedAlert({ managed, noun, sx }: Props) {
    if (!useIsTeamOverwritten(managed)) return null;
    return (
        <Alert severity="warning" sx={sx ?? {}}>
            This {noun} is managed by my team config. Changes I make here are overwritten on the next sync — ask the
            publisher to change it, or make my own copy.
        </Alert>
    );
}
