import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { EmptyState } from '../../components/EmptyState.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    onBrowse: () => void;
}

export function AgentsEmptyState({ onBrowse }: Props) {
    return (
        <EmptyState
            variant="dashed"
            icon={
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 32, color: ATLAS_PALETTE.slate40 }}
                >
                    smart_toy
                </Box>
            }
            title="No agents installed"
            description={
                <>
                    Install agents from the Marketplace. Each agent stays linked to its catalog
                    entry, so you&apos;ll see upgrades and can detach or reinstall any time.
                </>
            }
            actions={
                <Button
                    variant="contained"
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18 }}
                        >
                            storefront
                        </Box>
                    }
                    onClick={onBrowse}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: 13.5,
                        px: 3,
                        py: 1.25,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    Browse the Marketplace
                </Button>
            }
        />
    );
}
