import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

// Batch-9 audit (enterprise-secrets read model). Small helper that pairs
// with the on-demand reveal endpoints:
//
//   1. Owner clicks Reveal → parent calls the reveal API (returns plaintext)
//   2. Parent stashes the plaintext in transient state (never in cache)
//      and passes it in via `revealedValue`
//   3. This component displays it for RE-MASK-AFTER-SECONDS, then flips
//      itself back to masked and calls onExpire() so the parent can
//      clear its transient state
//
// The countdown, copy affordance, and mask-again gesture live here so
// every consumer (SharedSecretsTab, ProjectEnvSecretsModal,
// NotificationsTab) gets the same UX by default.

export interface SecretRevealButtonProps {
    /** true when a value is stored (so a Reveal button makes sense). */
    hasValue: boolean;
    /** Called when Owner clicks Reveal. Parent fetches the plaintext
     *  from the reveal endpoint and passes the resolved value back via
     *  `revealedValue`. */
    onReveal: () => void;
    /** In-flight signal from the parent's mutation. Used to disable the
     *  button while the fetch is running. */
    isRevealing?: boolean;
    /** When set, this component enters the "revealed" state and starts
     *  the countdown. Parent clears this via `onExpire` after the
     *  countdown completes (or on unmount). */
    revealedValue?: string | null;
    /** Fires when the countdown expires. Parent should clear its
     *  transient `revealedValue` state so the display re-masks. */
    onExpire?: () => void;
    /** Countdown length in seconds. Default 30. */
    autoMaskSeconds?: number;
}

const DEFAULT_MASK_SECONDS = 30;

export function SecretRevealButton({
    hasValue,
    onReveal,
    isRevealing = false,
    revealedValue,
    onExpire,
    autoMaskSeconds = DEFAULT_MASK_SECONDS,
}: SecretRevealButtonProps) {
    const [secondsLeft, setSecondsLeft] = useState(autoMaskSeconds);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // 2026-07-03 audit finding: consumers pass `onExpire` as an inline
    // closure (`onExpire={() => setRevealedValue(null)}`), so its identity
    // churns on every parent re-render. Listing it in the effect's dep
    // array made the effect re-run each tick, clobbering the interval and
    // resetting secondsLeft — the countdown never reached 0 on pages that
    // re-render at least once per second, so the plaintext stayed visible
    // past the auto-mask window. Route the callback through a ref instead
    // so the effect can read the latest closure without re-subscribing.
    const onExpireRef = useRef<(() => void) | undefined>(onExpire);
    useEffect(() => {
        onExpireRef.current = onExpire;
    }, [onExpire]);

    // Start the countdown when a value arrives; reset when it clears.
    useEffect(() => {
        if (revealedValue === undefined || revealedValue === null) {
            setSecondsLeft(autoMaskSeconds);
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            return;
        }
        setSecondsLeft(autoMaskSeconds);
        timerRef.current = setInterval(() => {
            setSecondsLeft((prev) => {
                if (prev <= 1) {
                    // Tick that flips to 0 also triggers the expire
                    // callback exactly once — clearing the timer prevents
                    // re-fire even if the parent doesn't clear state
                    // immediately.
                    if (timerRef.current) {
                        clearInterval(timerRef.current);
                        timerRef.current = null;
                    }
                    onExpireRef.current?.();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [revealedValue, autoMaskSeconds]);

    async function copyToClipboard(): Promise<void> {
        if (revealedValue === undefined || revealedValue === null) return;
        try {
            await navigator.clipboard.writeText(revealedValue);
        } catch {
            /* best-effort — clipboard perm may be denied */
        }
    }

    if (!hasValue) {
        // Nothing stored; the parent renders its own "Set new value" input.
        return null;
    }

    if (revealedValue !== undefined && revealedValue !== null) {
        // Visible state: value + countdown + copy + mask-now button.
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                    component="code"
                    sx={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 12,
                        background: 'rgba(0,0,0,0.05)',
                        borderRadius: 0.75,
                        px: 1,
                        py: 0.5,
                        userSelect: 'all',
                        overflowX: 'auto',
                        maxWidth: 320,
                        whiteSpace: 'nowrap',
                    }}
                >
                    {revealedValue}
                </Box>
                <Tooltip title="Copy to clipboard">
                    <IconButton size="small" onClick={copyToClipboard} aria-label="Copy revealed secret">
                        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                            content_copy
                        </span>
                    </IconButton>
                </Tooltip>
                <Tooltip title="Re-mask now">
                    <IconButton
                        size="small"
                        onClick={() => onExpireRef.current?.()}
                        aria-label="Re-mask secret"
                    >
                        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                            visibility_off
                        </span>
                    </IconButton>
                </Tooltip>
                <Typography variant="caption" color="text.secondary">
                    Auto-masks in {secondsLeft}s
                </Typography>
            </Box>
        );
    }

    // Masked state: dots + Reveal button.
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
                component="span"
                sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 12,
                    color: 'text.secondary',
                    letterSpacing: 1,
                }}
            >
                ••••••••••••
            </Typography>
            <Button
                size="small"
                variant="outlined"
                onClick={onReveal}
                disabled={isRevealing}
                aria-label="Reveal secret"
            >
                {isRevealing ? 'Revealing…' : 'Reveal'}
            </Button>
        </Box>
    );
}
