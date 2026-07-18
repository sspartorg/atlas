import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import SendRounded from '@mui/icons-material/SendRounded';
import {
    EXTERNAL_NOTIFICATION_EVENT_KEYS,
    EXTERNAL_NOTIFICATION_EVENT_LABELS,
    type ExternalNotificationEventKey,
    type ExternalNotificationProvider,
} from '@atlas/shared';
import {
    useSettings,
    useUpdateExternalNotification,
    useUpdateNotifications,
} from '../../hooks/useSettings.js';
import { useToast } from '../../hooks/useToast.js';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { SettingsSection } from './SettingsSection.js';
import { WebPushRow } from './WebPushRow.js';

const MONO = '"JetBrains Mono", monospace';

function parseToggles(json: string): Record<string, boolean> {
    try {
        return JSON.parse(json) as Record<string, boolean>;
    } catch {
        return {};
    }
}

export function NotificationsTab() {
    const { data: settings } = useSettings();
    const updateExternal = useUpdateExternalNotification();
    const updateNotifications = useUpdateNotifications();
    const toast = useToast();

    const qc = useQueryClient();
    const [provider, setProvider] = useState<ExternalNotificationProvider>(
        settings?.external_notification_provider ?? 'telegram',
    );
    const [token, setToken] = useState(settings?.external_notification_token ?? '');
    const [chatId, setChatId] = useState(settings?.external_notification_chat_id ?? '');
    const [webhookUrl, setWebhookUrl] = useState(settings?.external_notification_webhook_url ?? '');
    const [showToken, setShowToken] = useState(false);
    const [showWebhook, setShowWebhook] = useState(false);
    const [testing, setTesting] = useState(false);
    // Batch-9 audit (enterprise-secrets read model): GET /api/settings
    // returns `external_notification_token` and `_webhook_url` as null
    // regardless of storage state. The `_set` booleans tell the UI
    // whether a value is stored; these transient state slots hold the
    // one-shot reveal returned by the dedicated reveal endpoints. Both
    // clear after 30s (see the effect below).
    const [revealedToken, setRevealedToken] = useState<string | null>(null);
    const [revealedWebhook, setRevealedWebhook] = useState<string | null>(null);
    const tokenIsStored = Boolean(
        (settings as unknown as { external_notification_token_set?: boolean } | undefined)
            ?.external_notification_token_set,
    );
    const webhookIsStored = Boolean(
        (settings as unknown as { external_notification_webhook_url_set?: boolean } | undefined)
            ?.external_notification_webhook_url_set,
    );

    useEffect(() => {
        if (revealedToken === null) return;
        const t = setTimeout(() => setRevealedToken(null), 30_000);
        return () => clearTimeout(t);
    }, [revealedToken]);
    useEffect(() => {
        if (revealedWebhook === null) return;
        const t = setTimeout(() => setRevealedWebhook(null), 30_000);
        return () => clearTimeout(t);
    }, [revealedWebhook]);

    async function handleRevealToken(): Promise<void> {
        try {
            const res = await api.settings.revealExternalNotificationToken();
            setRevealedToken(res.value);
        } catch (err) {
            toast.show({
                message: 'Could not reveal token',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async function handleRevealWebhook(): Promise<void> {
        try {
            const res = await api.settings.revealExternalNotificationWebhookUrl();
            setRevealedWebhook(res.value);
        } catch (err) {
            toast.show({
                message: 'Could not reveal webhook URL',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // Pill state is derived from settings — survives reload, resets to "Untested"
    // whenever the user edits the token or chat ID (cleared in the service).
    const lastTestOk = settings?.external_notification_last_test_ok;
    const endpointLabel = settings?.external_notification_endpoint_label ?? null;
    const connection: 'unknown' | 'ok' | 'bad' =
        lastTestOk === 1 ? 'ok' : lastTestOk === 0 ? 'bad' : 'unknown';
    const connectionDetail =
        connection === 'ok'
            ? endpointLabel
                ? `Connected · ${endpointLabel}`
                : 'Connected · message delivered'
            : '';

    useEffect(() => {
        if (!settings) return;
        setProvider(settings.external_notification_provider ?? 'telegram');
        setToken(settings.external_notification_token ?? '');
        setChatId(settings.external_notification_chat_id ?? '');
        setWebhookUrl(settings.external_notification_webhook_url ?? '');
    }, [settings]);

    function commitProvider(next: ExternalNotificationProvider) {
        if (next === (settings?.external_notification_provider ?? 'telegram')) return;
        setProvider(next);
        updateExternal.mutate(
            { external_notification_provider: next },
            { onSuccess: () => toast.show({ message: `Provider set to ${providerLabel(next)}` }) },
        );
    }

    function commitWebhookUrl() {
        // Batch-9 enterprise-secrets read model: settings.external_notification_webhook_url
        // is ALWAYS null from the wire, so local `webhookUrl` seeded via
        // the useEffect below is ALSO always ''. Sending null when the
        // user hasn't typed a new value would DESTROY the stored ciphertext.
        // Only fire the write when the Owner has actually typed a new URL.
        const trimmed = webhookUrl.trim();
        if (trimmed.length === 0) return;
        updateExternal.mutate(
            { external_notification_webhook_url: trimmed },
            { onSuccess: () => toast.show({ message: 'Webhook URL saved' }) },
        );
    }

    // Button is enabled when there is anything to test — either the user
    // just typed a value in the input (local state) OR the server has one
    // stored (the `_set` booleans exposed by the Batch-9 read-model). The
    // local-state slots for `token` and `webhookUrl` are always empty on
    // page load because GET /api/settings redacts those two fields; without
    // the OR-on-stored fallback, the button stayed disabled forever after
    // the audit landed even when a value was actually saved.
    // `chatId` is not a secret, so it round-trips normally on GET.
    const canTest =
        provider === 'telegram'
            ? (!!token.trim() || tokenIsStored) && !!chatId.trim()
            : !!webhookUrl.trim() || webhookIsStored;

    const toggles = useMemo(
        () => parseToggles(settings?.external_notification_event_toggles ?? '{}'),
        [settings?.external_notification_event_toggles]
    );

    function isToggled(key: ExternalNotificationEventKey): boolean {
        // Most events default ON unless the Owner explicitly toggled off.
        // `terminal.waiting_for_input` defaults OFF (high-volume opt-in)
        // and requires an explicit `true` in the toggles map. Mirrors
        // shouldSendForEvent in api/services/external-notifications.ts.
        if (key === 'terminal.waiting_for_input') return toggles[key] === true;
        return toggles[key] !== false;
    }

    function setToggle(key: ExternalNotificationEventKey, value: boolean) {
        const next = { ...toggles, [key]: value };
        updateNotifications.mutate(
            { external_notification_event_toggles: next },
            { onSuccess: () => toast.show({ message: 'Notification preferences saved' }) }
        );
    }

    function commitConnection() {
        // Batch-9 enterprise-secrets read model: settings.external_notification_token
        // is ALWAYS null from the wire, so local `token` is either '' (never
        // typed / cleared after save via the useEffect above) or contains a
        // new value the user is trying to store. Sending null for a blank
        // token would DESTROY the stored ciphertext — that fires every time
        // the user commits a chat-ID edit with an untouched token field.
        // Fix: only include a field in the batch when the user has actually
        // changed it. To clear the token, the Owner must delete-and-save
        // the credential itself (a future explicit affordance).
        const trimmedToken = token.trim();
        const trimmedChatId = chatId.trim();
        const currentChatId = settings?.external_notification_chat_id ?? '';
        const patch: {
            external_notification_token?: string;
            external_notification_chat_id?: string | null;
        } = {};
        if (trimmedToken.length > 0) patch.external_notification_token = trimmedToken;
        if (trimmedChatId !== currentChatId) {
            patch.external_notification_chat_id = trimmedChatId || null;
        }
        if (Object.keys(patch).length === 0) return;
        updateExternal.mutate(patch, {
            onSuccess: () => toast.show({ message: 'Notification channel saved' }),
        });
    }

    async function handleTest() {
        setTesting(true);
        try {
            const r = await api.settings.testExternalNotification();
            // The API already persisted external_notification_last_test_ok /
            // external_notification_endpoint_label on the settings row.
            // Invalidate the settings query so the pill picks up the new state.
            await qc.invalidateQueries({ queryKey: ['settings'] });
            if (r.ok) {
                toast.show({ message: 'Test message sent' });
            } else {
                toast.show(r.error ? { message: 'Test failed', detail: r.error } : { message: 'Test failed' });
            }
        } finally {
            setTesting(false);
        }
    }

    const detectedTimezone = useMemo(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        []
    );

    // Auto-save timezone the first time the tab loads if not yet set, so the
    // quiet-hours math has a sensible default.
    useEffect(() => {
        if (settings && !settings.quiet_hours_timezone) {
            updateNotifications.mutate({ quiet_hours_timezone: detectedTimezone });
        }
    }, [settings?.id]);

    const [quietFrom, setQuietFrom] = useState(settings?.quiet_hours_from ?? '22:00');
    const [quietTo, setQuietTo] = useState(settings?.quiet_hours_to ?? '08:00');
    const quietEnabled = settings?.quiet_hours_enabled === 1;

    useEffect(() => {
        if (!settings) return;
        if (settings.quiet_hours_from) setQuietFrom(settings.quiet_hours_from);
        if (settings.quiet_hours_to) setQuietTo(settings.quiet_hours_to);
    }, [settings]);

    // Terminal idle threshold (minutes). Server stores seconds; UI prefers
    // minutes because the practical range is 1-60.
    const idleMinutesFromSettings = Math.round((settings?.terminal_idle_notify_seconds ?? 300) / 60);
    const [idleMinutes, setIdleMinutes] = useState(idleMinutesFromSettings);
    useEffect(() => {
        setIdleMinutes(idleMinutesFromSettings);
    }, [idleMinutesFromSettings]);

    function commitIdleMinutes() {
        if (idleMinutes === idleMinutesFromSettings) return;
        if (!Number.isFinite(idleMinutes) || idleMinutes < 1 || idleMinutes > 60) {
            setIdleMinutes(idleMinutesFromSettings); // revert invalid input
            return;
        }
        updateNotifications.mutate(
            { terminal_idle_notify_seconds: idleMinutes * 60 },
            { onSuccess: () => toast.show({ message: 'Idle threshold saved' }) },
        );
    }

    function commitQuiet() {
        // Skip writes when the feature is off — the inputs are disabled in
        // that state, but onBlur can still fire if the toggle flips off
        // while a field is focused.
        if (!quietEnabled) return;
        const fromOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(quietFrom);
        const toOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(quietTo);
        if (!fromOk || !toOk) return;
        updateNotifications.mutate(
            {
                quiet_hours_from: quietFrom,
                quiet_hours_to: quietTo,
                quiet_hours_timezone: settings?.quiet_hours_timezone ?? detectedTimezone,
            },
            { onSuccess: () => toast.show({ message: 'Quiet hours saved' }) }
        );
    }

    function setQuietHoursEnabled(value: boolean) {
        // Flipping ON for the first time: also seed from/to/timezone in case
        // the row was created without them so the window applies immediately.
        const patch: {
            quiet_hours_enabled: number;
            quiet_hours_from?: string;
            quiet_hours_to?: string;
            quiet_hours_timezone?: string;
        } = { quiet_hours_enabled: value ? 1 : 0 };
        if (value) {
            if (!settings?.quiet_hours_from) patch.quiet_hours_from = quietFrom;
            if (!settings?.quiet_hours_to) patch.quiet_hours_to = quietTo;
            if (!settings?.quiet_hours_timezone)
                patch.quiet_hours_timezone = detectedTimezone;
        }
        updateNotifications.mutate(patch, {
            onSuccess: () =>
                toast.show({
                    message: value ? 'Quiet hours enabled' : 'Quiet hours disabled',
                }),
        });
    }

    return (
        <Box>
            <SettingsSection
                title="External Notification Channel"
                subtitle="Delivered via the outbound provider you configure below. Switch provider to change the transport."
            >
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Row label="Provider">
                        <Select
                            size="small"
                            value={provider}
                            onChange={(e) =>
                                commitProvider(e.target.value as ExternalNotificationProvider)
                            }
                            sx={{ minWidth: 240 }}
                        >
                            <MenuItem value="telegram">Telegram</MenuItem>
                            <MenuItem value="teams">Microsoft Teams</MenuItem>
                        </Select>
                    </Row>
                    <Divider />
                    {provider === 'telegram' && (
                        <>
                            <Row label="Bot Token *">
                                <TextField
                                    fullWidth
                                    size="small"
                                    type={showToken || revealedToken !== null ? 'text' : 'password'}
                                    value={revealedToken ?? token}
                                    onChange={(e) => {
                                        // Editing clears any active reveal.
                                        setRevealedToken(null);
                                        setToken(e.target.value);
                                    }}
                                    onBlur={commitConnection}
                                    placeholder={
                                        tokenIsStored && !token
                                            ? '••••  Stored — click 🔍 to reveal, or type to replace'
                                            : '123456789:ABC-def…'
                                    }
                                    // If a revealed value is displayed, prevent
                                    // accidental edits — Owner explicitly
                                    // hides or waits for auto-mask.
                                    InputProps={{ readOnly: revealedToken !== null }}
                                    // Mono font for the visible token, system font when
                                    // masked — mono's bullets are wide and look chunky
                                    // on iOS where the input is forced to 16 px.
                                    inputProps={{
                                        style: {
                                            fontFamily: showToken ? MONO : 'inherit',
                                            fontSize: 13,
                                            letterSpacing: showToken ? 'normal' : '0.05em',
                                        },
                                    }}
                                    slotProps={{
                                        input: {
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => {
                                                            // Enterprise read model:
                                                            //   - Empty typed + stored value → fetch reveal
                                                            //   - Otherwise → toggle local show
                                                            if (tokenIsStored && !token) {
                                                                if (revealedToken !== null) {
                                                                    setRevealedToken(null);
                                                                } else {
                                                                    void handleRevealToken();
                                                                }
                                                            } else {
                                                                setShowToken((v) => !v);
                                                            }
                                                        }}
                                                        aria-label={
                                                            showToken || revealedToken !== null
                                                                ? 'Hide token'
                                                                : 'Reveal token'
                                                        }
                                                        sx={{ color: ATLAS_PALETTE.slate60 }}
                                                    >
                                                        {showToken || revealedToken !== null ? (
                                                            <VisibilityOffOutlined sx={{ fontSize: 18 }} />
                                                        ) : (
                                                            <VisibilityOutlined sx={{ fontSize: 18 }} />
                                                        )}
                                                    </IconButton>
                                                </InputAdornment>
                                            ),
                                        },
                                    }}
                                />
                            </Row>
                            <Divider />
                            <Row label="Chat ID *">
                                <TextField
                                    fullWidth
                                    size="small"
                                    value={chatId}
                                    onChange={(e) => setChatId(e.target.value)}
                                    onBlur={commitConnection}
                                    placeholder="-100123456789"
                                    inputProps={{ style: { fontFamily: MONO, fontSize: 13 } }}
                                />
                            </Row>
                            <Divider />
                        </>
                    )}
                    {provider === 'teams' && (
                        <>
                            <Row label="Webhook URL *">
                                <TextField
                                    fullWidth
                                    size="small"
                                    type={showWebhook || revealedWebhook !== null ? 'text' : 'password'}
                                    value={revealedWebhook ?? webhookUrl}
                                    onChange={(e) => {
                                        setRevealedWebhook(null);
                                        setWebhookUrl(e.target.value);
                                    }}
                                    onBlur={commitWebhookUrl}
                                    placeholder={
                                        webhookIsStored && !webhookUrl
                                            ? '••••  Stored — click 🔍 to reveal, or type to replace'
                                            : 'https://…powerautomate.com/…/triggers/manual/paths/invoke?…sig=…'
                                    }
                                    InputProps={{ readOnly: revealedWebhook !== null }}
                                    inputProps={{
                                        style: {
                                            fontFamily: showWebhook || revealedWebhook !== null ? MONO : 'inherit',
                                            fontSize: 13,
                                            letterSpacing: showWebhook || revealedWebhook !== null ? 'normal' : '0.05em',
                                        },
                                    }}
                                    slotProps={{
                                        input: {
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => {
                                                            if (webhookIsStored && !webhookUrl) {
                                                                if (revealedWebhook !== null) {
                                                                    setRevealedWebhook(null);
                                                                } else {
                                                                    void handleRevealWebhook();
                                                                }
                                                            } else {
                                                                setShowWebhook((v) => !v);
                                                            }
                                                        }}
                                                        aria-label={
                                                            showWebhook || revealedWebhook !== null
                                                                ? 'Hide webhook URL'
                                                                : 'Reveal webhook URL'
                                                        }
                                                        sx={{ color: ATLAS_PALETTE.slate60 }}
                                                    >
                                                        {showWebhook || revealedWebhook !== null ? (
                                                            <VisibilityOffOutlined sx={{ fontSize: 18 }} />
                                                        ) : (
                                                            <VisibilityOutlined sx={{ fontSize: 18 }} />
                                                        )}
                                                    </IconButton>
                                                </InputAdornment>
                                            ),
                                        },
                                    }}
                                />
                            </Row>
                            <Divider />
                        </>
                    )}
                    <Row label="Connection">
                        <Box
                            sx={{
                                display: 'flex',
                                flexDirection: { xs: 'column', sm: 'row' },
                                alignItems: { xs: 'flex-start', sm: 'center' },
                                gap: 2,
                                flexWrap: 'wrap',
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    bgcolor:
                                        connection === 'ok'
                                            ? 'rgba(49,171,70,.12)'
                                            : connection === 'bad'
                                              ? 'rgba(220,38,38,.10)'
                                              : ATLAS_PALETTE.slate08,
                                    color:
                                        connection === 'ok'
                                            ? ATLAS_PALETTE.success
                                            : connection === 'bad'
                                              ? ATLAS_PALETTE.error
                                              : ATLAS_PALETTE.slate60,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    px: 2,
                                    py: 0.5,
                                    borderRadius: '9999px',
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        bgcolor:
                                            connection === 'ok'
                                                ? ATLAS_PALETTE.success
                                                : connection === 'bad'
                                                  ? ATLAS_PALETTE.error
                                                  : ATLAS_PALETTE.slate40,
                                    }}
                                />
                                {connection === 'ok'
                                    ? connectionDetail
                                    : connection === 'bad'
                                      ? 'Not connected'
                                      : 'Untested'}
                            </Box>
                            <Button
                                variant="outlined"
                                startIcon={<SendRounded sx={{ fontSize: 14 }} />}
                                onClick={() => void handleTest()}
                                disabled={!canTest || testing}
                                sx={{ textTransform: 'none' }}
                            >
                                {testing ? 'Sending…' : 'Send Test Message'}
                            </Button>
                        </Box>
                    </Row>
                </Box>
            </SettingsSection>

            <SettingsSection
                title="Browser Push"
                subtitle="Get a native browser notification for every Atlas event on this device. No quiet hours, no filtering — wherever this browser is signed in, you'll get pinged."
            >
                <WebPushRow />
            </SettingsSection>

            <SettingsSection
                title="Per-Event Notifications"
                subtitle="Agents won't ping you for events that are switched off. In-app notifications are always created — these toggles only gate the external notification channel."
            >
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    {EXTERNAL_NOTIFICATION_EVENT_KEYS.map((key, i) => {
                        const meta = EXTERNAL_NOTIFICATION_EVENT_LABELS[key];
                        return (
                            <Box
                                key={key}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 3,
                                    py: 2,
                                    borderTop:
                                        i === 0 ? 'none' : `1px solid ${ATLAS_PALETTE.slate06}`,
                                }}
                            >
                                <Box>
                                    <Typography
                                        sx={{
                                            fontSize: 13,
                                            fontWeight: 500,
                                            color: ATLAS_PALETTE.slate,
                                        }}
                                    >
                                        {meta.title}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            color: ATLAS_PALETTE.slate60,
                                            mt: 0.25,
                                        }}
                                    >
                                        {meta.sub}
                                    </Typography>
                                </Box>
                                <Switch
                                    checked={isToggled(key)}
                                    onChange={(_, v) => setToggle(key, v)}
                                    color="success"
                                />
                            </Box>
                        );
                    })}
                </Box>
            </SettingsSection>

            <SettingsSection
                title="Quiet Hours"
                subtitle="While quiet hours are active, external notifications are silenced — even agent and MCP-driven sends. In-app notifications are still posted."
            >
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Row label="Enable">
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 3,
                            }}
                        >
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                {quietEnabled
                                    ? 'External notifications are muted between the times below.'
                                    : 'Off — external notifications deliver at any hour.'}
                            </Typography>
                            <Switch
                                checked={quietEnabled}
                                onChange={(_, v) => setQuietHoursEnabled(v)}
                                color="success"
                            />
                        </Box>
                    </Row>
                    <Divider />
                    <Row label="From">
                        <TextField
                            size="small"
                            value={quietFrom}
                            onChange={(e) => setQuietFrom(e.target.value)}
                            onBlur={commitQuiet}
                            placeholder="22:00"
                            disabled={!quietEnabled}
                            inputProps={{
                                style: { fontFamily: MONO, fontSize: 13, maxWidth: 120 },
                            }}
                            sx={{ maxWidth: 160 }}
                        />
                    </Row>
                    <Divider />
                    <Row label="To">
                        <TextField
                            size="small"
                            value={quietTo}
                            onChange={(e) => setQuietTo(e.target.value)}
                            onBlur={commitQuiet}
                            placeholder="08:00"
                            disabled={!quietEnabled}
                            inputProps={{
                                style: { fontFamily: MONO, fontSize: 13, maxWidth: 120 },
                            }}
                            sx={{ maxWidth: 160 }}
                        />
                    </Row>
                    <Divider />
                    <Row label="Time Zone">
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                opacity: quietEnabled ? 1 : 0.5,
                            }}
                        >
                            <Typography
                                sx={{ fontFamily: MONO, fontSize: 13, color: ATLAS_PALETTE.slate }}
                            >
                                {settings?.quiet_hours_timezone ?? detectedTimezone}
                            </Typography>
                            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                                (detected from system)
                            </Typography>
                        </Box>
                    </Row>
                </Box>
            </SettingsSection>

            <SettingsSection
                title="Terminal Idle Notifications"
                subtitle="When a Terminal session sees no PTY output and no keystrokes for this many minutes, Atlas fires a 'needs you' notification (in-app + web push). Lower = faster reminders, higher = fewer false alarms during long-running commands."
            >
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Row label="Threshold (minutes)">
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            <TextField
                                size="small"
                                type="number"
                                value={idleMinutes}
                                onChange={(e) => setIdleMinutes(Number(e.target.value))}
                                onBlur={commitIdleMinutes}
                                inputProps={{ min: 1, max: 60, step: 1 }}
                                sx={{ width: 90 }}
                            />
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                Valid range 1&ndash;60 min. Default 5 min.
                            </Typography>
                        </Box>
                    </Row>
                </Box>
            </SettingsSection>
        </Box>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '180px 1fr' },
                gap: { xs: 1, md: 4 },
                alignItems: { xs: 'stretch', md: 'center' },
                py: 2,
            }}
        >
            <Typography
                sx={{
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate60,
                    fontWeight: 500,
                }}
            >
                {label}
            </Typography>
            <Box sx={{ minWidth: 0 }}>{children}</Box>
        </Box>
    );
}

function Divider() {
    return <Box sx={{ borderTop: `1px solid ${ATLAS_PALETTE.slate06}` }} />;
}

function providerLabel(p: ExternalNotificationProvider): string {
    return p === 'teams' ? 'Microsoft Teams' : 'Telegram';
}
