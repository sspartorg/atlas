/* eslint-disable */
// Atlas service worker.
//
// Plain .js (not built) and served from /public so the browser sees it at the
// root scope `/`. The build pipeline copies it verbatim into dist/ — Vite's
// public/ semantics handle this with no config change.
//
// Two responsibilities:
//   1. `push` — show the OS notification when a push lands.
//   2. `notificationclick` — focus an existing Atlas tab + navigate it to
//      the URL embedded in the payload, or open a new tab if none exist.

self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (_err) {
        payload = { title: 'Atlas', body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'Atlas';
    const options = {
        body: payload.body || '',
        icon: '/atlas.png',
        badge: '/atlas.png',
        tag: payload.notification_id != null ? String(payload.notification_id) : undefined,
        data: {
            url: payload.url || '/notifications',
            notification_id: payload.notification_id,
            kind: payload.kind,
        },
        // Higher visibility for items that need the Owner's attention.
        requireInteraction: payload.kind === 'needs_you',
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Only allow same-origin absolute paths ("/foo/bar") as notification
// targets. `client.navigate` rejects cross-origin URLs, but its catch
// falls through to `clients.openWindow(...)` which has no same-origin
// restriction — any push payload with `data.url = 'https://attacker/'`
// would open the attacker's page in a top-level browsing context on the
// Owner's click. Reject anything that isn't a same-origin absolute path.
function safeTargetUrl(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return '/notifications';
    // "/foo" but NOT "//foo" (protocol-relative) or "\foo" (weird IE
    // quirks) or "javascript:" or "data:" or "http(s)://".
    if (!/^\/(?!\/)/.test(raw)) return '/notifications';
    return raw;
}

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = safeTargetUrl(event.notification.data && event.notification.data.url);

    event.waitUntil(
        (async () => {
            const allClients = await self.clients.matchAll({
                type: 'window',
                includeUncontrolled: true,
            });
            // Prefer an existing Atlas tab — focus + navigate it so the
            // Owner doesn't drown in duplicates each time they tap.
            for (const client of allClients) {
                if ('focus' in client) {
                    try {
                        await client.focus();
                        if ('navigate' in client) {
                            await client.navigate(targetUrl);
                        }
                        return;
                    } catch (_err) {
                        // fall through to openWindow
                    }
                }
            }
            if (self.clients.openWindow) {
                await self.clients.openWindow(targetUrl);
            }
        })(),
    );
});
