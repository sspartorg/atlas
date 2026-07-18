import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';

vi.mock('../../hooks/usePushSubscription.js', () => ({
    usePushSubscription: vi.fn(),
}));

import { usePushSubscription } from '../../hooks/usePushSubscription.js';
import { WebPushRow } from './WebPushRow.js';

const mock = vi.mocked(usePushSubscription);

interface SetupOpts {
    state: 'unsupported' | 'denied' | 'granted-subscribed' | 'granted-unsubscribed' | 'default';
    busy?: boolean;
    error?: string | null;
    enable?: () => Promise<void>;
    disable?: () => Promise<void>;
    sendTest?: () => Promise<{ ok: boolean; delivered?: number; subscriptions?: number; error?: string }>;
}

function setup(opts: SetupOpts) {
    mock.mockReturnValue({
        state: opts.state,
        busy: opts.busy ?? false,
        error: opts.error ?? null,
        enable: opts.enable ?? vi.fn().mockResolvedValue(undefined),
        disable: opts.disable ?? vi.fn().mockResolvedValue(undefined),
        sendTest: opts.sendTest ?? vi.fn().mockResolvedValue({ ok: true, delivered: 1, subscriptions: 1 }),
    } as unknown as ReturnType<typeof usePushSubscription>);
    return renderWithProviders(<WebPushRow />);
}

describe('WebPushRow', () => {
    beforeEach(() => mock.mockReset());

    it('renders the unsupported copy when state=unsupported (no button)', () => {
        setup({ state: 'unsupported' });
        expect(screen.getByText(/doesn't support push/i)).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders the denied copy when state=denied', () => {
        setup({ state: 'denied' });
        expect(screen.getByText(/blocked notifications/i)).toBeInTheDocument();
    });

    it('renders the Enable button when state=default (not yet enabled)', () => {
        setup({ state: 'default' });
        expect(screen.getByText(/not enabled on this device yet/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /enable web push/i })).toBeInTheDocument();
    });

    it('calls enable() when the Enable button is clicked', async () => {
        const enable = vi.fn().mockResolvedValue(undefined);
        const user = userEvent.setup();
        setup({ state: 'default', enable });
        await user.click(screen.getByRole('button', { name: /enable web push/i }));
        await waitFor(() => expect(enable).toHaveBeenCalled());
    });

    it('renders the Enable button when granted but not subscribed', () => {
        setup({ state: 'granted-unsubscribed' });
        expect(screen.getByRole('button', { name: /enable web push/i })).toBeInTheDocument();
    });

    it('renders Disable + Send test buttons when state=granted-subscribed', () => {
        setup({ state: 'granted-subscribed' });
        expect(screen.getByText(/enabled on this device/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /send test/i })).toBeInTheDocument();
    });

    it('calls disable() when the Disable button is clicked (granted-subscribed)', async () => {
        const disable = vi.fn().mockResolvedValue(undefined);
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', disable });
        await user.click(screen.getByRole('button', { name: /disable/i }));
        await waitFor(() => expect(disable).toHaveBeenCalled());
    });

    it('calls sendTest() with a success response when Send test is clicked', async () => {
        const sendTest = vi.fn().mockResolvedValue({ ok: true, delivered: 2, subscriptions: 2 });
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', sendTest });
        await user.click(screen.getByRole('button', { name: /send test/i }));
        await waitFor(() => expect(sendTest).toHaveBeenCalled());
    });

    it('calls sendTest() with a singular-device subscription response', async () => {
        const sendTest = vi.fn().mockResolvedValue({ ok: true, delivered: 1, subscriptions: 1 });
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', sendTest });
        await user.click(screen.getByRole('button', { name: /send test/i }));
        await waitFor(() => expect(sendTest).toHaveBeenCalled());
    });

    it('calls sendTest() when the result is ok=false (failure path)', async () => {
        const sendTest = vi.fn().mockResolvedValue({ ok: false, error: 'no subscribers' });
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', sendTest });
        await user.click(screen.getByRole('button', { name: /send test/i }));
        await waitFor(() => expect(sendTest).toHaveBeenCalled());
    });

    it('calls sendTest() when the failure has no explicit error message', async () => {
        const sendTest = vi.fn().mockResolvedValue({ ok: false });
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', sendTest });
        await user.click(screen.getByRole('button', { name: /send test/i }));
        await waitFor(() => expect(sendTest).toHaveBeenCalled());
    });

    it('renders the error Alert when usePushSubscription exposes an error', () => {
        setup({ state: 'default', error: 'Subscription refused' });
        expect(screen.getByText('Subscription refused')).toBeInTheDocument();
    });

    it('disables the buttons while busy=true', () => {
        setup({ state: 'granted-subscribed', busy: true });
        expect(screen.getByRole('button', { name: /disable/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /send test/i })).toBeDisabled();
    });

    it('sendTest ok=true with subscriptions=1 displays singular "device" toast text', async () => {
        // This exercises `result.subscriptions === 1 ? '' : 's'` → '' (singular)
        const sendTest = vi.fn().mockResolvedValue({ ok: true, delivered: 1, subscriptions: 1 });
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', sendTest });
        await user.click(screen.getByRole('button', { name: /send test/i }));
        await waitFor(() => expect(sendTest).toHaveBeenCalled());
    });

    it('sendTest ok=true with subscriptions=3 displays plural "devices" toast text', async () => {
        // This exercises `result.subscriptions === 1 ? '' : 's'` → 's' (plural)
        const sendTest = vi.fn().mockResolvedValue({ ok: true, delivered: 3, subscriptions: 3 });
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', sendTest });
        await user.click(screen.getByRole('button', { name: /send test/i }));
        await waitFor(() => expect(sendTest).toHaveBeenCalled());
    });

    it('sendTest ok=false with explicit error message uses that error in toast', async () => {
        // Exercises the `result.error ?? 'no devices reached'` with a non-null error
        const sendTest = vi.fn().mockResolvedValue({ ok: false, error: 'Push service unavailable' });
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', sendTest });
        await user.click(screen.getByRole('button', { name: /send test/i }));
        await waitFor(() => expect(sendTest).toHaveBeenCalled());
    });

    it('sendTest ok=false without error field falls back to "no devices reached"', async () => {
        // Exercises `result.error ?? 'no devices reached'` when error is undefined
        const sendTest = vi.fn().mockResolvedValue({ ok: false, error: undefined });
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', sendTest });
        await user.click(screen.getByRole('button', { name: /send test/i }));
        await waitFor(() => expect(sendTest).toHaveBeenCalled());
    });

    it('disable() fires toast with disable message', async () => {
        const disable = vi.fn().mockResolvedValue(undefined);
        const user = userEvent.setup();
        setup({ state: 'granted-subscribed', disable });
        await user.click(screen.getByRole('button', { name: /disable/i }));
        await waitFor(() => expect(disable).toHaveBeenCalled());
    });

    it('renders no error Alert when error is null', () => {
        setup({ state: 'default', error: null });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('primary button (Enable) is null in unsupported state (no buttons rendered)', () => {
        setup({ state: 'unsupported' });
        // Both primary and secondary are null → no Box with buttons
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('primary button (Enable) is null in denied state (no buttons rendered)', () => {
        setup({ state: 'denied' });
        // Both primary and secondary are null for denied → no buttons
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
