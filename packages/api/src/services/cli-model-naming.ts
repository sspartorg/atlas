// Workstream #4 (2026-06-02) — Agent model strings are stored in the
// CLI-correct form directly on `agents.model`. The composite FK
// `agents (cli, model) → cli_models (cli, model_name)` (migration 061)
// guarantees the row is valid for its CLI. The previous hyphen→dot
// rewrite (`CLAUDE_CODE_TO_COPILOT`) is gone — the runtime passes the
// stored string straight to the CLI.
//
// This module retains the Windows spawn-path machinery
// (`quoteArgsForShell`, `resolveSpawn`) and the null/undefined fallback
// inside `normalizeModelForCli`, both unrelated to model identification.

import type { AgentCli } from '@atlas/shared';

/**
 * Resolve an agent's model string for the target CLI.
 *
 * The agent row's `model` is the authoritative identifier — passed to
 * the CLI unchanged. Falls back to a sensible default only when the
 * field is null/undefined (legacy rows from before the FK existed,
 * which the FK should now make impossible — kept defensively).
 */
// Deliberately NOT `DEFAULT_MODEL_BY_CLI` — that map holds the *preferred*
// model for a fresh session (Opus for claude). This is the last-resort
// fallback for a legacy row with a null model, where the cheap-and-safe
// choice is right and silently promoting the run to Opus is not.
const FALLBACK_MODEL_BY_CLI: Record<AgentCli, string> = {
    claude: 'sonnet',
    copilot: 'gpt-5',
    ollama: 'qwen3.5',
};

export function normalizeModelForCli(
    model: string | undefined | null,
    cli: AgentCli
): string {
    if (!model) return FALLBACK_MODEL_BY_CLI[cli];
    return model;
}

// Node spawn with `shell: true` on Windows runs the command through
// `cmd.exe`, which re-parses the joined command line and SPLITS each arg
// at every whitespace character. That breaks `-p "Reply with the single
// word OK..."` into eleven separate positional args, which is why copilot
// reported "too many arguments. Expected 0 arguments but got 8." despite
// the same command working when typed manually in a shell.
//
// Node requires `shell: true` for `.cmd` / `.bat` wrappers (the npm-
// installed `claude` and `copilot` binaries are both `.cmd` wrappers on
// Windows). We can't drop `shell: true`, so we pre-quote each arg
// ourselves the way cmd.exe expects: double-quote anything containing
// whitespace or shell metacharacters, and escape embedded `"` as `""`.
export function quoteArgsForShell(args: string[]): string[] {
    if (process.platform !== 'win32') return args;
    // Windows-only quoting logic — only reachable on win32.
    /* v8 ignore start */
    return args.map((a) => {
        if (a === '') return '""';
        if (!/[\s"<>&|^()]/.test(a)) return a;
        return `"${a.replace(/"/g, '""')}"`;
    });
    /* v8 ignore stop */
}

// On Windows, `shell: true` runs the command through `cmd.exe`, which
// caps the joined command line at ~8191 characters. The full SDLC
// agent prompts (Constitution + role prompt + worktree preamble +
// self-memory) routinely run 15–25 KB — well past that limit — and
// `-p <prompt>` on the Copilot CLI then fails with
// `[stderr] The command line is too long.`
//
// The fix: bypass the `.cmd` shim and spawn `node <npm-loader.js>`
// directly with `shell: false`. CreateProcess's command-line limit is
// 32,767 characters (4× more), and Node accepts `shell: false` for
// `.js` entry points without tripping CVE-2024-27980. We parse the
// `.cmd` shim's contents once per call to find the underlying `.js`,
// then return a `{ command, args }` pair the caller can pass to
// `nodeSpawn` with `shell: false`. Falls back to the original
// `{ bin, args, shell: true }` shape when the resolution doesn't
// match (custom installs, future shim formats) so the user still gets
// a useful error path.
//
// Verified shim shape on `copilot.cmd` and `claude.cmd` shipped by
// npm 10+ on Windows 11: both end with a line of the form
//   `"%_prog%"  "%dp0%\node_modules\<pkg>\<entry>.js" %*`
// We grep for that final `.js` path.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface ResolvedSpawn {
    command: string;
    args: string[];
    useShell: boolean;
}

// Resolved entry-point cache (per cli binary). Keyed by bin name so a
// future `gh` or `aider` CLI gets its own lookup.
const RESOLVED_ENTRY_CACHE: Map<string, string | null> = new Map();

function resolveCliShim(bin: string): string | null {
    if (process.platform !== 'win32') return null;
    // All code below is Windows-only — the function returns null on POSIX.
    /* v8 ignore start */
    const cached = RESOLVED_ENTRY_CACHE.get(bin);
    if (cached !== undefined) return cached;
    let cmdPath: string;
    try {
        // `where.exe` prints all matches; we want the first `.cmd`.
        const out = execFileSync('where.exe', [bin], { encoding: 'utf8', timeout: 5000 });
        const cmdLine = out.split(/\r?\n/).find((line) => line.toLowerCase().endsWith('.cmd'));
        if (!cmdLine) {
            RESOLVED_ENTRY_CACHE.set(bin, null);
            return null;
        }
        cmdPath = cmdLine.trim();
    } catch {
        RESOLVED_ENTRY_CACHE.set(bin, null);
        return null;
    }
    let contents: string;
    try {
        contents = readFileSync(cmdPath, 'utf8');
    } catch {
        RESOLVED_ENTRY_CACHE.set(bin, null);
        return null;
    }
    // Find the path the shim passes to node. Pattern:
    //   "<...>.js"  (double-quoted, ends with .js, before `%*`)
    const match = contents.match(/"([^"\r\n]+\.js)"\s+%\*/i);
    if (!match || !match[1]) {
        RESOLVED_ENTRY_CACHE.set(bin, null);
        return null;
    }
    // The shim path is relative to `%dp0%` (= the .cmd's directory).
    const dp0 = dirname(cmdPath);
    const jsPath = match[1].replace(/%dp0%\\?/gi, `${dp0}\\`);
    const absolute = resolvePath(jsPath);
    if (!existsSync(absolute)) {
        RESOLVED_ENTRY_CACHE.set(bin, null);
        return null;
    }
    RESOLVED_ENTRY_CACHE.set(bin, absolute);
    return absolute;
    /* v8 ignore stop */
}

/**
 * Resolve a CLI binary into a spawn-ready `{ command, args, useShell }`
 * triple. On Windows, walks the `.cmd` shim to its `.js` entry point so
 * the caller can spawn `node <js>` directly with `shell: false` and
 * benefit from the 32,767-char CreateProcess limit instead of cmd.exe's
 * ~8191-char limit. Falls back to `{ bin, args, useShell: true }` on
 * non-Windows or when the shim shape doesn't match.
 *
 * Callers should pass the returned shape to `nodeSpawn`:
 *   spawn(resolved.command, resolved.args, { shell: resolved.useShell, ... })
 *
 * The arg-quoting contract from `quoteArgsForShell` only applies when
 * `useShell === true`; the direct-spawn path passes argv unmodified.
 */
export function resolveSpawn(bin: string, args: string[]): ResolvedSpawn {
    const entry = resolveCliShim(bin);
    if (entry) {
        // Windows shim successfully resolved — spawn node directly.
        /* v8 ignore next */
        return { command: process.execPath, args: [entry, ...args], useShell: false };
    }
    return { command: bin, args: quoteArgsForShell(args), useShell: process.platform === 'win32' };
}
