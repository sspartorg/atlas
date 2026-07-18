import { describe, expect, it, vi } from 'vitest';
import { AtlasApiError } from '../api/api.js';
import { transitionItemOnError } from './useTransitionItem.js';

function makeToast() {
    return { show: vi.fn() };
}

describe('transitionItemOnError', () => {
    it('returns false for a non-AtlasApiError', () => {
        const toast = makeToast();
        expect(transitionItemOnError(toast, new Error('boom'))).toBe(false);
        expect(toast.show).not.toHaveBeenCalled();
    });

    it('returns false for a AtlasApiError that is not 422/conflict', () => {
        const toast = makeToast();
        const err = new AtlasApiError('Internal', 'internal_error', 500);
        expect(transitionItemOnError(toast, err)).toBe(false);
        expect(toast.show).not.toHaveBeenCalled();
    });

    it('returns false for a 422 with no open_children array', () => {
        const toast = makeToast();
        const err = new AtlasApiError('Conflict', 'conflict', 422, {
            parent_id: 'ATL-1',
        });
        expect(transitionItemOnError(toast, err)).toBe(false);
    });

    it('returns true and shows a toast with first 3 ids when open_children present', () => {
        const toast = makeToast();
        const err = new AtlasApiError('Conflict', 'conflict', 422, {
            parent_id: 'ATL-1',
            open_children: [
                { id: 'ATL-2', status: 'in_progress' },
                { id: 'ATL-3', status: 'in_progress' },
                { id: 'ATL-4', status: 'in_progress' },
            ],
        });
        expect(transitionItemOnError(toast, err)).toBe(true);
        expect(toast.show).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringMatching(/open children/i),
                detail: expect.stringMatching(/ATL-2, ATL-3, ATL-4/),
            }),
        );
    });

    it('appends "and N more" when there are more than 3 open children', () => {
        const toast = makeToast();
        const err = new AtlasApiError('Conflict', 'conflict', 422, {
            open_children: [
                { id: 'ATL-2', status: 'in_progress' },
                { id: 'ATL-3', status: 'in_progress' },
                { id: 'ATL-4', status: 'in_progress' },
                { id: 'ATL-5', status: 'in_progress' },
                { id: 'ATL-6', status: 'in_progress' },
            ],
        });
        expect(transitionItemOnError(toast, err)).toBe(true);
        const arg = toast.show.mock.calls[0]?.[0];
        expect(arg?.detail).toMatch(/and 2 more/);
        expect(arg?.detail).toMatch(/are not done yet/);
    });

    it('uses singular grammar for a single open child', () => {
        const toast = makeToast();
        const err = new AtlasApiError('Conflict', 'conflict', 422, {
            open_children: [{ id: 'ATL-9', status: 'in_progress' }],
        });
        transitionItemOnError(toast, err);
        const arg = toast.show.mock.calls[0]?.[0];
        expect(arg?.detail).toMatch(/is not done yet/);
    });

    it('falls back to err.message when open_children is empty', () => {
        const toast = makeToast();
        const err = new AtlasApiError('Server says: closed by force', 'conflict', 422, {
            open_children: [],
        });
        transitionItemOnError(toast, err);
        const arg = toast.show.mock.calls[0]?.[0];
        expect(arg?.detail).toBe('Server says: closed by force');
    });
});
