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

function repoWith(files: Record<string, string>, message = 'change'): string {
    const dir = mkdtempSync(join(tmpdir(), 'ps-gate-'));
    const sh = (cmd: string) => execFileSync('bash', ['-c', cmd], { cwd: dir, stdio: 'pipe' });
    sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
    writeFileSync(join(dir, 'seed.txt'), 'base\n');
    sh('git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD');
    for (const [name, body] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, name)), { recursive: true });
        writeFileSync(join(dir, name), body);
    }
    sh(`git add -A && git commit -q -F - <<'MSG'\n${message}\nMSG`);
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

describe.skipIf(!pwsh)('PowerShell guardrail bodies, executed', () => {
    // ADR 0024 deleted the five scripts that guessed at the customer's stack,
    // and with them the three describes that lived here. What is left checks
    // Atlas's own artifacts, and this harness still has a job: it exists
    // because a `.ps1` once ran two of the nine checks its bash sibling ran,
    // and nothing caught it until a human read the file.
    describe('commit-discipline', () => {
        it('passes when every commit on the branch carries the trailer', () => {
            const dir = repoWith({ 'a.js': 'const added = 1;\n' }, 'change\n\nCo-Authored-By: Someone <s@example.com>');
            expect(runGate('commit-discipline', dir).code).toBe(0);
        });

        it('names the commit that is missing it', () => {
            const dir = repoWith({ 'a.js': 'const added = 1;\n' });
            const r = runGate('commit-discipline', dir);
            expect(r.code).toBe(1);
            expect(r.out).toContain('missing Co-Authored-By trailer');
        });
    });

    describe('prereqs', () => {
        // A dirty worktree is the one state every later script misreads: the
        // diff it inspects is not the diff that will be pushed.
        it('reports a dirty worktree', () => {
            const dir = repoWith({ 'a.js': 'const added = 1;\n' });
            writeFileSync(join(dir, 'uncommitted.txt'), 'x');
            const r = runGate('prereqs', dir);
            expect(r.code).toBe(1);
            // Named, not just non-zero: a missing `.atlas` also exits 1 here,
            // so the code alone would pass whether or not the dirty-tree check
            // survived.
            expect(r.out).toContain('dirty working tree');
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
