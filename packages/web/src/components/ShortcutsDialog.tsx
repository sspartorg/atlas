import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, ELEVATION } from '../theme/tokens.js';

interface IShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

interface IShortcutRow {
    keys: string[];
    desc: string;
    sequence?: boolean;
}

interface IShortcutSection {
    title: string;
    rows: IShortcutRow[];
}

const SECTIONS: IShortcutSection[] = [
    {
        title: 'Go to (press G then key)',
        rows: [
            { keys: ['G', 'D'], desc: 'Dashboard', sequence: true },
            { keys: ['G', 'P'], desc: 'Projects', sequence: true },
            { keys: ['G', 'E'], desc: 'Epics', sequence: true },
            { keys: ['G', 'I'], desc: 'Issues', sequence: true },
            { keys: ['G', 'Q'], desc: 'Queue', sequence: true },
            { keys: ['G', 'A'], desc: 'Agents', sequence: true },
            { keys: ['G', 'N'], desc: 'Notifications', sequence: true },
            { keys: ['G', 'S'], desc: 'Settings', sequence: true },
        ],
    },
    {
        title: 'Dialog',
        rows: [
            { keys: ['Ctrl', 'K'], desc: 'Open Keyboard Shortcuts' },
            { keys: ['?'], desc: 'Open Keyboard Shortcuts' },
            { keys: ['Esc'], desc: 'Close any open dialog or popover' },
        ],
    },
];

const MONO_FONT = '"JetBrains Mono", monospace';

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <Box
            component="kbd"
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: ATLAS_PALETTE.slate06,
                color: ATLAS_PALETTE.slate,
                border: `1px solid ${ATLAS_PALETTE.slate08}`,
                borderRadius: '4px',
                padding: '2px 6px',
                fontFamily: MONO_FONT,
                fontSize: '0.6875rem',
                lineHeight: 1,
                minWidth: 18,
            }}
        >
            {children}
        </Box>
    );
}

export function ShortcutsDialog({ open, onClose }: IShortcutsDialogProps) {
    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            sx={{
                '& .MuiBackdrop-root': {
                    backgroundColor: 'rgba(46, 46, 46, 0.4)',
                },
            }}
            slotProps={{
                paper: {
                    sx: {
                        borderRadius: '8px',
                        boxShadow: ELEVATION.overlay,
                        p: 6,
                        bgcolor: 'background.paper',
                        position: 'relative',
                        zIndex: 1,
                        m: { xs: 2, sm: 4 },
                        maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                    },
                },
            }}
        >
            <Box>
                <Typography
                    sx={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        letterSpacing: '-0.01em',
                    }}
                >
                    Keyboard Shortcuts
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                    Press ? from anywhere to open this dialog.
                </Typography>
            </Box>

            {SECTIONS.map((section) => (
                <Box key={section.title} sx={{ mt: 4 }}>
                    <Typography
                        sx={{
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate60,
                            mb: 2,
                        }}
                    >
                        {section.title}
                    </Typography>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: 'auto 1fr',
                            columnGap: 4,
                            rowGap: 2,
                            alignItems: 'center',
                        }}
                    >
                        {section.rows.map((row, i) => (
                            <RowFragment key={`${row.keys.join('+')}-${i}`} row={row} />
                        ))}
                    </Box>
                </Box>
            ))}
        </Dialog>
    );
}

function RowFragment({ row }: { row: IShortcutRow }) {
    return (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {row.keys.map((k, i) => (
                    <Box
                        key={`${k}-${i}`}
                        component="span"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                    >
                        {i > 0 && (
                            <Typography
                                component="span"
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    mx: 0.25,
                                }}
                            >
                                {row.sequence ? 'then' : '+'}
                            </Typography>
                        )}
                        <Kbd>{k}</Kbd>
                    </Box>
                ))}
            </Box>
            <Typography sx={{ fontSize: 14, color: ATLAS_PALETTE.slate }}>{row.desc}</Typography>
        </>
    );
}
