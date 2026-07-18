# 0005. SSE-First Freshness

**Date:** 2026-05-11
**Status:** Accepted

## Context

Atlas's UI surfaces nearly every entity in the system on multiple pages simultaneously: the sidenav badges, the dashboard KPIs, the queue page, the agent detail tabs, the epic / story / bug detail pages, the activity log. A user editing a story title must see the new title reflected on the sidenav, the parent epic's children list, and the queue page within milliseconds — not on the next poll interval.

Polling at the cadence required (sub-second, across every entity the user has open) would have crushed the server. Even at five-second intervals across an Owner with twenty React Query keys live, the API would be servicing hundreds of redundant requests per minute on a working tree with zero mutations. And the polling interval becomes the visible latency for every change — a one-second poll means the average mutation visibility is half a second behind the actual write.

The architecture's options were polling, long-polling, WebSockets, and Server-Sent Events. Polling was rejected for the reasons above. WebSockets were considered but rejected: the traffic is overwhelmingly server-to-client (mutations come through REST POST/PATCH, not through the socket), WebSockets require special configuration in HTTP proxies and load balancers, and the JavaScript reconnection story is more involved than SSE's built-in `EventSource`. SSE was the right shape: a single long-lived `GET /api/events` stream, server-initiated push, no special infrastructure, native browser support.

The SSE catalogue and the rationale are documented in `.agents/api-surface.md:155` and `.agents/api-surface.md:320`. The in-memory client registry lives in `packages/api/src/routes/events.ts:5`.

## Decision

Drop periodic polling from the UI entirely. Every mutation flows back to the web as an SSE event on `GET /api/events`. The web subscribes via `useSSE()` (in `packages/web/src/hooks/useSSE.ts`) and invalidates the corresponding React Query keys when each event arrives. The only timer in the stream is a 30-second heartbeat (`routes/events.ts:31`) to keep the connection alive through proxies. React Query's `refetchOnWindowFocus` covers drift during the brief reconnect window after a server restart.

## Consequences

- Mutations reflect in the UI within the round-trip time of the SSE event, typically under 50ms on localhost.
- Server load scales with mutation rate, not with the number of open UI surfaces. A quiet day generates one event per Owner action plus the 30s heartbeats.
- A server restart drops every connected client. The web reconnects automatically; any mutations that happened during the gap are picked up by `refetchOnWindowFocus`.
- The in-memory client registry means SSE state is not horizontally scalable. If Atlas ever runs more than one API process, the registry needs to be replaced with a pub/sub bus.
- Every new entity needs a corresponding SSE event in `routes/events.ts` and a corresponding invalidation entry in `useSSE.ts`. The map is the contract; forgetting an entry leaves the UI stale.
- WebSocket-flavoured features (bidirectional chat, server-receives-from-client) are unavailable on this surface. Atlas does not need them today.
