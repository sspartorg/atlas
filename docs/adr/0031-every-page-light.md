# 0031. Every Page Light: Compressed API, Self-Hosted Fonts, Per-Route Budgets

**Date:** 2026-10-14
**Status:** Accepted — supersedes the total-app budget in 0030 (decision 6)

## Context

ADR 0030 cut the dashboard's cold load by two thirds. Measuring **every** route the same way — `scripts/perf-stack.sh` (production build, the 2,100-task `atlas_perf` seed), Lighthouse "slow 4G" (1.6 Mbps, 150 ms RTT), 4x CPU, 390 px phone, fresh browser per page — showed the rest of the app was far heavier:

| Route | Cold download | Network idle | Cause |
| --- | --- | --- | --- |
| `/terminal` | 3,820 KB | 20.1 s | `GET /api/issues/tree` for every project, from an always-mounted dialog, then discarded |
| `/projects/:id` | 1,965 KB | 11.3 s | 1.2 MB issue tree |
| `/tasks`, `/projects` | 1,420 KB | 8.4 s | `GET /api/tasks` 888 KB; agent list with prompts 154 KB |
| `/agents/:id` | 627 KB | 4.8 s | the Performance tab's charting library loaded on the Overview tab |

Three causes applied to every page: **the API compressed nothing** (`/api/tasks` was 888 KB on the wire and 26 KB gzipped); the agent list sent every prompt to pages that show none; and on phones the task list rendered all 2,100 cards (33,460 DOM nodes, 3.2 s of main thread at 4x CPU).

## Decision

1. **Compress API responses** (`packages/api/src/plugins/compression.ts`): JSON/text bodies over 1 KB, Brotli q4 or gzip by `Accept-Encoding`, via `node:zlib` in an `onSend` hook. Streams and the hijacked SSE route are untouched.
2. **Self-host fonts** (`scripts/fetch-fonts.mjs` → `src/assets/fonts/`, `src/theme/fonts.css`): Inter, JetBrains Mono and the Material Symbols subset, with Google's unicode-range subsets kept. No third-party origin; fonts are hashed `/assets` files, cached immutable. `icons.test.ts` fails while the font and `ICONS` disagree.
3. **No font preloads.** Measured: preloading Inter + icons made content appear 0.5 s *later* on slow 4G (they compete with the JS that has to run first); preloading the icon font alone, 0.1 s later. Text swaps in; icons arrive before content.
4. **Start the route with the settings fetch**: `RouteGuard` renders the route hidden (inside a fixed wrapper, so it is revealed, never remounted) while `/api/settings` loads, so the page's code and API calls no longer wait for it.
5. **Agent lists without prompts by default**: `useAgents()` reads `GET /api/agents?view=summary`; `useAgentsWithPrompts()` serves the Agents page and Search, the only readers of `prompt_md`.
6. **Load what the screen shows**: AgentDetail's non-default tabs and its dialogs are lazy; the dashboard's empty state is lazy; `StartSessionDialog` fetches the issue tree only while open and scoped to a project; phone lists (tasks, unassigned queue, project history) render 50 rows at a time (`components/ShowMore.tsx`); the header mascot waits until no query is in flight.
7. **Budget each route's first visit** (`check-bundle-budget.mjs`, from `dist/.vite/manifest.json`): startup chunks + the route's static import graph ≤ **290 KB gz**, with named exceptions for routes that carry a heavy library on purpose — the workflow canvas (≤ 480 / 450 KB), the chart routes (≤ 365–375 KB), the terminal session routes (≤ 345–360 KB). The total-app budget is dropped: it summed chunks no visit downloads and grew whenever code moved out of a page into a lazy chunk. The startup budget (230 KB) stays.

## Result

Same profile, cold load (total download / network idle):

| Route | Before | After |
| --- | --- | --- |
| `/terminal` | 3,820 KB / 20.1 s | 393 KB / 3.5 s |
| `/projects/:id` | 1,965 KB / 11.3 s | 543 KB / 4.9 s |
| `/tasks` | 1,420 KB / 8.4 s | 428 KB / 3.7 s |
| `/projects` | 1,418 KB / 8.3 s | 425 KB / 3.6 s |
| `/agents/agent-ai-news/runs/:id` (big log) | 1,259 KB / 7.8 s | 410 KB / 3.6 s |
| `/agents` | 1,014 KB / 6.5 s | 485 KB / 4.3 s |
| `/queue` | 875 KB / 5.6 s | 405 KB / 3.5 s |
| `/agents/:id` | 627 KB / 4.8 s (LCP 3.9 s) | 418 KB / 4.0 s (LCP 2.6 s) |
| `/` | 402 KB / 3.5 s | 400 KB / 3.4 s (LCP 2.2 s) |

Every measured route now downloads 355–543 KB cold; repeat visits move only API data (2–125 KB).

## Not done

- **`IIssueTreeResponse.agents`** (156 KB raw per project page, read by nothing in web or MCP) and the duplicated **`tasks`** list need a change to `@atlas/shared` — an Owner decision.
- **HTTP/2.** `vite preview` speaks HTTP/1.1: six connections, and a cold page makes 30–65 requests. A TLS reverse proxy (Caddy/nginx) in front would remove most of the remaining request queueing.
