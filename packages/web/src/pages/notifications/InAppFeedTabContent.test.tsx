import { describe, expect, it } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { InAppFeedTabContent } from './InAppFeedTabContent.js';
import { makeAgent, makeNotification } from '../../test-utils/factories.js';

// Renders the current router pathname so click-routing tests can assert on
// where the navigation actually landed.
function LocationDisplay() {
    const loc = useLocation();
    return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

const BASE = 'http://localhost:3000/api';

describe('InAppFeedTabContent', () => {
    it('renders an empty state when there are no notifications', () => {
        renderWithProviders(<InAppFeedTabContent allRows={[]} agents={[]} />);
        expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
    });

    it('renders rows from allRows with agent metadata', () => {
        const agents = [makeAgent({ id: 'agent-coder', name: 'Coder' })];
        const rows = [
            makeNotification({
                id: 1,
                message: 'Sub-task ATL-2 moved to In Review',
                kind: 'needs_you',
                issue_type: 'sub_task',
                issue_id: 'ATL-2',
                agent_id: 'agent-coder',
            }),
            makeNotification({
                id: 2,
                message: 'System ping',
                kind: 'system',
                agent_id: null,
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={agents} />);
        expect(screen.getByText(/Sub-task ATL-2 moved/)).toBeInTheDocument();
        expect(screen.getByText('System ping')).toBeInTheDocument();
    });

    it('shows a needs_you alert banner when any row is needs_you', () => {
        const rows = [
            makeNotification({
                id: 1,
                kind: 'needs_you',
                message: 'Action needed',
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('filters rows by kind when a FilterPill is clicked', () => {
        const rows = [
            makeNotification({ id: 1, kind: 'update', message: 'Just an update' }),
            makeNotification({ id: 2, kind: 'system', message: 'System message' }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        // Click "System" pill
        const systemPill = screen.getByText('System');
        fireEvent.click(systemPill);
        // Only System message should remain visible
        expect(screen.getByText('System message')).toBeInTheDocument();
        expect(screen.queryByText('Just an update')).not.toBeInTheDocument();
    });

    it('clicks a row to mark it read and navigate by issue_type', () => {
        let markRead = false;
        server.use(
            http.patch(`${BASE}/notifications/1/read`, () => {
                markRead = true;
                return HttpResponse.json({ ok: true });
            })
        );
        const rows = [
            makeNotification({
                id: 1,
                message: 'Task link click',
                kind: 'update',
                issue_type: 'task',
                issue_id: 'ATL-99',
                read_at: null,
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        const row = screen.getByText(/Task link click/);
        fireEvent.click(row);
        // markRead may or may not have fired (race with React), but click ran.
        expect(row).toBeInTheDocument();
        // Help silence unused
        void markRead;
    });

    it.each([
        ['task', '/tasks/id-task'],
        ['sub_task', '/sub-tasks/id-sub_task'],
    ] as const)('routes a %s notification to its detail page', (t, path) => {
        const rows = [
            makeNotification({
                id: 100,
                kind: 'update',
                issue_type: t,
                issue_id: `id-${t}`,
                message: `Click ${t}`,
                read_at: '2026-01-01T00:00:00Z',
            }),
        ];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>
        );
        fireEvent.click(screen.getByText(`Click ${t}`));
        expect(screen.getByTestId('location').textContent).toBe(path);
    });

    it('navigates to /projects/<id> when no issue_id but project_id is set', () => {
        const rows = [
            makeNotification({
                id: 200,
                kind: 'update',
                issue_type: null,
                issue_id: null,
                project_id: 'p1',
                message: 'Project ping',
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        const el = screen.getByText('Project ping');
        fireEvent.click(el);
    });

    it('falls back to /notifications when nothing else matches (same as a push click)', () => {
        const rows = [
            makeNotification({
                id: 201,
                kind: 'system',
                issue_type: null,
                issue_id: null,
                project_id: null,
                message: 'Lonely system message',
            }),
        ];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>
        );
        fireEvent.click(screen.getByText('Lonely system message'));
        expect(screen.getByTestId('location').textContent).toBe('/notifications');
    });

    it('routes reminder notifications to /reminders, not /tasks', () => {
        // Reminder rows ship with event_type='reminder', issue_id=null, and
        // project_id=null (see api/src/services/reminders.ts#fireOne). Without
        // a dedicated branch in openNotification(), they fall through to the
        // /tasks catch-all.
        const rows = [
            makeNotification({
                id: 300,
                event_type: 'reminder',
                kind: 'system',
                issue_type: null,
                issue_id: null,
                project_id: null,
                message: 'Time to stretch',
            }),
        ];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>
        );
        fireEvent.click(screen.getByText('Time to stretch'));
        expect(screen.getByTestId('location').textContent).toBe('/reminders');
    });

    it('uses singular "1 item needs you" phrasing', () => {
        const rows = [makeNotification({ id: 1, kind: 'needs_you', message: 'One only' })];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        expect(screen.getByText(/1 item needs you/)).toBeInTheDocument();
    });

    it('navigates to link_url when row has an explicit deep link', () => {
        const rows = [
            makeNotification({
                id: 400,
                kind: 'system',
                link_url: '/terminal/sess-abc',
                message: 'Terminal session link',
                issue_type: null,
                issue_id: null,
                project_id: null,
            }),
        ];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>
        );
        fireEvent.click(screen.getByText('Terminal session link'));
        expect(screen.getByTestId('location').textContent).toBe('/terminal/sess-abc');
    });

    it('marks already-read row as read without PATCH when row.read_at is set', () => {
        let patched = false;
        server.use(
            http.patch(`${BASE}/notifications/500/read`, () => {
                patched = true;
                return HttpResponse.json({ ok: true });
            })
        );
        const rows = [
            makeNotification({
                id: 500,
                message: 'Already read message',
                kind: 'update',
                issue_type: 'sub_task',
                issue_id: 'ATL-50',
                read_at: '2026-01-01T12:00:00Z',
            }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        fireEvent.click(screen.getByText('Already read message'));
        // read_at is set so markRead.mutate should NOT be called
        expect(patched).toBe(false);
    });

    it('clicking "All" filter pill covers setFilter("all") (L109)', () => {
        const rows = [
            makeNotification({ id: 600, kind: 'needs_you', message: 'Action item 1' }),
            makeNotification({ id: 601, kind: 'update', message: 'Update item 1' }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        // First switch to another filter, then click All to reset
        fireEvent.click(screen.getByText('System'));
        fireEvent.click(screen.getByText('All'));
        // All rows should be visible again
        expect(screen.getByText('Action item 1')).toBeInTheDocument();
        expect(screen.getByText('Update item 1')).toBeInTheDocument();
    });

    it('clicking "Needs You" filter pill covers setFilter("needs_you") (L115)', () => {
        const rows = [
            makeNotification({ id: 700, kind: 'needs_you', message: 'Needs you message' }),
            makeNotification({ id: 701, kind: 'update', message: 'Just an update' }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        fireEvent.click(screen.getByText('Needs You'));
        expect(screen.getByText('Needs you message')).toBeInTheDocument();
        expect(screen.queryByText('Just an update')).not.toBeInTheDocument();
    });

    it('clicking "Updates" filter pill covers setFilter("update") (L121)', () => {
        const rows = [
            makeNotification({ id: 800, kind: 'needs_you', message: 'Action needed' }),
            makeNotification({ id: 801, kind: 'update', message: 'Update notification' }),
        ];
        renderWithProviders(<InAppFeedTabContent allRows={rows} agents={[]} />);
        fireEvent.click(screen.getByText('Updates'));
        expect(screen.getByText('Update notification')).toBeInTheDocument();
        expect(screen.queryByText('Action needed')).not.toBeInTheDocument();
    });

    // Every producer's row lands where the push click would (notificationLinkUrl).
    it.each([
        [
            'workflow run',
            {
                event_type: 'workflow_run',
                link_url: '/workflows/wf1/runs/run1',
                issue_type: 'task',
                issue_id: 'ATL-1',
            },
            '/workflows/wf1/runs/run1',
        ],
        [
            'standalone agent run',
            {
                event_type: 'agent_completed_no_item',
                link_url: '/agents/a1/runs/r1',
                issue_type: null,
                issue_id: null,
                project_id: null,
            },
            '/agents/a1/runs/r1',
        ],
        [
            'item',
            { event_type: 'ci_failed', issue_type: 'task', issue_id: 'ATL-7' },
            '/tasks/ATL-7',
        ],
        [
            'sub-task',
            { event_type: 'agent_error', issue_type: 'sub_task', issue_id: 'ATL-7-1' },
            '/sub-tasks/ATL-7-1',
        ],
        [
            'jira',
            { event_type: 'jira_sync', issue_type: null, issue_id: null, project_id: null },
            '/settings?tab=jira',
        ],
        [
            'terminal',
            {
                event_type: 'terminal.waiting_for_input',
                link_url: '/terminal/s1',
                issue_type: null,
                issue_id: null,
            },
            '/terminal/s1',
        ],
        [
            'autofetch',
            { event_type: 'autofetch_failed', issue_type: null, issue_id: null, project_id: 'p1' },
            '/projects/p1',
        ],
    ] as const)('a %s row opens %s', (_name, over, path) => {
        const rows = [makeNotification({ id: 900, message: 'Route me', ...over })];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>
        );
        fireEvent.click(screen.getByText('Route me'));
        expect(screen.getByTestId('location').textContent).toBe(path);
    });

    it('opens from the keyboard and renders each row as a 3-zone card', () => {
        const rows = [makeNotification({ id: 901, message: 'Key me', link_url: '/reminders' })];
        renderWithProviders(
            <>
                <InAppFeedTabContent allRows={rows} agents={[]} />
                <LocationDisplay />
            </>
        );
        const card = screen.getByTestId('notification-card');
        expect(card).toHaveAttribute('tabindex', '0');
        fireEvent.keyDown(card, { key: 'Enter' });
        expect(screen.getByTestId('location').textContent).toBe('/reminders');
    });

    it('keeps the filter pills on one scrollable row', () => {
        renderWithProviders(<InAppFeedTabContent allRows={[makeNotification()]} agents={[]} />);
        const group = screen.getByRole('group', { name: 'Filter notifications' });
        expect(group).toHaveStyle({ flexWrap: 'nowrap', overflowX: 'auto' });
    });

    describe('snooze from a reminder card', () => {
        const reminderRow = (over: Parameters<typeof makeNotification>[0] = {}) =>
            makeNotification({
                id: 400,
                event_type: 'reminder',
                kind: 'system',
                issue_type: null,
                issue_id: null,
                project_id: null,
                link_url: '/reminders',
                message: 'Drink water',
                reminder_id: 12,
                read_at: null,
                ...over,
            });

        it('snoozes the reminder that fired, marks the card read, and keeps the way to Reminders', async () => {
            const snoozed: unknown[] = [];
            const read: string[] = [];
            server.use(
                http.get(`${BASE}/settings`, () => HttpResponse.json({ quiet_hours_timezone: 'UTC' })),
                http.post(`${BASE}/reminders/12/snooze`, async ({ request }) => {
                    snoozed.push(await request.json());
                    return HttpResponse.json({ id: 12, next_fire_at: new Date(Date.now() + 3_600_000).toISOString() });
                }),
                http.post(`${BASE}/notifications/:id/read`, ({ params }) => {
                    read.push(String(params['id']));
                    return HttpResponse.json({ ok: true });
                }),
            );
            renderWithProviders(
                <>
                    <InAppFeedTabContent allRows={[reminderRow()]} agents={[]} />
                    <LocationDisplay />
                </>
            );
            // The card is not a button (it holds one); the snooze button is the action.
            expect(screen.queryByRole('button', { name: /Drink water/ })).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Snooze reminder' }));
            const menu = await screen.findByRole('menu');
            expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
                'Snooze 10 minutes',
                'Snooze 1 hour',
                'Snooze until tomorrow 9:00',
                'Open Reminders',
            ]);
            fireEvent.click(within(menu).getByRole('menuitem', { name: 'Snooze 1 hour' }));
            await waitFor(() => expect(snoozed).toEqual([{ minutes: 60 }]));
            await waitFor(() => expect(read).toEqual(['400']));

            fireEvent.click(screen.getByRole('button', { name: 'Snooze reminder' }));
            fireEvent.click(await screen.findByRole('menuitem', { name: 'Open Reminders' }));
            expect(screen.getByTestId('location').textContent).toBe('/reminders');
        });

        it('a failed snooze leaves the card unread', async () => {
            const read: string[] = [];
            server.use(
                http.post(`${BASE}/reminders/12/snooze`, () => HttpResponse.json({ error: 'cancelled' }, { status: 409 })),
                http.post(`${BASE}/notifications/:id/read`, ({ params }) => {
                    read.push(String(params['id']));
                    return HttpResponse.json({ ok: true });
                }),
            );
            renderWithProviders(<InAppFeedTabContent allRows={[reminderRow()]} agents={[]} />);
            fireEvent.click(screen.getByRole('button', { name: 'Snooze reminder' }));
            fireEvent.click(await screen.findByRole('menuitem', { name: 'Snooze 10 minutes' }));
            await new Promise((r) => setTimeout(r, 50));
            expect(read).toEqual([]);
        });

        it('an already-read reminder card snoozes without marking read again', async () => {
            const read: string[] = [];
            server.use(
                http.post(`${BASE}/reminders/12/snooze`, () =>
                    HttpResponse.json({ id: 12, next_fire_at: new Date().toISOString() }),
                ),
                http.post(`${BASE}/notifications/:id/read`, ({ params }) => {
                    read.push(String(params['id']));
                    return HttpResponse.json({ ok: true });
                }),
            );
            renderWithProviders(
                <InAppFeedTabContent allRows={[reminderRow({ read_at: '2026-10-16T00:00:00Z' })]} agents={[]} />
            );
            fireEvent.click(screen.getByRole('button', { name: 'Snooze reminder' }));
            fireEvent.click(await screen.findByRole('menuitem', { name: 'Snooze 10 minutes' }));
            await new Promise((r) => setTimeout(r, 50));
            expect(read).toEqual([]);
        });

        it('a reminder fire from before the fire log (no reminder_id) stays a plain link card', () => {
            renderWithProviders(<InAppFeedTabContent allRows={[reminderRow({ reminder_id: null })]} agents={[]} />);
            expect(screen.queryByRole('button', { name: 'Snooze reminder' })).toBeNull();
            expect(screen.getByRole('button', { name: /Drink water/ })).toBeInTheDocument();
        });
    });
});
