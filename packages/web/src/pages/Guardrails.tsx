import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { GUARDRAIL_CATEGORIES, type GuardrailCategory, type IGuardrailRule } from '@atlas/shared';
import {
    useGuardrails,
    useGuardrailScripts,
    useCreateGuardrail,
    useUpdateGuardrail,
    useDeleteGuardrail,
    useSaveGuardrails,
} from '../hooks/useGuardrails.js';
import { useToast } from '../hooks/useToast.js';
import { useNow } from '../hooks/useNow.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { GuardrailCategoryCard } from './guardrails/GuardrailCategoryCard.js';
import { GuardrailRightRail } from './guardrails/GuardrailRightRail.js';
import { GuardrailModal } from './guardrails/GuardrailModal.js';
import { GuardrailScriptsTab } from './guardrails/GuardrailScriptsTab.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { MOBILE_SHELL } from '../theme/tokens.js';

import { relativeTime } from '../utils/time.js';

const MONO = '"JetBrains Mono", monospace';

export function Guardrails() {
    useSetPageTitle('Guard-rails');
    const { data, isLoading } = useGuardrails();
    const { data: scripts = [] } = useGuardrailScripts();
    const createRule = useCreateGuardrail();
    const updateRule = useUpdateGuardrail();
    const deleteRule = useDeleteGuardrail();
    const saveAll = useSaveGuardrails();
    const toast = useToast();

    const [modalOpen, setModalOpen] = useState(false);
    const [modalCategory, setModalCategory] = useState<GuardrailCategory>('file_system');
    const [editing, setEditing] = useState<IGuardrailRule | null>(null);
    const [dirtyCount, setDirtyCount] = useState(0);
    const [tab, setTab] = useState<'rules' | 'scripts'>('rules');
    // Tick once a minute so "Saved 14 min ago by Owner" climbs forward.
    useNow();

    const rulesByCategory = useMemo(() => {
        const map = new Map<GuardrailCategory, IGuardrailRule[]>();
        for (const cat of GUARDRAIL_CATEGORIES) map.set(cat, []);
        for (const r of data?.rules ?? []) map.get(r.category)?.push(r);
        return map;
    }, [data?.rules]);

    function openAdd(category: GuardrailCategory) {
        setEditing(null);
        setModalCategory(category);
        setModalOpen(true);
    }

    function openEdit(rule: IGuardrailRule) {
        setEditing(rule);
        setModalCategory(rule.category);
        setModalOpen(true);
    }

    async function handleSubmit(input: {
        category: GuardrailCategory;
        rule_text: string;
        detail: string | null;
        severity: 'block' | 'ask_owner' | 'warn';
    }) {
        if (editing) {
            await updateRule.mutateAsync({ id: editing.id, patch: input });
            toast.show({ message: 'Rule updated' });
        } else {
            await createRule.mutateAsync(input);
            toast.show({ message: 'Rule added' });
        }
        setDirtyCount((n) => n + 1);
    }

    async function handleDelete(rule: IGuardrailRule) {
        await deleteRule.mutateAsync(rule.id);
        setDirtyCount((n) => n + 1);
        toast.show({ message: 'Rule deleted' });
    }

    async function handleSaveAll() {
        await saveAll.mutateAsync();
        setDirtyCount(0);
        toast.show({ message: 'Guard-rails saved' });
    }

    function handleDiscard() {
        setDirtyCount(0);
        toast.show({
            message: 'Dirty marker cleared',
            detail: 'Saved edits remain — Discard only clears the session counter.',
        });
    }

    if (isLoading || !data) {
        return (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={32} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }

    const totalRules = data.rules.length;
    const publishedAt = data.published_at;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4, pb: 24, position: 'relative' }}>
            {/* Header */}
            <Box sx={{ mb: 5 }}>
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
                    Guard-rails
                </Typography>
                <Typography
                    sx={{
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate60,
                        mt: 1.5,
                        lineHeight: 1.6,
                        maxWidth: 720,
                    }}
                >
                    These rules are merged into every agent's prompt on its next run. Atlas treats
                    them as the agent contract — failing a{' '}
                    <Box component="span" sx={{ fontWeight: 600 }}>
                        BLOCK
                    </Box>{' '}
                    rule stops the run; an{' '}
                    <Box component="span" sx={{ fontWeight: 600 }}>
                        ASK OWNER
                    </Box>{' '}
                    rule routes it to you.
                </Typography>
                <Typography
                    sx={{ fontFamily: MONO, fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 2 }}
                >
                    {GUARDRAIL_CATEGORIES.length} categories · {totalRules} rules
                    {dirtyCount > 0 && ` · ${dirtyCount} dirty`}
                </Typography>
            </Box>

            <Tabs
                value={tab}
                onChange={(_, v: 'rules' | 'scripts') => setTab(v)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                    mb: 4,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                    '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 },
                }}
            >
                <Tab value="rules" label={`Rules  ${totalRules}`} />
                <Tab value="scripts" label={`Scripts  ${scripts.length}`} />
            </Tabs>

            {tab === 'rules' && (
                <>
                    {/* Body: main + right rail (stacks on mobile) */}
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 280px' },
                            gap: { xs: 4, md: 5 },
                            alignItems: 'flex-start',
                        }}
                    >
                        <Box>
                            {GUARDRAIL_CATEGORIES.map((cat) => (
                                <GuardrailCategoryCard
                                    key={cat}
                                    category={cat}
                                    rules={rulesByCategory.get(cat) ?? []}
                                    onAdd={() => openAdd(cat)}
                                    onEdit={openEdit}
                                />
                            ))}
                        </Box>
                        <Box sx={{ position: 'sticky', top: 24 }}>
                            <GuardrailRightRail />
                        </Box>
                    </Box>

                    {/* Sticky bottom action bar */}
                    <Box
                        sx={{
                            position: 'fixed',
                            // Sidenav is hidden below md (drawer); inline 240px above md.
                            left: { xs: 0, md: 240 },
                            right: 0,
                            bottom: {
                                xs: `calc(${MOBILE_SHELL.bottomNavHeight}px + env(safe-area-inset-bottom))`,
                                md: 0,
                            },
                            bgcolor: ATLAS_PALETTE.white,
                            borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                            px: { xs: 3, md: 8 },
                            py: 3,
                            display: 'flex',
                            flexDirection: { xs: 'column', md: 'row' },
                            alignItems: { xs: 'stretch', md: 'center' },
                            justifyContent: 'space-between',
                            gap: { xs: 2, md: 4 },
                            zIndex: 10,
                        }}
                    >
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            {dirtyCount > 0
                                ? `${dirtyCount} rule${dirtyCount === 1 ? '' : 's'} changed this session`
                                : 'No unsaved changes'}
                            {publishedAt && ` · Saved ${relativeTime(publishedAt)} by Owner`}
                        </Typography>
                        <Box
                            sx={{
                                display: 'flex',
                                gap: 2,
                                justifyContent: { xs: 'flex-end', md: 'flex-start' },
                            }}
                        >
                            <Button
                                variant="outlined"
                                onClick={handleDiscard}
                                disabled={dirtyCount === 0 || saveAll.isPending}
                                sx={{ textTransform: 'none' }}
                            >
                                Discard
                            </Button>
                            <Button
                                variant="contained"
                                color="success"
                                onClick={() => void handleSaveAll()}
                                disabled={saveAll.isPending}
                                startIcon={
                                    saveAll.isPending ? (
                                        <CircularProgress size={14} color="inherit" />
                                    ) : undefined
                                }
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                {saveAll.isPending ? 'Saving…' : 'Save Guard-rails'}
                            </Button>
                        </Box>
                    </Box>
                </>
            )}

            {tab === 'scripts' && <GuardrailScriptsTab />}

            <GuardrailModal
                open={modalOpen}
                initialCategory={modalCategory}
                editing={editing}
                onClose={() => setModalOpen(false)}
                onSubmit={handleSubmit}
                onDelete={(r) => void handleDelete(r)}
            />
        </Box>
    );
}
