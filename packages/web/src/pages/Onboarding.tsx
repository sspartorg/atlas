import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ISettings } from '@atlas/shared';
import { BRAND_SECONDARY_ACCENTS } from '@atlas/shared';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowForward from '@mui/icons-material/ArrowForward';
import ArrowBack from '@mui/icons-material/ArrowBack';
import Check from '@mui/icons-material/Check';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import { ATLAS_PALETTE, ELEVATION } from '../theme/tokens.js';
import { useSettings } from '../hooks/useSettings.js';
import { api } from '../api/api.js';
import { FolderPicker } from '../components/FolderPicker.js';
import { AtlasLogo } from '../components/AtlasLogo.js';
import { StepIndicator } from '../components/onboarding/StepIndicator.js';
import { SuccessView } from '../components/onboarding/SuccessView.js';
import { WizardSkeleton } from '../components/onboarding/WizardSkeleton.js';

const SUCCESS_DURATION_MS = 5000;

// Distinct owner-chip swatches. Sourced from the shared accent palette so
// onboarding matches the Settings accent picker — and never collapses to a
// single hue the way the raw theme hue-slots (cerulean/eggplant/…) do once
// they route through the brand accent.
const ACCENT_OPTIONS: readonly string[] = BRAND_SECONDARY_ACCENTS.map((s) => s.hex);

type SubmitState = 'editing' | 'submitting' | 'success';

const FOCUS_HALO_BLUE = '0 0 0 4px rgba(0,122,201,.25)';
const HOVER_HALO_BLUE = '0 0 0 4px rgba(0,122,201,.18)';
const ERROR_BG_ORANGE = 'rgba(199,83,47,.06)';
const BACK_BUTTON_HOVER_BG = 'rgba(0,122,201,.06)';

function Lockup() {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Box
                sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                }}
            >
                <AtlasLogo size={40} />
            </Box>
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, lineHeight: 1 }}>
                    <Typography
                        sx={{
                            fontSize: 20,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            letterSpacing: '-0.01em',
                            lineHeight: 1,
                        }}
                    >
                        Atlas
                    </Typography>
                </Box>
                <Typography
                    sx={{
                        fontSize: 13,
                        fontWeight: 400,
                        color: ATLAS_PALETTE.slate60,
                        lineHeight: 1.4,
                        mt: 1,
                    }}
                >
                    AI Agent Orchestration
                </Typography>
            </Box>
        </Box>
    );
}

function StaticFieldLabel({ children }: { children: React.ReactNode }) {
    return (
        <Typography
            component="label"
            sx={{
                fontSize: 14,
                fontWeight: 500,
                color: ATLAS_PALETTE.slate,
                display: 'block',
                mb: 2,
            }}
        >
            {children}{' '}
            <Box component="span" aria-hidden="true" sx={{ color: ATLAS_PALETTE.orange }}>
                *
            </Box>
        </Typography>
    );
}

const inputSx = (hasError: boolean) => ({
    '& .MuiOutlinedInput-root': {
        height: 44,
        borderRadius: '6px',
        bgcolor: hasError ? ERROR_BG_ORANGE : 'transparent',
        '& fieldset': {
            borderColor: hasError ? ATLAS_PALETTE.orange : ATLAS_PALETTE.slate08,
            borderWidth: '1px',
        },
        '&:hover fieldset': {
            borderColor: hasError ? ATLAS_PALETTE.orange : ATLAS_PALETTE.slate30,
        },
        '&.Mui-focused fieldset': {
            borderColor: hasError ? ATLAS_PALETTE.orange : ATLAS_PALETTE.brandBlue,
            borderWidth: '1px',
        },
        '&.Mui-focused': {
            boxShadow: hasError ? `0 0 0 4px ${ERROR_BG_ORANGE}` : FOCUS_HALO_BLUE,
        },
    },
    '& .MuiOutlinedInput-input': {
        fontSize: 16,
        color: ATLAS_PALETTE.slate,
        '&::placeholder': {
            color: ATLAS_PALETTE.slate30,
            opacity: 1,
        },
    },
});

const primaryBtnSx = { height: 44, textTransform: 'none' as const, fontWeight: 500 };
const secondaryBtnSx = {
    height: 44,
    textTransform: 'none' as const,
    fontWeight: 500,
    color: ATLAS_PALETTE.brandBlue,
    borderColor: ATLAS_PALETTE.brandBlue,
    '&:hover': {
        bgcolor: BACK_BUTTON_HOVER_BG,
        borderColor: ATLAS_PALETTE.brandBlue,
    },
};

const WORKSPACE_PLACEHOLDER = (() => {
    if (typeof navigator === 'undefined') return 'e.g. C:\\Users\\You\\Projects';
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac') || ua.includes('iphone') || ua.includes('ipad')) return 'e.g. /Users/you/Projects';
    if (ua.includes('linux') || ua.includes('android')) return 'e.g. /home/you/projects';
    return 'e.g. C:\\Users\\You\\Projects';
})();

export function Onboarding() {
    const navigate = useNavigate();
    const settings = useSettings();
    const queryClient = useQueryClient();
    const [step, setStep] = useState<1 | 2>(1);
    const [ownerName, setOwnerName] = useState('');
    const [accentColor, setAccentColor] = useState<string>(ACCENT_OPTIONS[0] ?? '#7C3AED');
    const [workspacePath, setWorkspacePath] = useState('');
    const [errors, setErrors] = useState<{ ownerName?: string; workspacePath?: string }>({});
    const [submitState, setSubmitState] = useState<SubmitState>('editing');
    const [submitError, setSubmitError] = useState<string | null>(null);
    const swatchRefs = useRef<Array<HTMLDivElement | null>>([]);
    const pendingSettings = useRef<ISettings | null>(null);

    useEffect(() => {
        if (submitState !== 'success') return;
        void Promise.all([
            queryClient.prefetchQuery({
                queryKey: ['dashboard'],
                queryFn: () => api.counts.dashboard(),
            }),
            queryClient.prefetchQuery({ queryKey: ['agents'], queryFn: () => api.agents.list() }),
            queryClient.prefetchQuery({
                queryKey: ['projects'],
                queryFn: () => api.projects.list(),
            }),
            queryClient.prefetchQuery({
                queryKey: ['sidenav-counts'],
                queryFn: () => api.counts.sidenav(),
            }),
            queryClient.prefetchQuery({
                queryKey: ['notifications', undefined],
                queryFn: () => api.notifications.list(),
            }),
        ]);
        const timer = setTimeout(() => {
            if (pendingSettings.current) {
                queryClient.setQueryData(['settings'], pendingSettings.current);
            }
            navigate('/');
        }, SUCCESS_DURATION_MS);
        return () => clearTimeout(timer);
    }, [submitState, navigate, queryClient]);

    function handleWorkspacePathChange(next: string) {
        setWorkspacePath(next);
        if (errors.workspacePath) {
            setErrors((prev) => {
                const copy = { ...prev };
                delete copy.workspacePath;
                return copy;
            });
        }
    }

    function validateStep1() {
        const e: { ownerName?: string; workspacePath?: string } = {};
        if (!ownerName.trim()) e.ownerName = 'Enter a display name to continue.';
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    function validateStep2() {
        const e: { ownerName?: string; workspacePath?: string } = {};
        if (!workspacePath.trim()) e.workspacePath = 'Pick a workspace folder to continue.';
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    function handleStep1Next() {
        if (validateStep1()) setStep(2);
    }

    async function handleFinish() {
        if (!validateStep2()) return;
        setSubmitError(null);
        setSubmitState('submitting');
        try {
            const newSettings = await api.settings.onboard({
                owner_name: ownerName.trim(),
                workspace_path: workspacePath.trim(),
            });
            pendingSettings.current = newSettings;
            setSubmitState('success');
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Could not finish onboarding.');
            setSubmitState('editing');
        }
    }

    function handleSwatchKey(e: KeyboardEvent<HTMLDivElement>) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const idx = ACCENT_OPTIONS.findIndex((c) => c === accentColor);
        const safeIdx = idx === -1 ? 0 : idx;
        const next =
            e.key === 'ArrowRight'
                ? (safeIdx + 1) % ACCENT_OPTIONS.length
                : (safeIdx - 1 + ACCENT_OPTIONS.length) % ACCENT_OPTIONS.length;
        const nextColor = ACCENT_OPTIONS[next];
        if (nextColor === undefined) return;
        setAccentColor(nextColor);
        swatchRefs.current[next]?.focus();
    }

    if (settings.isPending) {
        return <WizardSkeleton />;
    }

    return (
        <Box
            sx={{
                minHeight: '100vh',
                bgcolor: ATLAS_PALETTE.cloud,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
            }}
        >
            {/* Page header */}
            <Box
                sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '24px 48px',
                }}
            >
                <Lockup />
                <StepIndicator current={step} complete={submitState === 'success'} />
            </Box>

            {/* Centered card region */}
            <Box
                sx={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    px: 6,
                    pb: 6,
                }}
            >
                <Box
                    sx={{
                        width: 560,
                        bgcolor: 'background.paper',
                        borderRadius: '16px',
                        p: 12,
                        boxShadow: ELEVATION.overlay,
                    }}
                >
                    {submitState === 'success' ? (
                        <SuccessView />
                    ) : step === 1 ? (
                        <Box>
                            <Typography
                                sx={{
                                    fontSize: 28,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                    mb: 2,
                                    lineHeight: 1.2,
                                    letterSpacing: '-0.01em',
                                }}
                            >
                                Welcome to Atlas.
                            </Typography>
                            <Typography
                                sx={{
                                    fontSize: 16,
                                    color: ATLAS_PALETTE.slate70,
                                    mb: 8,
                                    lineHeight: 1.6,
                                }}
                            >
                                Two quick questions and you're in. Everything else is already
                                configured.
                            </Typography>

                            <Box
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                    maxWidth: 480,
                                    mx: 'auto',
                                }}
                            >
                                <TextField
                                    fullWidth
                                    required
                                    label="Display name"
                                    value={ownerName}
                                    onChange={(e) => setOwnerName(e.target.value)}
                                    placeholder="e.g. sspart"
                                    error={Boolean(errors.ownerName)}
                                    helperText={errors.ownerName}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleStep1Next();
                                    }}
                                    autoFocus
                                />

                                <Box>
                                    <Typography
                                        sx={{
                                            fontSize: 14,
                                            fontWeight: 500,
                                            color: ATLAS_PALETTE.slate,
                                            display: 'block',
                                            mb: 2,
                                        }}
                                    >
                                        Pick a color for your owner chip
                                    </Typography>
                                    <Box
                                        role="radiogroup"
                                        aria-label="Owner chip color"
                                        onKeyDown={handleSwatchKey}
                                        sx={{ display: 'flex', gap: 3 }}
                                    >
                                        {ACCENT_OPTIONS.map((color, i) => {
                                            const selected = accentColor === color;
                                            return (
                                                <Box
                                                    key={color}
                                                    ref={(el: HTMLDivElement | null) => {
                                                        swatchRefs.current[i] = el;
                                                    }}
                                                    role="radio"
                                                    aria-checked={selected}
                                                    tabIndex={selected ? 0 : -1}
                                                    onClick={() => setAccentColor(color)}
                                                    sx={{
                                                        width: 28,
                                                        height: 28,
                                                        borderRadius: '9999px',
                                                        bgcolor: color,
                                                        cursor: 'pointer',
                                                        outline: 'none',
                                                        transition: 'box-shadow 150ms ease',
                                                        boxShadow: selected
                                                            ? `inset 0 0 0 2px #FFFFFF, 0 0 0 2px ${color}`
                                                            : 'none',
                                                        '&:hover': selected
                                                            ? undefined
                                                            : { boxShadow: HOVER_HALO_BLUE },
                                                        '&:focus-visible': {
                                                            boxShadow: selected
                                                                ? `inset 0 0 0 2px #FFFFFF, 0 0 0 2px ${color}, 0 0 0 4px rgba(0,122,201,.25)`
                                                                : FOCUS_HALO_BLUE,
                                                        },
                                                    }}
                                                />
                                            );
                                        })}
                                    </Box>
                                    <Typography
                                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 4 }}
                                    >
                                        This shows on every comment, assignee chip, and KPI card you
                                        author.
                                    </Typography>
                                </Box>
                            </Box>

                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 10 }}>
                                <Button
                                    variant="contained"
                                    onClick={handleStep1Next}
                                    endIcon={<ArrowForward />}
                                    sx={primaryBtnSx}
                                >
                                    Next
                                </Button>
                            </Box>
                        </Box>
                    ) : (
                        <Box>
                            <Typography
                                sx={{
                                    fontSize: 28,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                    mb: 2,
                                    lineHeight: 1.2,
                                    letterSpacing: '-0.01em',
                                }}
                            >
                                Where should Atlas keep your projects?
                            </Typography>
                            <Typography
                                sx={{
                                    fontSize: 16,
                                    color: ATLAS_PALETTE.slate70,
                                    mb: 8,
                                    lineHeight: 1.6,
                                }}
                            >
                                Atlas will clone repos and create worktrees inside this folder.
                                Pick something with plenty of disk space.
                            </Typography>

                            <Box
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                    maxWidth: 480,
                                    mx: 'auto',
                                }}
                            >
                                <Box>
                                    <StaticFieldLabel>Workspace folder</StaticFieldLabel>
                                    <FolderPicker
                                        value={workspacePath}
                                        onChange={handleWorkspacePathChange}
                                        placeholder={WORKSPACE_PLACEHOLDER}
                                        error={Boolean(errors.workspacePath)}
                                        autoFocus
                                        onEnterCommit={() => void handleFinish()}
                                        textFieldSx={inputSx(Boolean(errors.workspacePath))}
                                    />
                                    {errors.workspacePath && (
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                gap: 1.5,
                                                alignItems: 'center',
                                                mt: 1,
                                                fontSize: 12,
                                                color: ATLAS_PALETTE.orange,
                                            }}
                                        >
                                            <ErrorOutline
                                                sx={{ fontSize: 16, color: ATLAS_PALETTE.orange }}
                                            />
                                            {errors.workspacePath}
                                        </Box>
                                    )}
                                    <Box
                                        sx={{
                                            mt: 4,
                                            bgcolor: ATLAS_PALETTE.cloud,
                                            border: '1px solid rgba(0,122,201,.12)',
                                            borderRadius: '8px',
                                            p: '12px 14px',
                                            display: 'flex',
                                            gap: 2.5,
                                            alignItems: 'flex-start',
                                            fontSize: 13,
                                            color: ATLAS_PALETTE.slate,
                                            lineHeight: 1.5,
                                        }}
                                    >
                                        <InfoOutlined
                                            sx={{
                                                color: ATLAS_PALETTE.brandBlue,
                                                fontSize: 18,
                                                mt: '1px',
                                            }}
                                        />
                                        We'll create this folder if it doesn't exist. You can change
                                        it later in Settings → Environment.
                                    </Box>
                                </Box>
                            </Box>

                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 10 }}>
                                <Button
                                    variant="outlined"
                                    onClick={() => setStep(1)}
                                    startIcon={<ArrowBack />}
                                    disabled={submitState === 'submitting'}
                                    sx={secondaryBtnSx}
                                >
                                    Back
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={() => void handleFinish()}
                                    disabled={submitState === 'submitting'}
                                    endIcon={
                                        submitState === 'submitting' ? (
                                            <CircularProgress size={14} color="inherit" />
                                        ) : (
                                            <Check />
                                        )
                                    }
                                    sx={primaryBtnSx}
                                >
                                    {submitState === 'submitting' ? 'Setting Up…' : 'Finish Setup'}
                                </Button>
                            </Box>

                            {submitError && submitState !== 'submitting' && (
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.orange,
                                        mt: 6,
                                        textAlign: 'center',
                                    }}
                                >
                                    {submitError}
                                </Typography>
                            )}
                        </Box>
                    )}
                </Box>
            </Box>
        </Box>
    );
}
