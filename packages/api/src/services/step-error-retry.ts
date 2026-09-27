// Whether a workflow step that ended in `error` is worth one automatic retry
// before the run parks with the Owner.
//
// Pure, like `gate-check-routing.ts`: the engine owns the timer, the respawn
// and the park; this file only reads the step's stored output and says
// "transient" or "permanent". The bias is toward retrying — a crash with no
// recognisable cause (the API restarted under it, the CLI died, the network
// dropped) usually goes away on its own, and the cost of being wrong is one
// extra step before the park that would have happened anyway. The list below
// is only the failures a second attempt cannot fix: the binary is not there,
// the CLI is not signed in, the account cannot pay, the agent is gone.
//
// ponytail: substring heuristics over free-form CLI output. A step whose own
// work happens to print one of these phrases parks without a retry — the safe
// direction, since that is exactly today's behaviour. Give the runner a typed
// error kind for auth/billing (it already tags `cli_not_installed`) if the
// guesses ever misfire.
const PERMANENT_PATTERNS: RegExp[] = [
    // The runner's typed marker for ENOENT (`classifyRunError`), and the raw
    // spawn error when it is untagged.
    /\[error-kind:cli_not_installed/,
    /\bspawn\b.*\bENOENT\b/,
    /command not found/i,
    // Not signed in / bad key / expired token — Claude Code and Copilot's
    // wording.
    /invalid api key/i,
    /please run \/login/i,
    /\bnot logged in\b/i,
    /authentication[_ ](error|failed|required)/i,
    /no authentication information/i,
    /oauth token (has )?expired/i,
    /\b401\b.*unauthori[sz]ed|unauthori[sz]ed.*\b401\b/i,
    /credit balance is too low/i,
    // `spawnNode`'s own refusal — the Owner has to reinstall or re-enable it.
    /is missing or inactive/,
];

export function isRetryableStepError(outputText: string | null | undefined): boolean {
    const text = outputText ?? '';
    return !PERMANENT_PATTERNS.some((p) => p.test(text));
}
