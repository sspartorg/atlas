import { describe, expect, it } from 'vitest';
import { deriveItemEventKey } from './agent-runner.js';

// `deriveItemEventKey` is the contract between the orchestrator's
// post-run hook and the per-event external-notification toggle list. The
// user-visible switches in NotificationsTab cover Waiting for Info, In
// Review, Failed, and the no-item category — everything else (Done, In
// Progress, Draft, Ready) deliberately has no toggle and must skip the
// external send.
describe('deriveItemEventKey', () => {
    it('maps waiting_for_info to the waiting_for_info event key', () => {
        expect(deriveItemEventKey('waiting_for_info')).toBe(
            'item.status_changed:waiting_for_info',
        );
    });

    it('maps in_review to the in_review event key', () => {
        expect(deriveItemEventKey('in_review')).toBe('item.status_changed:in_review');
    });

    it.each(['done', 'in_progress', 'ready', 'draft', 'unknown', ''])(
        'returns undefined for status %s (no external-notification toggle covers it)',
        (status) => {
            expect(deriveItemEventKey(status)).toBeUndefined();
        },
    );
});
