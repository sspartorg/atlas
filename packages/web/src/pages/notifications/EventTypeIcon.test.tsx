import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { EventTypeIcon, getEventMeta } from './EventTypeIcon.js';

describe('EventTypeIcon', () => {
    it('renders a known event type', () => {
        const { container } = renderWithProviders(<EventTypeIcon eventType="pr_merged" />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('falls back to default for unknown events', () => {
        const meta = getEventMeta('some_unknown_event');
        expect(meta.icon).toBe('notifications');
        expect(meta.label).toMatch(/Some Unknown Event/);
    });

    // Exercise every MAP branch in getEventMeta so v8 branch coverage fires.
    it.each([
        ['agent_completed', 'task_alt'],
        ['agent_error', 'error'],
        ['autofetch_success', 'sync'],
        ['autofetch_skipped', 'sync_disabled'],
        ['autofetch_failed', 'cloud_off'],
        ['autofetch_conflict', 'merge_type'],
        ['autofetch_disabled', 'block'],
        ['pr_opened', 'merge'],
        ['pr_merged', 'call_merge'],
        ['story_complete', 'check_circle'],
        ['waiting_for_info', 'help_outline'],
        ['subtask_blocked', 'block'],
        ['guardrails_updated', 'shield'],
    ] as const)(
        'getEventMeta(%s) returns icon %s',
        (eventType, expectedIcon) => {
            const meta = getEventMeta(eventType);
            expect(meta.icon).toBe(expectedIcon);
            expect(meta.label).toBeTruthy();
        },
    );

    it('renders with custom size prop', () => {
        const { container } = renderWithProviders(<EventTypeIcon eventType="agent_error" size={36} />);
        expect(container.firstChild).toBeInTheDocument();
    });
});
