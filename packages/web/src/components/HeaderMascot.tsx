import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import type { LottieComponentProps, LottieRefCurrentProps } from 'lottie-react';
import { useActiveRuns } from '../hooks/useActiveRuns.js';
import { useThemeModeContext } from '../hooks/useThemeModeContext.js';
import { ATLAS_PALETTE, MOTION } from '../theme/tokens.js';
import type { ThemeMode } from '../hooks/useThemeMode.js';

// 2026-06-12 — lottie-web is ~116 KB gzipped; the mascot is decorative.
// Defer the import so the shell paints immediately with the fallback
// dot and lottie-{react,web} ship in their own chunk loaded after first
// paint. The mascot then crossfades in once Lottie resolves.
type LottieDefault = ComponentType<LottieComponentProps>;
let lottiePromise: Promise<LottieDefault> | null = null;
function loadLottie(): Promise<LottieDefault> {
    // Vite's CJS interop for `lottie-react` wraps the CJS default under a
    // second `default` when the dep isn't pre-bundled via optimizeDeps:
    //   { default: { default: Lottie, useLottie, useLottieInteractivity } }
    // Older versions of Vite / Node exposed the fn at `m.default` directly,
    // so we unwrap defensively. Without this, React sees an object instead
    // of a component and throws "Element type is invalid ... got: object"
    // at HeaderMascot render. Regressed with the 2026-06-30 deps upgrade
    // (b9faa1d) that shifted React 18 → 19 optimizeDeps handling.
    lottiePromise ??= import('lottie-react').then((m) => {
        const inner = (m as unknown as { default: unknown }).default;
        if (typeof inner === 'function') return inner as LottieDefault;
        /* v8 ignore start -- the global `vi.mock('lottie-react', ...)` in test-setup.ts
         * always exposes `default` as a function directly (single-wrap shape), so this
         * double-wrapped-CJS fallback path is unreachable under the test mock. */
        const dbl = (inner as { default?: unknown }).default;
        return (typeof dbl === 'function' ? dbl : inner) as LottieDefault;
        /* v8 ignore stop */
    });
    return lottiePromise;
}

type MascotData = unknown;

// Public asset paths. Lottie JSON is small (~3 KB each) and cached by the
// browser after the first load; we fetch lazily so the topbar paints before
// the mascot is ready, and falls back to a static dot if either asset fails.
// Three variants per state — one pair picked at random per session so the
// mascot doesn't loop identically across refreshes.
// `?v=` is a content version bumped whenever the Lottie JSON colours change.
// `cache: 'force-cache'` below means a browser that already loaded the bot
// keeps the old palette forever — adding the version query is the only way
// to give clients a fresh copy without breaking the long-cache strategy.
const IDLE_URLS = [
    '/lottie/mascot-idle.json?v=2',
    '/lottie/mascot-idle-2.json?v=2',
    '/lottie/mascot-idle-3.json?v=2',
];
const WORKING_URLS = [
    '/lottie/mascot-working.json?v=2',
    '/lottie/mascot-working-2.json?v=2',
    '/lottie/mascot-working-3.json?v=2',
];

function pickRandom<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)] as T;
}

async function loadMascot(url: string): Promise<MascotData | null> {
    try {
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) return null;
        return (await res.json()) as MascotData;
    } catch {
        return null;
    }
}

// --- Theme-reactive recolour --------------------------------------------
// The mascot art ships amber (its warm "identity" colour, ~H43). The Owner
// wants it brand-blue in light mode and orange in dark mode. Rather than
// duplicate six JSON assets per theme, we rotate the warm colour family to
// a target hue at paint time, preserving each shade's saturation, lightness
// and alpha so the bot keeps its shading. The structural navy outline
// (H219) and grey (S0), and the "working" green accent (H~130), fall
// outside the warm band and are left untouched.
const WARM_HUE_MIN = 20;
const WARM_HUE_MAX = 60;
const WARM_SAT_MIN = 0.3;
const LIGHT_HUE = 212; // brand blue — light theme
const DARK_HUE = 26; // orange — dark theme

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h / 6, s, l };
}

function hue2rgb(p: number, q: number, t: number): number {
    let tt = t;
    if (tt < 0) tt += 1;
    /* v8 ignore next -- only ever called with h=mascotHue()/360 (LIGHT_HUE=212 or DARK_HUE=26,
     * both < 240) offset by ±1/3, so tt can reach at most ~0.997 and this normalization branch
     * (tt > 1) is unreachable with the two fixed hues actually in use. */
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    // recolorWarm only calls hslToRgb when `s > WARM_SAT_MIN` (0.3), so `s`
    // is never 0 at this call site — this guard is unreachable in practice.
    /* v8 ignore next */
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

// Walk a Lottie document and rotate every warm solid colour to `targetHue`.
// Lottie stores colours under a `c.k` array of normalised 0..1 [r,g,b(,a)].
// All six mascot assets use static colours only (no gradients / keyframed
// colour), verified against the source JSON.
function recolorWarm(data: MascotData, targetHue: number): MascotData {
    // JSON round-trip: a cheap deep clone for a ~14 KB pure-JSON document,
    // so we never mutate the cached fetch result shared across renders.
    const clone = JSON.parse(JSON.stringify(data)) as unknown;
    const hueFrac = targetHue / 360;
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        const c = obj['c'] as { k?: unknown } | undefined;
        if (c && typeof c === 'object' && Array.isArray(c.k)) {
            const k = c.k as number[];
            if (k.length >= 3 && k.slice(0, 3).every((x) => typeof x === 'number')) {
                const { h, s, l } = rgbToHsl(k[0]!, k[1]!, k[2]!);
                const hueDeg = h * 360;
                if (s > WARM_SAT_MIN && hueDeg >= WARM_HUE_MIN && hueDeg <= WARM_HUE_MAX) {
                    const [nr, ng, nb] = hslToRgb(hueFrac, s, l);
                    k[0] = nr;
                    k[1] = ng;
                    k[2] = nb; // k[3] alpha (if present) is preserved
                }
            }
        }
        for (const key of Object.keys(obj)) visit(obj[key]);
    };
    visit(clone);
    return clone as MascotData;
}

function mascotHue(mode: ThemeMode): number {
    return mode === 'dark' ? DARK_HUE : LIGHT_HUE;
}

interface HeaderMascotProps {
    size?: number;
}

// Idle vs working bot in the header. Driven by the live agent-run state via
// useActiveRuns(), which is auto-invalidated by SSE so the flip happens
// within a round-trip of an agent picking up work. Honors
// prefers-reduced-motion by pausing the Lottie player rather than swapping
// to a static frame, so the user still sees the "active" tint change.
export function HeaderMascot({ size = 40 }: HeaderMascotProps) {
    const { hasActiveRuns, count } = useActiveRuns();
    const { mode } = useThemeModeContext();
    const [idleData, setIdleData] = useState<MascotData | null>(null);
    const [workingData, setWorkingData] = useState<MascotData | null>(null);
    const [LottieComponent, setLottieComponent] = useState<LottieDefault | null>(null);
    const lottieRef = useRef<LottieRefCurrentProps | null>(null);

    useEffect(() => {
        let cancelled = false;
        void loadLottie().then((c) => {
            if (!cancelled) setLottieComponent(() => c);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Pick a stable variant pair for the lifetime of this mount. Re-picking
    // when hasActiveRuns flips would feel jittery — we want one bot per
    // session that the user gets to know.
    const variantUrls = useMemo(
        () => ({ idle: pickRandom(IDLE_URLS), working: pickRandom(WORKING_URLS) }),
        [],
    );

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [idle, working] = await Promise.all([
                loadMascot(variantUrls.idle),
                loadMascot(variantUrls.working),
            ]);
            if (cancelled) return;
            setIdleData(idle);
            setWorkingData(working);
        })();
        return () => {
            cancelled = true;
        };
    }, [variantUrls]);

    const prefersReducedMotion = useMemo(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }, []);

    const rawAnimationData = hasActiveRuns ? workingData : idleData;
    // Rotate the bot's warm identity colour to the per-theme hue. Re-runs
    // only when the asset or the theme changes — a theme flip restarts the
    // Lottie loop (rare enough to be invisible).
    const animationData = useMemo(
        () => (rawAnimationData ? recolorWarm(rawAnimationData, mascotHue(mode)) : null),
        [rawAnimationData, mode],
    );
    const tooltipLabel = hasActiveRuns
        ? `${count} agent${count === 1 ? '' : 's'} working`
        : 'Idle — no agents running';

    // Tint background ring so the state difference reads even before the
    // animation loads or if assets fail. Active ring is green `success` in
    // light mode and warm amber `warning` in dark — both stay brand-distinct
    // and visible against their canvas (the previous brand-blue collapsed to
    // monochrome in Mercury and disappeared in dark). Muted slate for idle.
    const activeRingColor = mode === 'light' ? ATLAS_PALETTE.success : ATLAS_PALETTE.warning;
    const ringColor = hasActiveRuns ? activeRingColor : ATLAS_PALETTE.slate30;
    const ringGlow = hasActiveRuns
        ? `0 0 0 2px color-mix(in srgb, ${activeRingColor} 22%, transparent), 0 0 12px color-mix(in srgb, ${activeRingColor} 42%, transparent)`
        : 'none';

    return (
        <Tooltip title={tooltipLabel} placement="bottom" arrow>
            <Box
                aria-label={tooltipLabel}
                role="img"
                sx={{
                    position: 'relative',
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: `1.5px solid ${ringColor}`,
                    boxShadow: ringGlow,
                    background: ATLAS_PALETTE.white,
                    transition: `border-color ${MOTION.hover}ms ease, box-shadow ${MOTION.hover}ms ease`,
                }}
            >
                {animationData && LottieComponent ? (
                    <LottieComponent
                        lottieRef={lottieRef}
                        animationData={animationData}
                        loop
                        autoplay={!prefersReducedMotion}
                        rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                        style={{ width: size - 4, height: size - 4 }}
                    />
                ) : (
                    <Box
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: ringColor,
                        }}
                    />
                )}
            </Box>
        </Tooltip>
    );
}
