import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import type { IAgent } from '@atlas/shared';
import { useUpdateAgent } from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// Curated set covering the four agent categories. Avoids drowning the
// Owner in the full Material Symbols catalog; new glyphs can be appended
// here as new agent archetypes appear.
const GLYPHS: ReadonlyArray<{ icon: string; label: string }> = [
    { icon: 'developer_board', label: 'PO / planning' },
    { icon: 'task_alt', label: 'Spec / checklist' },
    { icon: 'terminal', label: 'Coder' },
    { icon: 'verified', label: 'QA / verify' },
    { icon: 'bug_report', label: 'Bug hunter' },
    { icon: 'science', label: 'Experiment' },
    { icon: 'api', label: 'API' },
    { icon: 'edit_note', label: 'Docs' },
    { icon: 'travel_explore', label: 'SEO / research' },
    { icon: 'campaign', label: 'Marketing' },
    { icon: 'palette', label: 'Design' },
    { icon: 'dashboard_customize', label: 'Wireframe' },
    { icon: 'auto_awesome', label: 'AI / generic' },
    { icon: 'support_agent', label: 'Support' },
    { icon: 'lightbulb', label: 'Ideas' },
    { icon: 'rocket_launch', label: 'Launch' },
];

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
    if (!m || !m[1] || !m[2] || !m[3]) return hex;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

interface Props {
    open: boolean;
    agent: IAgent;
    currentGlyph: string;
    onClose: () => void;
}

export function GlyphPickerModal({ open, agent, currentGlyph, onClose }: Props) {
    const updateAgent = useUpdateAgent();
    const toast = useToast();
    const [selected, setSelected] = useState(currentGlyph);

    useEffect(() => {
        if (open) setSelected(currentGlyph);
    }, [open, currentGlyph]);

    function handleSave() {
        if (selected === currentGlyph) {
            onClose();
            return;
        }
        updateAgent.mutate(
            { id: agent.id, data: { glyph: selected } },
            {
                onSuccess: () => {
                    toast.show({ message: 'Glyph updated' });
                    onClose();
                },
                onError: (e) =>
                    toast.show({
                        message: 'Could not update glyph',
                        detail: (e as Error).message,
                    }),
            }
        );
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle
                sx={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    pb: 1,
                }}
            >
                Replace glyph
            </DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, mb: 3 }}>
                    The glyph appears on this agent&apos;s avatar, card, and chip across the app.
                </Typography>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 1.5,
                    }}
                >
                    {GLYPHS.map((g) => {
                        const isSelected = g.icon === selected;
                        return (
                            <Box
                                key={g.icon}
                                role="button"
                                aria-label={g.label}
                                aria-pressed={isSelected}
                                onClick={() => setSelected(g.icon)}
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 0.75,
                                    height: 92,
                                    px: 1,
                                    border: `2px solid ${
                                        isSelected
                                            ? agent.accent_color
                                            : ATLAS_PALETTE.slate10
                                    }`,
                                    background: isSelected
                                        ? hexToRgba(agent.accent_color, 0.06)
                                        : ATLAS_PALETTE.white,
                                    borderRadius: '10px',
                                    cursor: 'pointer',
                                    transition:
                                        'border-color 120ms ease, background 120ms ease',
                                    '&:hover': {
                                        borderColor: isSelected
                                            ? agent.accent_color
                                            : ATLAS_PALETTE.slate30,
                                        background: hexToRgba(agent.accent_color, 0.04),
                                    },
                                }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{
                                        fontSize: 26,
                                        color: isSelected
                                            ? agent.accent_color
                                            : ATLAS_PALETTE.slate60,
                                        fontVariationSettings: isSelected
                                            ? "'FILL' 1"
                                            : "'FILL' 0",
                                        flexShrink: 0,
                                    }}
                                >
                                    {g.icon}
                                </Box>
                                <Typography
                                    sx={{
                                        fontSize: 10.5,
                                        color: ATLAS_PALETTE.slate60,
                                        textAlign: 'center',
                                        lineHeight: 1.2,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                        width: '100%',
                                    }}
                                >
                                    {g.label}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3 }}>
                <Button onClick={onClose} sx={{ textTransform: 'none' }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={updateAgent.isPending}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.green,
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                    }}
                >
                    {updateAgent.isPending ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
