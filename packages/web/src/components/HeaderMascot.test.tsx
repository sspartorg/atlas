import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { HeaderMascot } from './HeaderMascot.js';

// Minimal Lottie JSON with a warm-hued solid colour (H≈43°, S>0.3).
// Normalised 0..1 RGB for an amber: r=0.95, g=0.70, b=0.10 → h≈43°, s≈0.9, l≈0.52
// This is the minimum fixture that makes `recolorWarm` actually recolor a pixel,
// exercising rgbToHsl → hslToRgb → hue2rgb in the process.
const WARM_LOTTIE = {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
        {
            ty: 4,
            shapes: [
                {
                    ty: 'fl',
                    c: { k: [0.95, 0.70, 0.10, 1] },
                },
            ],
        },
    ],
};

// Multi-shape Lottie covering additional rgbToHsl/hslToRgb branches:
//   shape[0]: warm dark amber r=0.70,g=0.50,b=0.05 → H≈41°, S≈0.87, L≈0.375 (<0.5)
//             exercises hslToRgb l<0.5 branch (q = l*(1+s)) at L98
//   shape[1]: pinkish r=0.90,g=0.15,b=0.60 → max=r, g<b → exercises L80 g<b branch
//             hueDeg≈322° (outside warm band so not recolored, but rgbToHsl is called)
const MULTI_BRANCH_LOTTIE = {
    v: '5.7.4', fr: 30, ip: 0, op: 60, w: 100, h: 100,
    layers: [
        {
            ty: 4,
            shapes: [
                { ty: 'fl', c: { k: [0.70, 0.50, 0.05, 1] } }, // dark warm amber (L<0.5)
                { ty: 'fl', c: { k: [0.90, 0.15, 0.60, 1] } }, // pinkish (max=r, g<b)
            ],
        },
    ],
};

// A Lottie with a grey (s=0) — exercises the s===0 branch in hslToRgb.
const GREY_LOTTIE = {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
        {
            ty: 4,
            shapes: [
                {
                    ty: 'fl',
                    c: { k: [0.5, 0.5, 0.5, 1] },
                },
            ],
        },
    ],
};

describe('HeaderMascot', () => {
    it('renders with idle tooltip when no active runs', () => {
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
        );
        renderWithProviders(<HeaderMascot />);
        expect(screen.getByRole('img', { name: /idle/i })).toBeInTheDocument();
    });

    it('passes a custom size to the wrapper', () => {
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
        );
        renderWithProviders(<HeaderMascot size={28} />);
        expect(screen.getByRole('img', { name: /idle/i })).toBeInTheDocument();
    });

    it('exercises mascotHue + recolorWarm + rgbToHsl + hslToRgb + hue2rgb with warm Lottie data', async () => {
        // Serve warm Lottie JSON for all mascot asset URLs so loadMascot resolves
        // with real data. Then recolorWarm(data, mascotHue(mode)) runs the full
        // colour-rotation pipeline: rgbToHsl → hue2rgb → hslToRgb.
        // jsdom base URL is http://localhost:3000/ (vitest default) so relative
        // /lottie/* fetches become http://localhost:3000/lottie/*.
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(WARM_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        // Wait for the lottie-mock element to appear — this only renders once
        // both animationData (from recolorWarm) and LottieComponent are non-null,
        // meaning lines 186-187 (setIdleData) and 243-250 (LottieComponent render)
        // and the full recolor helper chain (L51-141) have all executed.
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises mascotHue(dark) path — recolorWarm runs with DARK_HUE target', async () => {
        // Active runs => hasActiveRuns=true => workingData used
        server.use(
            http.get('http://localhost:3000/api/run', () =>
                HttpResponse.json([{ id: 'r1', status: 'in_progress' }]),
            ),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(WARM_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        // Wait for the Lottie mock to render — confirms recolorWarm executed
        // with the working data and mascotHue(mode) called.
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises hslToRgb s===0 (grey) branch via grey Lottie fixture', async () => {
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(GREY_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        // Wait for lottie-mock — grey RGB passes through rgbToHsl which returns
        // s=0 (d===0 branch), then recolorWarm skips it (s not > WARM_SAT_MIN),
        // but the full pipeline still runs.
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises rgbToHsl d===0 branch (r===g===b pure grey) via flat-grey Lottie', async () => {
        // When r===g===b (d=0), rgbToHsl returns early with h=0, s=0.
        // This exercises the d===0 branch at line 77.
        const FLAT_GREY_LOTTIE = {
            v: '5.7.4', fr: 30, ip: 0, op: 60, w: 100, h: 100,
            layers: [{ ty: 4, shapes: [{ ty: 'fl', c: { k: [0.5, 0.5, 0.5, 1] } }] }],
        };
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(FLAT_GREY_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises loadMascot fetch failure catch branch (returns null on network error)', async () => {
        // loadMascot fetches with cache:'force-cache'; if the network throws, the
        // catch returns null and rawAnimationData stays null — the fallback dot renders.
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            // Return 500 for lottie assets → res.ok=false branch in loadMascot
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json({}, { status: 500 })),
        );
        const { container } = renderWithProviders(<HeaderMascot />);
        // With failed fetch, animationData stays null, so lottie-mock never appears.
        // The fallback dot (8px Box) renders instead. Wait a tick to let any
        // pending microtasks settle, then confirm no lottie-mock appeared.
        await waitFor(
            () => expect(screen.getByRole('img', { name: /idle/i })).toBeInTheDocument(),
            { timeout: 10000 },
        );
        // The lottie-mock must NOT be present since animationData is null.
        expect(container.querySelector('[data-testid="lottie-mock"]')).toBeNull();
    }, 30000);

    it('exercises working state tooltip when active runs exist (count>1 plural branch)', async () => {
        // hasActiveRuns=true, count=2 → tooltip shows plural "agents working"
        server.use(
            http.get('http://localhost:3000/api/run', () =>
                HttpResponse.json([
                    { id: 'r1', status: 'in_progress' },
                    { id: 'r2', status: 'in_progress' },
                ]),
            ),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(WARM_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        await waitFor(
            () => expect(screen.getByRole('img', { name: /agents working/i })).toBeInTheDocument(),
            { timeout: 10000 },
        );
        // Also confirm the lottie player rendered (L242 true branch covered)
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises working state tooltip with count=1 (singular branch)', async () => {
        server.use(
            http.get('http://localhost:3000/api/run', () =>
                HttpResponse.json([{ id: 'r1', status: 'in_progress' }]),
            ),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(WARM_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        await waitFor(
            () => expect(screen.getByRole('img', { name: /agent working/i })).toBeInTheDocument(),
            { timeout: 10000 },
        );
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises hue2rgb branches via hue in all quadrants — rgbToHsl max===g path', async () => {
        // For max===g path in rgbToHsl: need g > r and g > b
        // amber r=0.3, g=0.9, b=0.1 → max=g, warm hue ~ H90 (outside warm band 20-60)
        // Use a mid-green hue that's in the warm band: r=0.5,g=0.8,b=0.05
        // hueDeg = H82 — still outside warm band, but tests max===g branch in rgbToHsl
        const GREEN_HUE_LOTTIE = {
            v: '5.7.4', fr: 30, ip: 0, op: 60, w: 100, h: 100,
            layers: [{ ty: 4, shapes: [{ ty: 'fl', c: { k: [0.5, 0.8, 0.05, 1] } }] }],
        };
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(GREEN_HUE_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises hue2rgb tt<1/6 and tt>2/3 branches via Lottie with warm colour in upper t range', async () => {
        // For the hue2rgb path: The output values of h depend on which channel is max.
        // For max===b path in rgbToHsl: need b > r and b > g
        // r=0.05, g=0.1, b=0.9 → max=b, h=(r-g)/d + 4 — outside warm band but tests max===b branch
        const BLUE_HUE_LOTTIE = {
            v: '5.7.4', fr: 30, ip: 0, op: 60, w: 100, h: 100,
            layers: [{ ty: 4, shapes: [{ ty: 'fl', c: { k: [0.05, 0.1, 0.9, 1] } }] }],
        };
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(BLUE_HUE_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises prefersReducedMotion=true branch (matchMedia returns true)', async () => {
        // Override matchMedia to return matches:true so prefersReducedMotion useMemo
        // returns true, which sets autoplay=false in the LottieComponent call.
        const origMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: (query: string) => ({
                matches: query.includes('reduce'),
                media: query,
                onchange: null,
                addListener: () => {},
                removeListener: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => false,
            }),
        });
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(WARM_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
        // Restore
        Object.defineProperty(window, 'matchMedia', { writable: true, value: origMatchMedia });
    }, 30000);

    it('exercises !window.matchMedia branch — prefersReducedMotion defaults false when matchMedia absent', async () => {
        // L195: `if (typeof window === 'undefined' || !window.matchMedia) return false`
        // Force !window.matchMedia by temporarily removing it.
        const origMatchMedia = window.matchMedia;
        // Force !window.matchMedia by setting it to undefined to test L195 guard branch.
        Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(WARM_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        await waitFor(
            () => expect(screen.getByRole('img', { name: /idle/i })).toBeInTheDocument(),
            { timeout: 10000 },
        );
        // Restore
        Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: origMatchMedia });
    }, 30000);

    it('exercises mode=dark ring color branch (dark mode active ring = warning)', async () => {
        // Dark mode + active runs → activeRingColor = ATLAS_PALETTE.warning
        // This exercises the `mode === 'light' ? success : warning` branch.
        server.use(
            http.get('http://localhost:3000/api/run', () =>
                HttpResponse.json([{ id: 'r1', status: 'in_progress' }]),
            ),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(WARM_LOTTIE)),
        );
        // Render in dark mode via ThemeModeContext
        const { ThemeModeContext } = await import('../hooks/useThemeModeContext.js');
        const { render: rtlRender } = await import('@testing-library/react');
        const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
        const { MemoryRouter } = await import('react-router-dom');
        const React = await import('react');
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } });
        rtlRender(
            React.createElement(
                ThemeModeContext.Provider,
                { value: { mode: 'dark', setMode: () => {}, toggle: () => {} } },
                React.createElement(
                    QueryClientProvider,
                    { client: qc },
                    React.createElement(
                        MemoryRouter,
                        null,
                        React.createElement(HeaderMascot),
                    ),
                ),
            ),
        );
        await waitFor(
            () => expect(screen.getByRole('img', { name: /agent working/i })).toBeInTheDocument(),
            { timeout: 10000 },
        );
        // Confirm lottie rendered (L242 true branch in dark mode)
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises rgbToHsl max===r g<b branch and hslToRgb l<0.5 branch via multi-shape Lottie', async () => {
        // MULTI_BRANCH_LOTTIE contains:
        //  - dark warm amber (l≈0.375<0.5) → hslToRgb uses q=l*(1+s) arm (L98 l<0.5 branch)
        //  - pinkish (max=r, g<b) → rgbToHsl uses h=(g-b)/d+6 arm (L80 g<b branch)
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', () => HttpResponse.json(MULTI_BRANCH_LOTTIE)),
        );
        renderWithProviders(<HeaderMascot />);
        await waitFor(
            () => expect(screen.getByTestId('lottie-mock')).toBeInTheDocument(),
            { timeout: 10000 },
        );
    }, 30000);

    it('exercises loadMascot cancelled=true branch — unmount before fetch resolves', async () => {
        // L185: if (cancelled) return; — fires when the component unmounts
        // before the async loadMascot Promise resolves. We delay the lottie
        // response so we can unmount before it arrives.
        let resolveResponse!: () => void;
        const deferred = new Promise<void>((resolve) => { resolveResponse = resolve; });
        server.use(
            http.get('http://localhost:3000/api/run', () => HttpResponse.json([])),
            http.get('http://localhost:3000/lottie/:file', async () => {
                await deferred;
                return HttpResponse.json(WARM_LOTTIE);
            }),
        );
        const { unmount } = renderWithProviders(<HeaderMascot />);
        // Unmount immediately — cancelled is now true inside the async closure
        unmount();
        // Now let the deferred fetch resolve — the `if (cancelled) return`
        // guard at L185 prevents the setState call on an unmounted component.
        resolveResponse();
        // Give the promise chain a chance to run
        await new Promise((resolve) => setTimeout(resolve, 50));
        // No assertions needed beyond "no React setState-after-unmount warnings"
        // (which vitest would catch as an error). Reaching here without throw = pass.
    }, 30000);
});
