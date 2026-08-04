import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// W12 spec 4 — Subprocess arg safety static audit.
//
// Every runner that spawns a child process MUST use array-form args
// (not a single shell-evaluated string) and MUST NOT set `shell: true`.
// A `spawn(cmd, joinedString)` invocation or `shell: true` opens the
// door to command injection from any data flowing into the args
// (project path, branch name, commit message, credential token, etc.).
//
// Approach: read each runner's source via fs.readFileSync and assert
// the regex patterns are absent. This catches new spawn sites added
// by future patches AS WELL AS the existing surface.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVICES_DIR = resolve(__dirname);

const RUNNER_FILES = [
    'agent-runner.ts',
    'auto-fetch-runner.ts',
    'clone-runner.ts',
    'delete-runner.ts',
    'reclone-runner.ts',
    'git-status.ts',
    'git-verify.ts',
    'worktree-orchestrator.ts',
    'cli-session-host.ts',
    // Shells out to git with a path that arrives from a query param, so the
    // array-argv / no-shell invariants matter here more than anywhere.
    'worktree-diff.ts',
];

function loadSource(relPath: string): string {
    return readFileSync(resolve(SERVICES_DIR, relPath), 'utf8');
}

/** Strip line comments (// ...) so regex audits don't match documentation. */
function stripLineComments(src: string): string {
    return src
        .split('\n')
        .map((line) => {
            const idx = line.indexOf('//');
            return idx >= 0 ? line.slice(0, idx) : line;
        })
        .join('\n');
}

describe('subprocess-args audit — no shell:true in any runner', () => {
    for (const file of RUNNER_FILES) {
        it(`${file}: forbids shell: true`, () => {
            // Strip line comments so documentation lines don't trigger false positives.
            const src = stripLineComments(loadSource(file));
            // Allow `shell: process.platform === 'win32'` (the standard Windows
            // gate), `shell: resolved.useShell` (dynamic), and `shell: false`.
            // Reject any literal `shell: true`.
            const matches = src.match(/\bshell\s*:\s*true\b/g);
            if (matches) {
                throw new Error(
                    `${file} uses shell: true — command injection risk. Use array-form args + shell: false instead.`,
                );
            }
            expect(matches).toBeNull();
        });
    }
});

describe('subprocess-args audit — array-form args required', () => {
    for (const file of RUNNER_FILES) {
        it(`${file}: spawn/execFile second-arg must be an array literal or variable, not a joined template`, () => {
            const src = loadSource(file);
            // Look for spawn/spawnSync/execFile invocations where the SECOND
            // arg is a backtick-template-literal string (which suggests a
            // joined command line passed as a single shell-evaluated string).
            // This is a heuristic: it flags patterns like
            //   spawn('git', `add ${branch}`, …)
            // while allowing
            //   spawn('git', ['add', branch], …)
            const re = /\b(spawn|spawnSync|execFile|exec)\s*\(\s*[^,]+,\s*`/g;
            const matches = src.match(re);
            if (matches) {
                throw new Error(
                    `${file} appears to invoke a spawn with a template-string second arg: ${matches.join(' | ')}. Use array-form args instead.`,
                );
            }
            expect(matches).toBeNull();
        });
    }
});

describe('subprocess-args audit — cli-session-host Windows wrap stays array-form', () => {
    it('spawnSpecForWindows returns args as a string[] (never joined)', () => {
        const src = loadSource('cli-session-host.ts');
        // The wrap must keep the array shape. Look for the function's
        // return signature; it must return `{ binary, args }` where args
        // is an array (the wrap clones it via [...args]).
        expect(src).toMatch(/spawnSpecForWindows/);
        // The wrap on Windows produces `['/c', binary, ...args]`. Assert
        // that exact shape exists.
        expect(src).toMatch(/\['\/c',\s*binary,\s*\.\.\.args\]/);
    });
});
