// 2026-06-10 — `${variable.KEY}` placeholder substitution for the
// per-project setup-script runner.
//
// The user authors a `.sh` or `.ps1` body on the project (see migration
// 004 for storage). Before execution the orchestrator merges the global
// `environment_secrets` map with the per-project `project_env_vars`
// map (project wins on key collision) and runs `substitute` against
// the script body. Unknown keys throw `UnknownSecretError` and the
// runner records `agent_runs.status='setup_failed'` without spawning
// the CLI.
//
// Identifier rule: keys must match `[A-Za-z_][A-Za-z0-9_]*` — the same
// shape PowerShell / bash accept for variable names. The regex
// deliberately rejects bare `${X}` (no namespace), wrong namespaces
// like `${env.X}`, and empty `${variable.}` so the syntax is
// unambiguous and shell `${var}` expansion stays intact.

export class UnknownSecretError extends Error {
    constructor(readonly key: string) {
        super(`Unknown secret: \${variable.${key}}`);
        this.name = 'UnknownSecretError';
    }
}

const PLACEHOLDER_RE = /\$\{variable\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function substitute(template: string, vars: ReadonlyMap<string, string>): string {
    return template.replace(PLACEHOLDER_RE, (_match, key: string) => {
        const value = vars.get(key);
        if (value === undefined) throw new UnknownSecretError(key);
        return value;
    });
}

export function mergeSecrets(
    environmentSecrets: ReadonlyMap<string, string> | undefined,
    projectSecrets: ReadonlyMap<string, string> | undefined,
): Map<string, string> {
    const merged = new Map<string, string>();
    if (environmentSecrets) {
        for (const [k, v] of environmentSecrets) merged.set(k, v);
    }
    if (projectSecrets) {
        for (const [k, v] of projectSecrets) merged.set(k, v);
    }
    return merged;
}
