import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import SaveRounded from '@mui/icons-material/SaveRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import { useEnv, useUpdateEnv } from '../../hooks/useEnv.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { SettingsSection } from './SettingsSection.js';
import { EnvVarRow } from './EnvVarRow.js';

const MONO = '"JetBrains Mono", monospace';

export function EnvironmentTab() {
    const { data, isLoading } = useEnv();
    const updateEnv = useUpdateEnv();
    const toast = useToast();
    const [draft, setDraft] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!data) return;
        const next: Record<string, string> = {};
        for (const v of data.vars) next[v.key] = v.value;
        setDraft(next);
    }, [data]);

    const dirty = useMemo(() => {
        if (!data) return false;
        return data.vars.some((v) => (draft[v.key] ?? '') !== v.value);
    }, [draft, data]);

    const summary = useMemo(() => {
        if (!data) return '';
        const secrets = data.vars.filter((v) => v.secret).length;
        const restartReq = data.vars.filter((v) => v.restart_required).length;
        return `${data.vars.length} variables · ${secrets} hold${secrets === 1 ? 's' : ''} a secret · ${restartReq} require${restartReq === 1 ? 's' : ''} a server restart.`;
    }, [data]);

    if (isLoading || !data) {
        return (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={24} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }

    async function handleSave() {
        if (!data) return;
        const updates = data.vars
            .filter((v) => (draft[v.key] ?? '') !== v.value)
            .map((v) => ({ key: v.key, value: draft[v.key] ?? '' }));
        if (updates.length === 0) return;
        try {
            await updateEnv.mutateAsync(updates);
            toast.show({
                message: 'Environment saved',
                detail: `Wrote ${updates.length} variable${updates.length === 1 ? '' : 's'} to .env`,
            });
        } catch (err) {
            toast.show({
                message: 'Could not save .env',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return (
        <Box>
            <Alert
                icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                sx={{
                    mb: 4,
                    bgcolor: ATLAS_PALETTE.cloud,
                    color: ATLAS_PALETTE.slate,
                    border: `1px solid rgba(0,122,201,.12)`,
                    '& .MuiAlert-message': { fontSize: 12 },
                }}
            >
                Lives in the Atlas server folder — the directory you run{' '}
                <Box component="span" sx={{ fontFamily: MONO }}>
                    pnpm dev
                </Box>{' '}
                from. Not in your individual project folders. Reads{' '}
                <Box component="span" sx={{ fontFamily: MONO }}>
                    .env
                </Box>{' '}
                on boot.
            </Alert>

            <SettingsSection title="Environment" subtitle={summary}>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    {data.vars.map((env, i) => (
                        <Box
                            key={env.key}
                            sx={{
                                borderTop: i === 0 ? 'none' : `1px solid ${ATLAS_PALETTE.slate06}`,
                            }}
                        >
                            <EnvVarRow
                                env={env}
                                value={draft[env.key] ?? ''}
                                onChange={(next) => setDraft((d) => ({ ...d, [env.key]: next }))}
                            />
                        </Box>
                    ))}
                </Box>

                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: { xs: 'column', md: 'row' },
                        alignItems: { xs: 'stretch', md: 'center' },
                        justifyContent: 'space-between',
                        gap: { xs: 2, md: 3 },
                        mt: 4,
                        pt: 4,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate08}`,
                    }}
                >
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={<SaveRounded sx={{ fontSize: 16 }} />}
                        onClick={() => void handleSave()}
                        disabled={!dirty || updateEnv.isPending}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            alignSelf: { xs: 'flex-start', md: 'center' },
                        }}
                    >
                        {updateEnv.isPending ? 'Saving…' : 'Save Changes'}
                    </Button>
                    <Typography
                        sx={{
                            fontSize: 12,
                            color: dirty ? ATLAS_PALETTE.warning : ATLAS_PALETTE.slate60,
                        }}
                    >
                        {dirty ? 'unsaved changes' : 'no unsaved changes'}
                    </Typography>
                </Box>
            </SettingsSection>

            <Alert
                icon={<RestartAltRounded sx={{ color: ATLAS_PALETTE.warning }} />}
                sx={{
                    mt: 4,
                    bgcolor: 'rgba(199,83,47,.06)',
                    color: ATLAS_PALETTE.slate,
                    border: `1px solid rgba(199,83,47,.18)`,
                    '& .MuiAlert-message': { fontSize: 12, lineHeight: 1.6 },
                }}
            >
                Variables marked{' '}
                <Box
                    component="span"
                    sx={{
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 600,
                        px: 0.75,
                        py: 0.25,
                        bgcolor: 'rgba(199,83,47,.10)',
                        color: ATLAS_PALETTE.warning,
                        borderRadius: '4px',
                    }}
                >
                    RESTART
                </Box>{' '}
                only take effect after the API process restarts. Stop the dev server
                (Ctrl + C in the terminal running{' '}
                <Box component="span" sx={{ fontFamily: MONO }}>
                    pnpm dev
                </Box>
                ) and start it again to pick up the new value.
            </Alert>
        </Box>
    );
}
