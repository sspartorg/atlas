import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { credentialsService } from './credentials.js';

// Per-call git auth helpers.
//
// buildGitAuth() writes a per-invocation temp *directory* holding:
//   - `config`               — the git config file (points core.hooksPath
//                              here when human attribution is wired)
//   - `prepare-commit-msg`   — (github_app + human_* set) shell hook that
//                              appends `Co-Authored-By: <human>` to every
//                              commit made under this env
//
// The directory (not just the config file) is the cleanup unit — the
// caller passes the whole dir to `cleanupGitConfig` in `finally`.
//
// Convention (see `project_git_auth_uses_http_extraheader`): auth flows
// via `[http] extraheader = AUTHORIZATION: basic <b64>` written to the
// config file, exposed to git via `GIT_CONFIG_GLOBAL`. URL-embedded
// credentials leak to GCM on Windows — never use them.
//
// For `github_app` credentials the config additionally carries a
// `[user] name / email` block so `git commit` attributes to the bot's
// identity (or the human's, when human_* is set — see below).
//
// Human attribution (migration 025): if the github_app credential has
// `human_name` + `human_email` set, this module installs a
// `prepare-commit-msg` hook that appends `Co-Authored-By: <human>` to
// every commit. The bot stays as the primary author; the human is a
// co-author trailer — same shape isw-CDM-Next uses for `cdmnext-claude-bot`.

/**
 * Full credential material for a single git+gh invocation. The
 * `humanGhLogin` is surfaced separately so callers (like
 * `openPullRequest`) can plumb it into `gh pr create --assignee <login>`
 * and prepend `Requested-By: @<login>` to PR bodies.
 */
export interface GitAuth {
    /** Absolute path to the config file that GIT_CONFIG_GLOBAL should point at. */
    configPath: string;
    /** Absolute path to the parent temp dir. `cleanupGitConfig` unlinks this
     *  whole dir (config + hook + anything else we write). */
    configDir: string;
    /** Installation token (`ghs_...` for github_app, PAT string for pat). */
    token: string;
    /** github_app-only. `null` when the credential has no human_gh_login. */
    humanGhLogin: string | null;
    /** github_app-only. `null` when the credential has no human_name. Used
     *  by callers that build `git commit --trailer=...` explicitly (see
     *  cli-sessions terminal-finalize), because a `-c core.hooksPath=...`
     *  override on the commit invocation would otherwise defeat our
     *  `prepare-commit-msg` hook. Explicit `--trailer` can't be overridden. */
    humanName: string | null;
    /** github_app-only. `null` when the credential has no human_email. */
    humanEmail: string | null;
}

/**
 * Thrown when a github_app credential's lazy token mint fails at the
 * network layer (transient GitHub 5xx, DNS blip, etc.). Callers that
 * treat auth as an optional decoration (e.g. `git commit` under a
 * PAT-less finalize step) can catch this and proceed with a null auth
 * env; callers that must have auth (git push, gh pr create) should
 * surface it as a structured 4xx to the user instead of a raw 500.
 */
export class GitAuthUnavailableError extends Error {
    constructor(public readonly credentialId: string, cause: unknown) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        super(`[git-credentials] auth for credential ${credentialId} unavailable: ${msg}`);
        this.name = 'GitAuthUnavailableError';
    }
}

/**
 * Build the per-invocation auth surface. Returns `null` when
 * `credentialId` is null / the credential lookup returns nothing.
 * Throws `GitAuthUnavailableError` when a github_app credential's
 * lazy mint fails (previously the raw ghApi error propagated as an
 * unhandled 500 across every route that touched credentialed git ops).
 * See the module docstring for what files are written.
 */
export async function buildGitAuth(
    credentialId: string | null,
): Promise<GitAuth | null> {
    if (!credentialId) return null;
    const cred = await credentialsService.get(credentialId);
    if (!cred) return null;
    // `getToken` triggers lazy refresh for github_app credentials; that
    // call ALSO best-effort-backfills `app_slug` (see refreshCredential).
    // Re-read the row afterwards so the [user] section can use the fresh
    // slug on the very first push of a newly-added App credential.
    let token: string;
    try {
        token = await credentialsService.getToken(credentialId);
    } catch (err) {
        throw new GitAuthUnavailableError(credentialId, err);
    }
    const enriched =
        cred.kind === 'github_app' && !cred.app_slug
            ? ((await credentialsService.get(credentialId)) ?? cred)
            : cred;

    const configDir = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
    try {
        const configPath = join(configDir, 'config');

        const authB64 = Buffer.from(`${enriched.username}:${token}`, 'utf8').toString('base64');
        const lines: string[] = [
            '[http]',
            `\textraheader = AUTHORIZATION: basic ${authB64}`,
            '[credential]',
            '\thelper =',
        ];

        if (
            enriched.kind === 'github_app' &&
            enriched.app_slug &&
            enriched.app_id != null
        ) {
            const name = `${enriched.app_slug}[bot]`;
            const email = `${enriched.app_id}+${enriched.app_slug}[bot]@users.noreply.github.com`;
            lines.push('[user]');
            lines.push(`\tname = ${name}`);
            lines.push(`\temail = ${email}`);
        } else if (enriched.kind === 'github_app') {
            // 2026-07-03 audit finding: if `app_slug` is missing (backfill
            // failed / app-config.json had no `slug`), we would silently
            // omit the [user] block and let `git commit` fall back to the
            // developer's identity from .git/config — exactly the
            // regression migration 025 was meant to prevent. Log loudly
            // so the operator knows to check the App's slug before
            // pushing under this credential.
            // eslint-disable-next-line no-console
            console.warn(
                `[git-credentials] github_app credential ${enriched.id} has no app_slug/app_id — commit authorship will FALL BACK to the developer's .git/config identity. Re-add the credential once the App's slug backfill succeeds.`,
            );
        }

        // Install the co-author hook when the credential has both human
        // fields set. Bot stays as primary author (the [user] block
        // above); the human is credited via a Co-Authored-By trailer.
        const wantHumanAttribution =
            enriched.kind === 'github_app' &&
            !!enriched.human_name &&
            !!enriched.human_email;
        if (wantHumanAttribution) {
            // The hook is a POSIX shell script. Git for Windows bundles
            // bash and runs `.sh`-less hook files via it automatically —
            // no extension needed.
            const trailer = `Co-Authored-By: ${enriched.human_name} <${enriched.human_email}>`;
            writePrepareCommitMsgHook(configDir, trailer);
            lines.push('[core]');
            // POSIX-style forward slashes; git accepts them on Windows
            // too (Git for Windows converts internally).
            lines.push(`\thooksPath = ${configDir.replace(/\\/g, '/')}`);
        }

        const cfg = lines.join('\n') + '\n';
        writeFileSync(configPath, cfg, { mode: 0o600 });

        return {
            configPath,
            configDir,
            token,
            humanGhLogin: enriched.kind === 'github_app' ? enriched.human_gh_login : null,
            humanName: enriched.kind === 'github_app' ? enriched.human_name : null,
            humanEmail: enriched.kind === 'github_app' ? enriched.human_email : null,
        };
    } catch (err) {
        // If we fail after mkdtempSync but before returning, the temp
        // dir would leak in /tmp forever. Clean it up and re-throw so
        // the caller sees the real error.
        try {
            rmSync(configDir, { recursive: true, force: true });
        } catch {
            /* best-effort */
        }
        throw err;
    }
}

/**
 * Back-compat wrapper: returns only the config path. Kept for callers
 * that don't need the token or human attribution (e.g. worktree-orchestrator
 * `pushWorktree` — git push doesn't need `GH_TOKEN`). Prefer `buildGitAuth`
 * when the caller invokes `gh` or spawns an interactive PTY.
 *
 * On a transient github_app mint failure this returns `{configPath: null,
 * transient: true}` so callers can distinguish "credential not found /
 * unreadable" (null configPath, transient=false) from "credential exists
 * but GitHub is currently unreachable" (null configPath, transient=true).
 * The 2026-07-03 audit found the old collapse-to-null behaviour was
 * telling Owners to re-attach their credential during a GitHub 5xx —
 * they'd wipe the app_installation_id cache and start another mint
 * against the same 5xx, cycling until GitHub recovered.
 *
 * Any error other than `GitAuthUnavailableError` (e.g. mkdtempSync
 * ENOSPC) still propagates.
 */
export async function buildGitConfig(
    credentialId: string | null,
): Promise<{ configPath: string | null; transient: boolean }> {
    try {
        const auth = await buildGitAuth(credentialId);
        return { configPath: auth ? auth.configPath : null, transient: false };
    } catch (err) {
        if (err instanceof GitAuthUnavailableError) {
            // eslint-disable-next-line no-console
            console.warn(err.message);
            return { configPath: null, transient: true };
        }
        throw err;
    }
}

// A `atlas-git-*` prefix on the temp dir's basename is our safety
// invariant: cleanupGitConfig will only recursive-rm a path whose
// basename matches this. Anything else is refused as a no-op — this
// prevents a misuse where someone passes a plain `/tmp/foo.config`
// file (its dirname is `/tmp`) from causing an rm -rf against the
// whole tmpdir. mkdtempSync's prefix argument guarantees every temp
// dir we create passes this check.
const TEMP_DIR_PREFIX = 'atlas-git-';

/**
 * Delete the temp git config directory produced by `buildGitAuth`.
 * Accepts either the config file path (parent dir is removed) or the
 * config dir directly. Safe with `null` (no-op) or a path that no
 * longer exists.
 *
 * REFUSES to remove anything whose basename doesn't start with
 * `atlas-git-`. That's a safety belt against misuse — a caller who
 * accidentally passes a path outside our temp shape (e.g., the raw
 * `/tmp` dir) would otherwise blow it away.
 */
export function cleanupGitConfig(pathOrDir: string | null): void {
    if (!pathOrDir) return;
    // Resolve to the directory we actually want to remove. If the
    // caller passed the config file path (buildGitAuth's `configPath`),
    // the parent dir is our target. If they passed the dir directly
    // (buildGitAuth's `configDir`), use it as-is.
    const looksLikeConfigFile =
        pathOrDir.endsWith('config') || pathOrDir.endsWith('.config');
    const target = looksLikeConfigFile ? dirname(pathOrDir) : pathOrDir;
    // Safety belt: only remove if the target's basename matches our
    // temp-dir shape. Prevents accidental rm-rf on `/tmp` or any other
    // path the caller might have passed in error.
    if (!basename(target).startsWith(TEMP_DIR_PREFIX)) {
        return;
    }
    try {
        rmSync(target, { recursive: true, force: true });
    } catch {
        /* best-effort */
    }
}

/**
 * Write the `prepare-commit-msg` hook. Git for Windows ships bash and
 * runs the script through it; on POSIX the shebang + 0o755 mode gets
 * exec'd directly. The script appends the given trailer to the commit
 * message body iff the trailer isn't already present (idempotent so
 * `git commit --amend` doesn't stack duplicates).
 */
function writePrepareCommitMsgHook(dir: string, trailer: string): void {
    const hookPath = join(dir, 'prepare-commit-msg');
    // Escape single quotes for embedding in POSIX single-quoted string.
    const escapedTrailer = trailer.replace(/'/g, `'\\''`);
    // NOTE: template literal, so `${...}` is interpolated by JS but plain
    // `$var` is NOT (JS only expands the `${...}` form). Keep shell
    // variables written as `$FOO` / `$1` — no leading backslash. A
    // backslash before `$` would produce the string `\$FOO` in the
    // output, and shell inside `"..."` treats `\$` as a LITERAL dollar
    // sign (no variable expansion), so every check would compare against
    // the literal string "$1" instead of the actual argument.
    const script = `#!/bin/sh
# prepare-commit-msg -- atlas human-attribution trailer
# Injected by buildGitAuth(). Appends the Co-Authored-By trailer for the
# human developer behind the automation, unless the message already has
# an identical line (idempotent under 'git commit --amend' + merge
# resolve rewrites). Runs for every commit shape (-m, -F, editor, amend,
# merge, squash) -- the message file is always $1.
set -e
COMMIT_MSG_FILE="$1"
TRAILER='${escapedTrailer}'
if [ -z "$COMMIT_MSG_FILE" ] || [ ! -f "$COMMIT_MSG_FILE" ]; then
    exit 0
fi
if grep -qxF "$TRAILER" "$COMMIT_MSG_FILE"; then
    exit 0
fi
# Append with a blank line separator so trailers stay grouped at the
# tail regardless of what the commit author wrote above.
printf '\\n%s\\n' "$TRAILER" >> "$COMMIT_MSG_FILE"
`;
    // 0o755 so the hook is executable on POSIX. Windows ignores the mode
    // bits but runs the file via bundled bash anyway.
    writeFileSync(hookPath, script, { mode: 0o755 });
}
