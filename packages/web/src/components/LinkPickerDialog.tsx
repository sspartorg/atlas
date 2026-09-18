import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import CloseRounded from '@mui/icons-material/CloseRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import type { IIssueLinkRow, IssueType } from '@atlas/shared';
import {
    useIssueLinks,
    useCreateIssueLink,
} from '../hooks/useIssueLinks.js';
import { useTasks } from '../hooks/useTasks.js';
import { useAllSubTasks } from '../hooks/useSubTasks.js';
import { useToast } from '../hooks/useToast.js';
import { KindIcon } from './KindIcon.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

export interface PickerCandidate {
    type: IssueType;
    id: string;
    shortId: string;
    title: string;
}

interface LinkPickerDialogProps {
    open: boolean;
    mode: 'relates_to' | 'depends_on' | 'tested_by';
    /** The item the new link is being added FROM. */
    fromIssueType: IssueType;
    fromIssueId: string;
    /** Pre-loaded links from the parent's /full response (filters out self
     *  + already-linked targets). When omitted, the dialog fetches via
     *  `useIssueLinks`. */
    links?: IIssueLinkRow[];
    /**
     * When `mode === 'tested_by'`, restrict candidates to sub-tasks of this
     * task. Mirrors PO Writer's contract that dev/QA twins are siblings
     * under the same task. Tasks are dropped from the candidate list when
     * this is set.
     */
    restrictToTaskId?: string | undefined;
    onClose: () => void;
}

/**
 * Self-contained item-link picker. Lifted out of `RelatedItemsCard` so the
 * detail-page `+` add-menu can open it directly when the Blocked-by /
 * Relates-to tables are hidden (zero links). Both the `+` menu and the
 * tables' in-section "Add dependency" / "Link an item" buttons mount the
 * same dialog with different `mode`s.
 *
 * Picker corpus (tasks + sub-tasks) is gated on `open=true` — the two list
 * queries only fire while the dialog is open, so the dialog mount cost is
 * just the dialog shell.
 */
export function LinkPickerDialog({
    open,
    mode,
    fromIssueType,
    fromIssueId,
    links: propLinks,
    restrictToTaskId,
    onClose,
}: LinkPickerDialogProps) {
    // Only fetch when the parent did not pre-supply links.
    const { data: fetchedLinks = [] } = useIssueLinks(fromIssueType, fromIssueId, {
        enabled: !propLinks,
    });
    const links: IIssueLinkRow[] = propLinks ?? fetchedLinks;

    const createLink = useCreateIssueLink(fromIssueType, fromIssueId);
    const toast = useToast();

    // Corpus fetches. Lazy by construction: the parent only mounts this
    // dialog when the picker is being opened, so these list queries fire
    // only on owner intent (not on every detail page render).
    const { data: tasks = [] } = useTasks();
    const { data: subTasks = [] } = useAllSubTasks();

    const [query, setQuery] = useState('');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Reset query/error state on every open.
    useEffect(() => {
        if (open) {
            setQuery('');
            setErrorMsg(null);
        }
    }, [open]);

    const linkedKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const l of links) keys.add(`${l.relation_type}:${l.type}:${l.item_id}`);
        return keys;
    }, [links]);

    const candidates = useMemo<PickerCandidate[]>(() => {
        const sub = (restrictToTaskId
            ? subTasks.filter((t) => t.task_id === restrictToTaskId)
            : subTasks
        ).map((t) => ({ type: 'sub_task' as const, id: t.id, shortId: t.id, title: t.title }));
        if (restrictToTaskId) return sub;
        return [
            ...tasks.map((t) => ({ type: 'task' as const, id: t.id, shortId: t.id, title: t.title })),
            ...sub,
        ];
    }, [tasks, subTasks, restrictToTaskId]);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return candidates
            .filter((c) => {
                if (c.type === fromIssueType && c.id === fromIssueId) return false; // self
                if (linkedKeys.has(`${mode}:${c.type}:${c.id}`)) return false; // already linked at this relation
                return (
                    c.shortId.toLowerCase().includes(q) ||
                    c.title.toLowerCase().includes(q) ||
                    c.id.toLowerCase().includes(q)
                );
            })
            .slice(0, 8);
    }, [candidates, query, fromIssueType, fromIssueId, linkedKeys, mode]);

    async function handlePick(c: PickerCandidate) {
        setErrorMsg(null);
        try {
            await createLink.mutateAsync({
                toType: c.type,
                toId: c.id,
                relationType: mode,
            });
            setQuery('');
            toast.show({
                message:
                    mode === 'depends_on'
                        ? `Now blocked by ${c.shortId}`
                        : mode === 'tested_by'
                          ? `Test-link added: ${c.shortId}`
                          : `Linked to ${c.shortId}`,
                detail: c.title,
            });
            onClose();
        } catch (err) {
            setErrorMsg((err as Error).message);
        }
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={false}
            PaperProps={{
                sx: {
                    width: 560,
                    maxWidth: '92vw',
                    borderRadius: '14px',
                    overflow: 'hidden',
                    m: 2,
                },
            }}
        >
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, p: 4, pb: 3 }}>
                <Box
                    sx={{
                        width: 34,
                        height: 34,
                        borderRadius: '8px',
                        background: `${ATLAS_PALETTE.brandBlue}1A`,
                        color: ATLAS_PALETTE.brandBlue,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <LinkRounded sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: ATLAS_PALETTE.slate,
                            lineHeight: 1.2,
                        }}
                    >
                        {mode === 'depends_on'
                            ? 'Add dependency'
                            : mode === 'tested_by'
                              ? 'Add test link'
                              : 'Link an item'}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        {mode === 'depends_on'
                            ? 'This item will stay blocked until the picked target reaches done.'
                            : mode === 'tested_by'
                              ? 'This item will be the test holder. Pick the item it tests (same task only).'
                              : 'Search for a related task or sub-task to attach.'}
                    </Typography>
                </Box>
                <IconButton
                    onClick={onClose}
                    size="small"
                    sx={{ color: ATLAS_PALETTE.slate60, flexShrink: 0 }}
                >
                    <CloseRounded fontSize="small" />
                </IconButton>
            </Box>

            {/* Body */}
            <Box sx={{ px: 4, pb: 3 }}>
                <TextField
                    label="Id or title"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                    slotProps={{
                        input: {
                            sx: {
                                background: ATLAS_PALETTE.white,
                                fontSize: 13,
                            },
                        },
                    }}
                />

                {errorMsg && (
                    <Typography sx={{ mt: 2, fontSize: 12, color: ATLAS_PALETTE.error }}>
                        {errorMsg}
                    </Typography>
                )}

                <Box
                    sx={{
                        mt: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        maxHeight: '48vh',
                        overflow: 'auto',
                    }}
                >
                    {query.trim().length === 0 ? (
                        <Typography
                            sx={{
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate40,
                                fontStyle: 'italic',
                                py: 4,
                                textAlign: 'center',
                            }}
                        >
                            Start typing to search.
                        </Typography>
                    ) : matches.length === 0 ? (
                        <Typography
                            sx={{
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate60,
                                fontStyle: 'italic',
                                py: 4,
                                textAlign: 'center',
                            }}
                        >
                            No matches.
                        </Typography>
                    ) : (
                        matches.map((m) => (
                            <Box
                                key={`${m.type}:${m.id}`}
                                onClick={() => void handlePick(m)}
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: '20px 92px 1fr',
                                    alignItems: 'center',
                                    gap: 1.5,
                                    px: 2,
                                    py: 1.25,
                                    borderRadius: '8px',
                                    background: ATLAS_PALETTE.white,
                                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    cursor: 'pointer',
                                    transition: 'border-color 120ms ease',
                                    '&:hover': {
                                        borderColor: ATLAS_PALETTE.brandBlue,
                                        background: ATLAS_PALETTE.cloud,
                                    },
                                }}
                            >
                                <KindIcon kind={m.type} size={14} />
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    {m.shortId}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        color: ATLAS_PALETTE.slate,
                                        fontWeight: 500,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {m.title}
                                </Typography>
                            </Box>
                        ))
                    )}
                </Box>
            </Box>

            {/* Footer */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 2,
                    px: 4,
                    py: 3,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                }}
            >
                <Button
                    onClick={onClose}
                    sx={{ color: ATLAS_PALETTE.slate60, textTransform: 'none' }}
                >
                    Cancel
                </Button>
            </Box>
        </Dialog>
    );
}
