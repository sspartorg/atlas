import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { useQueryClient } from '@tanstack/react-query';
import type {
    AgentHandoffKind,
    IAgent,
    IAgentChecklistItem,
    IAgentHandoffRule,
    IssueStatus,
} from '@atlas/shared';
import { STATUS_LABELS } from '@atlas/shared';
import { api } from '../../api/api.js';
import {
    useAgentChecklists,
    useAgents,
    useHandoffRules,
    useUpdateAgent,
} from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';

interface Props {
    agent: IAgent;
}

interface ChecklistDraft {
    key: string; // stable client-side row key (id-as-string for persisted, "new-…" for unsaved)
    label: string;
    required: boolean;
}

interface RouteDraft {
    targetId: string;
    status: IssueStatus;
}

const STATUS_OPTIONS: IssueStatus[] = [
    'draft',
    'ready',
    'in_progress',
    'waiting_for_info',
    'in_review',
    'done',
];

const DEFAULT_ON_PASS: RouteDraft = { targetId: '', status: 'ready' };
const DEFAULT_ON_FAIL: RouteDraft = { targetId: 'owner', status: 'waiting_for_info' };

function findRule(rules: IAgentHandoffRule[], kind: AgentHandoffKind): RouteDraft | null {
    const r = rules.find((x) => x.kind === kind);
    if (!r) return null;
    // `|| ''` guards a blanked-out target_agent_id (e.g. the target agent was
    // deleted server-side and the row was scrubbed to '') so the Select falls
    // back to the "Pick an agent…" placeholder instead of rendering undefined.
    return { targetId: r.target_agent_id || '', status: r.status };
}

export function HandoffsTabContent({ agent }: Props) {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { data: agents = [] } = useAgents();
    const rulesQuery = useHandoffRules(agent.id);
    const checklistsQuery = useAgentChecklists(agent.id);
    const updateAgent = useUpdateAgent();

    const [prompt, setPrompt] = useState(agent.handoff_prompt_md);
    const [checks, setChecks] = useState<ChecklistDraft[]>([]);
    const [onPass, setOnPass] = useState<RouteDraft>(DEFAULT_ON_PASS);
    const [onFail, setOnFail] = useState<RouteDraft>(DEFAULT_ON_FAIL);
    const [hydratedRules, setHydratedRules] = useState(false);
    const [hydratedChecks, setHydratedChecks] = useState(false);
    const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);
    // `?? null` fallback guards a stale/out-of-range index, but `checks` only
    // shrinks via confirmRemovePendingCheck (which resets pendingDeleteIdx to
    // null in the same tick), so checks[pendingDeleteIdx] is always defined
    // whenever pendingDeleteIdx !== null in the wired-up UI.
    /* v8 ignore next */
    const pendingDeleteCheck = pendingDeleteIdx !== null ? checks[pendingDeleteIdx] ?? null : null;

    // Re-sync the local prompt buffer whenever the agent row is refetched from
    // the server (e.g. after MCP-driven updateAgent invalidates the cache).
    useEffect(() => {
        setPrompt(agent.handoff_prompt_md);
    }, [agent.handoff_prompt_md]);

    useEffect(() => {
        if (!rulesQuery.data || hydratedRules) return;
        setOnPass(findRule(rulesQuery.data, 'on-pass') ?? DEFAULT_ON_PASS);
        setOnFail(findRule(rulesQuery.data, 'on-fail') ?? DEFAULT_ON_FAIL);
        setHydratedRules(true);
    }, [rulesQuery.data, hydratedRules]);

    useEffect(() => {
        if (!checklistsQuery.data || hydratedChecks) return;
        setChecks(
            checklistsQuery.data.map((c: IAgentChecklistItem) => ({
                key: String(c.id),
                label: c.label,
                required: c.required,
            }))
        );
        setHydratedChecks(true);
    }, [checklistsQuery.data, hydratedChecks]);

    const targetAgents = agents;

    function addCheck() {
        setChecks((xs) => [
            ...xs,
            { key: `new-${Date.now()}-${xs.length}`, label: 'New check', required: true },
        ]);
    }
    function updateCheck(idx: number, patch: Partial<ChecklistDraft>) {
        setChecks((xs) => xs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    }
    function removeCheck(idx: number) {
        setChecks((xs) => xs.filter((_, i) => i !== idx));
    }
    function confirmRemovePendingCheck() {
        // Defensive guard: ConfirmRemoveCheckDialog only renders open (and thus
        // its onConfirm is only reachable) when pendingDeleteCheck !== null,
        // which itself requires pendingDeleteIdx !== null — so this early return
        // can't be hit through the wired-up UI.
        /* v8 ignore next */
        if (pendingDeleteIdx === null) return;
        removeCheck(pendingDeleteIdx);
        setPendingDeleteIdx(null);
    }

    const [saving, setSaving] = useState(false);
    const onPassMissing = !onPass.targetId;
    const onFailMissing = !onFail.targetId;
    const canSave = !onPassMissing && !onFailMissing && !saving;

    async function handleSave() {
        // Defensive guard: the "Save handoffs" button is `disabled={!canSave}`,
        // and canSave already requires !onPassMissing && !onFailMissing, so a
        // real click can never reach handleSave while either route is missing.
        /* v8 ignore next 3 */
        if (onPassMissing || onFailMissing) {
            toast.show({ message: 'Pick an Assign-to for both routes before saving' });
            return;
        }
        setSaving(true);
        try {
            // 1) persist the handoff prompt onto the agent row
            await updateAgent.mutateAsync({
                id: agent.id,
                data: { handoff_prompt_md: prompt },
            });

            // 2) replace handoff rules with one on-pass + one on-fail row
            await api.agents.setHandoffRules(agent.id, [
                { target_agent_id: onPass.targetId, kind: 'on-pass', status: onPass.status },
                { target_agent_id: onFail.targetId, kind: 'on-fail', status: onFail.status },
            ]);

            // 3) replace the checklist
            await api.agents.setChecklists(
                agent.id,
                checks
                    .filter((c) => c.label.trim().length > 0)
                    .map((c, idx) => ({
                        label: c.label.trim(),
                        sort_order: idx,
                        required: c.required,
                    }))
            );

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['agents', agent.id, 'handoff-rules'] }),
                queryClient.invalidateQueries({ queryKey: ['agents', agent.id, 'checklists'] }),
            ]);
            toast.show({ message: 'Handoffs saved' });
        } catch (e) {
            toast.show({
                message: 'Save failed',
                // Every awaited call above (updateAgent.mutateAsync, api.agents.*,
                // queryClient.invalidateQueries) only ever rejects with a real
                // Error (AtlasApiError extends Error, fetch failures throw
                // TypeError) — the String(e) fallback can't be exercised without
                // a non-Error throw, which nothing in this try block produces.
                /* v8 ignore next */
                detail: e instanceof Error ? e.message : String(e),
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Box>
            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    p: 3,
                    mb: 3,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 1.5,
                    }}
                >
                    Handoff prompt
                </Typography>
                <Box
                    sx={{
                        display: 'flex',
                        gap: 1.5,
                        alignItems: 'flex-start',
                        p: 2,
                        mb: 2,
                        bgcolor: ATLAS_PALETTE.accentSoft,
                        border: `1px solid ${ATLAS_PALETTE.slate12}`,
                        borderRadius: '8px',
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{
                            fontSize: 18,
                            color: ATLAS_PALETTE.slate,
                            flexShrink: 0,
                            mt: '1px',
                        }}
                    >
                        info
                    </Box>
                    <Typography
                        sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate70, lineHeight: 1.55 }}
                    >
                        Tasks and handoff rules are merged into the agent&apos;s prompt at runtime.
                        Define each in its own card below to keep the UI focused.
                    </Typography>
                </Box>
                <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    placeholder="Before handing off, run each item in the checklist below. Append the result to the Story comments as <status>."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    sx={{
                        '& .MuiInputBase-input': {
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            fontSize: 12.5,
                            lineHeight: 1.6,
                        },
                    }}
                />
            </Box>

            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    p: 3,
                    mb: 3,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 0.75,
                    }}
                >
                    Pre-handoff checklist
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                    Agent considers each before handing off. Order doesn&apos;t matter.
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
                        No checks yet. Add one to enforce a pre-handoff gate.
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
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{
                                    fontSize: 16,
                                    color: ATLAS_PALETTE.slate40,
                                    flexShrink: 0,
                                }}
                            >
                                drag_indicator
                            </Box>
                            <TextField
                                fullWidth
                                variant="standard"
                                value={c.label}
                                onChange={(e) => updateCheck(idx, { label: e.target.value })}
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
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 16 }}
                                >
                                    delete
                                </Box>
                            </IconButton>
                        </Box>
                    ))
                )}
                <Box
                    onClick={addCheck}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        mt: 2,
                        color: ATLAS_PALETTE.brandBlue,
                        cursor: 'pointer',
                        fontSize: 12.5,
                        fontWeight: 500,
                        '&:hover .icon-link-text': { textDecoration: 'underline' },
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 16 }}
                    >
                        add
                    </Box>
                    <Box component="span" className="icon-link-text">
                        Add check
                    </Box>
                </Box>
            </Box>

            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    p: 3,
                    mb: 3,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 0.75,
                    }}
                >
                    Handoffs
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 2.5 }}>
                    Two possible routes. The agent takes one based on whether every checklist item
                    passes.
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
                    <RouteCard
                        color={ATLAS_PALETTE.green}
                        icon="check_circle"
                        title="All checks passed"
                        route={onPass}
                        options={targetAgents}
                        onChange={setOnPass}
                        ownerOption={false}
                        error={onPassMissing}
                    />
                    <RouteCard
                        color={ATLAS_PALETTE.warning}
                        icon="error"
                        title="Any check failed"
                        route={onFail}
                        options={targetAgents}
                        onChange={setOnFail}
                        ownerOption
                        error={onFailMissing}
                    />
                </Box>
                <Typography
                    sx={{
                        fontSize: 11.5,
                        color: ATLAS_PALETTE.slate40,
                        mt: 2,
                        fontStyle: 'italic',
                    }}
                >
                    Only two routes allowed. To branch further, split the agent.
                </Typography>
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 2,
                    flexWrap: 'wrap',
                }}
            >
                {(onPassMissing || onFailMissing) && (
                    <Typography
                        sx={{
                            fontSize: 12,
                            color: ATLAS_PALETTE.error,
                            fontWeight: 500,
                        }}
                    >
                        Pick an Assign-to for both routes to save.
                    </Typography>
                )}
                <Button
                    variant="contained"
                    onClick={() => {
                        void handleSave();
                    }}
                    disabled={!canSave}
                    sx={{
                        textTransform: 'none',
                        bgcolor: ATLAS_PALETTE.green,
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                    }}
                >
                    {saving ? 'Saving…' : 'Save handoffs'}
                </Button>
            </Box>

            <ConfirmRemoveCheckDialog
                check={pendingDeleteCheck}
                onCancel={() => setPendingDeleteIdx(null)}
                onConfirm={confirmRemovePendingCheck}
            />
        </Box>
    );
}

function ConfirmRemoveCheckDialog({
    check,
    onCancel,
    onConfirm,
}: {
    check: ChecklistDraft | null;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const label = check?.label.trim() || 'this checklist item';

    return (
        <Dialog
            open={check !== null}
            onClose={onCancel}
            maxWidth="xs"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: '12px',
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            <Box sx={{ p: 5 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, mb: 4 }}>
                    <Box
                        sx={{
                            width: 32,
                            height: 32,
                            borderRadius: '8px',
                            bgcolor: 'rgba(220,38,38,0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <DeleteOutlineRounded
                            sx={{ color: ATLAS_PALETTE.error, fontSize: 20 }}
                        />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <FormHeading>Delete this checklist item?</FormHeading>
                        <Typography
                            sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}
                        >
                            <strong>{label}</strong> will be removed from the pre-handoff
                            checklist. The change is local until you click <strong>Save
                            handoffs</strong>.
                        </Typography>
                    </Box>
                    <IconButton size="small" onClick={onCancel} aria-label="Close">
                        <CloseRounded fontSize="small" />
                    </IconButton>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                    <Button onClick={onCancel} sx={{ textTransform: 'none' }}>
                        Cancel
                    </Button>
                    <Button
                        onClick={onConfirm}
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
    );
}

interface RouteCardProps {
    color: string;
    icon: string;
    title: string;
    route: RouteDraft;
    options: IAgent[];
    ownerOption: boolean;
    onChange: (next: RouteDraft) => void;
    error?: boolean;
}

function RouteCard({
    color,
    icon,
    title,
    route,
    options,
    ownerOption,
    onChange,
    error = false,
}: RouteCardProps) {
    return (
        <Box
            sx={{
                background: `${color}0D`,
                border: `1px solid ${color}40`,
                borderRadius: '10px',
                p: 2.5,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 18, color }}
                >
                    {icon}
                </Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                    {title}
                </Typography>
            </Box>
            <Box sx={{ mb: 1.5 }}>
                <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60, mb: 0.5 }}>
                    Assign to
                </Typography>
                <Select
                    size="small"
                    fullWidth
                    value={route.targetId}
                    onChange={(e) =>
                        onChange({ targetId: e.target.value as string, status: route.status })
                    }
                    displayEmpty
                    error={error}
                    renderValue={(value) => {
                        if (!value) {
                            return (
                                <Box
                                    component="span"
                                    sx={{ color: ATLAS_PALETTE.slate40 }}
                                >
                                    Pick an agent…
                                </Box>
                            );
                        }
                        if (value === 'owner') return 'Owner (sspart)';
                        const match = options.find((o) => o.id === value);
                        return match ? match.name : value;
                    }}
                    sx={{
                        background: ATLAS_PALETTE.white,
                        '& .MuiOutlinedInput-input': { fontSize: 13, py: 1 },
                    }}
                >
                    {ownerOption ? <MenuItem value="owner">Owner (sspart)</MenuItem> : null}
                    {options.map((w) => (
                        <MenuItem key={w.id} value={w.id}>
                            {w.name}
                        </MenuItem>
                    ))}
                </Select>
                {error && (
                    <Typography
                        sx={{
                            fontSize: 11,
                            color: ATLAS_PALETTE.error,
                            mt: 0.5,
                        }}
                    >
                        Required.
                    </Typography>
                )}
            </Box>
            <Box>
                <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60, mb: 0.5 }}>
                    Set status to
                </Typography>
                <Select
                    size="small"
                    fullWidth
                    value={route.status}
                    onChange={(e) =>
                        onChange({
                            targetId: route.targetId,
                            status: e.target.value as IssueStatus,
                        })
                    }
                    sx={{
                        background: ATLAS_PALETTE.white,
                        '& .MuiOutlinedInput-input': { fontSize: 13, py: 1 },
                    }}
                >
                    {STATUS_OPTIONS.map((s) => (
                        <MenuItem key={s} value={s} sx={{ fontSize: 13 }}>
                            {STATUS_LABELS[s]}
                        </MenuItem>
                    ))}
                </Select>
            </Box>
        </Box>
    );
}
