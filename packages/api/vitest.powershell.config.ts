import { defineConfig } from 'vitest/config';

// The PowerShell guardrail suite, without the Postgres global setup.
//
// `vitest.config.ts` creates and migrates a test database in `globalSetup`
// because almost every api test needs one. These tests do not: they read
// `GUARDRAIL_SCRIPT_SEEDS` from source and execute the bodies against
// throwaway git repos in the temp dir.
//
// That distinction only became visible when the `windows-latest` job ran for
// the first time and died with ECONNREFUSED before discovering a single test —
// the harness needed a database the tests themselves did not. Standing up
// Postgres on a Windows runner to satisfy a setup step nothing in this file
// uses would be minutes of CI for no evidence.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/db/seed-powershell.test.ts'],
        // No globalSetup, no setupFiles, no coverage thresholds: this suite is
        // about exit codes from `pwsh`, not about the api's coverage floor.
        testTimeout: 60_000,
        hookTimeout: 60_000,
    },
});
