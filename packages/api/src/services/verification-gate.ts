import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mergeSecrets } from './secret-substitution.js';
import { environmentSecretsService } from './environment-secrets.js';
import { projectEnvFileService } from './project-env-file.js';
import { redactSecretValues } from './project-setup-runner.js';

// ADR 0020 — Atlas runs the verification gate itself.
//
// Before ADR 0020 the only thing standing between a red test suite and a
// merged pull request was the agent's own word. `decideRunRouting` reads the
// `atlas-outcome` block and `if (item.passed)` believes it; nothing ever ran
// the guardrail scripts that `constitution-assembler.ts` stages into the
// worktree. Campaign finding F-012 recorded the consequence: one Task shipped
// two PRs with red suites while every reviewer agent reported green.
//
// ADR 0024 changed WHO decides what to run, not who runs it. The command is
// named by a checker agent that read the repo (a gate step) or by the Owner on
// the repo row (the pre-push gate). Atlas executes it and believes the exit
// code. It no longer ships bash that guesses at a package manager, a coverage
// floor or which file extensions mean "UI".
//
// Design contracts:
//   - **Per repo, not per run.** ADR 0017 Tasks span several repos and each
//     carries its own suite, so the gate runs in the checkout about to be
//     pushed. A repo whose suite is red is not pushed; its siblings are
//     unaffected.
//   - **"Could not run" is never a failure.** No command, an absent binary or
//     a timeout is *absence of evidence*. Returning `unavailable`
//     parks the run with the Owner. Treating it as red would convert an
//     unenforced gate into one that blocks every delivery — a worse failure
//     than the one being fixed.
//   - Output is mask-redacted with the same secret set the setup runner uses,
//     because a failing test can print an environment variable and this output
//     is persisted to the run log.
//   - Nothing is written to the worktree. The gate only reads and executes.

const execFileAsync = promisify(execFile);

/** Matches the setup runner. A real suite is slower than a setup script. */
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min
const MAX_BUFFER = 8 * 1024 * 1024;
/** Enough of the tail to identify the failure without pasting a whole suite. */
const MAX_REPORTED_OUTPUT = 4000;

/**
 * The child's environment: an allowlist, not `{...process.env}`.
 *
 * G-021 — the gate's failure output is persisted to the run log and rendered
 * to the Owner, and `redactSecretValues` masks only `environment_secrets` and
 * the project env file. The parent process carries `DATABASE_URL` (with the
 * password), `POSTGRES_PASSWORD` and `ATLAS_MCP_TOKEN`, none of which are in
 * that mask set — so a test that dumps its environment on failure, which is
 * common, wrote a live DB password into a stored log with nobody doing
 * anything wrong.
 *
 * An allowlist is a smaller change than widening the mask and is a guarantee
 * rather than a best effort: a secret that never enters the child cannot be
 * printed by it. Project secrets still reach the script the way they always
 * have — inlined by the setup runner — not through here.
 */
function gateEnv(): NodeJS.ProcessEnv {
    const allow = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'USER', 'LOGNAME'];
    const env: NodeJS.ProcessEnv = {};
    for (const key of allow) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
    }
    // Node toolchains need these to resolve a runtime; they carry no secret.
    for (const [key, value] of Object.entries(process.env)) {
        if (/^(NODE_|npm_config_prefix$|VOLTA_|NVM_|ASDF_|PNPM_HOME$|COREPACK_)/.test(key) && value !== undefined) {
            env[key] = value;
        }
    }
    env['CI'] = '1';
    return env;
}

export type GateResult =
    | { kind: 'pass'; output?: string }
    | { kind: 'fail'; output: string; exitCode?: number }
    /**
     * The script ran and produced output, but has nothing to compare against —
     * the visual gate's answer for a screen with no committed baseline. It is
     * not a failure (nothing is known to be wrong) and not a pass (nothing was
     * verified), so it gets its own verdict and the run routes to the reviewer
     * that can look at the captures.
     */
    | { kind: 'needs_review'; output: string; exitCode?: number }
    /**
     * Exit 0, and the script said it had nothing to check.
     *
     * Distinct from `pass` on purpose. Both exit 0 and both take the pass edge,
     * but they mean opposite things: `pass` is "I checked and it is fine",
     * `skipped` is "I could not check". Collapsing them is how a red suite
     * reached the end of a run behind four green rows (ATL-110) and how
     * `gate-visual` reported a pass on the one fixture built to exercise it.
     * Nothing downstream could tell verified from not-checked.
     */
    | { kind: 'skipped'; output: string }
    | { kind: 'unavailable'; reason: string };

/**
 * A check announces "nothing to do here" as `<something>: skipped - <why>` on
 * its first line, and opts into `needs_review` by printing
 * `ATLAS_GATE_NEEDS_REVIEW` on a line of its own. Both are conventions a
 * checker agent is told to honour in its prompt, and both are optional: a
 * command that prints neither is judged on its exit code alone.
 */
const SKIPPED_RE = /^[^\n]*:\s*skipped\b/i;
const NEEDS_REVIEW_SENTINEL = 'ATLAS_GATE_NEEDS_REVIEW';
const NEEDS_REVIEW_RE = new RegExp(`(^|\\n)\\s*${NEEDS_REVIEW_SENTINEL}\\b`);

function tail(text: string): string {
    return text.length <= MAX_REPORTED_OUTPUT ? text : text.slice(-MAX_REPORTED_OUTPUT);
}

/**
 * Run a command in `repoPath` and report what its exit code says.
 *
 * ADR 0024 — the command is named by a checker agent that read this repo, or
 * set by the Owner on the repo (`project_repos.verify_command`). Atlas composes
 * none of it: the product has no opinion about whether a customer runs `pnpm
 * test`, `cargo test` or `bazel test //...`, and every version of it that did
 * was wrong for somebody.
 *
 * The hardening is the same one ADR 0020's pre-push gate has always used, and
 * it is load-bearing for a different reason now. Running an LLM-named string is
 * no new capability — `allowedToolsFor` hands the same agent unrestricted
 * `Bash` in this same checkout, and it could have typed the command inline.
 * What IS new is that this runs unsupervised after the dispatch ended and its
 * output is persisted to `run_gate_results` and posted on the item. So:
 *
 *   - the child gets an environment ALLOWLIST, never `process.env` (G-021):
 *     `DATABASE_URL`, `POSTGRES_PASSWORD` and `ATLAS_MCP_TOKEN` are not in it,
 *     so a suite that dumps its environment on failure cannot write a live
 *     password into a stored log;
 *   - output is secret-redacted before it is returned, and withheld entirely
 *     if the secret set could not be loaded to mask it;
 *   - the command is written to a 0600 tmpfile OUTSIDE the worktree, so
 *     nothing the repo ships decides what runs.
 *
 * Not defended, and not defended before this either: a command that deletes the
 * home directory. The worktree is disposable; `$HOME` is not. The threat model
 * is unchanged — the agent has had `Bash` all along.
 *
 * Verdict contract: exit 0 is a pass, any non-zero is a fail — except that the
 * command may downgrade its own failure to `needs_review` by printing the
 * sentinel `ATLAS_GATE_NEEDS_REVIEW` on a line of its own (a missing visual
 * baseline is the case it exists for). A sentinel rather than a reserved exit
 * code because 2 is a generic failure for a great many tools, and reading those
 * as "a human should look at this" would route real breakage to the wrong
 * place. A first line matching `<something>: skipped` is a `skipped`, which
 * takes the pass edge but is never recorded as a pass (migration 013).
 */
export async function runNamedCommand(opts: {
    repoPath: string;
    projectId: string;
    /** One line, as the checker named it. Run by `bash -c` semantics, so `&&` and pipes work. */
    command: string;
}): Promise<GateResult> {
    const command = opts.command.trim();
    if (!command) {
        return { kind: 'unavailable', reason: 'no command to run' };
    }
    const isWin = process.platform === 'win32';
    // `set -u` only. Not `set -e`: the command is one line and its exit status
    // is the script's, and a `set -e` here would change the meaning of a
    // pipeline the checker deliberately wrote.
    const body = isWin
        ? `$ErrorActionPreference = 'Continue'\n${command}\nexit $LASTEXITCODE\n`
        : `set -u\n${command}\n`;
    const scriptPath = join(tmpdir(), `atlas-gate-${randomUUID()}.${isWin ? 'ps1' : 'sh'}`);
    await writeFile(scriptPath, body, { encoding: 'utf8', mode: 0o600 });

    // Same secret set the setup runner masks with. Failing to load them must
    // not block delivery, but it does mean we cannot mask — in that case the
    // output is dropped rather than risk persisting a plaintext secret.
    let secrets: ReadonlyMap<string, string> | null = null;
    try {
        secrets = mergeSecrets(
            await environmentSecretsService.decryptAll(),
            new Map((await projectEnvFileService.dbList(opts.projectId)).map((v) => [v.key, v.value])),
        );
    } catch {
        secrets = null;
    }

    const timeoutMs = Number(process.env['ATLAS_GATE_TIMEOUT_MS']) || DEFAULT_TIMEOUT_MS;
    const bin = isWin ? 'powershell.exe' : 'bash';
    const args = isWin ? ['-NoProfile', '-NonInteractive', '-File', scriptPath] : [scriptPath];

    try {
        const ok = await execFileAsync(bin, args, {
            cwd: opts.repoPath,
            env: gateEnv(),
            timeout: timeoutMs,
            maxBuffer: MAX_BUFFER,
            windowsHide: true,
        });
        // A passing check still says something worth recording ("skipped - no
        // perf harness in this repo" is the difference between a check that ran
        // and one that had nothing to do). Omitted when empty so a silent pass
        // is exactly `{ kind: 'pass' }`.
        const said = tail(`${ok.stdout ?? ''}`.trim());
        if (said && SKIPPED_RE.test(said)) return { kind: 'skipped', output: said };
        return said ? { kind: 'pass', output: said } : { kind: 'pass' };
    } catch (err: unknown) {
        const e = err as {
            code?: number | string;
            signal?: NodeJS.Signals;
            killed?: boolean;
            stdout?: string | Buffer;
            stderr?: string | Buffer;
        };
        // A timeout or a signal kill is not a red suite — we never learned the
        // answer. Same for a spawn failure, which surfaces as a string code
        // (ENOENT, EACCES) rather than a numeric exit status.
        if (e.killed || e.signal) {
            return { kind: 'unavailable', reason: `the check timed out after ${timeoutMs}ms` };
        }
        if (typeof e.code !== 'number') {
            return { kind: 'unavailable', reason: `could not run the check: ${String(e.code ?? 'unknown')}` };
        }
        const stdout = e.stdout instanceof Buffer ? e.stdout.toString('utf8') : (e.stdout ?? '');
        const stderr = e.stderr instanceof Buffer ? e.stderr.toString('utf8') : (e.stderr ?? '');
        const raw = `${stdout}${stderr}`.trim();
        const output = secrets
            ? redactSecretValues(raw, secrets)
            : '(output withheld — the secret set could not be loaded to mask it)';
        const clipped = tail(output);
        if (NEEDS_REVIEW_RE.test(raw)) {
            return { kind: 'needs_review', output: clipped, exitCode: e.code };
        }
        return { kind: 'fail', output: clipped, exitCode: e.code };
    } finally {
        // One line of Atlas-written wrapper around a command from an LLM, in a
        // shared tmpdir — remove it even when the run throws.
        await unlink(scriptPath).catch(() => undefined);
    }
}
