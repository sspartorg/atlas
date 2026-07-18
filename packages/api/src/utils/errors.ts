import type { ApiErrorBody, ApiErrorKind } from '@atlas/shared';

/**
 * W4 — Typed throwable that the Fastify setErrorHandler maps to a status +
 * `ApiErrorBody` JSON response. Route + service code throws this instead of
 * `reply.status(n).send({ error })` so the wire envelope ships a machine
 * code (`kind`) the web client can switch on without parsing English copy.
 *
 * Lives in its own module so the boot-time helper in `boot-errors.ts` can
 * stay narrow and import-free of the shared types.
 */
export class ApiError extends Error {
    constructor(
        public readonly kind: ApiErrorKind,
        message: string,
        public readonly status: number,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export function asErrorBody(err: ApiError): ApiErrorBody {
    const body: ApiErrorBody = { error: err.message, kind: err.kind };
    if (err.details !== undefined) {
        body.details = err.details;
    }
    return body;
}
