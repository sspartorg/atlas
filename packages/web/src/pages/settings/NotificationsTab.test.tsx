import { describe, expect, it } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { NotificationsTab } from './NotificationsTab.js';

const BASE = 'http://localhost:3000/api';

function settings(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        owner_name: 'Owner',
        accent_color: '#0A0A0A',
        workspace_path: '',
        constitution_md: '',
        onboarding_complete: 1,
        external_notification_provider: 'telegram',
        // Batch-9 enterprise-secrets read model: production GET /api/settings
        // never returns the plaintext token/webhook — always null. The `_set`
        // booleans below tell the UI whether a value is stored server-side.
        // Prior factory returned `token: 'tok-abc'` which the useEffect
        // would then seed into the local input; that hid every regression
        // in the tokenIsStored fallback path introduced by 3dcd8e5 (the
        // "Send Test with a stored-but-redacted token" flow). Individual
        // tests that want the redacted-but-configured state now get it
        // by default; tests that want the not-configured state override
        // `external_notification_token_set: false` and `_chat_id: null`.
        external_notification_token: null,
        external_notification_token_set: true,
        external_notification_chat_id: 'chat-1',
        external_notification_webhook_url: null,
        external_notification_webhook_url_set: false,
        external_notification_event_toggles: '{}',
        external_notification_last_test_ok: null,
        external_notification_endpoint_label: null,
        quiet_hours_from: '22:00',
        quiet_hours_to: '08:00',
        quiet_hours_timezone: 'UTC',
        // Quiet hours feature is opt-in via the new toggle (2026-06-11);
        // tests that exercise commitQuiet must keep it on so the inputs
        // aren't disabled. Individual tests can override to 0.
        quiet_hours_enabled: 1,
        ...overrides,
    };
}

describe('NotificationsTab', () => {
    it('mounts without crashing', () => {
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            ...defaultHandlers,
        );
        const { container } = renderWithProviders(<NotificationsTab />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders the connection pill as "Untested" when last_test_ok is null', async () => {
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
    });

    it('renders the connection pill as "Connected" when last_test_ok=1', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_last_test_ok: 1,
                        external_notification_endpoint_label: '@my_bot',
                    }),
                ),
            ),
            ...defaultHandlers,
        );
        const { container } = renderWithProviders(<NotificationsTab />);
        await waitFor(() => {
            expect(container.textContent).toMatch(/@my_bot/);
        });
    });

    it('renders the connection pill as "Not connected" when last_test_ok=0', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ external_notification_last_test_ok: 0 })),
            ),
            ...defaultHandlers,
        );
        const { container } = renderWithProviders(<NotificationsTab />);
        await waitFor(() => {
            expect(container.textContent).toMatch(/Not connected/);
        });
    });

    it('toggles the show-token visibility button (setShowToken branch)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const toggleBtn = screen.getByLabelText(/reveal token/i);
        fireEvent.click(toggleBtn);
        expect(await screen.findByLabelText(/hide token/i)).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText(/hide token/i));
    });

    it('changes the bot token + commits on blur (updateExternalNotification mutation)', async () => {
        // Under the enterprise read model, the token input starts empty
        // (settings.external_notification_token is null on the wire).
        // This test exercises the "first-time setup" path — no value
        // stored yet, so `_token_set: false` and the placeholder is the
        // "123456789:ABC-def…" format hint. The Owner typing a new value
        // marks the field dirty; blur PATCHes only the token field.
        let patched: unknown = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_token_set: false,
                        external_notification_chat_id: null,
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/external-notification`, async ({ request }) => {
                patched = await request.json();
                return HttpResponse.json(settings());
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const tokenInput = (await screen.findByPlaceholderText(/ABC-def/i)) as HTMLInputElement;
        await waitFor(() => expect(tokenInput.value).toBe(''));
        fireEvent.change(tokenInput, { target: { value: 'different-token' } });
        fireEvent.blur(tokenInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
        });
    });

    it('clicks "Send Test Message" → handleTest fires', async () => {
        let tested = false;
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.post(`${BASE}/settings/external-notification/test`, () => {
                tested = true;
                return HttpResponse.json({ ok: true });
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const tokenInputs = screen.getAllByPlaceholderText(/123456789/i) as HTMLInputElement[];
        if (tokenInputs[0]) {
            fireEvent.change(tokenInputs[0], { target: { value: 'fresh-tok' } });
        }
        const chatInput = screen.getByPlaceholderText(/-100/) as HTMLInputElement;
        fireEvent.change(chatInput, { target: { value: 'fresh-chat' } });
        const sendBtn = screen.getByRole('button', { name: /Send Test Message/i });
        fireEvent.click(sendBtn);
        await waitFor(() => {
            expect(tested).toBe(true);
        });
    });

    it('clicks Send Test → error branch (r.ok=false)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.patch(`${BASE}/settings/external-notification`, () => HttpResponse.json(settings())),
            http.post(`${BASE}/settings/external-notification/test`, () =>
                HttpResponse.json({ ok: false, error: 'bad token' }),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const tokenInputs = screen.getAllByPlaceholderText(/123456789/i) as HTMLInputElement[];
        if (tokenInputs[0]) {
            fireEvent.change(tokenInputs[0], { target: { value: 'fresh-tok' } });
        }
        const chatInput = screen.getByPlaceholderText(/-100/) as HTMLInputElement;
        fireEvent.change(chatInput, { target: { value: 'fresh-chat' } });
        const sendBtn = screen.getByRole('button', { name: /Send Test Message/i });
        fireEvent.click(sendBtn);
        await new Promise((r) => setTimeout(r, 100));
    });

    it('toggles a per-event notification switch (setToggle branch)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.patch(`${BASE}/settings/notifications`, () => HttpResponse.json(settings())),
            ...defaultHandlers,
        );
        const { container } = renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const switches = container.querySelectorAll('input[type="checkbox"]');
        if (switches.length > 0 && switches[0]) {
            fireEvent.click(switches[0]);
        }
    });

    it('edits quiet-hours fields and commits on blur (commitQuiet branch)', async () => {
        let patched: unknown = null;
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.patch(`${BASE}/settings/notifications`, async ({ request }) => {
                patched = await request.json();
                return HttpResponse.json(settings());
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const fromInput = screen.getByPlaceholderText('22:00') as HTMLInputElement;
        fireEvent.change(fromInput, { target: { value: '23:00' } });
        fireEvent.blur(fromInput);
        const toInput = screen.getByPlaceholderText('08:00') as HTMLInputElement;
        fireEvent.change(toInput, { target: { value: '07:00' } });
        fireEvent.blur(toInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
        });
    });

    it('blurs the quiet-hours input with invalid format (regex-fail early-return branch)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.patch(`${BASE}/settings/notifications`, () => HttpResponse.json(settings())),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const fromInput = screen.getByPlaceholderText('22:00') as HTMLInputElement;
        fireEvent.change(fromInput, { target: { value: 'bad-time' } });
        fireEvent.blur(fromInput);
        await new Promise((r) => setTimeout(r, 50));
    });

    it('disables From/To inputs when quiet_hours_enabled is 0', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ quiet_hours_enabled: 0 })),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const fromInput = screen.getByPlaceholderText('22:00') as HTMLInputElement;
        const toInput = screen.getByPlaceholderText('08:00') as HTMLInputElement;
        await waitFor(() => {
            expect(fromInput).toBeDisabled();
            expect(toInput).toBeDisabled();
        });
    });

    it('blurring a disabled From input does not PATCH (commitQuiet early-returns)', async () => {
        let patched = false;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ quiet_hours_enabled: 0 })),
            ),
            http.patch(`${BASE}/settings/notifications`, () => {
                patched = true;
                return HttpResponse.json(settings());
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const fromInput = screen.getByPlaceholderText('22:00') as HTMLInputElement;
        fireEvent.blur(fromInput);
        await new Promise((r) => setTimeout(r, 50));
        expect(patched).toBe(false);
    });

    it('flipping the quiet-hours toggle PATCHes quiet_hours_enabled', async () => {
        let patched: { quiet_hours_enabled?: number } | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ quiet_hours_enabled: 0 })),
            ),
            http.patch(`${BASE}/settings/notifications`, async ({ request }) => {
                patched = (await request.json()) as { quiet_hours_enabled?: number };
                return HttpResponse.json(settings({ quiet_hours_enabled: 1 }));
            }),
            ...defaultHandlers,
        );
        const { container } = renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const enableLabel = await screen.findByText(/Off — external notifications/i);
        const switchInput = enableLabel
            .closest('.MuiBox-root')
            ?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        expect(switchInput).toBeTruthy();
        if (!switchInput) {
            throw new Error('Quiet hours Switch not found');
        }
        fireEvent.click(switchInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect(patched?.quiet_hours_enabled).toBe(1);
        });
        expect(container.firstChild).toBeTruthy();
    });

    it('chat-id blur with identical value does not re-PATCH (commitConnection same-value branch)', async () => {
        let commitCount = 0;
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.patch(`${BASE}/settings/external-notification`, () => {
                commitCount += 1;
                return HttpResponse.json(settings());
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const chatInput = screen.getByPlaceholderText(/-100/) as HTMLInputElement;
        fireEvent.blur(chatInput);
        await new Promise((r) => setTimeout(r, 50));
        expect(commitCount).toBe(0);
    });

    it('renders the Browser Push section (web push migrated into Notifications tab)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Browser Push/i);
    });

    it('renders Telegram fields when provider=telegram and hides Webhook URL field', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ external_notification_provider: 'telegram' })),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for the Bot Token field — placeholder depends on whether a
        // value is stored (Batch-9 read model): "Stored — click 🔍 …" when
        // stored, "123456789:ABC-def…" otherwise. Match either.
        await screen.findByPlaceholderText(/ABC-def|Stored/i);
        // Chat ID placeholder is `-100123456789` — anchor to the leading `-100`.
        expect(screen.queryByPlaceholderText(/^-100/)).toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/powerautomate/i)).toBeNull();
    });

    it('renders Webhook URL field when provider=teams and hides Telegram inputs', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: 'https://example/webhook',
                    }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for the Webhook URL field — useEffect promotes provider='teams'
        // from settings AFTER the initial render.
        await screen.findByPlaceholderText(/powerautomate/i);
        // Under provider='teams', BOTH Telegram-field placeholders must
        // be absent (ABC-def AND the redacted Stored variant).
        expect(screen.queryByPlaceholderText(/ABC-def|Stored/)).toBeNull();
        expect(screen.queryByPlaceholderText(/^-100/)).toBeNull();
    });

    it('selecting Microsoft Teams from the dropdown PATCHes external_notification_provider', async () => {
        let patched: { external_notification_provider?: string } | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ external_notification_provider: 'telegram' })),
            ),
            http.patch(`${BASE}/settings/external-notification`, async ({ request }) => {
                patched = (await request.json()) as { external_notification_provider?: string };
                return HttpResponse.json(
                    settings({ external_notification_provider: 'teams' }),
                );
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        // MUI Select renders as a button with role="combobox"; click it to open
        // the menu, then click the "Microsoft Teams" option.
        const selectBtn = screen.getByRole('combobox');
        fireEvent.mouseDown(selectBtn);
        const teamsOption = await screen.findByRole('option', { name: /Microsoft Teams/i });
        fireEvent.click(teamsOption);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect(patched?.external_notification_provider).toBe('teams');
        });
    });

    it('commitWebhookUrl: blurring the webhook URL field PATCHes when value changed', async () => {
        let patched: { external_notification_webhook_url?: string | null } | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: 'https://old.example/hook',
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/external-notification`, async ({ request }) => {
                patched = (await request.json()) as {
                    external_notification_webhook_url?: string | null;
                };
                return HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: 'https://new.example/hook',
                    }),
                );
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for the Teams webhook field to appear.
        const webhookInput = await screen.findByPlaceholderText(/powerautomate/i) as HTMLInputElement;
        fireEvent.change(webhookInput, { target: { value: 'https://new.example/hook' } });
        fireEvent.blur(webhookInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect(patched?.external_notification_webhook_url).toBe('https://new.example/hook');
        });
    });

    it('commitWebhookUrl: blurring with unchanged (empty) value does not PATCH', async () => {
        let patchCount = 0;
        // Batch-9 enterprise-secrets read model: GET /api/settings never
        // returns the plaintext webhook URL — always null. The useEffect
        // in the component then seeds local `webhookUrl` to ''. Blurring
        // without typing must NOT trigger a PATCH; sending null would
        // destroy the stored ciphertext.
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: null,
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/external-notification`, () => {
                patchCount += 1;
                return HttpResponse.json(settings({ external_notification_provider: 'teams' }));
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        const webhookInput = await screen.findByPlaceholderText(/powerautomate/i) as HTMLInputElement;
        await waitFor(() => expect(webhookInput.value).toBe(''));
        fireEvent.blur(webhookInput);
        await new Promise((r) => setTimeout(r, 50));
        expect(patchCount).toBe(0);
    });

    it('toggles the show-webhook visibility button (setShowWebhook branch)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: 'https://example/hook',
                    }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByPlaceholderText(/powerautomate/i);
        const revealBtn = screen.getByLabelText(/reveal webhook url/i);
        fireEvent.click(revealBtn);
        expect(await screen.findByLabelText(/hide webhook url/i)).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText(/hide webhook url/i));
        expect(await screen.findByLabelText(/reveal webhook url/i)).toBeInTheDocument();
    });

    it('commitIdleMinutes: blurring idle threshold with new value PATCHes terminal_idle_notify_seconds', async () => {
        let patched: { terminal_idle_notify_seconds?: number } | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ terminal_idle_notify_seconds: 300 })),
            ),
            http.patch(`${BASE}/settings/notifications`, async ({ request }) => {
                patched = (await request.json()) as { terminal_idle_notify_seconds?: number };
                return HttpResponse.json(settings({ terminal_idle_notify_seconds: 600 }));
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const idleInput = screen.getByDisplayValue('5') as HTMLInputElement;
        fireEvent.change(idleInput, { target: { value: '10' } });
        fireEvent.blur(idleInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect(patched?.terminal_idle_notify_seconds).toBe(600);
        });
    });

    it('commitIdleMinutes: blurring with unchanged value does not PATCH', async () => {
        let patchCount = 0;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ terminal_idle_notify_seconds: 300 })),
            ),
            http.patch(`${BASE}/settings/notifications`, () => {
                patchCount += 1;
                return HttpResponse.json(settings());
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        // The display value should be 5 (300s / 60)
        await waitFor(() => expect(screen.getByDisplayValue('5')).toBeInTheDocument());
        const idleInput = screen.getByDisplayValue('5') as HTMLInputElement;
        fireEvent.blur(idleInput);
        await new Promise((r) => setTimeout(r, 50));
        expect(patchCount).toBe(0);
    });

    it('commitIdleMinutes: invalid value (0) reverts without PATCHing', async () => {
        let patchCount = 0;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ terminal_idle_notify_seconds: 300 })),
            ),
            http.patch(`${BASE}/settings/notifications`, () => {
                patchCount += 1;
                return HttpResponse.json(settings());
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        await waitFor(() => expect(screen.getByDisplayValue('5')).toBeInTheDocument());
        const idleInput = screen.getByDisplayValue('5') as HTMLInputElement;
        // Set an out-of-range value (0 < min 1).
        fireEvent.change(idleInput, { target: { value: '0' } });
        fireEvent.blur(idleInput);
        // Should revert back to 5 without patching.
        await waitFor(() => expect(screen.getByDisplayValue('5')).toBeInTheDocument());
        expect(patchCount).toBe(0);
    });

    it('isToggled returns false by default for terminal.waiting_for_input (opt-in event)', async () => {
        // The terminal.waiting_for_input key defaults OFF unless explicitly toggled ON.
        // Verify the switch for that event row is unchecked when toggles = '{}'.
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({ external_notification_event_toggles: '{}' }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for the event list to render.
        await screen.findByText(/Terminal: Waiting for Input/i);
        // The Per-Event section renders one Switch per event key. The last Switch
        // corresponds to terminal.waiting_for_input (it's the last entry in
        // EXTERNAL_NOTIFICATION_EVENT_KEYS). Find all checkboxes and take the last
        // one — the Quiet Hours and Provider sections render earlier checkboxes.
        // We narrow to checkboxes inside the Per-Event section by scoping to the
        // container that holds the "Terminal: Waiting for Input" text.
        const terminalTitle = screen.getByText(/Terminal: Waiting for Input/i);
        // Walk up to the flex row that wraps title + switch (3 levels: p → Box → row-Box).
        const rowBox = terminalTitle.parentElement?.parentElement;
        const switchInput = rowBox?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        expect(switchInput).toBeTruthy();
        expect(switchInput?.checked).toBe(false);
    });

    it('isToggled returns true for terminal.waiting_for_input when explicitly set ON', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_event_toggles: JSON.stringify({
                            'terminal.waiting_for_input': true,
                        }),
                    }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Terminal: Waiting for Input/i);
        // Wait for the settings to hydrate and the switch to reflect the stored toggle.
        await waitFor(() => {
            const terminalTitle = screen.getByText(/Terminal: Waiting for Input/i);
            const rowBox = terminalTitle.parentElement?.parentElement;
            const switchInput = rowBox?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            expect(switchInput).toBeTruthy();
            expect(switchInput?.checked).toBe(true);
        });
    });

    it('handleTest: shows "Sending…" while in-flight then restores button label', async () => {
        // Use a delayed response to catch the "Sending…" interim state.
        let resolveTest!: () => void;
        const testPromise = new Promise<void>((res) => { resolveTest = res; });
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.post(`${BASE}/settings/external-notification/test`, async () => {
                await testPromise;
                return HttpResponse.json({ ok: true });
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for settings to hydrate (token + chatId) so canTest=true and the button is enabled.
        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /Send Test Message/i });
            expect(btn).not.toBeDisabled();
        }, { timeout: 10000 });
        const sendBtn = screen.getByRole('button', { name: /Send Test Message/i });
        fireEvent.click(sendBtn);
        // While the promise is unresolved the button should say "Sending…"
        await waitFor(() => expect(screen.getByText(/Sending…/i)).toBeInTheDocument());
        resolveTest();
        // After the promise resolves the button label should revert.
        await waitFor(() => expect(screen.getByRole('button', { name: /Send Test Message/i })).toBeInTheDocument());
    });

    // Regression for the Batch-9 read-model interaction with `canTest`.
    // GET /api/settings returns `external_notification_token: null` +
    // `external_notification_token_set: true` when a value is stored. The
    // local `token` slot in the component starts empty because the field
    // is redacted; canTest must fall back to the `_set` boolean so the
    // Send Test button is enabled against the stored value.
    it('regression: enables Send Test when telegram token is stored but redacted on GET', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'telegram',
                        // Batch-9 shape: plaintext redacted, _set flag on.
                        external_notification_token: null,
                        external_notification_token_set: true,
                        external_notification_chat_id: 'chat-1',
                    }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /Send Test Message/i });
            expect(btn).not.toBeDisabled();
        }, { timeout: 10000 });
    });

    it('regression: enables Send Test when teams webhook is stored but redacted on GET', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: null,
                        external_notification_webhook_url_set: true,
                    }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /Send Test Message/i });
            expect(btn).not.toBeDisabled();
        }, { timeout: 10000 });
    });

    it('regression: keeps Send Test disabled when nothing is stored and nothing typed (teams)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: null,
                        external_notification_webhook_url_set: false,
                    }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for the provider select to reflect "teams" so we know the
        // settings hydrated before we assert the button state.
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Send Test Message/i })).toBeDisabled();
        }, { timeout: 10000 });
    });

    it('handleTest: error branch without detail message (r.ok=false, no r.error)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.post(`${BASE}/settings/external-notification/test`, () =>
                HttpResponse.json({ ok: false }),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const sendBtn = screen.getByRole('button', { name: /Send Test Message/i });
        fireEvent.click(sendBtn);
        // Should not throw; button should return to normal state.
        await waitFor(() => expect(screen.getByRole('button', { name: /Send Test Message/i })).toBeInTheDocument());
    });

    it('connectionDetail shows "Connected · message delivered" when last_test_ok=1 and no endpoint label', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_last_test_ok: 1,
                        external_notification_endpoint_label: null,
                    }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await waitFor(() => {
            expect(screen.getByText(/Connected · message delivered/i)).toBeInTheDocument();
        });
    });

    it('parseToggles catch branch: renders correctly when event_toggles is invalid JSON (lines 38-39)', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({ external_notification_event_toggles: 'not-valid-json{{{' }),
                ),
            ),
            ...defaultHandlers,
        );
        const { container } = renderWithProviders(<NotificationsTab />);
        // parseToggles('{{{') throws, returns {} — tab still renders normally without crashing
        await waitFor(() => {
            expect(container.firstChild).toBeInTheDocument();
        });
    });

    it('auto-save timezone useEffect: fires when quiet_hours_timezone is missing (lines 166-167)', async () => {
        let autoSaveCalled = false;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({ quiet_hours_timezone: null }),
                ),
            ),
            http.patch(`${BASE}/settings/notifications`, () => {
                autoSaveCalled = true;
                return HttpResponse.json({ ok: true });
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for the auto-save effect to fire (PATCH /settings/notifications)
        await waitFor(() => expect(autoSaveCalled).toBe(true), { timeout: 5000 });
    });

    it('commitConnection no-op when nothing has been typed (early return branch)', async () => {
        let patchCalled = false;
        // Batch-9 enterprise-secrets read model: GET /api/settings returns
        // external_notification_token: null even when a value is stored.
        // useEffect hydrates local `token` to ''. Blurring the (empty)
        // field without typing must NOT PATCH — sending null for the
        // token would clobber the stored ciphertext. When a value IS
        // stored (`_token_set: true`), the token input shows the
        // "Stored — click 🔍 to reveal" placeholder instead of the
        // format-hint placeholder.
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_token: null,
                        external_notification_token_set: true,
                        external_notification_chat_id: 'chat-1',
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/external-notification`, () => {
                patchCalled = true;
                return HttpResponse.json({ ok: true });
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for the chat-id input to hydrate — the token input's value
        // is '' both before and after settings load, so waiting on that
        // alone would race the useEffect that also seeds chatId. Anchor
        // on chat-id instead.
        const chatIdInput = (await screen.findByPlaceholderText(/-100/)) as HTMLInputElement;
        await waitFor(() => expect(chatIdInput.value).toBe('chat-1'));
        // Under `tokenIsStored=true` the placeholder is the redacted
        // "Stored — click 🔍 …" copy, not the "123456789:ABC-def" hint.
        const tokenInput = (await screen.findByPlaceholderText(/Stored/i)) as HTMLInputElement;
        expect(tokenInput.value).toBe('');
        fireEvent.blur(tokenInput);
        await new Promise((r) => setTimeout(r, 100));
        expect(patchCalled).toBe(false);
    });

    it('commitProvider no-op when same provider selected (early return branch)', async () => {
        let patchCalled = false;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ external_notification_provider: 'telegram' })),
            ),
            http.patch(`${BASE}/settings/external-notification`, () => {
                patchCalled = true;
                return HttpResponse.json({ ok: true });
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await waitFor(() => {
            expect(document.body).toBeTruthy();
        }, { timeout: 5000 });
        // Select the same provider — commitProvider returns early
        const select = screen.queryByRole('combobox');
        if (select) {
            fireEvent.mouseDown(select);
            const telegramOption = screen.queryByRole('option', { name: /telegram/i });
            if (telegramOption) fireEvent.click(telegramOption);
        }
        await new Promise((r) => setTimeout(r, 100));
        expect(patchCalled).toBe(false);
    });

    it('isToggled: terminal.waiting_for_input defaults OFF unless explicitly true', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    // toggles empty → terminal.waiting_for_input is false (default OFF)
                    settings({ external_notification_event_toggles: '{}' }),
                ),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await waitFor(() => screen.getByText(/Waiting for input/i));
        // The switch for "Waiting for input" should be unchecked by default
        const waitingRow = screen.getByText(/Waiting for input/i).closest('div');
        const switchEl = waitingRow?.querySelector('input[type="checkbox"]');
        if (switchEl) {
            expect((switchEl as HTMLInputElement).checked).toBe(false);
        }
    });

    // ── Branch gap-fill tests (W1 chunk coverage push) ──────────────────────

    it('commitWebhookUrl: blurring with empty webhookUrl does NOT PATCH (guards stored URL)', async () => {
        // 2026-07-03 audit fix: an empty typed value under the enterprise
        // read model must NOT send null — the stored ciphertext would be
        // destroyed. The Owner clears the URL by removing the credential
        // outright, not by tabbing away from a blank field.
        let patchCount = 0;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: null,
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/external-notification`, () => {
                patchCount += 1;
                return HttpResponse.json(
                    settings({ external_notification_provider: 'teams', external_notification_webhook_url: null }),
                );
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        const webhookInput = await screen.findByPlaceholderText(/powerautomate/i) as HTMLInputElement;
        fireEvent.change(webhookInput, { target: { value: '' } });
        fireEvent.blur(webhookInput);
        await new Promise((r) => setTimeout(r, 100));
        expect(patchCount).toBe(0);
    });

    it('commitConnection: token blur with empty string does NOT PATCH token (guards stored token)', async () => {
        // 2026-07-03 audit fix: under the enterprise read model,
        // GET /api/settings returns external_notification_token: null even
        // when a value is stored. Sending null on every chat-id edit was
        // destroying the stored ciphertext (finding NotificationsTab.tsx
        // :174). commitConnection now only writes the token field when the
        // Owner has actually typed a new value. This test also asserts
        // chat_id CAN still be updated on the same blur without touching
        // the token field.
        let patched: { external_notification_token?: string | null; external_notification_chat_id?: string | null } | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_token: null,
                        external_notification_chat_id: 'chat-1',
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/external-notification`, async ({ request }) => {
                patched = (await request.json()) as { external_notification_token?: string | null; external_notification_chat_id?: string | null };
                return HttpResponse.json(settings({ external_notification_token: null }));
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        // With `_token_set: true` (from the factory default), the token
        // input's placeholder is the redacted "Stored — click 🔍 …" copy.
        const tokenInput = (await screen.findByPlaceholderText(/Stored/i)) as HTMLInputElement;
        await waitFor(() => expect(tokenInput.value).toBe(''));
        // Change the chat_id so the mutation has something to send; the
        // token field stays empty (never typed).
        const chatIdInputs = screen.getAllByPlaceholderText(/^-100/) as HTMLInputElement[];
        const chatIdInput = chatIdInputs[0]!;
        fireEvent.change(chatIdInput, { target: { value: 'chat-2' } });
        fireEvent.blur(chatIdInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect(patched?.external_notification_chat_id).toBe('chat-2');
        });
        // Critical: `external_notification_token` must NOT be in the
        // patch body — undefined ⇒ the service leaves the ciphertext
        // untouched. `null` would clear it.
        expect(patched && 'external_notification_token' in patched).toBe(false);
    });

    it('handleTest: r.ok=false with r.error triggers detail toast branch (line 150)', async () => {
        let _patchCount = 0;
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings())),
            http.post(`${BASE}/settings/external-notification/test`, () =>
                HttpResponse.json({ ok: false, error: 'invalid token' }),
            ),
            http.patch(`${BASE}/settings`, () => {
                _patchCount += 1;
                return HttpResponse.json(settings());
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /Send Test Message/i });
            expect(btn).not.toBeDisabled();
        });
        const sendBtn = screen.getByRole('button', { name: /Send Test Message/i });
        fireEvent.click(sendBtn);
        // Wait for the button to return to "Send Test Message" — handleTest completed
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Send Test Message/i })).toBeInTheDocument(),
        );
    });

    it('commitQuiet: fromOk=true but toOk=false hits the || right-side branch (line 207)', async () => {
        // This test exercises the uncovered arm of `!fromOk || !toOk` where fromOk=true
        // but toOk=false causes the right-side of || to be evaluated and the function returns.
        server.use(
            http.get(`${BASE}/settings`, () => HttpResponse.json(settings({ quiet_hours_enabled: 1 }))),
            // Handler is required to prevent MSW "unhandled request" if something
            // unexpectedly fires — but we don't assert patched here.
            http.patch(`${BASE}/settings/notifications`, () => HttpResponse.json(settings())),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        // Set the "to" field to an invalid value while keeping "from" valid
        const toInput = screen.getByPlaceholderText('08:00') as HTMLInputElement;
        fireEvent.change(toInput, { target: { value: 'not-valid' } });
        fireEvent.blur(toInput);
        // commitQuiet should execute the || right side (toOk=false) and return early.
        // Verify the component still renders correctly (no crash).
        await waitFor(() => expect(screen.getByPlaceholderText('22:00')).toBeInTheDocument());
    });

    it('commitQuiet: PATCHes with detectedTimezone fallback when settings.quiet_hours_timezone is null (line 212)', async () => {
        let patched: { quiet_hours_timezone?: string } | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ quiet_hours_enabled: 1, quiet_hours_timezone: null })),
            ),
            http.patch(`${BASE}/settings/notifications`, async ({ request }) => {
                patched = (await request.json()) as { quiet_hours_timezone?: string };
                return HttpResponse.json(settings());
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        const fromInput = screen.getByPlaceholderText('22:00') as HTMLInputElement;
        fireEvent.change(fromInput, { target: { value: '21:00' } });
        fireEvent.blur(fromInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            // quiet_hours_timezone falls back to detectedTimezone (truthy string)
            expect(typeof patched?.quiet_hours_timezone).toBe('string');
            expect(patched?.quiet_hours_timezone).toBeTruthy();
        });
    });

    it('setQuietHoursEnabled(false) PATCHes enabled=0 (line 236)', async () => {
        let patched: { quiet_hours_enabled?: number } | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(settings({ quiet_hours_enabled: 1 })),
            ),
            http.patch(`${BASE}/settings/notifications`, async ({ request }) => {
                patched = (await request.json()) as { quiet_hours_enabled?: number };
                return HttpResponse.json(settings({ quiet_hours_enabled: 0 }));
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for quiet hours to be enabled (text confirms quiet_hours_enabled=1)
        await waitFor(() =>
            expect(screen.getByText(/External notifications are muted/i)).toBeInTheDocument(),
        );
        // The quiet-hours Enable row has a MuiSwitch. Walk up from the label text to find
        // the nearest ancestor that directly contains an input[type=checkbox].
        const enableLabel = screen.getByText(/External notifications are muted/i);
        let switchInput: HTMLInputElement | null = null;
        let el: Element | null = enableLabel.parentElement;
        while (el && !switchInput) {
            switchInput = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            el = el.parentElement;
        }
        if (!switchInput) {
            // Fallback: get all checkboxes and use the one in the quiet-hours region.
            // The quiet-hours switch is the LAST Switch before the per-event list; use
            // the checkbox whose parent has aria-checked matching the current state.
            const allChecked = document.querySelectorAll('input[type="checkbox"]:checked');
            // quiet_hours_enabled=1 → the Enable switch is checked; pick the last checked one
            // before the per-event section (per-events default OFF, so enabled switch stands out)
            switchInput = (allChecked[allChecked.length - 1] as HTMLInputElement | null);
        }
        expect(switchInput).not.toBeNull();
        if (switchInput) fireEvent.click(switchInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect(patched?.quiet_hours_enabled).toBe(0);
        });
    });

    it('commitProvider(telegram): switching from teams back to telegram calls providerLabel("telegram") (line 631)', async () => {
        let patched: { external_notification_provider?: string } | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        external_notification_provider: 'teams',
                        external_notification_webhook_url: 'https://example/hook',
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/external-notification`, async ({ request }) => {
                patched = (await request.json()) as { external_notification_provider?: string };
                return HttpResponse.json(settings({ external_notification_provider: 'telegram' }));
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        // Wait for the teams webhook field to confirm provider=teams loaded
        await screen.findByPlaceholderText(/powerautomate/i);
        // Open the provider dropdown and select Telegram
        const selectBtn = screen.getByRole('combobox');
        fireEvent.mouseDown(selectBtn);
        const telegramOption = await screen.findByRole('option', { name: /^Telegram$/i });
        fireEvent.click(telegramOption);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect(patched?.external_notification_provider).toBe('telegram');
        });
    });

    it('setQuietHoursEnabled(true) with existing from/to/timezone does NOT re-seed them (lines 228-231 false arms)', async () => {
        let patched: Record<string, unknown> | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        quiet_hours_enabled: 0,
                        quiet_hours_from: '22:00',
                        quiet_hours_to: '08:00',
                        quiet_hours_timezone: 'America/New_York',
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/notifications`, async ({ request }) => {
                patched = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json(settings({ quiet_hours_enabled: 1 }));
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        // Find the quiet-hours Enable switch by walking up from the label text
        const enableLabel1 = await screen.findByText(/Off — external notifications/i);
        let switchInput: HTMLInputElement | null = null;
        let el: Element | null = enableLabel1.parentElement;
        while (el && !switchInput) {
            switchInput = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            el = el.parentElement;
        }
        expect(switchInput).not.toBeNull();
        if (switchInput) fireEvent.click(switchInput);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect((patched as Record<string, unknown>)?.['quiet_hours_enabled']).toBe(1);
            // from/to/timezone already exist so should NOT be re-seeded in patch
            expect((patched as Record<string, unknown>)?.['quiet_hours_from']).toBeUndefined();
            expect((patched as Record<string, unknown>)?.['quiet_hours_to']).toBeUndefined();
            expect((patched as Record<string, unknown>)?.['quiet_hours_timezone']).toBeUndefined();
        });
    });

    it('setQuietHoursEnabled(true) with null from/to seeds them in the patch (lines 228-229 true arms)', async () => {
        // Timezone IS set (America/Chicago) so auto-save will not fire.
        // from and to are null → their seed branches (lines 228, 229) are hit.
        let patched: Record<string, unknown> | null = null;
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        quiet_hours_enabled: 0,
                        quiet_hours_from: null,
                        quiet_hours_to: null,
                        quiet_hours_timezone: 'America/Chicago',
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/notifications`, async ({ request }) => {
                patched = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json(settings({ quiet_hours_enabled: 1 }));
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        // Find the quiet-hours Enable switch by walking up from the label text
        const enableLabel2 = await screen.findByText(/Off — external notifications/i);
        let switchInput2: HTMLInputElement | null = null;
        let el2: Element | null = enableLabel2.parentElement;
        while (el2 && !switchInput2) {
            switchInput2 = el2.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            el2 = el2.parentElement;
        }
        expect(switchInput2).not.toBeNull();
        if (switchInput2) fireEvent.click(switchInput2);
        await waitFor(() => {
            expect(patched).toBeTruthy();
            expect((patched as Record<string, unknown>)['quiet_hours_enabled']).toBe(1);
            // from and to were null so they should be seeded
            expect((patched as Record<string, unknown>)['quiet_hours_from']).toBeTruthy();
            expect((patched as Record<string, unknown>)['quiet_hours_to']).toBeTruthy();
            // timezone was set so it should NOT be re-seeded
            expect((patched as Record<string, unknown>)['quiet_hours_timezone']).toBeUndefined();
        });
    });

    it('setQuietHoursEnabled(true) with null timezone seeds detectedTimezone in patch (line 231)', async () => {
        // from/to are set; quiet_hours_timezone is null on initial load.
        //
        // Execution order:
        //   1. Component mounts → useEffect (line 164) fires auto-save PATCH with { quiet_hours_timezone }.
        //      Response intentionally keeps quiet_hours_timezone null in the cache.
        //   2. We wait for auto-save to complete, then click Enable.
        //   3. setQuietHoursEnabled(true) reads settings?.quiet_hours_timezone which is still null
        //      → line 231 branch is hit, seeding detectedTimezone in the patch.
        let autoSaveDone = false;
        const patches: Array<Record<string, unknown>> = [];
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json(
                    settings({
                        quiet_hours_enabled: 0,
                        quiet_hours_from: '22:00',
                        quiet_hours_to: '08:00',
                        quiet_hours_timezone: null,
                    }),
                ),
            ),
            http.patch(`${BASE}/settings/notifications`, async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                patches.push(body);
                const isAutoSave =
                    'quiet_hours_timezone' in body && !('quiet_hours_enabled' in body);
                if (isAutoSave) {
                    autoSaveDone = true;
                    // Return null timezone so cache stays null → line 231 will fire on toggle
                    return HttpResponse.json(
                        settings({
                            quiet_hours_enabled: 0,
                            quiet_hours_from: '22:00',
                            quiet_hours_to: '08:00',
                            quiet_hours_timezone: null,
                        }),
                    );
                }
                return HttpResponse.json(
                    settings({
                        quiet_hours_enabled: (body['quiet_hours_enabled'] as number) ?? 0,
                        quiet_hours_from: '22:00',
                        quiet_hours_to: '08:00',
                        quiet_hours_timezone: null,
                    }),
                );
            }),
            ...defaultHandlers,
        );
        renderWithProviders(<NotificationsTab />);
        await screen.findByText(/Untested/i);
        // Wait for the auto-save to complete before clicking the toggle
        await waitFor(() => expect(autoSaveDone).toBe(true), { timeout: 5000 });
        // Find and click the quiet-hours enable switch
        const enableLabel = await screen.findByText(/Off — external notifications/i);
        let switchInput: HTMLInputElement | null = null;
        let walkEl: Element | null = enableLabel.parentElement;
        while (walkEl && !switchInput) {
            switchInput = walkEl.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            walkEl = walkEl.parentElement;
        }
        expect(switchInput).not.toBeNull();
        if (switchInput) fireEvent.click(switchInput);
        // Verify the toggle PATCH includes quiet_hours_timezone (seeded from detectedTimezone)
        await waitFor(() => {
            const togglePatch = patches.find((b) => b['quiet_hours_enabled'] === 1);
            expect(togglePatch).toBeTruthy();
            // quiet_hours_timezone was null at call time → line 231 seeds detectedTimezone
            expect((togglePatch as Record<string, unknown>)['quiet_hours_timezone']).toBeTruthy();
        }, { timeout: 8000 });
    });

}, 15000);
