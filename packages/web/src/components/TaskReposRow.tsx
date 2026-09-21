import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { AtlasApiError } from '../api/api.js';
import { useProjectRepos } from '../hooks/useProjectRepos.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { InfoRow } from './InfoPanel.js';
import { RepoSelect } from './RepoSelect.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    projectId: string;
    /** The Task's repos in order; `[]` only on a pre-ADR-0018 Task. */
    repoIds: string[];
    onChange: (next: string[]) => Promise<unknown>;
}

/** Task Details rail row (ADR 0018). Editable when the project has another repo to pick. */
export function TaskReposRow({ projectId, repoIds, onChange }: Props) {
    const { data: repos = [] } = useProjectRepos(projectId);
    const toast = useToast();
    const [draft, setDraft] = useState<string[] | null>(null);
    const [saving, setSaving] = useState(false);

    const current = repoIds.length > 0 ? repoIds : repos.slice(0, 1).map((r) => r.id);
    const nameOf = (id: string) => repos.find((r) => r.id === id)?.name ?? id;
    const editable = repos.length > 1;

    async function save(next: string[]) {
        setSaving(true);
        try {
            await onChange(next);
        } catch (e) {
            toast.show({
                message:
                    e instanceof AtlasApiError && e.status === 409
                        ? 'Stop the workflow run to change repos'
                        : e instanceof Error
                          ? e.message
                          : 'Could not change the repos',
            });
        } finally {
            setSaving(false);
            setDraft(null);
        }
    }

    return (
        <>
            <InfoRow
                label="Repos"
                clickable={editable}
                onClick={editable ? () => setDraft(current) : undefined}
            >
                <Box
                    sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 0.5,
                        justifyContent: { xs: 'flex-start', md: 'flex-end' },
                    }}
                >
                    {current.map((id) => (
                        <Chip
                            key={id}
                            label={nameOf(id)}
                            size="small"
                            sx={{ fontFamily: MONO, fontSize: 11.5 }}
                        />
                    ))}
                </Box>
                {editable && (
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}
                    >
                        arrow_drop_down
                    </Box>
                )}
            </InfoRow>
            {draft && (
                <Dialog open onClose={() => setDraft(null)} maxWidth="xs" fullWidth>
                    <DialogTitle sx={{ fontWeight: 600 }}>Repos</DialogTitle>
                    <DialogContent sx={{ pt: 1 }}>
                        <Box sx={{ pt: 1 }}>
                            <RepoSelect repos={repos} value={draft} onChange={setDraft} />
                        </Box>
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 2.5 }}>
                        <Button
                            onClick={() => setDraft(null)}
                            disabled={saving}
                            sx={{ textTransform: 'none' }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => void save(draft)}
                            disabled={saving}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Save
                        </Button>
                    </DialogActions>
                </Dialog>
            )}
        </>
    );
}
