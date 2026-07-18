import { describe, it, expect } from 'vitest';
import {
    assertCanStart,
    assertChildrenDone,
    checkChildrenDone,
    ChildrenNotDoneError,
} from './blockers.js';

describe('assertCanStart', () => {
    it('allows waiting_for_info regardless of blockers', () => {
        const res = assertCanStart('waiting_for_info', [
            { id: 'ATL-1', status: 'in_progress' },
        ]);
        expect(res.ok).toBe(true);
    });

    it('allows transitions other than in_progress / in_review through unchanged', () => {
        const res = assertCanStart('done', [{ id: 'ATL-1', status: 'in_progress' }]);
        expect(res.ok).toBe(true);
    });

    it('blocks in_progress when any blocker is not done', () => {
        const res = assertCanStart('in_progress', [
            { id: 'ATL-1', status: 'done' },
            { id: 'ATL-2', status: 'in_progress' },
        ]);
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.blockers).toHaveLength(1);
            expect(res.blockers[0]!.id).toBe('ATL-2');
        }
    });

    it('allows in_progress when every blocker is done', () => {
        const res = assertCanStart('in_progress', [
            { id: 'ATL-1', status: 'done' },
            { id: 'ATL-2', status: 'done' },
        ]);
        expect(res.ok).toBe(true);
    });

    it('blocks in_review the same way as in_progress', () => {
        const res = assertCanStart('in_review', [
            { id: 'ATL-1', status: 'ready' },
        ]);
        expect(res.ok).toBe(false);
    });

    it('treats an empty blockers list as unblocked', () => {
        const res = assertCanStart('in_progress', []);
        expect(res.ok).toBe(true);
    });
});

describe('checkChildrenDone / assertChildrenDone', () => {
    it('checkChildrenDone allows non-done targets through unchanged', () => {
        const res = checkChildrenDone('in_progress', [
            { id: 'ATL-2', status: 'ready' },
        ]);
        expect(res.ok).toBe(true);
    });

    it('checkChildrenDone allows done when every child is done', () => {
        const res = checkChildrenDone('done', [
            { id: 'ATL-2', status: 'done' },
            { id: 'ATL-3', status: 'done' },
        ]);
        expect(res.ok).toBe(true);
    });

    it('checkChildrenDone blocks done when any child is open', () => {
        const res = checkChildrenDone('done', [
            { id: 'ATL-2', status: 'done' },
            { id: 'ATL-3', status: 'in_progress' },
            { id: 'ATL-4', status: 'ready' },
        ]);
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.openChildren).toHaveLength(2);
            expect(res.openChildren.map((c) => c.id)).toEqual(['ATL-3', 'ATL-4']);
        }
    });

    it('checkChildrenDone treats waiting_for_info as open', () => {
        const res = checkChildrenDone('done', [
            { id: 'ATL-2', status: 'waiting_for_info' },
        ]);
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.openChildren).toHaveLength(1);
            expect(res.openChildren[0]!.id).toBe('ATL-2');
        }
    });

    it('checkChildrenDone treats an empty children list as closable', () => {
        const res = checkChildrenDone('done', []);
        expect(res.ok).toBe(true);
    });

    it('assertChildrenDone is a no-op for non-done targets', () => {
        expect(() =>
            assertChildrenDone('ATL-1', 'in_review', [
                { id: 'ATL-2', status: 'ready' },
            ]),
        ).not.toThrow();
    });

    it('assertChildrenDone is a no-op when every child is done', () => {
        expect(() =>
            assertChildrenDone('ATL-1', 'done', [
                { id: 'ATL-2', status: 'done' },
            ]),
        ).not.toThrow();
    });

    it('assertChildrenDone throws ChildrenNotDoneError with offending IDs', () => {
        try {
            assertChildrenDone('ATL-1', 'done', [
                { id: 'ATL-2', status: 'done' },
                { id: 'ATL-3', status: 'in_progress' },
                { id: 'ATL-4', status: 'draft' },
            ]);
            throw new Error('expected ChildrenNotDoneError');
        } catch (err) {
            expect(err).toBeInstanceOf(ChildrenNotDoneError);
            if (err instanceof ChildrenNotDoneError) {
                expect(err.parentId).toBe('ATL-1');
                expect(err.openChildren.map((c) => c.id)).toEqual(['ATL-3', 'ATL-4']);
                // Message lists the IDs so logs are debuggable without crawling .details.
                expect(err.message).toContain('ATL-3');
                expect(err.message).toContain('ATL-4');
            }
        }
    });
});
