import type { FastifyBaseLogger } from 'fastify';

// The Fastify logger for services that run outside a request (ticks, the
// workflow engine). `buildApp` installs it; before that (boot steps, scripts)
// warnings go to stderr.
let log: Pick<FastifyBaseLogger, 'warn' | 'error'> = {
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
} as Pick<FastifyBaseLogger, 'warn' | 'error'>;

export function setAppLog(logger: FastifyBaseLogger): void {
    log = logger;
}

export function appLog(): Pick<FastifyBaseLogger, 'warn' | 'error'> {
    return log;
}
