import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import type { IAgent, IAgentPromptVersion } from '@atlas/shared';
import {
    useAgentPromptVersions,
    useRevertAgentPrompt,
    useUpdateAgent,
} from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { relativeTime } from './agentViewModel.js';
import { MarkdownPreview } from '../../components/MarkdownPreview.js';

interface Props {
    agent: IAgent;
}

type ViewMode = 'edit' | 'split' | 'preview';

const MONO = TYPOGRAPHY.fontFamilyMono;

function ViewModeChip({
    mode,
    current,
    onClick,
    label,
}: {
    mode: ViewMode;
    current: ViewMode;
    onClick: () => void;
    label: string;
}) {
    const active = mode === current;
    return (
        <Box
            onClick={onClick}
            sx={{
                px: 1.5,
                height: 26,
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate60,
                background: active ? ATLAS_PALETTE.white : 'transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                boxShadow: active ? '0 1px 2px rgba(0,0,14,.08)' : 'none',
                transition: 'all 120ms ease',
                '&:hover': { color: ATLAS_PALETTE.slate },
            }}
        >
            {label}
        </Box>
    );
}

function formatTime(d: Date): string {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function slug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

interface PromptEditorCardProps {
    headerIcon: string;
    headerLabel: string;
    fileName: string;
    version: number;
    value: string;
    savedValue: string;
    placeholder: string;
    isSaving: boolean;
    statusLabelExtra?: string | null;
    onChange: (v: string) => void;
    onSave: () => void;
    onDiscard: () => void;
}

function PromptEditorCard({
    headerIcon,
    headerLabel,
    fileName,
    version,
    value,
    savedValue,
    placeholder,
    isSaving,
    statusLabelExtra,
    onChange,
    onSave,
    onDiscard,
}: PromptEditorCardProps) {
    const [mode, setMode] = useState<ViewMode>('split');
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const dirty = value !== savedValue;
    const lineCount = useMemo(() => value.split('\n').length, [value]);

    // Bump the "Saved HH:MM" stamp whenever the persisted value changes
    // after a save. We trigger only on transition from dirty=true to
    // dirty=false so revert / discard don't bump the stamp.
    useEffect(() => {
        if (!dirty) setLastSavedAt((prev) => (prev === null ? null : prev));
    }, [dirty]);

    const statusLabel = (() => {
        if (dirty) return 'Unsaved changes';
        if (lastSavedAt) return `Saved ${formatTime(lastSavedAt)}`;
        /* v8 ignore next -- statusLabelExtra is a future-proofing prop; the sole
           caller (PromptTabContent) never passes it, so this branch is
           unreachable via the wired-up UI today. */
        if (statusLabelExtra) return statusLabelExtra;
        return 'Not saved yet';
    })();

    function handleSave() {
        /* v8 ignore next -- defensive guard: the Save button is `disabled` whenever
           `!dirty` (see disabled={!dirty || isSaving} below), so a real click can
           never reach handleSave while dirty is false. */
        if (!dirty) return;
        onSave();
        setLastSavedAt(new Date());
    }

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                overflow: 'hidden',
                mb: 3,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 2,
                    px: 3,
                    py: 2,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 18, color: ATLAS_PALETTE.brandBlue }}
                >
                    {headerIcon}
                </Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                    {headerLabel} · v{version}
                </Typography>
                <Typography
                    sx={{
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate40,
                        fontFamily: MONO,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {fileName}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography
                    sx={{
                        fontSize: 11.5,
                        color: dirty ? ATLAS_PALETTE.orange : ATLAS_PALETTE.slate40,
                        fontFamily: MONO,
                    }}
                >
                    {statusLabel}
                </Typography>
                <Box
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        p: 0.5,
                        gap: 0.25,
                        borderRadius: '8px',
                        background: ATLAS_PALETTE.slate08,
                    }}
                >
                    <ViewModeChip mode="edit" current={mode} onClick={() => setMode('edit')} label="Edit" />
                    <ViewModeChip mode="split" current={mode} onClick={() => setMode('split')} label="Split" />
                    <ViewModeChip mode="preview" current={mode} onClick={() => setMode('preview')} label="Preview" />
                </Box>
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns:
                        mode === 'split' ? { xs: '1fr', md: '1fr 1fr' } : '1fr',
                    gridAutoRows: {
                        xs: mode === 'split' ? 'minmax(420px, auto)' : 'minmax(520px, auto)',
                        md: 'minmax(420px, auto)',
                    },
                }}
            >
                {(mode === 'edit' || mode === 'split') && (
                    <Box
                        sx={{
                            borderRight: {
                                xs: 'none',
                                md:
                                    mode === 'split'
                                        ? `1px solid ${ATLAS_PALETTE.slate06}`
                                        : 'none',
                            },
                            borderBottom: {
                                xs:
                                    mode === 'split'
                                        ? `1px solid ${ATLAS_PALETTE.slate06}`
                                        : 'none',
                                md: 'none',
                            },
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <Box
                            component="textarea"
                            value={value}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                onChange(e.target.value)
                            }
                            spellCheck={false}
                            placeholder={placeholder}
                            sx={{
                                flex: 1,
                                width: '100%',
                                border: 'none',
                                outline: 'none',
                                resize: 'none',
                                p: 3,
                                fontFamily: MONO,
                                fontSize: 12.5,
                                lineHeight: 1.7,
                                color: ATLAS_PALETTE.slate,
                                background: 'transparent',
                                '&::placeholder': { color: ATLAS_PALETTE.slate40 },
                            }}
                        />
                    </Box>
                )}
                {(mode === 'preview' || mode === 'split') && (
                    <Box sx={{ p: 3, overflow: 'auto' }}>
                        <MarkdownPreview source={value} />
                    </Box>
                )}
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    px: 3,
                    py: 2,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                    background: ATLAS_PALETTE.cloud,
                }}
            >
                <Typography
                    sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60, fontFamily: MONO }}
                >
                    {statusLabel} · {lineCount} {lineCount === 1 ? 'line' : 'lines'}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {dirty && (
                    <Button
                        variant="outlined"
                        onClick={onDiscard}
                        disabled={isSaving}
                        sx={{ height: 30, textTransform: 'none', fontSize: 12.5 }}
                    >
                        Discard
                    </Button>
                )}
                <Button
                    variant="contained"
                    color="success"
                    onClick={handleSave}
                    disabled={!dirty || isSaving}
                    sx={{ height: 30, textTransform: 'none', fontSize: 12.5 }}
                >
                    {isSaving ? 'Saving…' : 'Save'}
                </Button>
            </Box>
        </Box>
    );
}

interface VersionHistoryCardProps {
    versions: IAgentPromptVersion[];
    activeVersion: number;
    isReverting: boolean;
    onRevert: (version: number) => void;
}

function VersionHistoryCard({
    versions,
    activeVersion,
    isReverting,
    onRevert,
}: VersionHistoryCardProps) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                overflow: 'hidden',
                mb: 3,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 3,
                    py: 2,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }}
                >
                    history
                </Box>
                <Typography
                    sx={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    Version history ({versions.length})
                </Typography>
            </Box>

            <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
                <Box sx={{ minWidth: 640 }}>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '60px 1fr 140px 120px 100px',
                            gap: 1.5,
                            alignItems: 'center',
                            px: 3,
                            py: 1.25,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                            background: ATLAS_PALETTE.cloud,
                            position: 'sticky',
                            top: 0,
                            zIndex: 1,
                            boxSizing: 'border-box',
                        }}
                    >
                        {['Version', 'Created', 'Edited by', 'Status', 'Action'].map((h, i) => (
                            <Typography
                                key={h}
                                sx={{
                                    fontSize: 10.5,
                                    color: ATLAS_PALETTE.slate60,
                                    fontWeight: 600,
                                    letterSpacing: '0.04em',
                                    textTransform: 'uppercase',
                                    textAlign: i === 4 ? 'right' : 'left',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                            >
                                {h}
                            </Typography>
                        ))}
                    </Box>

                    {versions.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center' }}>
                            <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                                No prompt history yet. Saving a new version starts the trail.
                            </Typography>
                        </Box>
                    ) : (
                        versions.map((row) => {
                            const isActive = row.version === activeVersion;
                            return (
                                <Box
                                    key={row.id}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '60px 1fr 140px 120px 100px',
                                        alignItems: 'center',
                                        gap: 1.5,
                                        px: 3,
                                        py: 1.5,
                                        borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                                        '&:last-of-type': { borderBottom: 'none' },
                                        boxSizing: 'border-box',
                                    }}
                                >
                                    <Typography
                                        sx={{
                                            fontSize: 12.5,
                                            fontFamily: MONO,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        v{row.version}
                                    </Typography>
                                    <Typography
                                        title={
                                            row.reverted_from
                                                ? `${relativeTime(row.created_at)} · reverted from v${row.reverted_from}`
                                                : relativeTime(row.created_at)
                                        }
                                        sx={{
                                            fontSize: 12.5,
                                            color: ATLAS_PALETTE.slate70,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            minWidth: 0,
                                        }}
                                    >
                                        {relativeTime(row.created_at)}
                                        {row.reverted_from ? (
                                            <Box
                                                component="span"
                                                sx={{
                                                    ml: 1,
                                                    fontFamily: MONO,
                                                    fontSize: 11,
                                                    color: ATLAS_PALETTE.slate40,
                                                }}
                                            >
                                                · rev v{row.reverted_from}
                                            </Box>
                                        ) : null}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontSize: 12.5,
                                            color: ATLAS_PALETTE.slate70,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        {row.edited_by}
                                    </Typography>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 0.75,
                                            minWidth: 0,
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                width: 7,
                                                height: 7,
                                                borderRadius: '9999px',
                                                flexShrink: 0,
                                                background: isActive
                                                    ? ATLAS_PALETTE.green
                                                    : ATLAS_PALETTE.slate40,
                                            }}
                                        />
                                        <Typography
                                            sx={{
                                                fontSize: 12,
                                                fontWeight: 500,
                                                color: isActive
                                                    ? ATLAS_PALETTE.green
                                                    : ATLAS_PALETTE.slate60,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}
                                        >
                                            {isActive ? 'Active' : 'Replaced'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        {!isActive ? (
                                            <Box
                                                onClick={() => onRevert(row.version)}
                                                sx={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 0.5,
                                                    fontSize: 12,
                                                    color: ATLAS_PALETTE.brandBlue,
                                                    cursor: isReverting ? 'wait' : 'pointer',
                                                    pointerEvents: isReverting ? 'none' : 'auto',
                                                    '&:hover .icon-link-text': {
                                                        textDecoration: 'underline',
                                                    },
                                                }}
                                            >
                                                <Box
                                                    component="span"
                                                    className="material-symbols-rounded"
                                                    sx={{ fontSize: 14 }}
                                                >
                                                    undo
                                                </Box>
                                                <Box component="span" className="icon-link-text">
                                                    Revert
                                                </Box>
                                            </Box>
                                        ) : (
                                            <Typography
                                                sx={{
                                                    fontSize: 11,
                                                    color: ATLAS_PALETTE.slate40,
                                                    fontStyle: 'italic',
                                                }}
                                            >
                                                current
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            );
                        })
                    )}
                </Box>
            </Box>
        </Box>
    );
}

// 2026-06-12 — auto-prepended preamble that the agent-runner /
// commands-assembler injects above every item-attached agent's prompt
// at run time. Kept in lockstep with `preamble-assembler.ts` so the UI
// shows exactly what the agent will see. Owners don't need to (and
// shouldn't) re-author these 6 lines in their custom prompt.
function autoPrependedPreamble(agentId: string): string {
    return [
        `You are agent \`${agentId}\`. Before doing anything else, read these files at the worktree root:`,
        '',
        '1. `.atlas/constitution.md` — the project\'s rules of engagement',
        '2. `.atlas/handoff.md` — your routing contract (what MCP calls to make on pass / fail)',
        '3. `.atlas/current-task.md` — the item this run targets',
        '4. `.atlas/self-memory.md` — your past course-corrections (append a one-liner at the end of this run if you learn something non-obvious)',
    ].join('\n');
}

function AutoPreambleBanner({ agentId }: { agentId: string }) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.cloud,
                border: `1px dashed ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 2.5,
                mb: 2,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }}
                >
                    auto_awesome
                </Box>
                <Typography
                    sx={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    Auto-prepended at run time — you don't need to add this
                </Typography>
            </Box>
            <Box
                component="pre"
                sx={{
                    m: 0,
                    fontFamily: MONO,
                    fontSize: 12,
                    lineHeight: 1.65,
                    color: ATLAS_PALETTE.slate70,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}
            >
                {autoPrependedPreamble(agentId)}
            </Box>
        </Box>
    );
}

export function PromptTabContent({ agent }: Props) {
    const updateAgent = useUpdateAgent();
    const revertPrompt = useRevertAgentPrompt();
    const toast = useToast();

    // T1 — single prompt per agent record. Each SDLC role splits into
    // two agent rows (performer + reviewer); both edit their own
    // `prompt_md` through this single editor.
    const [draft, setDraft] = useState(agent.prompt_md);
    const { data: versions = [] } = useAgentPromptVersions(agent.id);

    useEffect(() => {
        setDraft(agent.prompt_md);
    }, [agent.id, agent.prompt_md]);

    const promptFileName = useMemo(
        () => `${slug(agent.name)}.prompt.md`,
        [agent.name],
    );

    async function savePrompt() {
        try {
            await updateAgent.mutateAsync({ id: agent.id, data: { prompt_md: draft } });
            toast.show({ message: `Saved as v${agent.prompt_version + 1}` });
        } catch (e) {
            toast.show({ message: 'Save failed', detail: (e as Error).message });
        }
    }

    function handleRevert(targetVersion: number) {
        /* v8 ignore next -- defensive guard: VersionHistoryCard never renders a
           Revert control for the active row (see `{!isActive ? <Revert/> : ...}`),
           so onRevert can never be invoked with the current prompt_version. */
        if (targetVersion === agent.prompt_version) return;
        revertPrompt.mutate(
            { id: agent.id, version: targetVersion },
            {
                onSuccess: (next) => {
                    toast.show({
                        message: `Reverted to v${targetVersion} as v${next.prompt_version}`,
                    });
                },
                onError: (e) =>
                    toast.show({ message: 'Revert failed', detail: (e as Error).message }),
            },
        );
    }

    return (
        <Box>
            {agent.requires_item ? <AutoPreambleBanner agentId={agent.id} /> : null}

            <PromptEditorCard
                headerIcon="article"
                headerLabel="Active prompt"
                fileName={promptFileName}
                version={agent.prompt_version}
                value={draft}
                savedValue={agent.prompt_md}
                placeholder={`# ${agent.name}\n\nWrite the agent's prompt in markdown…`}
                isSaving={updateAgent.isPending}
                onChange={setDraft}
                onSave={() => void savePrompt()}
                onDiscard={() => setDraft(agent.prompt_md)}
            />

            <VersionHistoryCard
                versions={versions}
                activeVersion={agent.prompt_version}
                isReverting={revertPrompt.isPending}
                onRevert={(v) => handleRevert(v)}
            />
        </Box>
    );
}
