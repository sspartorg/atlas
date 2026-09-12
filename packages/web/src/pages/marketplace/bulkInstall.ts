interface BulkInstallFailure {
    /** Catalog id that could not be installed. */
    id: string;
    /** HTTP status from the API, when the rejection carried one. */
    status: number | null;
    /** Server-supplied message — the only thing that makes a failure triageable. */
    reason: string;
}

export interface BulkInstallOutcome {
    /** Catalog ids that installed (possibly on the suggested-slug retry). */
    succeeded: string[];
    /** Catalog entries that could not be installed, each with its reason. */
    failed: BulkInstallFailure[];
}

/** The structured 409 envelope the install endpoint throws on a slug clash. */
interface SlugTakenError {
    status?: number;
    message?: string;
    details?: { suggested_id?: string };
}

function describe(id: string, err: unknown): BulkInstallFailure {
    const e = err as SlugTakenError;
    return {
        id,
        status: typeof e?.status === 'number' ? e.status : null,
        reason: e?.message || (err instanceof Error ? err.message : String(err)),
    };
}

/**
 * Install several catalog agents in parallel, isolating failures so one bad
 * agent never aborts the batch. If an install rejects with the SLUG_TAKEN
 * envelope (a detached/old local copy already owns the default slug), it is
 * retried once under the server-suggested slug. The caller decides what to do
 * with the aggregated outcome (navigate, toast, keep failures selected).
 *
 * Failures carry their status + server message. Reporting a bare count is what
 * made "a few agents didn't install" undiagnosable for weeks — the real reason
 * (a pruned model registry entry tripping agents_cli_model_fk) only ever
 * reached the API log.
 *
 * `install` is injected so this stays a pure, framework-free unit — the page
 * passes `api.marketplace.install`.
 */
export async function runBulkInstall(
    ids: string[],
    install: (id: string, opts?: { agent_id?: string }) => Promise<unknown>
): Promise<BulkInstallOutcome> {
    const results = await Promise.all(
        ids.map(async (id) => {
            try {
                await install(id);
                return { id, failure: null as BulkInstallFailure | null };
            } catch (err) {
                const suggested = (err as SlugTakenError)?.details?.suggested_id;
                if (suggested) {
                    try {
                        await install(id, { agent_id: suggested });
                        return { id, failure: null as BulkInstallFailure | null };
                    } catch (retryErr) {
                        return { id, failure: describe(id, retryErr) };
                    }
                }
                return { id, failure: describe(id, err) };
            }
        })
    );

    return {
        succeeded: results.filter((r) => r.failure === null).map((r) => r.id),
        failed: results.map((r) => r.failure).filter((f): f is BulkInstallFailure => f !== null),
    };
}
