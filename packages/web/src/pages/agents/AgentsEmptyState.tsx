import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { EmptyState } from '../../components/EmptyState.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    onBrowse: () => void;
    onCreate: () => void;
}

export function AgentsEmptyState({ onBrowse, onCreate }: Props) {
    return (
        <EmptyState
            variant="dashed"
            icon={
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    aria-hidden="true"
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
            // Two routes out, not one. Installing from the catalog is the common
            // path and stays primary, but an Owner who wants to author their own
            // agent had no in-flow affordance here at all — the header's "Add
            // Agent" is `display: none` below md, so on a phone this empty state
            // was the whole surface and it only offered the Marketplace.
            actions={
                <>
                    <Button
                        variant="outlined"
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{ fontSize: 18 }}
                            >
                                add
                            </Box>
                        }
                        onClick={onCreate}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: 13.5,
                            px: 3,
                            py: 1.25,
                        }}
                    >
                        Create new
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
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
                        Browse marketplace
                    </Button>
                </>
            }
        />
    );
}
