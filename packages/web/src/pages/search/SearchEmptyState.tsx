import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { EmptyState } from '../../components/EmptyState.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { FilterState, SearchType } from './searchViewModel.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    filters: FilterState;
    queryText: string | null;
    onDropStatus: () => void;
    onDropProject: () => void;
    onCreateType: (type: SearchType) => void;
}

export function SearchEmptyState({
    filters,
    queryText,
    onDropStatus,
    onDropProject,
    onCreateType,
}: Props) {
    const createType: SearchType = filters.types[0] ?? 'sub_bug';
    const createLabel =
        createType === 'sub_task'
            ? 'Sub-task'
            : createType === 'sub_bug'
              ? 'Sub-Bug'
              : (createType[0]?.toUpperCase() ?? '') + createType.slice(1);

    return (
        <EmptyState
            icon={
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 28, color: ATLAS_PALETTE.slate60 }}
                >
                    travel_explore
                </Box>
            }
            title="No Items Match"
            description="The query parses cleanly but no epics, stories, bugs, sub-tasks, sub-bugs, prompts, or conversations match."
            supplemental={
                queryText ? (
                    <Box
                        sx={{
                            display: 'inline-block',
                            background: ATLAS_PALETTE.cloud,
                            border: `1px solid ${ATLAS_PALETTE.brandBlue}30`,
                            borderRadius: '8px',
                            px: 2.5,
                            py: 1.5,
                        }}
                    >
                        <Typography
                            component="code"
                            sx={{ fontFamily: MONO, fontSize: 12, color: ATLAS_PALETTE.slate }}
                        >
                            {queryText}
                        </Typography>
                    </Box>
                ) : undefined
            }
            actions={
                <>
                    {filters.status !== 'any' ? (
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={onDropStatus}
                            startIcon={
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 16 }}
                                >
                                    filter_alt_off
                                </Box>
                            }
                            sx={{ textTransform: 'none', fontSize: 12.5 }}
                        >
                            Drop the Status Filter
                        </Button>
                    ) : null}
                    {filters.projectIds.length > 0 ? (
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={onDropProject}
                            startIcon={
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 16 }}
                                >
                                    swap_horiz
                                </Box>
                            }
                            sx={{ textTransform: 'none', fontSize: 12.5 }}
                        >
                            Try a Different Project
                        </Button>
                    ) : null}
                    <Button
                        variant="contained"
                        size="small"
                        onClick={() => onCreateType(createType)}
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 16 }}
                            >
                                add
                            </Box>
                        }
                        sx={{
                            textTransform: 'none',
                            fontSize: 12.5,
                            background: ATLAS_PALETTE.green,
                            boxShadow: 'none',
                            '&:hover': { background: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                        }}
                    >
                        Create a {createLabel}
                    </Button>
                </>
            }
        />
    );
}
