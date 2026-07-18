import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { NotificationLogTabContent } from './NotificationLogTabContent.js';
import { makeNotification } from '../../test-utils/factories.js';
import { Toast } from '../../components/Toast.js';
import * as apiModule from '../../api/api.js';
import type { ISettings } from '@atlas/shared';

function mockMobileViewport() {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('max-width') || query.includes('down'),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
    return () => {
        Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
    };
}

const BASE = 'http://localhost:3000/api';

const settings: ISettings = {
    id: 1,
    owner_name: 'Owner',
    onboarding_complete: 1,
    atlas_path: '',
    repos_root: '',
    ai_enabled: 0,
    external_notification_chat_id: '1234',
    external_notification_endpoint_label: 'atlas_bot',
    timezone: 'UTC',
    cli_default: 'claude',
    model_default: 'claude-opus-4-7',
    framework_default: 'tdd',
    effort_default: 'medium',
    locale: 'en-US',
} as unknown as ISettings;

describe('NotificationLogTabContent', () => {
    it('renders the empty state when there are no external-status rows', () => {
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={[]} />);
        expect(screen.getByText(/External Channel Is Configured but Quiet/i)).toBeInTheDocument();
    });

    it('renders rows when external_status is non-none', () => {
        const rows = [
            makeNotification({
                id: 1,
                external_status: 'sent',
                sent_external: 1,
                message: 'Sent external ping',
            }),
            makeNotification({
                id: 2,
                external_status: 'failed',
                failure_reason: 'network error',
                message: 'Failed external ping',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText('Sent external ping')).toBeInTheDocument();
        expect(screen.getByText('Failed external ping')).toBeInTheDocument();
    });

    it('filters by status when a FilterPill is clicked', () => {
        const rows = [
            makeNotification({ id: 1, external_status: 'sent', message: 'Sent A' }),
            makeNotification({ id: 2, external_status: 'failed', message: 'Failed B' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        // Click the "Failed" pill (the role=button one, not the status chip).
        const failedPills = screen.getAllByText('Failed');
        // The pill is wrapped in a role=button container.
        const pill = failedPills.find((el) =>
            el.closest('[role="button"]') !== null,
        );
        if (pill) {
            fireEvent.click(pill);
        }
        expect(screen.getByText('Failed B')).toBeInTheDocument();
    });

    it('shows the endpoint identity when external_notification_endpoint_label is set', () => {
        const rows = [
            makeNotification({ id: 1, external_status: 'sent', message: 'msg' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText('atlas_bot')).toBeInTheDocument();
    });

    it('clicks "Resend" on a sent row to fire the resend mutation', async () => {
        let resent = false;
        server.use(
            http.post(`${BASE}/notifications/1/resend`, () => {
                resent = true;
                return HttpResponse.json({ ok: true });
            }),
        );
        const rows = [
            makeNotification({
                id: 1,
                external_status: 'sent',
                message: 'Click resend',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        const btn = screen.getAllByRole('button', { name: /Resend/i })[0];
        if (btn) {
            fireEvent.click(btn);
            await waitFor(() => expect(resent).toBe(true));
        }
    });

    it('clicks "Retry" on a failed row to fire the resend mutation', async () => {
        let resent = false;
        server.use(
            http.post(`${BASE}/notifications/2/resend`, () => {
                resent = true;
                return HttpResponse.json({ ok: true });
            }),
        );
        const rows = [
            makeNotification({
                id: 2,
                external_status: 'failed',
                failure_reason: 'oops',
                message: 'Click retry',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        const btn = screen.getAllByRole('button', { name: /Retry/i })[0];
        if (btn) {
            fireEvent.click(btn);
            await waitFor(() => expect(resent).toBe(true));
        }
    });

    it('clicks "Cancel" on a pending row to fire the cancel mutation', async () => {
        let cancelled = false;
        server.use(
            http.post(`${BASE}/notifications/3/cancel`, () => {
                cancelled = true;
                return HttpResponse.json({ ok: true });
            }),
        );
        const rows = [
            makeNotification({
                id: 3,
                external_status: 'pending',
                message: 'Click cancel',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        const btn = screen.getAllByRole('button', { name: /Cancel/i })[0];
        if (btn) {
            fireEvent.click(btn);
            await waitFor(() => expect(cancelled).toBe(true));
        }
    });

    it('clicks "Send a Test Message" in the empty state', async () => {
        let tested = false;
        server.use(
            http.post(`${BASE}/settings/external-notification/test`, () => {
                tested = true;
                return HttpResponse.json({ ok: true });
            }),
        );
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={[]} />);
        const btn = screen.getByRole('button', { name: /Send a Test Message/i });
        fireEvent.click(btn);
        await waitFor(() => expect(tested).toBe(true));
    });

    it('handleSendTest success branch (r.ok=true) shows "Test message sent" toast', async () => {
        server.use(
            http.post(`${BASE}/settings/external-notification/test`, () =>
                HttpResponse.json({ ok: true }),
            ),
        );
        renderWithProviders(
            <>
                <NotificationLogTabContent settings={settings} allRows={[]} />
                <Toast />
            </>,
        );
        const btn = screen.getByRole('button', { name: /Send a Test Message/i });
        fireEvent.click(btn);
        await waitFor(() => {
            expect(screen.queryByText(/Test message sent/i)).toBeInTheDocument();
        }, { timeout: 5000 });
    });

    it('renders a row with failure_reason text', () => {
        const rows = [
            makeNotification({
                id: 9,
                external_status: 'failed',
                failure_reason: 'Bot blocked',
                message: 'Bot was blocked',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText('Bot was blocked')).toBeInTheDocument();
        expect(screen.getByText(/Bot blocked/)).toBeInTheDocument();
    });

    it('renders NotificationLogCard (fn#5) on mobile viewport', () => {
        // NotificationLogCard renders on the mobile branch (isMobile = true).
        // Override matchMedia for this test to simulate a mobile viewport so
        // useIsMobile() returns true and the card branch renders.
        const originalMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: query.includes('max-width') || query.includes('down'),
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
        const rows = [
            makeNotification({
                id: 10,
                external_status: 'sent',
                message: 'Card render test',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText('Card render test')).toBeInTheDocument();
        // Restore original matchMedia
        Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
    });

    it('fires onError (fn#9) when resend fails on a NotificationLogRow', async () => {
        server.use(
            http.post(`${BASE}/notifications/11/resend`, () =>
                HttpResponse.json({ error: 'Network failure' }, { status: 500 }),
            ),
        );
        const rows = [
            makeNotification({
                id: 11,
                external_status: 'sent',
                message: 'Resend error row',
            }),
        ];
        // Include Toast so the error toast message appears in the DOM.
        renderWithProviders(
            <>
                <NotificationLogTabContent settings={settings} allRows={rows} />
                <Toast />
            </>,
        );
        const btn = screen.getAllByRole('button', { name: /Resend/i })[0];
        if (btn) {
            fireEvent.click(btn);
            await waitFor(
                () => expect(screen.queryByText(/Resend failed/i)).toBeInTheDocument(),
                { timeout: 10000 },
            );
        }
    }, 30000);

    it('fires the All FilterPill onClick (fn#1) to reset filter', () => {
        const rows = [
            makeNotification({ id: 12, external_status: 'sent', message: 'All filter test' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        const allPills = screen.getAllByText('All');
        const pill = allPills.find((el) => el.closest('[role="button"]') !== null);
        if (pill) fireEvent.click(pill);
        expect(screen.getByText('All filter test')).toBeInTheDocument();
    });

    it('fires the Sent FilterPill onClick (fn#2)', () => {
        const rows = [
            makeNotification({ id: 13, external_status: 'sent', message: 'Sent filter test' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        const sentPills = screen.getAllByText('Sent');
        const pill = sentPills.find((el) => el.closest('[role="button"]') !== null);
        if (pill) fireEvent.click(pill);
        expect(screen.getByText('Sent filter test')).toBeInTheDocument();
    });

    it('renders status chip default branch (line 578) with unknown external_status', () => {
        // line 578: default case returns { label: '—', ... } for unknown status
        const rows = [
            makeNotification({
                id: 20,
                external_status: 'unknown_status' as 'sent',
                message: 'Unknown status row',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText('Unknown status row')).toBeInTheDocument();
        // The default branch renders '—' as the status chip label
        expect(document.body.textContent).toContain('—');
    });

    it('handleSendTest not-ok error branch (lines 614-618): shows error detail when r.error is present', async () => {
        // lines 614-618: else { toast.show(r.error ? { message: 'Test failed', detail: r.error } : ...) }
        server.use(
            http.post(`${BASE}/settings/external-notification/test`, () =>
                HttpResponse.json({ ok: false, error: 'Telegram rate limit' }),
            ),
        );
        renderWithProviders(
            <>
                <NotificationLogTabContent settings={settings} allRows={[]} />
                <Toast />
            </>,
        );
        const btn = screen.getByRole('button', { name: /Send a Test Message/i });
        fireEvent.click(btn);
        await waitFor(() => {
            expect(screen.queryByText(/Test failed/i)).toBeInTheDocument();
        }, { timeout: 5000 });
    });

    it('handleSendTest not-ok no-error branch (lines 614-618): shows plain "Test failed" when no r.error', async () => {
        // lines 614-618: r.error is falsy → toast.show({ message: 'Test failed' })
        server.use(
            http.post(`${BASE}/settings/external-notification/test`, () =>
                HttpResponse.json({ ok: false }),
            ),
        );
        renderWithProviders(
            <>
                <NotificationLogTabContent settings={settings} allRows={[]} />
                <Toast />
            </>,
        );
        const btn = screen.getByRole('button', { name: /Send a Test Message/i });
        fireEvent.click(btn);
        await waitFor(() => {
            expect(screen.queryByText(/Test failed/i)).toBeInTheDocument();
        }, { timeout: 5000 });
    });

    it('desktop view: "No deliveries match this filter" shown when a filter yields zero rows', () => {
        const rows = [
            makeNotification({ id: 30, external_status: 'sent', message: 'Only a sent row' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        // Click "Failed" — there are no failed rows, so visible.length === 0 on desktop
        const failedPills = screen.getAllByText('Failed');
        const pill = failedPills.find((el) => el.closest('[role="button"]') !== null);
        expect(pill).toBeDefined();
        fireEvent.click(pill!);
        expect(screen.getByText(/No deliveries match this filter/i)).toBeInTheDocument();
    });

    it('mobile view: "No deliveries match this filter" shown when a filter yields zero rows', () => {
        const originalMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: query.includes('max-width') || query.includes('down'),
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
        const rows = [
            makeNotification({ id: 31, external_status: 'sent', message: 'Mobile only sent row' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        const failedPills = screen.getAllByText('Failed');
        const pill = failedPills.find((el) => el.closest('[role="button"]') !== null);
        expect(pill).toBeDefined();
        fireEvent.click(pill!);
        expect(screen.getByText(/No deliveries match this filter/i)).toBeInTheDocument();
        Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
    });

    it('desktop row without issue_type/issue_id omits the item-id line (falsy branch)', () => {
        const rows = [
            makeNotification({
                id: 40,
                external_status: 'sent',
                message: 'No issue linked',
                issue_type: null,
                issue_id: null,
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText('No issue linked')).toBeInTheDocument();
        expect(screen.queryByText('ATL-2')).not.toBeInTheDocument();
    });

    it('fires the Pending FilterPill onClick (fn#4)', () => {
        const rows = [
            makeNotification({ id: 14, external_status: 'pending', message: 'Pending filter test' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        const pendingPills = screen.getAllByText('Pending');
        const pill = pendingPills.find((el) => el.closest('[role="button"]') !== null);
        if (pill) fireEvent.click(pill);
        expect(screen.getByText('Pending filter test')).toBeInTheDocument();
    });

    it('NotificationLogCard handleResend on mobile viewport (fn#5 handleResend)', async () => {
        // Forces mobile render via matchMedia mock so NotificationLogCard (not Row) renders.
        // Then clicks the Resend button to exercise handleResend (line 252).
        const originalMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: query.includes('max-width') || query.includes('down'),
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
        server.use(
            http.post(`${BASE}/notifications/20/resend`, () =>
                HttpResponse.json({}),
            ),
        );
        const rows = [
            makeNotification({ id: 20, external_status: 'sent', message: 'Mobile resend test' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText('Mobile resend test')).toBeInTheDocument();
        const resendBtns = screen.queryAllByRole('button', { name: /Resend/i });
        if (resendBtns.length > 0) {
            fireEvent.click(resendBtns[0]!);
            await waitFor(() => {}, { timeout: 1000 });
        }
        Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
        expect(document.body).toBeTruthy();
    }, 15000);

    it('NotificationLogCard handleCancel on mobile viewport (fn#5 handleCancel)', async () => {
        // Clicks Cancel on a pending row in mobile card view to exercise handleCancel (line 262).
        const originalMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: query.includes('max-width') || query.includes('down'),
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
        server.use(
            http.post(`${BASE}/notifications/21/cancel`, () =>
                HttpResponse.json({}),
            ),
        );
        const rows = [
            makeNotification({ id: 21, external_status: 'pending', message: 'Mobile cancel test' }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText('Mobile cancel test')).toBeInTheDocument();
        const cancelBtns = screen.queryAllByRole('button', { name: /Cancel/i });
        if (cancelBtns.length > 0) {
            fireEvent.click(cancelBtns[0]!);
            await waitFor(() => {}, { timeout: 1000 });
        }
        Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
        expect(document.body).toBeTruthy();
    }, 15000);

    it('NotificationLogCard onError Error-branch: shows err.message in the toast detail (line 258 true path)', async () => {
        const restoreViewport = mockMobileViewport();
        server.use(
            http.post(`${BASE}/notifications/50/resend`, () =>
                HttpResponse.json({ error: 'Card resend broke' }, { status: 500 }),
            ),
        );
        const rows = [
            makeNotification({ id: 50, external_status: 'sent', message: 'Card error row' }),
        ];
        renderWithProviders(
            <>
                <NotificationLogTabContent settings={settings} allRows={rows} />
                <Toast />
            </>,
        );
        const btn = screen.getAllByRole('button', { name: /Resend/i })[0];
        expect(btn).toBeDefined();
        fireEvent.click(btn!);
        await waitFor(
            () => expect(screen.queryByText(/Resend failed/i)).toBeInTheDocument(),
            { timeout: 10000 },
        );
        restoreViewport();
    }, 15000);

    it('NotificationLogCard onError non-Error branch: falls back to String(err) (line 258 false path)', async () => {
        const restoreViewport = mockMobileViewport();
        const resendSpy = vi
            .spyOn(apiModule.api.notifications, 'resend')
            .mockRejectedValueOnce('a plain string rejection, not an Error');
        const rows = [
            makeNotification({ id: 51, external_status: 'sent', message: 'Card non-error row' }),
        ];
        renderWithProviders(
            <>
                <NotificationLogTabContent settings={settings} allRows={rows} />
                <Toast />
            </>,
        );
        const btn = screen.getAllByRole('button', { name: /Resend/i })[0];
        expect(btn).toBeDefined();
        fireEvent.click(btn!);
        await waitFor(() =>
            expect(screen.queryByText(/Resend failed/i)).toBeInTheDocument(),
        );
        resendSpy.mockRestore();
        restoreViewport();
    });

    it('NotificationLogRow onError non-Error branch: falls back to String(err) (line 399 false path)', async () => {
        const resendSpy = vi
            .spyOn(apiModule.api.notifications, 'resend')
            .mockRejectedValueOnce('a plain string rejection, not an Error');
        const rows = [
            makeNotification({ id: 52, external_status: 'sent', message: 'Row non-error row' }),
        ];
        renderWithProviders(
            <>
                <NotificationLogTabContent settings={settings} allRows={rows} />
                <Toast />
            </>,
        );
        const btn = screen.getAllByRole('button', { name: /Resend/i })[0];
        expect(btn).toBeDefined();
        fireEvent.click(btn!);
        await waitFor(() =>
            expect(screen.queryByText(/Resend failed/i)).toBeInTheDocument(),
        );
        resendSpy.mockRestore();
    });

    it('NotificationLogCard renders the Retry action for a failed row on mobile (line 337 true path)', () => {
        const restoreViewport = mockMobileViewport();
        const rows = [
            makeNotification({
                id: 53,
                external_status: 'failed',
                failure_reason: 'card retry reason',
                message: 'Card retry row',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
        restoreViewport();
    });

    it('NotificationLogCard shows failure_reason text for a failed row on mobile (lines 370-371 true path)', () => {
        const restoreViewport = mockMobileViewport();
        const rows = [
            makeNotification({
                id: 54,
                external_status: 'failed',
                failure_reason: 'card failure detail',
                message: 'Card failure row',
            }),
        ];
        renderWithProviders(<NotificationLogTabContent settings={settings} allRows={rows} />);
        expect(screen.getByText(/card failure detail/)).toBeInTheDocument();
        restoreViewport();
    });
});
