# Agent Run Detail

**Route:** `/agents/:id/runs/:runId` • **Component:** `packages/web/src/pages/AgentRunDetail.tsx` • **Slug:** `agents`

## Purpose
Full read of a single `agent_runs` row: status header, issue link card, **per-event JSON viewer** over the run's stream-json transcript, summary panel pulled from the final `result` event, and three actions — **Re-run with same inputs / Copy log / Download log**. Reached from the Runs tab on `/agents/:id` (each row navigates here) and from `RunNowDialog` after successfully starting a run.

## States
- **Loading**: centered spinner.
- **Not found**: "Run not found." when either the agent or the run row is missing.
- **Populated (queued / in_progress)**: breadcrumbs + hero + issue link card + live log panel (`<QueueLiveLog>`); master-detail viewer hidden.
- **Populated (completed / error)**: breadcrumbs + hero + issue link card + per-event JSON viewer (master-detail) + (when a `result` event landed) summary panel; live log unmounted.

## UI elements

**Breadcrumbs**
- `Agents / {agent.name} / Runs / {runId.slice(0,8)}`
- "Agents" → `/agents`, agent name → `/agents/:id`, "Runs" → `/agents/:id?tab=runs`.

**Hero**
- Short run id (mono, large).
- Status pill (Completed / In progress / Queued / Error).
- Agent name · Started {relative} · Duration {m}m {s}s.
- Action buttons (desktop, in the hero):
  - **Re-run with same inputs** → mutation: `POST /api/run` with the loaded run's `{agent_id, issue_type, issue_id}`. On success: navigate to the new run's detail.
  - **Copy log** → `navigator.clipboard.writeText(output_text)`.
  - **Download log** → Blob → anchor → click → `.log` file.

**Issue link card**
- Polymorphic link back to the issue (`/issues/{type}/{id}` for stories/bugs/sub-*; `/epics/{id}` for epics). Helps the Owner pivot from "what ran" to "what it ran on".

**Live tail (queued + in-progress)**
- While `run.status === 'queued'` or `run.status === 'in_progress'`, a `<QueueLiveLog>` panel renders in place of the master-detail viewer — the same component the Queue drawer uses for streaming output. It subscribes to `/api/events` via `useRunOutputTail(runId)`, accumulates each `agent_output` SSE line, and shows `live · agent_output` with a blinking accent dot. The panel mounts on landing (even while the run is still queued, where it shows "Waiting for output…") so there's no flicker as the runner picks the row up — the status pill flips queued → in_progress, the empty copy gives way to streaming lines, and the same DOM stays mounted throughout.
- When `run_completed` / `run_error` arrives, `useSSE` invalidates `['agent-run', runId]`, the page refetches with the now-populated `output_text`, and React unmounts the live log because `run.status` is no longer streaming — the master-detail viewer takes over without any user action.
- Cache plumbing: `useSSE` also invalidates `['agent-run', runId]` on `agent_status` events (not only `run_completed` / `run_error`), so the queued → in_progress flip refreshes the run-detail view as soon as the runner takes the row. Without that, the cached row stuck at `queued` for the page's lifetime and the user only saw content after the run finished — see B03 fix `13e91c3` / `e07f85f`.
- Hidden on `completed` / `error` (the master-detail viewer takes over).
- The user no longer has to leave the page to follow a run live (the previous behavior was master-detail-only with an "— streaming —" placeholder until `output_text` arrived post-completion).

**Per-event JSON viewer (master-detail, two-pane)**
- Two-pane master-detail layout on a dark `#0F1928` surface. Desktop (`md+`): section index on the **left** (260px), log on the **right** (fills remainder), both 540px tall, scroll independently. Mobile (`xs`): section index on **top** (≤200px), log on **bottom** (≤380px), stacked vertically.
- Claude is spawned with `--print --verbose --output-format=stream-json`, so each stdout line is a JSON event (`system/init`, `assistant` with text + tool_use, `user` with tool_result, `result` with cost + duration, plus session-lifecycle noise like `system/hook_*` and `rate_limit_event`). The viewer parses each line into a typed event and renders it in both panes.
- **Left pane — section index**: one clickable row per event. Shows a 1-based index, the typed header (color-coded), and a one-line preview pulled from the first text/tool/result block. Clicking a row **selects** that event for display in the right pane; the selected row is highlighted with a darker background + a 2px inset accent stripe in the event's color. The index auto-scrolls to keep the selected row in view (useful both for long runs and for keyboard navigation).
- **Right pane — log**: shows **only the selected event** at a time. A compact header bar at the top of the pane reads `#<idx> <type>/<subtype>` in the event's color; below it sits the pretty-printed JSON body (or the raw text for stderr/copilot lines). One event at a time keeps each payload readable instead of forcing the Owner to scroll past dozens of collapsed cards.
- **Default selection** is event #1 on landing. Resets to #1 whenever the route's `:runId` changes so navigating between runs doesn't carry the previous run's selection over.
- Header color cues by event kind: cool blue for `assistant`, amber for `user` (tool turns), green for `result`, muted red for error / hook_response, grey for the rest. The section index uses the same palette so the eye lines up across panes.
- Lines that don't parse as JSON (stderr lines prefixed `[stderr]`, plain stdout from `gh copilot`, partial NDJSON fragments) render as plain-text rows in both panes; stderr rows tint red so shell errors stand out. They're still indexed and selectable in the left pane.
- Placeholder text when no event is selectable: `— no output captured —` (completed/error with empty `output_text`) — the section index shows `no events yet` in the same case. The viewer itself is hidden during queued/in_progress (the live log panel above takes its place), so the older queued/streaming placeholders are no longer reachable.

**Summary panel**
- Below the viewer, only on `completed` / `error` runs **and only when a `type:"result"` event was emitted**. Shows the final agent wrap-up by pulling `result.result` out of that event (Claude's own natural-language summary of the turn — the same text the model would print in `--output-format=text`). Header reads **Summary** for completed runs, **Error tail** for errored runs (left border colored to match: green / red). Hidden while the run is queued/in-progress and for non-Claude CLIs (e.g. `gh copilot`) that don't emit a structured result event.

**Mobile sticky bar**
- Below `md`: hero action buttons collapse into a fixed bottom bar (Re-run + Copy log), sitting `bottomNavHeight + safe-area-inset-bottom` above the page's bottom edge so it doesn't overlap the global `BottomNav`.

## Why these affordances exist
- **Separate route (not a drawer)** — Log inspection is the second most-used action after writing prompts; giving it a URL means logs can be shared, bookmarked, and reached by deep-link. A drawer would hide everything behind a back gesture and lose its place in browser history.
- **Re-run with same inputs** — Tuning an agent often means "edit prompt → re-run on the same target". Putting the action on the run page (not just the agent page) cuts an Epic/Story pick step out of every iteration.
- **Raw stream-json over a synthesized transcript** — An earlier version of the API tried to flatten Claude's stream-json events into a single human-readable log (`[init] model=… [tool] Bash {…} [tool_result] …`). It looked tidy until you wanted to *tune* a prompt — the synthesized lines hid the model's actual reasoning, the exact tool inputs, the rate-limit pings, and the structure of `tool_result` payloads. The viewer now persists Claude's NDJSON byte-for-byte and pretty-prints each event so the Owner can read the *real* exchange and adjust constitution/prompt/tool grants based on what actually happened. Downloaded `.log` files are the same NDJSON, ready to diff between runs.
- **Per-event cards, not one big `<pre>`** — Cards keep huge events (the `system/hook_response` SessionStart payload, the encrypted `thinking.signature` blobs) collapsible without dropping them. The Owner can scan headers, expand what's interesting, ignore the rest.
- **Two-pane layout (index + log)** — A long run can produce 50+ events; even with collapsed cards, scrolling through them to find "the tool_result before the model gave up" is tedious. The section index gives a stable, glanceable list of headers so the Owner can navigate by event type and number, then jump to the card with a click. Side-by-side on desktop keeps both views on screen simultaneously; on mobile the index sits above the log so it stays reachable without horizontal real estate.

## Hooks used
- `useAgent(id)` — for the breadcrumb agent name and re-run agent id (already cached from the agents list).
- `useAgentRun(runId)` — new hook wrapping `GET /api/run/:id`.
- `useRunOutputTail(runId)` — SSE subscriber feeding the live-tail panel while `status === 'queued' || status === 'in_progress'`.
- `useMutation` (inline) for the Re-run trigger.

## API endpoints touched
- `GET /api/agents/:id`
- `GET /api/run/:runId`
- `POST /api/run` (Re-run with same inputs)

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- `output_text` may be `null` for queued or in-progress runs. The master-detail viewer is hidden in those states (the live log panel renders in its place); the hero's Copy / Download buttons still toast "Nothing to copy/download yet" because `output_text` isn't populated until the run terminates.
- `started_at` is `null` until the run is picked up by `agent-runner`; the duration label shows `—` in that case.
- Summary panel is intentionally hidden mid-run and for runs with no `result` event — Claude only emits one at the very end, and `gh copilot` doesn't emit it at all.
- Right pane shows a single event at a time (master-detail). To follow a live run, click the latest section row each time the section index grows; there's no auto-follow yet (would steal focus from a row the Owner is actively reading).
- `selectedIdx` is clamped to `events.length - 1` on render, so if a run shrinks (e.g. server replays state) the pane never points past the end. Reset to `0` whenever `:runId` changes.
- Stderr lines come in as `[stderr] <text>` (not JSON), still indexed in the left pane, and shown as plain text in the right pane with red tint. Copilot runs are entirely plain-text rows — no cards.

## Connectivity
- **Pages**: [Agent Detail](16-agent-detail.md) — entry from the Runs tab row click; [Stories / Bugs](08-issues.md) — the issue link card target.
- **Routes**: `POST /run` re-uses the same endpoint as the original spawn so re-runs follow the identical scheduling and SSE-broadcast path as the initial run.
- **Entities**: `agent_run`, `agent` (via the breadcrumb hook).

## Coming soon on this page
None.
