import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import type { IWorkflow } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { INPUT_KIND_LABEL, TRIGGER_LABEL, deliveryLabel } from './labels.js';

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
}

function Icon({ name }: { name: string }) {
    return (
        <Box component="span" className="material-symbols-rounded" sx={{ fontSize: 18 }}>
            {name}
        </Box>
    );
}

export function WorkflowHeader({ workflow: wf, projectName, dirty, saveDisabled, saving, runDisabledReason, onSave, onRun, onDelete }: Props) {
    const active = wf.status === 'active';
    return (
        <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 3 }}>
            <Box sx={{ minWidth: 0 }}>
                <Link component={RouterLink} to="/workflows" underline="hover" sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                    Workflows
                </Link>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, minWidth: 0 }}>
                    <Typography variant="h2" sx={{ color: ATLAS_PALETTE.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.warnFg, flexShrink: 0 }}>Unsaved changes</Typography>
                    )}
                </Box>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                    {projectName} · {INPUT_KIND_LABEL[wf.input_kind]} · {TRIGGER_LABEL[wf.trigger]} · {deliveryLabel(wf)}
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
                <Tooltip title="Delete workflow">
                    <IconButton aria-label="Delete workflow" onClick={onDelete} sx={{ color: ATLAS_PALETTE.slate60 }}>
                        <Icon name="delete" />
                    </IconButton>
                </Tooltip>
            </Box>
        </Box>
    );
}
