import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            // Barrel + types contribute no runtime; test files exclude themselves.
            exclude: ['src/index.ts', 'src/types/index.ts', 'src/**/*.test.ts'],
            // shared is the contract surface — pure functions, no excuse for gaps.
            // CI gates these thresholds via `pnpm -F @atlas/shared test:coverage`.
            thresholds: {
                lines: 100,
                branches: 100,
                functions: 100,
                statements: 100,
            },
        },
    },
});
