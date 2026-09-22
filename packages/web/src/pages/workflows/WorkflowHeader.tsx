import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import type { IWorkflow } from '@atlas/shared';
import { api } from '../../api/api.js';
import { usePublishWorkflow, useUpgradeWorkflow } from '../../hooks/useWorkflows.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { INPUT_KIND_LABEL, deliveryLabel, triggerLabel } from './labels.js';
import { WorkflowScheduleDialog } from './WorkflowScheduleDialog.js';

interface Props {
    workflow: IWorkflow;
    projectName: string;
    dirty: boolean;
    saveDisabled: boolean;
    saving: boolean;
    runDisabledReason: string | null;
    onSave: () => void;
    onRun: () => void;
    onDelete: () => void;
    /** Omitted on surfaces with no draft to edit; the schedule then reads flat. */
    onScheduleChange?: ((patch: Partial<IWorkflow>) => void) | undefined;
}

function Icon({ name }: { name: string }) {
    return (
        <Box
            component="span"
            className="material-symbols-rounded"
            aria-hidden="true"
            sx={{ fontSize: 18 }}
        >
            {name}
        </Box>
    );
}

export function WorkflowHeader({
    workflow: wf,
    projectName,
    dirty,
    saveDisabled,
    saving,
    runDisabledReason,
    onSave,
    onRun,
    onDelete,
    onScheduleChange,
}: Props) {
    const active = wf.status === 'active';
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const toast = useToast();
    const publish = usePublishWorkflow();
    const upgrade = useUpgradeWorkflow();

    // Pulling the source again replaces the graph, so it stays an explicit
    // action with its own confirmation copy. The automatic path (import) only
    // upgrades a workflow nobody has edited since it was pulled.
    async function handleUpgrade() {
        try {
            await upgrade.mutateAsync(wf.id);
            toast.show({ message: 'Upgraded from the marketplace' });
        } catch (err) {
            toast.show({
                message: 'Could not upgrade workflow',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async function handlePublish() {
        try {
            const entry = await publish.mutateAsync(wf.id);
            toast.show({
                message:
                    entry.published_at === entry.updated_at
                        ? 'Published to the marketplace'
                        : 'Updated in the marketplace',
            });
        } catch (err) {
            toast.show({
                message: 'Could not publish workflow',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 3,
                flexWrap: 'wrap',
                mb: 3,
            }}
        >
            <Box sx={{ minWidth: 0 }}>
                <Link
                    component={RouterLink}
                    to="/workflows"
                    underline="hover"
                    sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}
                >
                    Workflows
                </Link>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, minWidth: 0 }}>
                    <Typography
                        variant="h2"
                        sx={{
                            color: ATLAS_PALETTE.slate,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {wf.name || 'Untitled workflow'}
                    </Typography>
                    <Box
                        component="span"
                        sx={{
                            px: 2,
                            height: 20,
                            display: 'inline-flex',
                            alignItems: 'center',
                            borderRadius: '9999px',
                            fontSize: 10.5,
                            fontWeight: 600,
                            background: active ? ATLAS_PALETTE.successSoft : ATLAS_PALETTE.slate06,
                            color: active ? ATLAS_PALETTE.successFg : ATLAS_PALETTE.slate60,
                            flexShrink: 0,
                        }}
                    >
                        {active ? 'Active' : 'Inactive'}
                    </Box>
                    {dirty && (
                        <Typography
                            sx={{ fontSize: 12, color: ATLAS_PALETTE.warnFg, flexShrink: 0 }}
                        >
                            Unsaved changes
                        </Typography>
                    )}
                </Box>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                    {projectName} · {INPUT_KIND_LABEL[wf.input_kind]} ·{' '}
                    {onScheduleChange && wf.input_kind !== 'sub_task' ? (
                        <Box
                            component="button"
                            type="button"
                            onClick={() => setScheduleOpen(true)}
                            sx={{
                                font: 'inherit',
                                color: 'inherit',
                                background: 'none',
                                border: 'none',
                                p: 0,
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                textDecorationStyle: 'dotted',
                                textUnderlineOffset: 3,
                                '&:hover': { color: ATLAS_PALETTE.slate },
                            }}
                        >
                            {triggerLabel(wf)}
                        </Box>
                    ) : (
                        triggerLabel(wf)
                    )}{' '}
                    · {deliveryLabel(wf)}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button
                    variant="contained"
                    onClick={onSave}
                    disabled={saveDisabled || saving}
                    startIcon={<Icon name="save" />}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {saving ? 'Saving…' : 'Save'}
                </Button>
                <Tooltip title={runDisabledReason ?? ''}>
                    <Box component="span">
                        <Button
                            variant="outlined"
                            onClick={onRun}
                            disabled={runDisabledReason !== null}
                            startIcon={<Icon name="play_arrow" />}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Run now
                        </Button>
                    </Box>
                </Tooltip>
                {wf.upgrade_available && (
                    <Tooltip title="This workflow's marketplace source has a newer version">
                        <Box component="span">
                            <Button
                                variant="contained"
                                onClick={() => void handleUpgrade()}
                                disabled={upgrade.isPending}
                                startIcon={<Icon name="upgrade" />}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                {upgrade.isPending ? 'Upgrading…' : 'Upgrade available'}
                            </Button>
                        </Box>
                    </Tooltip>
                )}
                <Tooltip title={dirty ? 'Save your changes before exporting' : ''}>
                    <Box component="span">
                        <Button
                            variant="outlined"
                            href={api.workflows.exportZipUrl(wf.id)}
                            disabled={dirty}
                            startIcon={<Icon name="download" />}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Export
                        </Button>
                    </Box>
                </Tooltip>
                <Tooltip title={dirty ? 'Save your changes before publishing' : ''}>
                    <Box component="span">
                        <Button
                            variant="outlined"
                            onClick={() => void handlePublish()}
                            disabled={dirty || publish.isPending}
                            startIcon={<Icon name="storefront" />}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            {publish.isPending ? 'Publishing…' : 'Publish'}
                        </Button>
                    </Box>
                </Tooltip>
                <Tooltip title="Delete workflow">
                    <IconButton
                        aria-label="Delete workflow"
                        onClick={onDelete}
                        sx={{ color: ATLAS_PALETTE.slate60 }}
                    >
                        <Icon name="delete" />
                    </IconButton>
                </Tooltip>
            </Box>
            {onScheduleChange && (
                <WorkflowScheduleDialog
                    open={scheduleOpen}
                    workflow={wf}
                    onChange={onScheduleChange}
                    onClose={() => setScheduleOpen(false)}
                />
            )}
        </Box>
    );
}
