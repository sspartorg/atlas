import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { environmentSecretsService } from './environment-secrets.js';
import { runVerificationGate } from './verification-gate.js';

// ADR 0020 + G-022. These spawn real bash against a real script rather than
// mocking `execFile`: the point of the gate is that an exit code is believed
// over a claim, and a mocked exit code would just be another claim.
//
// What changed with G-022 — the body now comes from the `guardrail_scripts`
// row, NOT from a file in the repo. These tests seed that row. They used to
// write `<repo>/.atlas/scripts/bash/check-coder-tests-green.sh` and assert it
// ran, which is exactly the vulnerability: a repository shipping its own copy
// of that path got it executed. Every test here failed when the fix landed,
// which is what a test encoding the old behaviour should do.
const posix = process.platform !== 'win32';

const GATE_ID = 'coder-tests-green';
let repoPath: string;

/** Seed the guardrail row the gate reads. It is the only input the gate trusts. */
async function setGateScript(bodySh: string): Promise<void> {
    await testDb
        .insertInto('guardrail_scripts')
        .values({
            id: GATE_ID,
            name: 'Coder typecheck/lint/tests changed',
            description: '',
            body_sh: bodySh,
            body_ps1: '# not used on posix',
            sort_order: 103,
        } as never)
        .onConflict((oc) => oc.column('id').doUpdateSet({ body_sh: bodySh } as never))
        .execute();
}

const NO_SECRETS_PROJECT = 'project-that-does-not-exist';
const run = () =>
    runVerificationGate({ repoPath, projectId: NO_SECRETS_PROJECT, itemId: 'ATL-1' });

beforeEach(async () => {
    await truncateAll();
    repoPath = mkdtempSync(join(tmpdir(), 'atlas-gate-test-'));
});
afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
});
afterAll(async () => {
    await closeTestDb();
});

describe.skipIf(!posix)('runVerificationGate', () => {
    it('passes when the configured script exits 0', async () => {
        await setGateScript('#!/usr/bin/env bash\nexit 0\n');
        expect(await run()).toEqual({ kind: 'pass' });
    });

    // "I checked and it is fine" and "there was nothing I could check" are both
    // exit 0 and both take the pass edge, and they mean opposite things. On
    // ATL-110 a red suite reached the end of a run behind four `pass` rows, two
    // of which were skips, and gate-visual reported a pass on the one fixture
    // built to exercise it. The verdict has to say which happened.
    it('reports skipped — NOT pass — when the script says it had nothing to check', async () => {
        await setGateScript('#!/usr/bin/env bash\necho "gate-coverage: skipped - no coverage script declared"\nexit 0\n');
        expect(await run()).toEqual({
            kind: 'skipped',
            output: 'gate-coverage: skipped - no coverage script declared',
        });
    });

    it('still reports pass when a passing script says something that is not a skip', async () => {
        await setGateScript('#!/usr/bin/env bash\necho "gate-perf: within budget"\nexit 0\n');
        expect(await run()).toEqual({ kind: 'pass', output: 'gate-perf: within budget' });
    });

    // A project override need not follow the house convention; when it does
    // not, it reads as `pass`, which is exactly the old behaviour.
    it('treats a silent exit 0 as pass, not skipped', async () => {
        await setGateScript('#!/usr/bin/env bash\nexit 0\n');
        expect(await run()).toEqual({ kind: 'pass' });
    });

    it('does not mistake the word "skipped" later in the output for a skip', async () => {
        await setGateScript('#!/usr/bin/env bash\nprintf "gate-hygiene: clean\\n3 tests skipped\\n"\nexit 0\n');
        expect((await run()).kind).toBe('pass');
    });

    it('fails when the script exits non-zero, and reports what it printed', async () => {
        await setGateScript('#!/usr/bin/env bash\nprintf "coder-tests-green:\\n  test script failed\\n"\nexit 1\n');
        const res = await run();
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('test script failed');
    });

    it('captures stderr too — a failing suite often writes there', async () => {
        await setGateScript('#!/usr/bin/env bash\necho "boom" >&2\nexit 2\n');
        const res = await run();
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('boom');
    });

    it('ignores a script the REPOSITORY planted at the staged path (G-022)', async () => {
        // The attack this fix exists for. Before G-022 the gate executed
        // whatever sat at that path, with cwd = the repo and the parent's env.
        const dir = join(repoPath, '.atlas', 'scripts', 'bash');
        mkdirSync(dir, { recursive: true });
        const marker = join(repoPath, 'PWNED');
        writeFileSync(join(dir, `check-${GATE_ID}.sh`), `#!/usr/bin/env bash\ntouch ${marker}\nexit 0\n`, {
            mode: 0o755,
        });
        // Atlas's own script FAILS, so a `pass` would prove the planted file ran.
        await setGateScript('#!/usr/bin/env bash\necho "atlas script ran"\nexit 1\n');

        const res = await run();
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('atlas script ran');
        expect(existsSync(marker), 'the repo-planted script executed').toBe(false);
    });

    it('reports unavailable — NOT fail — when no gate script is configured', async () => {
        const res = await run();
        expect(res.kind).toBe('unavailable');
        if (res.kind !== 'unavailable') throw new Error('unreachable');
        expect(res.reason).toContain(GATE_ID);
    });

    it('reports unavailable — NOT fail — when the gate times out', async () => {
        await setGateScript('#!/usr/bin/env bash\nsleep 30\n');
        const prev = process.env['ATLAS_GATE_TIMEOUT_MS'];
        process.env['ATLAS_GATE_TIMEOUT_MS'] = '300';
        try {
            const res = await run();
            expect(res.kind).toBe('unavailable');
            if (res.kind !== 'unavailable') throw new Error('unreachable');
            expect(res.reason).toContain('timed out');
        } finally {
            if (prev === undefined) delete process.env['ATLAS_GATE_TIMEOUT_MS'];
            else process.env['ATLAS_GATE_TIMEOUT_MS'] = prev;
        }
    });

    it('passes --run-tests, which is what makes the script run the suite', async () => {
        await setGateScript('#!/usr/bin/env bash\n[ "$2" = "--run-tests" ] || exit 3\nexit 0\n');
        expect((await run()).kind).toBe('pass');
    });

    it("runs with the repo as cwd, so it sees that repo's manifest", async () => {
        // ADR 0017 — each repo of a Task has its own suite. The wrong cwd
        // would test a sibling and report on the wrong code.
        writeFileSync(join(repoPath, 'marker-file'), 'x');
        await setGateScript('#!/usr/bin/env bash\n[ -f marker-file ] || exit 4\nexit 0\n');
        expect((await run()).kind).toBe('pass');
    });

    it('does not hand the parent process environment to the script (G-021)', async () => {
        // The gate's output is persisted to the run log. The API process holds
        // DATABASE_URL (with a password) and ATLAS_MCP_TOKEN, and
        // `redactSecretValues` masks neither — so a test that dumps its
        // environment on failure used to write a live password into storage.
        await setGateScript('#!/usr/bin/env bash\necho "DB=[${DATABASE_URL:-unset}]"\nexit 1\n');
        const res = await run();
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('DB=[unset]');
    });

    it('still passes PATH through, or nothing would run at all', async () => {
        await setGateScript('#!/usr/bin/env bash\n[ -n "$PATH" ] || exit 5\nexit 0\n');
        expect((await run()).kind).toBe('pass');
    });

    it('withholds output entirely when the secret set cannot be loaded', async () => {
        await setGateScript('#!/usr/bin/env bash\necho "ghp_realtokenvalue"\nexit 1\n');
        const spy = vi
            .spyOn(environmentSecretsService, 'decryptAll')
            .mockRejectedValueOnce(new Error('workspace key unreadable'));
        try {
            const res = await run();
            expect(res.kind).toBe('fail');
            if (res.kind !== 'fail') throw new Error('unreachable');
            expect(res.output).toContain('output withheld');
            expect(res.output).not.toContain('ghp_realtokenvalue');
        } finally {
            spy.mockRestore();
        }
    });

    it('truncates a very long failure to its tail', async () => {
        await setGateScript('#!/usr/bin/env bash\nfor i in $(seq 1 3000); do echo "line $i padding padding"; done\nexit 1\n');
        const res = await run();
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output.length).toBeLessThanOrEqual(4000);
        expect(res.output).toContain('line 3000');
    });
});
