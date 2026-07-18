import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import StickyNote2Rounded from '@mui/icons-material/StickyNote2Rounded';
import type { IScratchPad } from '@atlas/shared';
import { PageFab, useSetPageTitle } from '../components/shell/index.js';
import { HeroEmptyState } from '../components/HeroEmptyState.js';
import { ScratchPadEditor } from '../components/ScratchPadEditor.js';
import { useScratchPadList, useCreateScratchPad } from '../hooks/useScratchPad.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

// P12 — Scratch Pad page. Tile-grid of free-form markdown notes that don't
// belong to any project / agent / issue. The list is rendered as a
// responsive CSS grid of cards; clicking a card opens the modal markdown
// editor; clicking "New tile" creates an empty row and opens the editor
// pointed at it.
//
// Why a card grid and not a list: the spec called out "tile-grid card
// layout"; the visual model is sticky-notes-on-a-wall rather than a row of
// todo items. The grid auto-fills wider screens.

const PREVIEW_LIMIT = 140;

export function ScratchPad() {
    useSetPageTitle('Scratch Pad');
    const toast = useToast();

    const { data: tiles = [], isLoading } = useScratchPadList();
    const createTile = useCreateScratchPad();

    const [editingId, setEditingId] = useState<string | null>(null);

    const editingTile = editingId ? (tiles.find((t) => t.id === editingId) ?? null) : null;

    function openNew() {
        createTile.mutate(
            {},
            {
                onSuccess: (tile) => setEditingId(tile.id),
                onError: (e: Error) => {
                    toast.show({
                        message: 'Could not create scratch pad tile',
                        detail: e.message,
                    });
                },
            },
        );
    }

    return (
        // Match Epics.tsx: `py: 4` (was `py: 12`, ~3x too much vertical
        // padding); the desktop "New tile" button hides on mobile (xs) and
        // `<PageFab>` self-renders as a bottom-right FAB only on mobile,
        // exactly like the Epics page.
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    mb: 5,
                    gap: 4,
                    flexWrap: 'wrap',
                }}
            >
                <Box>
                    <Typography
                        variant="h1"
                        sx={{
                            fontSize: '2.25rem',
                            fontWeight: 700,
                            lineHeight: 1.2,
                            letterSpacing: '-0.01em',
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        Scratch Pad
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 2 }}>
                        Free-form markdown tiles. Use them for half-formed thoughts before
                        they become an Epic or a Story.
                    </Typography>
                </Box>
                <Box sx={{ display: { xs: 'none', md: 'flex' } }}>
                    <Button
                        variant="contained"
                        startIcon={<AddRounded sx={{ fontSize: 16 }} />}
                        onClick={openNew}
                        disabled={createTile.isPending}
                        sx={{ textTransform: 'none', fontWeight: 500 }}
                    >
                        {createTile.isPending ? 'Creating...' : 'New tile'}
                    </Button>
                </Box>
            </Box>

            {!isLoading && tiles.length === 0 ? (
                <HeroEmptyState
                    icon={
                        <StickyNote2Rounded
                            sx={{ fontSize: 30, color: ATLAS_PALETTE.slate60 }}
                        />
                    }
                    title="No scratch pad tiles yet"
                    description="Use New tile to capture a thought. Tiles autosave every 5 seconds while open."
                />
            ) : (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                        gap: 4,
                    }}
                >
                    {tiles.map((tile) => (
                        <TileCard
                            key={tile.id}
                            tile={tile}
                            onOpen={() => setEditingId(tile.id)}
                        />
                    ))}
                </Box>
            )}

            <ScratchPadEditor
                open={editingId !== null}
                onClose={() => setEditingId(null)}
                tile={editingTile}
            />

            <PageFab onClick={openNew} label="New tile" />
        </Box>
    );
}

interface TileCardProps {
    tile: IScratchPad;
    onOpen: () => void;
}

function TileCard({ tile, onOpen }: TileCardProps) {
    const title = tile.title.trim().length > 0 ? tile.title : 'Untitled tile';
    const preview =
        tile.body_md.length > PREVIEW_LIMIT
            ? `${tile.body_md.slice(0, PREVIEW_LIMIT).trimEnd()}...`
            : tile.body_md;
    const updatedAt = new Date(tile.updated_at);
    const updatedLabel = Number.isNaN(updatedAt.getTime())
        ? ''
        : updatedAt.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
          });

    return (
        <Box
            onClick={onOpen}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minHeight: 160,
                px: 4,
                py: 4,
                borderRadius: '12px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                background: ATLAS_PALETTE.white,
                cursor: 'pointer',
                transition: 'all 150ms ease',
                '&:hover': {
                    borderColor: ATLAS_PALETTE.slate30,
                    background: ATLAS_PALETTE.cloud,
                },
            }}
        >
            <Typography
                sx={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                }}
            >
                {title}
            </Typography>
            <Typography
                sx={{
                    flex: 1,
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate60,
                    whiteSpace: 'pre-wrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 5,
                    WebkitBoxOrient: 'vertical',
                }}
            >
                {preview || (
                    <Box
                        component="span"
                        sx={{ fontStyle: 'italic', color: ATLAS_PALETTE.slate40 }}
                    >
                        Empty tile. Click to start writing.
                    </Box>
                )}
            </Typography>
            <Typography
                sx={{
                    fontSize: 11,
                    color: ATLAS_PALETTE.slate60,
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {updatedLabel}
            </Typography>
        </Box>
    );
}
