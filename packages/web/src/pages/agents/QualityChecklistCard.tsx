import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/api.js';
import { useAgentChecklists } from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';
import { FormSection } from '../../components/FormSection.js';

interface ChecklistDraft {
    key: string; // stable client-side row key (id-as-string for persisted, "new-…" for unsaved)
    label: string;
    required: boolean;
}

export function QualityChecklistCard({ agentId }: { agentId: string }) {
    const queryClient = useQueryClient();
    const toast = useToast();
    const checklistsQuery = useAgentChecklists(agentId);
    const [checks, setChecks] = useState<ChecklistDraft[]>([]);
    const [hydrated, setHydrated] = useState(false);
    const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const pendingDeleteCheck =
        pendingDeleteIdx !== null ? (checks[pendingDeleteIdx] ?? null) : null;

    useEffect(() => {
        if (!checklistsQuery.data || hydrated) return;
        setChecks(
            checklistsQuery.data.map((c) => ({
                key: String(c.id),
                label: c.label,
                required: c.required,
            }))
        );
        setHydrated(true);
    }, [checklistsQuery.data, hydrated]);

    function addCheck() {
        setChecks((xs) => [
            ...xs,
            { key: `new-${Date.now()}-${xs.length}`, label: 'New check', required: true },
        ]);
    }

    function confirmRemove() {
        if (pendingDeleteIdx === null) return;
        setChecks((xs) => xs.filter((_, i) => i !== pendingDeleteIdx));
        setPendingDeleteIdx(null);
    }

    async function handleSave() {
        setSaving(true);
        try {
            await api.agents.setChecklists(
                agentId,
                checks
                    .filter((c) => c.label.trim().length > 0)
                    .map((c, idx) => ({
                        label: c.label.trim(),
                        sort_order: idx,
                        required: c.required,
                    }))
            );
            await queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'checklists'] });
            toast.show({ message: 'Checklist saved' });
        } catch (e) {
            toast.show({
                message: 'Save failed',
                detail: e instanceof Error ? e.message : String(e),
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <FormSection label="Quality checklist">
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: -1, mb: 2 }}>
                The agent reports each check in its outcome. A failed required check sends the work
                down the workflow&apos;s fail path.
            </Typography>
            {checks.length === 0 ? (
                <Typography
                    sx={{
                        fontSize: 12.5,
                        color: ATLAS_PALETTE.slate40,
                        py: 1.5,
                        fontStyle: 'italic',
                    }}
                >
                    No checks yet. Add one to enforce a quality gate.
                </Typography>
            ) : (
                checks.map((c, idx) => (
                    <Box
                        key={c.key}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            py: 1,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                            '&:last-of-type': { borderBottom: 'none' },
                        }}
                    >
                        <TextField
                            fullWidth
                            variant="standard"
                            value={c.label}
                            onChange={(e) =>
                                setChecks((xs) =>
                                    xs.map((x, i) =>
                                        i === idx ? { ...x, label: e.target.value } : x
                                    )
                                )
                            }
                            slotProps={{ input: { disableUnderline: true } }}
                            sx={{
                                '& .MuiInputBase-input': {
                                    fontSize: 13,
                                    color: ATLAS_PALETTE.slate,
                                },
                            }}
                        />
                        <IconButton
                            size="small"
                            onClick={() => setPendingDeleteIdx(idx)}
                            aria-label={`Remove checklist item: ${c.label || 'untitled'}`}
                            sx={{ color: ATLAS_PALETTE.slate40 }}
                        >
                            <DeleteOutlineRounded sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Box>
                ))
            )}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    mt: 2,
                }}
            >
                <Button
                    size="small"
                    onClick={addCheck}
                    sx={{ textTransform: 'none', color: ATLAS_PALETTE.brandBlue }}
                >
                    Add check
                </Button>
                <Button
                    variant="contained"
                    size="small"
                    onClick={() => void handleSave()}
                    disabled={saving || !hydrated}
                    sx={{
                        textTransform: 'none',
                        bgcolor: ATLAS_PALETTE.green,
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                    }}
                >
                    {saving ? 'Saving…' : 'Save checklist'}
                </Button>
            </Box>

            <Dialog
                open={pendingDeleteCheck !== null}
                onClose={() => setPendingDeleteIdx(null)}
                maxWidth="xs"
                fullWidth
                PaperProps={{ sx: { borderRadius: '12px', m: { xs: 2, sm: 4 } } }}
            >
                <Box sx={{ p: 5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, mb: 4 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <FormHeading>Delete this checklist item?</FormHeading>
                            <Typography
                                sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}
                            >
                                <strong>
                                    {pendingDeleteCheck?.label.trim() || 'this checklist item'}
                                </strong>{' '}
                                will be removed. The change is local until you click{' '}
                                <strong>Save checklist</strong>.
                            </Typography>
                        </Box>
                        <IconButton
                            size="small"
                            onClick={() => setPendingDeleteIdx(null)}
                            aria-label="Close"
                        >
                            <CloseRounded fontSize="small" />
                        </IconButton>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                        <Button
                            onClick={() => setPendingDeleteIdx(null)}
                            sx={{ textTransform: 'none' }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={confirmRemove}
                            variant="contained"
                            color="error"
                            startIcon={<DeleteOutlineRounded />}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Delete item
                        </Button>
                    </Box>
                </Box>
            </Dialog>
        </FormSection>
    );
}
