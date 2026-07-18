import { Cron } from 'croner';
import { db } from '../db/kysely-client.js';
import type { IAgent, AgentSchedulePreset } from '@atlas/shared';
import { maybeAutoDispatch } from './agent-dispatcher.js';
import { spawnAgentRun } from './agent-runner.js';
import { remindersService } from './reminders.js';
import { refreshExpiring as refreshExpiringAppTokens } from './github-app-tokens.js';

// Theme 06: thin wrapper that calls spawnAgentRun with null item params
// for `requires_item = false` agents. Kept as a separate name so it's
// obvious at call sites that this is the freedom-mode entry.
async function spawnFreedomRun(agentId: string): Promise<string> {
    return spawnAgentRun({ agentId, issueType: null, issueId: null });
}

/**
 * Subset of IAgent that uniquely determines the next fire. Accepted by
 * `computeNextAgentSlot` so the function works with both full DB rows
 * AND just-built create-input objects.
 */
export type AgentScheduleInput = Pick<IAgent,
    | 'schedule_preset'
    | 'schedule_hours'
    | 'schedule_time_of_day'
    | 'schedule_weekdays'
    | 'schedule_day_of_month'
> & {
    /** Theme 09 — optional cron expression. When set, overrides the
     *  preset-driven math below. */
    cron_expr?: string | null;
};

// Per-agent scheduled auto-dispatch — single clock-driven poller.
// One setInterval ticks every minute, reads the DB, and dispatches agents
// whose `next_run_at` slot has arrived AND have ready items AND have
// capacity.
//
// Schedule presets (see `AgentSchedulePreset` in shared):
//   - every_n_hours: cadence is `schedule_hours` hours. The next slot is
//     anchored to the local-midnight grid via `computeNextSlot`.
//   - daily:         fires at `schedule_time_of_day` every day.
//   - weekly:        fires at `schedule_time_of_day` on the ISO weekdays
//                    listed in `schedule_weekdays`.
//   - monthly:       fires at `schedule_time_of_day` on `schedule_day_of_month`,
//                    clamped to the month's last day when needed.
// All shapes are computed by `computeNextAgentSlot`.
//
// Who owns `next_run_at`:
//
//   * **Agent create / schedule edit** (`agentsService.create`,
//     `agentsService.update`) seeds it via `computeNextAgentSlot(now, agent)`.
//   * **The dispatcher** (this file) advances it after a fire by calling
//     `computeNextAgentSlot(now, agent)` — i.e. the next slot is derived
//     from the actual fire time, not from any clock grid. An every-N-hours
//     agent that fires at 14:23 with a 3h cadence gets next slot 17:23
//     (not 18:00). A daily-at-09:00 agent that fires at 09:23 today gets
//     next slot tomorrow 09:00.
//   * **Boot does nothing.** No re-anchor at startup; the stored value
//     stays as-is. If the slot passed while the server was off and there
//     is work, the first tick fires immediately. If there's no work, the
//     agent stays "due" indefinitely — the poller just re-checks every
//     minute until items arrive.
//
// Owner rule the design follows: **"I wait only when I worked."** An agent
// that hasn't done anything for a long time and gets given work fires
// right away; an agent that just fired waits its full cadence.
//
// Logging posture: silent on uninteresting ticks. The only lines that
// print at debug level are state changes (dispatch, capacity-block). Empty
// queue is not a state change — it's the default — so it's not logged.

const POLL_INTERVAL_MS = 60_000;
const MIN_CADENCE_MS = 60_000;

// Re-read ATLAS_LOG_LEVEL on each log call so the verbosity level can be
// toggled at runtime (e.g. in tests via vi.stubEnv) without a module reload.
// Real errors still go through console.warn.
function schedLog(msg: string): void {
    const lvl = (process.env['ATLAS_LOG_LEVEL'] ?? 'info').toLowerCase();
    if (lvl === 'debug' || lvl === 'trace') console.log(msg);
}

let pollerHandle: NodeJS.Timeout | null = null;
let alignHandle: NodeJS.Timeout | null = null;

/**
 * Decision shape for the freedom-mode dispatch branch in
 * `dispatchOneAgent`. Pure function, no DB / no SSE / no spawn — keeps
 * the branch unit-testable without dragging the runner stack into the
 * test setup.
 *
 *   - `not_freedom` → agent is item-driven; caller should fall through to
 *     the ready-items lookup.
 *   - `at_capacity` → freedom agent already has `concurrent_runs` queued
 *     or in-progress runs; caller should log + return without spawning.
 *   - `spawn`        → cap is clear; caller should bump `last_run_at` and
 *     call `spawnFreedomRun(agent.id)`.
 */
export type FreedomDispatchDecision =
    | { kind: 'not_freedom' }
    | { kind: 'at_capacity'; liveCount: number; cap: number }
    | { kind: 'spawn' };

export interface DecideFreedomDispatchInput {
    agent: Pick<IAgent, 'requires_item' | 'concurrent_runs'>;
    liveRunCount: number;
}

export function decideFreedomDispatch(
    input: DecideFreedomDispatchInput,
): FreedomDispatchDecision {
    if (input.agent.requires_item) {
        return { kind: 'not_freedom' };
    }
    if (input.liveRunCount >= input.agent.concurrent_runs) {
        return {
            kind: 'at_capacity',
            liveCount: input.liveRunCount,
            cap: input.agent.concurrent_runs,
        };
    }
    return { kind: 'spawn' };
}

/**
 * Strictly-future next slot for an agent's cadence, anchored at the
 * server's LOCAL midnight (00:00 in process TZ). For divisor cadences
 * (0.5/1/2/3/6/12/24 h) on a divisor-of-24h schedule, slots are
 * clock-aligned in local time: e.g. a 2h agent fires at 00:00, 02:00,
 * 04:00, ... 22:00 local. UTC-epoch anchoring would offset these by the
 * TZ fractional-hour (e.g. IST = UTC+5:30 produces slots on the half-hour),
 * which surfaced as a 30-min discrepancy in the UI.
 */
export function computeNextSlot(now: Date, scheduleHours: number): Date {
    const cadenceMs = Math.max(Math.round(scheduleHours * 3600 * 1000), MIN_CADENCE_MS);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const elapsed = now.getTime() - startOfDay.getTime();
    let nextMs = startOfDay.getTime() + (Math.floor(elapsed / cadenceMs) + 1) * cadenceMs;
    // Defensive: floor(elapsed/cadenceMs)+1 is mathematically always > elapsed
    // for integer ms inputs in the realistic (sub-day) range this function is
    // called with; exhaustive search over cadence/elapsed combinations found
    // no floating-point case where this fires. Kept as a guard rail in case
    // of extreme scheduleHours values producing a non-integer cadenceMs edge.
    /* v8 ignore next */
    if (nextMs <= now.getTime()) nextMs += cadenceMs;
    return new Date(nextMs);
}

function truncToMinute(d: Date): Date {
    const t = d.getTime();
    return new Date(t - (t % 60_000));
}

// ISO weekday: Mon=1, Tue=2, ..., Sun=7.
function isoWeekday(d: Date): number {
    const dow = d.getDay(); // 0=Sun..6=Sat
    return dow === 0 ? 7 : dow;
}

// Last day-of-month (1-31) for the local-time year/month of `d`.
function lastDayOfMonth(d: Date): number {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// A09 — fetch the global IANA TZ string for cron interpretation. Returns
// `undefined` (not 'UTC') when unset so Croner falls back to the process
// timezone — which is what local-first Atlas installs want.
export async function getSchedulingTimezone(): Promise<string | undefined> {
    const row = await db
        .selectFrom('settings')
        .select('quiet_hours_timezone')
        .where('id', '=', 1)
        .executeTakeFirst();
    return row?.quiet_hours_timezone ?? undefined;
}

function parseTimeOfDay(s: string): { h: number; m: number } {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
    if (!m) throw new Error(`invalid schedule_time_of_day: ${s}`);
    return { h: Number(m[1]), m: Number(m[2]) };
}

/**
 * Returns the strictly-future next fire time for an agent, anchored in
 * the process-local timezone. Dispatches on `schedule_preset`:
 *
 *   - every_n_hours: identical to `computeNextSlot(now, schedule_hours)`.
 *   - daily:         today at `time_of_day`, or tomorrow if already past.
 *   - weekly:        walk forward day-by-day; first day whose ISO weekday
 *                    is in `weekdays` AND whose `time_of_day` is strictly
 *                    future.
 *   - monthly:       day_of_month clamped to the month's last day, at
 *                    `time_of_day`. If that's not future, advance month-
 *                    by-month re-clamping until a future slot is found.
 *
 * Throws when required fields are missing or invalid for the chosen
 * preset — the caller (tickAgentScheduler) catches per-agent errors so a
 * single bad row doesn't kill the loop.
 */
export function computeNextAgentSlot(
    now: Date,
    agent: AgentScheduleInput,
    timezone?: string,
): Date {
    // Theme 09 — cron expression wins when set. The seeded ai-news
    // agent uses '0 9 * * *' for the 09:00 user-local daily digest;
    // custom autonomous agents can use any croner-compatible expr.
    //
    // A09 — when `timezone` is set, Croner interprets the cron in that
    // IANA TZ rather than the process-local zone. Callers fetch it from
    // `settings.quiet_hours_timezone` via `getSchedulingTimezone()`
    // below; undefined preserves the original process-local behavior
    // (which is what local-first Atlas installs want).
    if (agent.cron_expr && agent.cron_expr.trim()) {
        const cron = new Cron(
            agent.cron_expr.trim(),
            timezone ? { paused: true, timezone } : { paused: true },
        );
        const next = cron.nextRun(now);
        if (!next) throw new Error(`cron_expr "${agent.cron_expr}" has no future fire`);
        return next;
    }
    const preset: AgentSchedulePreset = agent.schedule_preset;
    if (preset === 'every_n_hours') {
        if (!agent.schedule_hours || agent.schedule_hours <= 0) {
            throw new Error('every_n_hours requires schedule_hours > 0');
        }
        return computeNextSlot(now, agent.schedule_hours);
    }
    if (!agent.schedule_time_of_day) {
        throw new Error(`${preset} requires schedule_time_of_day`);
    }
    const { h, m } = parseTimeOfDay(agent.schedule_time_of_day);

    if (preset === 'daily') {
        const candidate = new Date(now);
        candidate.setHours(h, m, 0, 0);
        if (candidate.getTime() <= now.getTime()) {
            candidate.setDate(candidate.getDate() + 1);
        }
        return candidate;
    }

    if (preset === 'weekly') {
        const weekdays = agent.schedule_weekdays;
        if (!weekdays || weekdays.length === 0) {
            throw new Error('weekly requires schedule_weekdays (1+ ISO weekdays)');
        }
        const set = new Set(weekdays);
        // Walk forward up to 8 days (covers today + a full week).
        for (let offset = 0; offset < 8; offset++) {
            const candidate = new Date(now);
            candidate.setDate(candidate.getDate() + offset);
            candidate.setHours(h, m, 0, 0);
            if (set.has(isoWeekday(candidate)) && candidate.getTime() > now.getTime()) {
                return candidate;
            }
        }
        // Defensive — with at least one valid weekday in the set we must
        // find a match within 7 days.
        throw new Error('weekly: no future slot found within 8 days');
    }

    // monthly
    const dom = agent.schedule_day_of_month;
    if (!dom || dom < 1 || dom > 31) {
        throw new Error('monthly requires schedule_day_of_month (1..31)');
    }
    // Try this month first. If the clamped slot is in the future, return it.
    // Otherwise step month-by-month (re-clamping each time) — at most 12 iters
    // to bound the search.
    for (let monthOffset = 0; monthOffset < 13; monthOffset++) {
        const candidate = new Date(
            now.getFullYear(),
            now.getMonth() + monthOffset,
            1,
            h,
            m,
            0,
            0,
        );
        // Clamp day-of-month to the month's actual last day.
        const last = lastDayOfMonth(candidate);
        candidate.setDate(Math.min(dom, last));
        if (candidate.getTime() > now.getTime()) return candidate;
    }
    throw new Error('monthly: no future slot found within 13 months');
}

async function dispatchOneAgent(agent: IAgent, now: Date): Promise<void> {
    // Theme 06: freedom-mode agents (`requires_item = false`) run on
    // schedule without a queued item. The scheduler doesn't try to find
    // a `ready` item for them; it just dispatches a single run per tick
    // (capped by concurrent_runs). Their `agent_runs` row has
    // `item_id = null`; the prompt builder renders a freedom-run preamble.
    // The branch decision is in `decideFreedomDispatch` — pure helper so
    // the predicate is unit-testable without the DB.
    if (!agent.requires_item) {
        const liveRows = await db
            .selectFrom('agent_runs')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('agent_id', '=', agent.id)
            .where('status', 'in', ['queued', 'in_progress'])
            .executeTakeFirst();
        // countAll() + executeTakeFirst() always returns exactly one row (count
        // 0 for no matches, never zero rows), so `liveRows` and `liveRows.n`
        // are never null/undefined here — the `?? 0` is a defensive fallback
        // for a shape kysely's types don't statically rule out.
        /* v8 ignore next */
        const decision = decideFreedomDispatch({
            agent,
            liveRunCount: Number(liveRows?.n ?? 0),
        });
        if (decision.kind === 'at_capacity') {
            schedLog(
                `[agent-schedule] ${agent.id}: freedom-mode at capacity (${decision.liveCount}/${decision.cap}), holding`,
            );
            return;
        }
        // decision.kind === 'spawn' here — `not_freedom` is impossible
        // because we've already gated on `!agent.requires_item`.
        //
        // CAS-claim the schedule slot: the UPDATE runs with a
        // `next_run_at = <original>` guard so overlapping ticks (setInterval
        // does not wait for the previous async tick to complete) can't both
        // conclude "dispatch". Only the winning tick's UPDATE returns a row
        // — the loser sees zero rows returned and skips the spawn. This
        // closes the silent-cap-violation window in which two ticks both
        // read liveRunCount=0 and both spawnFreedomRun.
        const tz = await getSchedulingTimezone();
        const nextSlot = computeNextAgentSlot(now, agent, tz);
        const claimed = await db
            .updateTable('agents')
            .set({
                last_run_at: now.toISOString(),
                next_run_at: nextSlot.toISOString(),
            })
            .where('id', '=', agent.id)
            .where('next_run_at', '=', agent.next_run_at as string)
            .returning('id')
            .executeTakeFirst();
        if (!claimed) {
            schedLog(
                `[agent-schedule] ${agent.id}: freedom-mode claim lost to concurrent tick, skipping spawn`,
            );
            return;
        }
        schedLog(
            `[agent-schedule] ${agent.id}: freedom-mode dispatch; next fire ${nextSlot.toISOString()}`,
        );
        await spawnFreedomRun(agent.id);
        return;
    }

    // Empty queue → silent return. The agent stays "due" forever until
    // work arrives; logging this every minute is just noise.
    const ready = await db
        .selectFrom('items')
        .select(['id'])
        .where('assignee_agent_id', '=', agent.id)
        .where('status', '=', 'ready')
        .orderBy('updated_at', 'asc')
        .execute();
    if (ready.length === 0) return;

    // Capacity check — concurrent_runs is a fan-out cap, not a per-tick
    // spawn budget. If we're maxed out we leave next_run_at alone so the
    // next minute can retry once a run completes. This IS a state change
    // worth logging (someone added work but nothing fires).
    const liveRows = await db
        .selectFrom('agent_runs')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .where('agent_id', '=', agent.id)
        .where('status', 'in', ['queued', 'in_progress'])
        .executeTakeFirst();
    // Same defensive fallback as above — countAll() always yields one row.
    /* v8 ignore next */
    const liveCount = Number(liveRows?.n ?? 0);
    const capacity = Math.max(0, agent.concurrent_runs - liveCount);
    if (capacity === 0) {
        schedLog(
            `[agent-schedule] ${agent.id}: ${ready.length} item(s) ready but at capacity (${liveCount}/${agent.concurrent_runs}), holding`,
        );
        return;
    }

    // Queue has work AND we have capacity. Stamp last_run_at = now and
    // advance next_run_at to the next slot for this agent's preset BEFORE
    // spawning, so a slow CLI doesn't shift cadence and so the next
    // minute's tick doesn't re-fire this agent. The next slot is derived
    // from `now` (not the prior next_run_at), so the cadence walks
    // forward from the actual fire time — see module doc.
    const tz = await getSchedulingTimezone();
    const nextSlot = computeNextAgentSlot(now, agent, tz);
    const dispatchCount = Math.min(ready.length, capacity);
    await db
        .updateTable('agents')
        .set({
            last_run_at: now.toISOString(),
            next_run_at: nextSlot.toISOString(),
        })
        .where('id', '=', agent.id)
        .execute();

    schedLog(
        `[agent-schedule] ${agent.id}: dispatching ${dispatchCount} of ${ready.length} ready item(s); next fire ${nextSlot.toISOString()}`,
    );

    for (const item of ready.slice(0, capacity)) {
        const result = await maybeAutoDispatch(item.id);
        if (result.dispatched) {
            schedLog(
                `[agent-schedule] dispatched ${agent.id} -> ${item.id} (run ${result.runId})`,
            );
        } else {
            schedLog(
                `[agent-schedule] skip dispatch ${agent.id} -> ${item.id}: ${result.reason}`,
            );
        }
    }
}

/**
 * One pass of the poll loop. Exported for tests.
 *
 *   1. Seed `next_run_at` for any active eligible agent that has none
 *      (one-time correction for agents that predate this scheduler).
 *   2. Find agents whose `next_run_at <= now` (minute precision).
 *   3. For each, run capacity → queue → dispatch.
 */
export async function tickAgentScheduler(): Promise<void> {
    const now = truncToMinute(new Date());
    const nowIso = now.toISOString();

    // F-001 — sweep stuck runs before the dispatch phase. A run is
    // "stuck" if it's still in_progress, started >30 minutes ago, and
    // has accumulated zero output_text — which means the CLI never
    // streamed anything (subprocess died silently, network broken,
    // postgres bounce dropped the handle, etc.). Forensic /goal sweep
    // observed this on MON-7's first PO Writer dispatch (run d1cf7b22)
    // where the run stayed in_progress for 13+ min with null output
    // and cancelRun reported `killedSubprocess: false` — the
    // orchestrator had no subprocess registered.
    try {
        const swept = await sweepStuckRuns();
        if (swept > 0) schedLog(`[stuck-run-watchdog] errored ${swept} stuck run(s)`);
    } catch (err) {
        // Defensive: sweepStuckRuns only issues a SELECT + per-row UPDATE
        // against a stable schema, so this branch has no realistic trigger
        // in tests short of injecting a DB fault. Kept so a genuine outage
        // (connection drop mid-sweep) can't take down the whole tick.
        /* v8 ignore next 3 */
        schedLog(
            `[stuck-run-watchdog] tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // Theme 07 — fire any due reminders before agent dispatch. Cheap to run
    // every minute (single indexed query on next_fire_at), and keeps
    // delivery latency bounded by the same tick interval the agents use.
    try {
        const fired = await remindersService.fireDueReminders(now);
        if (fired > 0) schedLog(`[reminders] fired ${fired} reminder(s)`);
    } catch (err) {
        schedLog(`[reminders] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Pre-warm GitHub App installation tokens that are within 15 minutes of
    // expiry. Lazy refresh in `credentialsService.getToken` still fires if
    // this loop stalls, but pre-warming keeps push/PR latency at the token
    // lookup near zero (~1ms) instead of ~200-300ms for a JWT + API round-trip.
    // Only credentials of kind='github_app' are scanned; PAT-only databases
    // pay no cost.
    try {
        const { refreshed, errors } = await refreshExpiringAppTokens(now.getTime());
        if (refreshed > 0 || errors > 0) {
            schedLog(`[github-app-tokens] refreshed=${refreshed} errors=${errors}`);
        }
    } catch (err) {
        schedLog(
            `[github-app-tokens] tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // Safety net for agents that somehow lack next_run_at. The canonical
    // setter is `agentsService.create` / `agentsService.update` — this
    // branch catches the rare case of an agent inserted via raw SQL, a
    // seed script that pre-dated this contract, or a migration row whose
    // next_run_at column wasn't populated.
    const unseeded = (await db
        .selectFrom('agents')
        .selectAll()
        .where('status', '=', 'active')
        .where('next_run_at', 'is', null)
        .execute()) as unknown as IAgent[];
    const tickTz = await getSchedulingTimezone();
    for (const a of unseeded) {
        try {
            const slot = computeNextAgentSlot(now, a, tickTz);
            await db
                .updateTable('agents')
                .set({ next_run_at: slot.toISOString() })
                .where('id', '=', a.id)
                .execute();
            schedLog(
                `[agent-schedule] ${a.id}: seeded next_run_at=${slot.toISOString()} (preset ${a.schedule_preset})`,
            );
        } catch (err) {
            console.warn(
                `[agent-schedule] ${a.id}: cannot seed next_run_at — ${(err as Error).message}`,
            );
        }
    }

    const due = (await db
        .selectFrom('agents')
        .selectAll()
        .where('status', '=', 'active')
        .where('next_run_at', 'is not', null)
        .where('next_run_at', '<=', nowIso)
        .execute()) as unknown as IAgent[];

    // No per-tick header. dispatchOneAgent logs only on a real state
    // change (dispatch or capacity-block); a tick with nothing to do is
    // silent. Avoids ~1 line/minute/agent of "still nothing" spam.
    for (const agent of due) {
        try {
            await dispatchOneAgent(agent, now);
        } catch (err) {
            // Per-agent failures must not break the whole tick. Logging
            // (not throwing) is by design: the poller is best-effort and
            // an unhandled rejection from setInterval would crash the API.
            console.warn(
                `[agent-schedule] tick failed for ${agent.id}: ${(err as Error).message}`,
            );
        }
    }
}

// F-001 — stuck-run watchdog. Called from tickAgentScheduler before
// dispatch. Threshold is intentionally generous (30 min) because some
// agent runs legitimately take ~5-10 min for spec-kit + Claude
// reasoning; only "started long ago AND zero output" is a confident
// "stuck" signal. Returns the number of runs flipped to `error` so
// the caller can log a single summary line.
export const STUCK_RUN_THRESHOLD_MS = 30 * 60 * 1000;

export async function sweepStuckRuns(): Promise<number> {
    const thresholdIso = new Date(Date.now() - STUCK_RUN_THRESHOLD_MS).toISOString();
    const stuck = await db
        .selectFrom('agent_runs')
        .select(['id'])
        .where('status', '=', 'in_progress')
        .where('started_at', '<', thresholdIso)
        .where('output_text', 'is', null)
        .execute();

    if (stuck.length === 0) return 0;

    const nowIso = new Date().toISOString();
    for (const row of stuck) {
        await db
            .updateTable('agent_runs')
            .set({
                status: 'error',
                completed_at: nowIso,
                output_text:
                    '[watchdog] run stuck: no output_text in 30 minutes — subprocess presumed dead. ' +
                    'Auto-erroring so the item can be re-dispatched. See findings F-001 in audit notes.',
            })
            .where('id', '=', row.id)
            .where('status', '=', 'in_progress') // race-safe: only flip if still in_progress
            .execute();
    }
    return stuck.length;
}

/**
 * Start the single clock-driven poller. First tick snaps to the next
 * wall-clock minute boundary so subsequent ticks land near :00 of each
 * minute (within scheduler/event-loop drift).
 */
export function startAgentSchedulerPoller(): void {
    stopAgentSchedulerPoller();

    const nowMs = Date.now();
    const nextMinuteMs = (Math.floor(nowMs / 60_000) + 1) * 60_000;
    const initialDelay = Math.max(0, nextMinuteMs - nowMs);

    const runTick = () => {
        tickAgentScheduler().catch((err) => {
            console.warn(
                `[agent-schedule] poll tick failed: ${(err as Error).message}`,
            );
        });
    };

    schedLog(
        `[agent-schedule] poller started, first tick at ${new Date(nextMinuteMs).toISOString()} ` +
            `(then every ${POLL_INTERVAL_MS / 1000}s)`,
    );

    alignHandle = setTimeout(() => {
        runTick();
        pollerHandle = setInterval(runTick, POLL_INTERVAL_MS);
        pollerHandle.unref?.();
    }, initialDelay);
    alignHandle.unref?.();
}

export function stopAgentSchedulerPoller(): void {
    if (alignHandle) {
        clearTimeout(alignHandle);
        alignHandle = null;
    }
    if (pollerHandle) {
        clearInterval(pollerHandle);
        pollerHandle = null;
    }
}

