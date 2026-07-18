// W4 — ApiError wire envelope. Covers the `details === undefined` branch in
// asErrorBody so the JSON body omits the field rather than emitting `undefined`.

import { describe, expect, it } from 'vitest';
import { ApiError, asErrorBody } from './errors.js';

describe('ApiError + asErrorBody', () => {
    it('captures kind, message, status, and details', () => {
        const e = new ApiError('not_found', 'item missing', 404, { itemId: 'x' });
        expect(e.kind).toBe('not_found');
        expect(e.status).toBe(404);
        expect(e.message).toBe('item missing');
        expect(e.details).toEqual({ itemId: 'x' });
        expect(e.name).toBe('ApiError');
    });

    it('asErrorBody includes details when provided', () => {
        const e = new ApiError('validation_error', 'bad', 400, { field: 'x' });
        expect(asErrorBody(e)).toEqual({
            error: 'bad',
            kind: 'validation_error',
            details: { field: 'x' },
        });
    });

    it('asErrorBody omits details when undefined (no `details: undefined` on the wire)', () => {
        const e = new ApiError('internal_error', 'boom', 500);
        const body = asErrorBody(e);
        expect(body).toEqual({ error: 'boom', kind: 'internal_error' });
        expect('details' in body).toBe(false);
    });

    it('asErrorBody preserves a null details value (since null !== undefined)', () => {
        const e = new ApiError('not_found', 'nope', 404, null);
        const body = asErrorBody(e);
        // null is a real value, not undefined → field kept.
        expect(body.details).toBeNull();
    });
});
