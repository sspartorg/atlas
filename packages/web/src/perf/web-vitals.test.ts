import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// `import.meta.env` is set by vitest via vite, so the env-gated branch
// can be exercised by stubbing the value before importing the module.

describe('initWebVitalsReporter', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('early-returns when VITE_ATLAS_PERF is not "1" (off-path)', async () => {
        vi.stubEnv('VITE_ATLAS_PERF', '');
        const { initWebVitalsReporter } = await import('./web-vitals.js');
        // No throw, no console call, and resolves cleanly.
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        await initWebVitalsReporter();
        expect(infoSpy).not.toHaveBeenCalled();
    });

    it('registers the 5 vitals reporters when VITE_ATLAS_PERF=1', async () => {
        vi.stubEnv('VITE_ATLAS_PERF', '1');
        const calls = {
            onCLS: vi.fn(),
            onFCP: vi.fn(),
            onINP: vi.fn(),
            onLCP: vi.fn(),
            onTTFB: vi.fn(),
        };
        vi.doMock('web-vitals', () => calls);
        const { initWebVitalsReporter } = await import('./web-vitals.js');
        await initWebVitalsReporter();
        expect(calls.onCLS).toHaveBeenCalledTimes(1);
        expect(calls.onFCP).toHaveBeenCalledTimes(1);
        expect(calls.onINP).toHaveBeenCalledTimes(1);
        expect(calls.onLCP).toHaveBeenCalledTimes(1);
        expect(calls.onTTFB).toHaveBeenCalledTimes(1);
    });

    it('reportMetric emits a tagged JSON line with the current route', async () => {
        vi.stubEnv('VITE_ATLAS_PERF', '1');
        let capturedReporter: ((metric: unknown) => void) | null = null;
        vi.doMock('web-vitals', () => ({
            onCLS: (r: typeof capturedReporter) => {
                capturedReporter = r;
            },
            onFCP: vi.fn(),
            onINP: vi.fn(),
            onLCP: vi.fn(),
            onTTFB: vi.fn(),
        }));
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        // Stub window.location.pathname for deterministic route capture.
        Object.defineProperty(window, 'location', {
            value: { ...window.location, pathname: '/dashboard' },
            writable: true,
        });

        const { initWebVitalsReporter } = await import('./web-vitals.js');
        await initWebVitalsReporter();
        expect(capturedReporter).not.toBeNull();
        capturedReporter!({
            name: 'LCP',
            value: 1234,
            rating: 'good',
            delta: 100,
            id: 'lcp-1',
        });
        expect(infoSpy).toHaveBeenCalledTimes(1);
        const arg = infoSpy.mock.calls[0]![0] as string;
        const parsed = JSON.parse(arg);
        expect(parsed).toMatchObject({
            tag: 'atlas:web-vitals',
            name: 'LCP',
            value: 1234,
            rating: 'good',
            delta: 100,
            id: 'lcp-1',
            route: '/dashboard',
        });
    });
});
