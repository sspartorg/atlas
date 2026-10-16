import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Reminders, formatSchedule } from './Reminders.js';
import type { IReminder, IReminderFire } from '@atlas/shared';

let isMobileValue = false;
vi.mock('../hooks/useIsMobile.js', () => ({ useIsMobile: () => isMobileValue }));
const show = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useToast.js', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useToast: () => ({ show, toasts: [], dismiss: vi.fn() }),
}));
// Toasts render in the app shell, not here: assert on what the page asked to show.
const toasted = (message: string | RegExp) =>
    waitFor(() =>
        expect(show.mock.calls.map((c) => (c[0] as { message: string }).message)).toContainEqual(
            typeof message === 'string' ? message : expect.stringMatching(message),
        ),
    );

const BASE = 'http://localhost:3000/api';
const HOUR = 60 * 60 * 1000;

function makeReminder(overrides: Partial<IReminder> = {}): IReminder {
    return {
        id: 1,
        label: 'Daily standup',
        body: 'Ping the team',
        schedule_kind: 'daily',
        schedule_value: '09:00',
        channel: 'notification',
        status: 'active',
        next_fire_at: new Date(Date.now() + HOUR + 5 * 60_000).toISOString(),
        last_fired_at: null,
        fire_count: 0,
        created_at: '2026-05-16T00:00:00Z',
        updated_at: '2026-05-16T00:00:00Z',
        created_by_agent_id: null,
        ...overrides,
    };
}

/** Serve the two list calls the page makes: live (active,paused) and history. */
function serveLists(live: IReminder[], history: IReminder[] = [], seen: string[] = []) {
    server.use(
        http.get(`${BASE}/reminders`, ({ request }) => {
            const url = new URL(request.url);
            seen.push(url.search);
            const status = url.searchParams.get('status') ?? '';
            if (status.includes('active')) return HttpResponse.json(live);
            const offset = Number(url.searchParams.get('offset') ?? 0);
            const limit = Number(url.searchParams.get('limit') ?? 50);
            return HttpResponse.json(history.slice(offset, offset + limit));
        }),
        http.get(`${BASE}/settings`, () => HttpResponse.json({ quiet_hours_timezone: 'Asia/Kolkata' })),
    );
}

async function openHistory() {
    fireEvent.click(screen.getByRole('switch', { name: /show history/i }));
    return screen.findByRole('region', { name: 'History' });
}

async function openMenu(label: string) {
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${label}` }));
    return screen.findByRole('menu');
}

afterEach(() => {
    isMobileValue = false;
    show.mockClear();
});

describe('Reminders page — lists', () => {
    it('shows the empty state with no live reminders', async () => {
        serveLists([]);
        renderWithProviders(<Reminders />);
        expect(await screen.findByText('No active reminders')).toBeInTheDocument();
    });

    it('asks only for active + paused until history is on, then pages history 50 at a time', async () => {
        const seen: string[] = [];
        const hist = Array.from({ length: 51 }, (_, i) =>
            makeReminder({ id: 100 + i, label: `Old ${i}`, status: 'cancelled' }),
        );
        serveLists([makeReminder()], hist, seen);
        renderWithProviders(<Reminders />);
        await screen.findByText('Daily standup');
        expect(seen).toEqual(['?status=active%2Cpaused']);

        const region = await openHistory();
        await within(region).findByText('Old 0');
        expect(seen).toContain('?status=cancelled%2Ccompleted&limit=50&offset=0');
        expect(within(region).queryByText('Old 50')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show more history' }));
        expect(await within(region).findByText('Old 50')).toBeInTheDocument();
        expect(seen).toContain('?status=cancelled%2Ccompleted&limit=50&offset=50');
        expect(screen.queryByRole('button', { name: 'Show more history' })).toBeNull();
    });

    it('names the Owner time zone in the subtitle', async () => {
        serveLists([makeReminder()]);
        renderWithProviders(<Reminders />);
        expect(await screen.findByText('Asia/Kolkata')).toBeInTheDocument();
    });

    it('refresh refetches both lists', async () => {
        const seen: string[] = [];
        serveLists([makeReminder()], [makeReminder({ id: 2, label: 'Gone', status: 'cancelled' })], seen);
        renderWithProviders(<Reminders />);
        await screen.findByText('Daily standup');
        await openHistory();
        await screen.findByText('Gone');
        const before = seen.length;
        fireEvent.click(screen.getByRole('button', { name: /refresh reminders/i }));
        await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(before + 2));
    });
});

describe('Reminders page — time line', () => {
    it('live rows show the next fire; paused rows the last fire', async () => {
        serveLists([
            makeReminder(),
            makeReminder({ id: 2, label: 'On hold', status: 'paused', last_fired_at: new Date(Date.now() - 2 * HOUR).toISOString() }),
            makeReminder({ id: 3, label: 'Never', status: 'paused' }),
        ]);
        renderWithProviders(<Reminders />);
        expect(await screen.findByText('Next in 1h')).toBeInTheDocument();
        expect(screen.getByText('Paused · last fired 2h ago')).toBeInTheDocument();
        expect(screen.getByText('Paused · never fired')).toBeInTheDocument();
    });

    it('history rows say when they finished instead of a stale next fire', async () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * HOUR).toISOString();
        const twoHoursAgo = new Date(Date.now() - 2 * HOUR - 60_000).toISOString();
        serveLists(
            [],
            [
                makeReminder({ id: 2, label: 'Done once', status: 'completed', updated_at: threeDaysAgo, fire_count: 1 }),
                makeReminder({ id: 3, label: 'Stopped', status: 'cancelled', updated_at: twoHoursAgo, last_fired_at: threeDaysAgo }),
                makeReminder({ id: 4, label: 'Ancient', status: 'cancelled', updated_at: '2020-01-01T00:00:00Z' }),
            ],
        );
        renderWithProviders(<Reminders />);
        await screen.findByText('No active reminders');
        await openHistory();
        expect(await screen.findByText('Completed 3d ago · fired 1×')).toBeInTheDocument();
        expect(screen.getByText('Cancelled 2h ago · last fired 3d ago')).toBeInTheDocument();
        expect(screen.getByText(/^Cancelled on /)).toBeInTheDocument();
        expect(screen.queryByText(/^Next/)).toBeNull();
    });
});

describe('Reminders page — fire log', () => {
    it('tapping a history row lazy-loads its fire log', async () => {
        const fires: IReminderFire[] = [
            { notification_id: 9, fired_at: '2026-10-15T03:30:00Z', push_status: 'sent', external_status: 'failed', failure_reason: 'chat not found' },
            { notification_id: 8, fired_at: '2026-10-14T03:30:00Z', push_status: 'none', external_status: 'pending', failure_reason: null },
        ];
        const fireCalls = vi.fn();
        serveLists([], [makeReminder({ id: 5, label: 'Logged', status: 'completed', fire_count: 2 })]);
        server.use(
            http.get(`${BASE}/reminders/5/fires`, () => {
                fireCalls();
                return HttpResponse.json(fires);
            }),
        );
        renderWithProviders(<Reminders />);
        await openHistory();
        const toggle = await screen.findByRole('button', { name: /Logged — show fire log/ });
        expect(fireCalls).not.toHaveBeenCalled();
        fireEvent.click(toggle);
        const log = await screen.findByRole('list', { name: 'Fire log' });
        expect(within(log).getAllByRole('listitem')).toHaveLength(2);
        expect(within(log).getByText('external failed · chat not found')).toBeInTheDocument();
        expect(within(log).getByText('external held / sending')).toBeInTheDocument();
        expect(within(log).getByText('push sent')).toBeInTheDocument();
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('button', { name: /Logged — hide fire log/ }));
        expect(screen.queryByRole('list', { name: 'Fire log' })).toBeNull();
        expect(fireCalls).toHaveBeenCalledTimes(1);
    });

    it('says so when a reminder has no logged fires, or the log fails', async () => {
        serveLists([], [
            makeReminder({ id: 6, label: 'Quiet', status: 'cancelled' }),
            makeReminder({ id: 7, label: 'Broken', status: 'cancelled' }),
        ]);
        server.use(
            http.get(`${BASE}/reminders/6/fires`, () => HttpResponse.json([])),
            http.get(`${BASE}/reminders/7/fires`, () => HttpResponse.json({ error: 'x' }, { status: 500 })),
        );
        renderWithProviders(<Reminders />);
        await openHistory();
        fireEvent.click(await screen.findByRole('button', { name: /Quiet — show fire log/ }));
        expect(await screen.findByText(/No fires logged/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Broken — show fire log/ }));
        expect(await screen.findByText('Could not load the fire log.')).toBeInTheDocument();
    });
});

describe('Reminders page — row menu', () => {
    it('offers only the actions valid for each status', async () => {
        serveLists(
            [makeReminder(), makeReminder({ id: 2, label: 'On hold', status: 'paused' })],
            [
                makeReminder({ id: 3, label: 'Done once', status: 'completed', schedule_kind: 'once', schedule_value: '2026-10-01T00:00:00Z' }),
                makeReminder({ id: 4, label: 'Stopped', status: 'cancelled' }),
            ],
        );
        renderWithProviders(<Reminders />);
        await screen.findByText('Daily standup');
        await openHistory();
        await screen.findByText('Stopped');
        const names = async (label: string) => {
            const menu = await openMenu(label);
            const items = within(menu).getAllByRole('menuitem').map((m) => m.textContent);
            fireEvent.keyDown(menu, { key: 'Escape' });
            await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
            return items;
        };
        const snoozes = ['Snooze 10 minutes', 'Snooze 1 hour', 'Snooze until tomorrow 9:00'];
        expect(await names('Daily standup')).toEqual(['Edit', 'Pause', ...snoozes, 'Cancel reminder']);
        expect(await names('On hold')).toEqual(['Edit', 'Resume', ...snoozes, 'Cancel reminder']);
        expect(await names('Done once')).toEqual([...snoozes, 'Delete']);
        expect(await names('Stopped')).toEqual(['Delete']);
    });

    it('pause and resume PATCH the status', async () => {
        const bodies: unknown[] = [];
        serveLists([makeReminder(), makeReminder({ id: 2, label: 'On hold', status: 'paused' })]);
        server.use(
            http.patch(`${BASE}/reminders/:id`, async ({ request, params }) => {
                bodies.push({ id: params['id'], body: await request.json() });
                return HttpResponse.json(makeReminder());
            }),
        );
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Pause' }));
        await toasted('Reminder "Daily standup" paused');
        fireEvent.click(within(await openMenu('On hold')).getByRole('menuitem', { name: 'Resume' }));
        await toasted('Reminder "On hold" resumed');
        expect(bodies).toEqual([
            { id: '1', body: { status: 'paused' } },
            { id: '2', body: { status: 'active' } },
        ]);
    });

    it('a failed pause says so', async () => {
        serveLists([makeReminder()]);
        server.use(http.patch(`${BASE}/reminders/1`, () => HttpResponse.json({ error: 'nope' }, { status: 409 })));
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Pause' }));
        await toasted('Could not pause reminder');
    });

    it('snooze posts the minutes and toasts the new time', async () => {
        const bodies: unknown[] = [];
        serveLists([makeReminder()]);
        server.use(
            http.post(`${BASE}/reminders/1/snooze`, async ({ request }) => {
                bodies.push(await request.json());
                return HttpResponse.json(makeReminder({ next_fire_at: new Date(Date.now() + 10 * 60_000).toISOString() }));
            }),
        );
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Snooze 10 minutes' }));
        await toasted(/^Snoozed until/);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Snooze 1 hour' }));
        await waitFor(() => expect(bodies).toEqual([{ minutes: 10 }, { minutes: 60 }]));
    });

    it('a failed snooze says so', async () => {
        serveLists([makeReminder()]);
        server.use(http.post(`${BASE}/reminders/1/snooze`, () => HttpResponse.json({ error: 'x' }, { status: 409 })));
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Snooze until tomorrow 9:00' }));
        await toasted('Could not snooze reminder');
    });

    it('Edit opens the edit modal', async () => {
        serveLists([makeReminder()]);
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Edit' }));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('Cancel confirms, then soft-cancels with a plain DELETE', async () => {
        const urls: string[] = [];
        serveLists([makeReminder()]);
        server.use(
            http.delete(`${BASE}/reminders/1`, ({ request }) => {
                urls.push(request.url);
                return HttpResponse.json(makeReminder({ status: 'cancelled' }));
            }),
        );
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Cancel reminder' }));
        const dialog = await screen.findByRole('dialog', { name: 'Cancel reminder?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Cancel reminder' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel reminder' }));
        await toasted('Reminder "Daily standup" cancelled');
        expect(urls).toEqual([`${BASE}/reminders/1`]);
    });

    it('a failed cancel says so', async () => {
        serveLists([makeReminder()]);
        server.use(http.delete(`${BASE}/reminders/1`, () => HttpResponse.json({ error: 'x' }, { status: 500 })));
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Cancel reminder' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel reminder' }));
        await toasted('Could not cancel reminder');
    });

    it('Delete confirms, then hard-deletes with ?hard=1', async () => {
        const urls: string[] = [];
        serveLists([], [makeReminder({ id: 4, label: 'Stopped', status: 'cancelled' })]);
        server.use(
            http.delete(`${BASE}/reminders/4`, ({ request }) => {
                urls.push(request.url);
                return new HttpResponse(null, { status: 204 });
            }),
        );
        renderWithProviders(<Reminders />);
        await openHistory();
        fireEvent.click(within(await openMenu('Stopped')).getByRole('menuitem', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete reminder?' });
        expect(within(dialog).getByText(/removed from history for good/)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        fireEvent.click(within(await openMenu('Stopped')).getByRole('menuitem', { name: 'Delete' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete reminder' }));
        await toasted('Reminder "Stopped" deleted');
        expect(urls).toEqual([`${BASE}/reminders/4?hard=1`]);
    });

    it('a refused delete says so', async () => {
        serveLists([], [makeReminder({ id: 4, label: 'Stopped', status: 'cancelled' })]);
        server.use(http.delete(`${BASE}/reminders/4`, () => HttpResponse.json({ error: 'x' }, { status: 409 })));
        renderWithProviders(<Reminders />);
        await openHistory();
        fireEvent.click(within(await openMenu('Stopped')).getByRole('menuitem', { name: 'Delete' }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete reminder' }));
        await toasted('Could not delete reminder');
    });
});

describe('Reminders page — mobile card', () => {
    it('renders label + status, schedule + channel, then time line + menu, with no spacer boxes', async () => {
        isMobileValue = true;
        serveLists([makeReminder({ channel: 'both' })], [makeReminder({ id: 2, label: 'Stopped', status: 'cancelled', channel: 'external' })]);
        renderWithProviders(<Reminders />);
        const card = (await screen.findAllByTestId('reminder-row'))[0]!;
        expect(within(card).getByText('Daily standup')).toBeInTheDocument();
        expect(within(card).getByText('active')).toBeInTheDocument();
        expect(within(card).getByText('Daily at 09:00')).toBeInTheDocument();
        expect(within(card).getByRole('img', { name: 'In-app + External Notification' })).toBeInTheDocument();
        expect(within(card).getByText('Next in 1h')).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: 'Actions for Daily standup' })).toBeInTheDocument();
        // The body is a desktop-only detail; the card stays three lines.
        expect(within(card).queryByText('Ping the team')).toBeNull();
        await openHistory();
        const hist = await screen.findByRole('button', { name: /Stopped — show fire log/ });
        expect(hist).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'External Notification' })).toBeInTheDocument();
    });

    it('the FAB opens the New reminder modal', async () => {
        isMobileValue = true;
        serveLists([]);
        renderWithProviders(<Reminders />);
        await screen.findByText('No active reminders');
        const fab = document.querySelector('.MuiFab-root') as HTMLElement;
        expect(fab).toHaveAccessibleName('New reminder');
        fireEvent.click(fab);
        await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));
    });
});

describe('Reminders page — desktop', () => {
    it('the header button opens the New reminder modal; the body shows on the row', async () => {
        serveLists([makeReminder({ channel: 'external' })]);
        renderWithProviders(<Reminders />);
        expect(await screen.findByText('Ping the team')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /new reminder/i }));
        await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));
    });
});

describe('Reminders page — edge states', () => {
    it('words every distance to the next and last fire', async () => {
        const at = (ms: number) => new Date(Date.now() + ms).toISOString();
        serveLists([
            makeReminder({ id: 1, label: 'r1', next_fire_at: at(30_000) }),
            makeReminder({ id: 2, label: 'r2', next_fire_at: at(10 * 60_000 + 30_000) }),
            makeReminder({ id: 3, label: 'r3', next_fire_at: at(2 * 24 * HOUR + HOUR) }),
            makeReminder({ id: 4, label: 'r4', next_fire_at: at(30 * 24 * HOUR) }),
            makeReminder({ id: 5, label: 'r5', next_fire_at: 'not-a-date' }),
            makeReminder({ id: 6, label: 'r6', status: 'paused', last_fired_at: at(-5 * 60_000 - 1000) }),
            makeReminder({ id: 7, label: 'r7', status: 'paused', last_fired_at: at(-10_000) }),
            makeReminder({ id: 8, label: 'r8', body: '' }),
        ]);
        renderWithProviders(<Reminders />);
        expect(await screen.findByText('Next in <1m')).toBeInTheDocument();
        expect(screen.getByText('Next in 10m')).toBeInTheDocument();
        expect(screen.getByText('Next in 2d')).toBeInTheDocument();
        expect(screen.getByText(/^Next on /)).toBeInTheDocument();
        expect(screen.getByText('Next')).toBeInTheDocument();
        expect(screen.getByText(/^Paused · last fired [56]m ago$/)).toBeInTheDocument();
        expect(screen.getByText('Paused · last fired just now')).toBeInTheDocument();
    });

    it('refresh with history off refetches only the live list', async () => {
        const seen: string[] = [];
        serveLists([makeReminder()], [], seen);
        renderWithProviders(<Reminders />);
        await screen.findByText('Daily standup');
        fireEvent.click(screen.getByRole('button', { name: /refresh reminders/i }));
        await waitFor(() => expect(seen.length).toBe(2));
        expect(seen.every((q) => q.includes('active'))).toBe(true);
    });

    it('a failed resume says so', async () => {
        serveLists([makeReminder({ status: 'paused' })]);
        server.use(http.patch(`${BASE}/reminders/1`, () => HttpResponse.json({ error: 'x' }, { status: 409 })));
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Resume' }));
        await toasted('Could not resume reminder');
    });

    it('dialogs stay open and show progress while their request is in flight', async () => {
        serveLists([makeReminder()], [makeReminder({ id: 4, label: 'Stopped', status: 'cancelled' })]);
        const never = () => new Promise<Response>(() => {});
        server.use(http.delete(`${BASE}/reminders/1`, never), http.delete(`${BASE}/reminders/4`, never));
        renderWithProviders(<Reminders />);
        fireEvent.click(within(await openMenu('Daily standup')).getByRole('menuitem', { name: 'Cancel reminder' }));
        const dialog = await screen.findByRole('dialog', { name: 'Cancel reminder?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel reminder' }));
        expect(await within(dialog).findByRole('button', { name: 'Cancelling…' })).toBeDisabled();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: 'Cancel reminder?' })).toBeInTheDocument();
    });

    it('the delete dialog stays open while deleting', async () => {
        serveLists([], [makeReminder({ id: 4, label: 'Stopped', status: 'cancelled' })]);
        server.use(http.delete(`${BASE}/reminders/4`, () => new Promise<Response>(() => {})));
        renderWithProviders(<Reminders />);
        await openHistory();
        fireEvent.click(within(await openMenu('Stopped')).getByRole('menuitem', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete reminder?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete reminder' }));
        expect(await within(dialog).findByRole('button', { name: 'Deleting…' })).toBeDisabled();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog', { name: 'Delete reminder?' })).toBeInTheDocument();
    });

    it('shows progress while the next history page loads', async () => {
        const hist = Array.from({ length: 50 }, (_, i) => makeReminder({ id: 100 + i, label: `Old ${i}`, status: 'cancelled' }));
        server.use(
            http.get(`${BASE}/reminders`, ({ request }) => {
                const url = new URL(request.url);
                if ((url.searchParams.get('status') ?? '').includes('active')) return HttpResponse.json([]);
                if (url.searchParams.get('offset') === '50') return new Promise<Response>(() => {});
                return HttpResponse.json(hist);
            }),
        );
        renderWithProviders(<Reminders />);
        await openHistory();
        fireEvent.click(await screen.findByRole('button', { name: 'Show more history' }));
        expect(await screen.findByRole('button', { name: 'Loading…' })).toBeDisabled();
    });
});

describe('formatSchedule', () => {
    it('covers each schedule kind', () => {
        expect(formatSchedule({ schedule_kind: 'daily', schedule_value: '09:00' })).toBe('Daily at 09:00');
        expect(formatSchedule({ schedule_kind: 'weekly', schedule_value: '08:00|1,3,9' })).toBe('Weekly Mon, Wed at 08:00');
        expect(formatSchedule({ schedule_kind: 'weekly', schedule_value: '08:00' })).toBe('08:00');
        expect(formatSchedule({ schedule_kind: 'cron', schedule_value: '0 9 * * 1' })).toBe('cron: 0 9 * * 1');
        expect(formatSchedule({ schedule_kind: 'once', schedule_value: 'not-a-date' })).toBe('not-a-date');
        expect(formatSchedule({ schedule_kind: 'once', schedule_value: '2026-10-01T00:00:00Z' })).toMatch(/^Once on /);
        expect(formatSchedule({ schedule_kind: 'bogus' as never, schedule_value: 'raw' })).toBe('raw');
    });
});

describe('Reminders page — honest states and the Owner zone', () => {
    it('a failed load is an error, not the empty hero', async () => {
        server.use(http.get(`${BASE}/reminders`, () => HttpResponse.json({ error: 'db down' }, { status: 500 })));
        renderWithProviders(<Reminders />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load reminders');
        expect(screen.queryByText('No active reminders')).not.toBeInTheDocument();
    });

    it('history on with nothing finished says so', async () => {
        serveLists([makeReminder()], []);
        renderWithProviders(<Reminders />);
        const region = await openHistory();
        expect(await within(region).findByText(/No finished reminders yet/)).toBeInTheDocument();
    });

    it('"Once on" and the tooltip are in the Owner zone (Asia/Kolkata), not the browser zone', async () => {
        serveLists([makeReminder({ schedule_kind: 'once', schedule_value: '2099-07-01T00:30:00.000Z', next_fire_at: '2099-07-01T00:30:00.000Z' })]);
        renderWithProviders(<Reminders />);
        const expected = new Date('2099-07-01T00:30:00.000Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
        expect(await screen.findByText(`Once on ${expected}`)).toBeInTheDocument();
    });
});

describe('formatSchedule — zone', () => {
    it('formats a Once in the given zone and falls back for an unknown one', () => {
        const at = '2099-07-01T00:30:00.000Z';
        const tokyo = new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' });
        expect(formatSchedule({ schedule_kind: 'once', schedule_value: at }, 'Asia/Tokyo')).toBe(`Once on ${tokyo}`);
        expect(formatSchedule({ schedule_kind: 'once', schedule_value: at }, 'Not/AZone')).toMatch(/^Once on /);
    });
});
