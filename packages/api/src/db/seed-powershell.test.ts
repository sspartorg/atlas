import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GUARDRAIL_SCRIPT_SEEDS } from './seed.js';

// The Windows half of every guardrail, actually executed.
//
// Until this file existed, no `.ps1` body had ever been run by a test. There
// is no PowerShell on the dev host and CI was Linux-only, so `body_ps1` shipped
// verified by string contract alone — and PR #45 found `gate-hygiene`'s ps1
// running two checks out of nine, caught only because a human read it.
//
// Running them found two more, one of which was on BOTH platforms:
//
//   1. `npm audit` exits non-zero with ENOLOCK when there is no lockfile, and
//      both bodies read any non-zero as "a high or critical advisory". A repo
//      with a package.json and no lockfile failed the security gate with a
//      vulnerability that did not exist. The bash tests never caught it because
//      they commit package.json in the BASE commit, so the audit never runs.
//   2. PowerShell's `-match` is case-insensitive and `grep -E` is not, so a
//      lowercase `todo` was debug residue on Windows and fine on Linux.
//
// Skips where PowerShell is absent rather than failing: a missing interpreter
// is absence of evidence (ADR 0020). The `gate-powershell` CI job provides one,
// so "skipped everywhere" cannot become the permanent state.

const pwsh = ['pwsh', 'powershell'].find(
    (bin) => spawnSync(bin, ['-NoLogo', '-Command', '$PSVersionTable.PSVersion.Major'], { stdio: 'ignore' }).status === 0,
);

function repoWith(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'ps-gate-'));
    const sh = (cmd: string) => execFileSync('bash', ['-c', cmd], { cwd: dir, stdio: 'pipe' });
    sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
    writeFileSync(join(dir, 'seed.txt'), 'base\n');
    sh('git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD');
    for (const [name, body] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, name)), { recursive: true });
        writeFileSync(join(dir, name), body);
    }
    sh('git add -A && git commit -qm change');
    return dir;
}

function runGate(id: string, dir: string, arg = 'ATL-1'): { code: number; out: string } {
    const body = GUARDRAIL_SCRIPT_SEEDS.find((s) => s.id === id)?.body_ps1 ?? '';
    const script = join(dir, `${id}.ps1`);
    writeFileSync(script, body);
    const r = spawnSync(pwsh!, ['-NoLogo', '-NoProfile', '-File', script, arg], {
        cwd: dir,
        encoding: 'utf8',
    });
    return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const PKG = '{"scripts":{}}';

describe.skipIf(!pwsh)('PowerShell guardrail bodies, executed', () => {
    describe('gate-hygiene', () => {
        it('passes a clean diff', () => {
            expect(runGate('gate-hygiene', repoWith({ 'a.js': 'const added = 2;\n', 'package.json': PKG })).code).toBe(0);
        });

        it('flags a bare TODO', () => {
            const r = runGate('gate-hygiene', repoWith({ 'a.js': '// TODO fix later\n', 'package.json': PKG }));
            expect(r.code).toBe(1);
            expect(r.out).toContain('residue');
        });

        it('flags debugger', () => {
            expect(runGate('gate-hygiene', repoWith({ 'a.js': 'debugger;\n', 'package.json': PKG })).code).toBe(1);
        });

        // Word-bounded on both sides: `TODO_FILE` is an identifier.
        it('does not flag TODO_FILE or HTTP_TODOS', () => {
            const files = { 'a.js': "const TODO_FILE = 'x';\nconst HTTP_TODOS = 2;\n", 'package.json': PKG };
            expect(runGate('gate-hygiene', repoWith(files)).code).toBe(0);
        });

        // The divergence this file was written to catch: `-match` is
        // case-insensitive, `grep -E` is not.
        it('does not flag a lowercase "todo", matching bash', () => {
            const files = { 'package.json': '{"scripts":{},"bin":{"todo":"cli.js"}}', 'a.js': 'const x = 1;\n' };
            const r = runGate('gate-hygiene', repoWith(files));
            expect(r.out).not.toContain('residue');
        });

        it('allows a tracked TODO(ATL-12) marker', () => {
            const files = { 'a.js': '// TODO(ATL-12): later\n', 'package.json': PKG };
            expect(runGate('gate-hygiene', repoWith(files)).code).toBe(0);
        });

        it('flags a newly added TODO(.agents) staleness marker', () => {
            const files = { 'a.js': '// TODO(.agents): update the doc\n', 'package.json': PKG };
            const r = runGate('gate-hygiene', repoWith(files));
            expect(r.code).toBe(1);
            expect(r.out).toContain('TODO(.agents)');
        });

        it('flags console.log in a library file', () => {
            const files = { 'lib.js': "console.log('debug');\n", 'package.json': PKG };
            expect(runGate('gate-hygiene', repoWith(files)).code).toBe(1);
        });

        it('exempts console.log in a declared bin — that is the product, not residue', () => {
            const files = { 'cli.js': "console.log('out');\n", 'package.json': '{"scripts":{},"bin":{"t":"cli.js"}}' };
            expect(runGate('gate-hygiene', repoWith(files)).code).toBe(0);
        });

        it('runs a declared lint script', () => {
            const files = { 'package.json': '{"scripts":{"lint":"node -e \\"process.exit(1)\\""}}' };
            const r = runGate('gate-hygiene', repoWith(files));
            expect(r.code).toBe(1);
            expect(r.out).toContain('lint failed');
        });

        // knip joined the declared-script loop in #45; the ps1 never ran it.
        it('runs a declared knip script', () => {
            const files = { 'package.json': '{"scripts":{"knip":"node -e \\"process.exit(1)\\""}}' };
            expect(runGate('gate-hygiene', repoWith(files)).out).toContain('knip failed');
        });

        // The false red. No lockfile means the audit could not run, not that a
        // vulnerability exists.
        it('does not invent an advisory when the manifest changed but there is no lockfile', () => {
            const r = runGate('gate-hygiene', repoWith({ 'package.json': PKG }));
            expect(r.out).not.toContain('advisory');
            expect(r.code).toBe(0);
        });
    });

    describe('gate-coverage', () => {
        it('skips when neither a coverage nor a test script is declared', () => {
            const r = runGate('gate-coverage', repoWith({ 'package.json': PKG }));
            expect(r.code).toBe(0);
            expect(r.out).toContain('no coverage script and no test script');
        });

        // ATL-149, on the Windows side.
        it('runs the test script when there is no coverage script', () => {
            const files = { 'package.json': '{"scripts":{"test":"node -e \\"\\""}}' };
            const r = runGate('gate-coverage', repoWith(files));
            expect(r.code).toBe(0);
            expect(r.out).toContain('coverage not measured');
        });

        it('fails a red suite even though coverage cannot be measured', () => {
            const files = { 'package.json': '{"scripts":{"test":"node -e \\"process.exit(1)\\""}}' };
            const r = runGate('gate-coverage', repoWith(files));
            expect(r.code).toBe(1);
            expect(r.out).toContain('the test suite failed');
        });
    });

    describe('gate-visual', () => {
        it('skips a pure backend change', () => {
            const files = { 'src/cache.js': 'export function load() { return 1; }\n', 'package.json': PKG };
            expect(runGate('gate-visual', repoWith(files)).out).toContain('no UI files changed and no markup added');
        });

        // #48, on the Windows side: an extension list misses server-rendered apps.
        it('does not skip server-rendered markup inside a .js file', () => {
            const files = { 'src/render.js': 'const row = `<li class="todo"><span>x</span></li>`;\n', 'package.json': PKG };
            expect(runGate('gate-visual', repoWith(files)).out).not.toContain('no UI files changed');
        });
    });
});

// A guard against the whole file quietly becoming a no-op. It asserts the
// thing that is true everywhere — that the bodies exist — so a green run on a
// host without PowerShell still says something.
describe('PowerShell bodies exist for every guardrail', () => {
    it('every seeded script ships a non-empty body_ps1', () => {
        for (const s of GUARDRAIL_SCRIPT_SEEDS) {
            expect(s.body_ps1.trim().length, `${s.id} has no PowerShell body`).toBeGreaterThan(0);
        }
    });
});
