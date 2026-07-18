/**
 * Per-invocation env for every orchestrator git/gh shell-out.
 *
 * Lifted from `worktree-orchestrator.ts` so every service that shells out to git
 * shares the same shape. Previously each file rolled its own partial env block
 * (some missed `GIT_CONFIG_NOSYSTEM`, some had no env at all) which on Windows
 * leaked through to Git for Windows's bundled GCM via `/etc/gitconfig`'s
 * `credential.helper = manager` — surfacing as a modal popup right after the
 * agent's run-end push (the cleanup fetch was the loudest offender; see
 * `cleanupWorktreeAfterPush`).
 *
 * Locks down every interactive credential path so we never block on GCM:
 *   - `GIT_CONFIG_NOSYSTEM=1` skips `/etc/gitconfig`. Git for Windows ships
 *     `credential.helper = manager` there — that file is the actual source of
 *     the GCM popups when our per-call temp global config is missing (e.g. the
 *     project has no credential row).
 *   - `GIT_TERMINAL_PROMPT=0` silences tty prompts.
 *   - `GCM_INTERACTIVE` / `GCM_GUI_PROMPT` / `GCM_MODAL_PROMPT` are three
 *     flavours of GCM-Core silence flag (different versions read different
 *     ones; setting all three is cheap and complete).
 *
 * When a credential is wired, `GIT_CONFIG_GLOBAL` points at a per-call temp
 * file containing `http.extraheader = AUTHORIZATION: basic <b64>`. Build that
 * tempfile via `buildGitConfig` from `./git-credentials.ts` and pass its path.
 * Pass `null` for local-only git calls (worktree remove, branch -D, status,
 * log, rev-parse, config get/set) — they don't touch the network so they don't
 * need the credential, but the GCM silencers still matter because some local
 * git operations on Windows still probe the helper chain.
 */
export function gitInvokeEnv(
    gitConfigPath: string | null,
    ghToken?: string | null,
): NodeJS.ProcessEnv {
    return {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GCM_INTERACTIVE: 'Never',
        GCM_GUI_PROMPT: 'false',
        GCM_MODAL_PROMPT: 'false',
        ...(gitConfigPath ? { GIT_CONFIG_GLOBAL: gitConfigPath } : {}),
        // `gh` reads its auth from GH_TOKEN / GITHUB_TOKEN env vars before
        // consulting `~/.config/gh/hosts.yml`. Without these, `gh pr create`
        // in a spawned shell would fall back to the developer's own
        // `gh auth login` and the resulting PR would be attributed to
        // them even though `git commit`/`git push` (which read
        // `GIT_CONFIG_GLOBAL`) run as the bot. Passing the same token
        // that lives in `http.extraheader` keeps both tools in sync.
        ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}),
    };
}
