// Wraps a boot-time async step so any throw → log + process.exit(1).
// Lives in its own module so W4 can later extend it into a typed error
// envelope (utils/errors.ts) without merge conflicts.
export async function bootStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
        console.error(`[boot] ${label} failed, refusing to start:\n${msg}`);
        process.exit(1);
    }
}
