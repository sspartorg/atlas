import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        globals: false,
        // 2026-06-25 (W4) — index.ts exports `main()` and only invokes it
        // when this guard env var is unset. Tests can `import { main }`
        // without the bin auto-running on module load.
        env: {
            ATLAS_MCP_TEST_NO_AUTORUN: '1',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: [
                // Test files only — every other src/**/*.ts file is included
                // and covered by W4 tests (config.test, server.test,
                // index.test, http-handler.test, registrations.test).
                'src/**/*.test.ts',
            ],
            // 2026-06-25 (W4) — full surface covered (index/server/config/
            // http-handler/registrations + all per-tool modules). Floor
            // lifted from 90 → 95 on all four metrics. Measured at this
            // point: 99.56 lines / 99.44 branches / 100 funcs / 99.56
            // statements. The 0.44 branch gap is the autorun guard in
            // index.ts which carries a v8 ignore annotation.
            // 2026-09-20 (ADR 0009 ratchet) — measured 100/100/100/100 on
            // 12 files / 167 tests while the gate sat at 95, so five points of
            // real coverage were unprotected. A ratchet locks gains in as well
            // as catching losses: any drop from 100 now fails.
            thresholds: {
                lines: 100,
                branches: 100,
                functions: 100,
                statements: 100,
            },
        },
    },
});
