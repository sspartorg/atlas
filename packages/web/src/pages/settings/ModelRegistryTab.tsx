import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import type { ICliModel, AgentCli } from '@atlas/shared';
import { useCliModels, useRemoveCliModel } from '../../hooks/useCliModels.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';
import { SettingsSection } from './SettingsSection.js';
import { ModelEditModal } from './ModelEditModal.js';

const MONO = '"JetBrains Mono", monospace';

const CLI_META: Record<AgentCli, { title: string; sub: string; dotColor: string; chip: string }> =
    {
        claude: {
            title: 'Claude CLI',
            sub: "Anthropic Claude SDK / claude-ck. Auth comes from your machine's `claude` install.",
            dotColor: ATLAS_PALETTE.error,
            chip: 'cli · claude',
        },
        copilot: {
            title: 'GitHub Copilot CLI',
            sub: 'GitHub Copilot CLI. Auth comes from `gh auth login` on this machine.',
            dotColor: ATLAS_PALETTE.slate,
            chip: 'cli · copilot',
        },
    };

export function ModelRegistryTab() {
    const { data: models = [], isLoading } = useCliModels();
    const claudeModels = useMemo(() => models.filter((m) => m.cli === 'claude'), [models]);
    const copilotModels = useMemo(() => models.filter((m) => m.cli === 'copilot'), [models]);

    if (isLoading) {
        return (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={24} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
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
                List every model you want available to your agents, scoped to the CLI that exposes
                it. The <strong>Add Agent</strong> dialog and per-agent model pickers only show
                what you&apos;ve added here.
            </Alert>

            <CliCard cli="claude" models={claudeModels} />
            <CliCard cli="copilot" models={copilotModels} />
        </Box>
    );
}

function CliCard({ cli, models }: { cli: AgentCli; models: ICliModel[] }) {
    const meta = CLI_META[cli];
    const toast = useToast();
    const remove = useRemoveCliModel();
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<ICliModel | null>(null);
    const [pendingDelete, setPendingDelete] = useState<ICliModel | null>(null);

    function openAdd() {
        setEditing(null);
        setModalOpen(true);
    }

    function openEdit(model: ICliModel) {
        setEditing(model);
        setModalOpen(true);
    }

    function confirmDelete() {
        if (!pendingDelete) return;
        const model = pendingDelete;
        remove.mutate(model.id, {
            onSuccess: () => {
                toast.show({ message: 'Model removed', detail: model.model_name });
                setPendingDelete(null);
            },
            onError: () => {
                setPendingDelete(null);
            },
        });
    }

    return (
        <SettingsSection sx={{ pt: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 2,
                    mb: 3,
                }}
            >
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', background: meta.dotColor }} />
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                    {meta.title}
                </Typography>
                <Box
                    sx={{
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 600,
                        px: 1,
                        py: 0.25,
                        bgcolor: ATLAS_PALETTE.slate08,
                        color: ATLAS_PALETTE.slate70,
                        borderRadius: '4px',
                    }}
                >
                    {meta.chip}
                </Box>
                <Typography
                    sx={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: ATLAS_PALETTE.slate60,
                        ml: 'auto',
                    }}
                >
                    {models.length} model{models.length === 1 ? '' : 's'}
                </Typography>
            </Box>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 3 }}>
                {meta.sub}
            </Typography>

            {models.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                    {models.map((m) => (
                        <Box
                            key={m.id}
                            role="button"
                            onClick={() => openEdit(m)}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                px: 3,
                                py: 2,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '8px',
                                bgcolor: ATLAS_PALETTE.white,
                                cursor: 'pointer',
                                transition: 'background 120ms ease',
                                '&:hover': { background: ATLAS_PALETTE.cloud },
                            }}
                        >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: ATLAS_PALETTE.slate,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {m.model_name}
                                </Typography>
                                {m.note && (
                                    <Typography
                                        sx={{
                                            fontSize: 11,
                                            fontStyle: 'italic',
                                            color: ATLAS_PALETTE.slate60,
                                            mt: 0.25,
                                            lineHeight: 1.4,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {m.note}
                                    </Typography>
                                )}
                            </Box>
                            <IconButton
                                size="small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingDelete(m);
                                }}
                                aria-label={`Remove ${m.model_name}`}
                                sx={{ flexShrink: 0 }}
                            >
                                <CloseRounded sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }} />
                            </IconButton>
                        </Box>
                    ))}
                </Box>
            )}

            <Button
                variant="outlined"
                startIcon={<AddRounded sx={{ fontSize: 16 }} />}
                onClick={openAdd}
                sx={{
                    textTransform: 'none',
                    fontWeight: 500,
                    alignSelf: 'flex-start',
                }}
            >
                Add model
            </Button>

            <ModelEditModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                cli={cli}
                cliLabel={meta.title}
                model={editing}
            />

            <ConfirmRemoveModelDialog
                model={pendingDelete}
                busy={remove.isPending}
                onCancel={() => setPendingDelete(null)}
                onConfirm={confirmDelete}
            />
        </SettingsSection>
    );
}

function ConfirmRemoveModelDialog({
    model,
    busy,
    onCancel,
    onConfirm,
}: {
    model: ICliModel | null;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const cliLabel = model ? CLI_META[model.cli].title : '';

    return (
        <Dialog
            open={model !== null}
            onClose={busy ? undefined : onCancel}
            maxWidth="xs"
            fullWidth
            PaperProps={{ sx: { borderRadius: '12px', m: 2 } }}
        >
            <Box sx={{ p: 5 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, mb: 4 }}>
                    <Box
                        sx={{
                            width: 32,
                            height: 32,
                            borderRadius: '8px',
                            bgcolor: 'rgba(220,38,38,0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <DeleteOutlineRounded
                            sx={{ color: ATLAS_PALETTE.error, fontSize: 20 }}
                        />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <FormHeading>Remove this model?</FormHeading>
                        <Typography
                            sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}
                        >
                            <strong>{model?.model_name ?? ''}</strong> will be removed from{' '}
                            {cliLabel}. Agents already configured to use it will keep the
                            reference, but you won&apos;t be able to pick it from the model dropdown
                            until you add it again.
                        </Typography>
                    </Box>
                    <IconButton
                        size="small"
                        onClick={onCancel}
                        disabled={busy}
                        aria-label="Close"
                    >
                        <CloseRounded fontSize="small" />
                    </IconButton>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                    <Button onClick={onCancel} disabled={busy} sx={{ textTransform: 'none' }}>
                        Cancel
                    </Button>
                    <Button
                        onClick={onConfirm}
                        disabled={busy}
                        variant="contained"
                        color="error"
                        startIcon={
                            busy ? (
                                <CircularProgress size={14} color="inherit" />
                            ) : (
                                <DeleteOutlineRounded />
                            )
                        }
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {busy ? 'Removing…' : 'Delete model'}
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}
