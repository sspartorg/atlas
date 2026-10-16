import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { EventTypeIcon, getEventMeta } from './EventTypeIcon.js';

describe('EventTypeIcon', () => {
    it('renders a known event type', () => {
        const { container } = renderWithProviders(<EventTypeIcon eventType="workflow_run" />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('falls back to default for unknown events', () => {
        const meta = getEventMeta('some_unknown_event');
        expect(meta.icon).toBe('notifications');
        expect(meta.label).toMatch(/Some Unknown Event/);
    });

    // Every event_type the API produces today has its own glyph and label —
    // none falls back to the generic bell.
    it.each([
        ['workflow_run', 'workflow'],
        ['agent_completed', 'task_alt'],
        ['agent_completed_no_item', 'task_alt'],
        ['agent_error', 'error'],
        ['agent_error_no_item', 'error'],
        ['ci_failed', 'bug_report'],
        ['reminder', 'alarm'],
        ['jira_sync', 'sync_alt'],
        ['terminal.waiting_for_input', 'terminal'],
        ['autofetch_success', 'sync'],
        ['autofetch_skipped', 'sync_disabled'],
        ['autofetch_failed', 'cloud_off'],
        ['autofetch_conflict', 'merge_type'],
        ['autofetch_disabled', 'block'],
    ] as const)('getEventMeta(%s) returns icon %s', (eventType, expectedIcon) => {
        const meta = getEventMeta(eventType);
        expect(meta.icon).toBe(expectedIcon);
        expect(meta.label).not.toBe('Notification');
    });

    it('drops the entries nothing produces any more', () => {
        for (const gone of [
            'pr_opened',
            'pr_merged',
            'story_complete',
            'subtask_blocked',
            'guardrails_updated',
        ]) {
            expect(getEventMeta(gone).icon).toBe('notifications');
        }
    });

    it('renders with custom size prop', () => {
        const { container } = renderWithProviders(
            <EventTypeIcon eventType="agent_error" size={36} />
        );
        expect(container.firstChild).toBeInTheDocument();
    });
});
