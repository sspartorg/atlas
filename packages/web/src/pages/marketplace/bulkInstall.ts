export interface BulkInstallOutcome {
    /** Catalog ids that installed (possibly on the suggested-slug retry). */
    succeeded: string[];
    /** Catalog ids that could not be installed. */
    failed: string[];
}

/** The structured 409 envelope the install endpoint throws on a slug clash. */
interface SlugTakenError {
    details?: { suggested_id?: string };
}

/**
 * Install several catalog agents in parallel, isolating failures so one bad
 * agent never aborts the batch. If an install rejects with the SLUG_TAKEN
 * envelope (a detached/old local copy already owns the default slug), it is
 * retried once under the server-suggested slug. The caller decides what to do
 * with the aggregated outcome (navigate, toast, keep failures selected).
 *
 * `install` is injected so this stays a pure, framework-free unit — the page
 * passes `api.marketplace.install`.
 */
export async function runBulkInstall(
    ids: string[],
    install: (id: string, opts?: { agent_id?: string }) => Promise<unknown>,
): Promise<BulkInstallOutcome> {
    const results = await Promise.all(
        ids.map(async (id) => {
            try {
                await install(id);
                return { id, ok: true };
            } catch (err) {
                const suggested = (err as SlugTakenError)?.details?.suggested_id;
                if (suggested) {
                    try {
                        await install(id, { agent_id: suggested });
                        return { id, ok: true };
                    } catch {
                        return { id, ok: false };
                    }
                }
                return { id, ok: false };
            }
        }),
    );

    return {
        succeeded: results.filter((r) => r.ok).map((r) => r.id),
        failed: results.filter((r) => !r.ok).map((r) => r.id),
    };
}
