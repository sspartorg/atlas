import { db } from '../db/kysely-client.js';
import { remindersService } from './reminders.js';
import { refreshExpiring as refreshExpiringAppTokens } from './github-app-tokens.js';
import { externalLinks } from './external-links.js';
import { onStepFinished, reconcileWorkflowRuns, tickWorkflowDispatch } from './workflow-engine.js';

// Single clock-driven poller. One setInterval ticks every minute and runs,
// in order: the stuck-run watchdog, due reminders, GitHub App token
// pre-warm, the workflow-run reconcile sweep, and workflow dispatch.
//
// ADR 0014 — agents no longer have schedules or queues. Workflows do: the
// engine starts runs for `item_ready` workflows whenever a ready item waits
// and for `schedule` workflows when their cron fires. Consecutive steps of a
// workflow run never wait for this tick — the engine chains them directly;
// the tick only starts new runs.
//
// Logging posture: silent on uninteresting ticks.

const POLL_INTERVAL_MS = 60_000;

function schedLog(msg: string): void {
    const lvl = (process.env['ATLAS_LOG_LEVEL'] ?? 'info').toLowerCase();
    if (lvl === 'debug' || lvl === 'trace') console.log(msg);
}

let pollerHandle: NodeJS.Timeout | null = null;
let alignHandle: NodeJS.Timeout | null = null;

/** One pass of the poll loop. Exported for tests. */
export async function tickAgentScheduler(): Promise<void> {
    const now = new Date();

    // F-001 — a run still in_progress 30 minutes after start with zero
    // output means the CLI never streamed anything (subprocess died
    // silently, network broken, postgres bounce dropped the handle).
    try {
        const swept = await sweepStuckRuns();
        if (swept > 0) schedLog(`[stuck-run-watchdog] errored ${swept} stuck run(s)`);
    } catch (err) {
        /* v8 ignore next 3 */
        schedLog(
            `[stuck-run-watchdog] tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    try {
        const fired = await remindersService.fireDueReminders(now);
        if (fired > 0) schedLog(`[reminders] fired ${fired} reminder(s)`);
    } catch (err) {
        schedLog(`[reminders] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Pre-warm GitHub App installation tokens within 15 minutes of expiry so
    // push/PR latency at the token lookup stays near zero.
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

    try {
        const parked = await reconcileWorkflowRuns(now);
        if (parked > 0) schedLog(`[workflow-reconcile] parked ${parked} orphaned workflow run(s)`);
    } catch (err) {
        schedLog(`[workflow-reconcile] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
        await externalLinks.syncReviewedTaskPrs();
    } catch (err) {
        schedLog(`[pr-state] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
        const started = await tickWorkflowDispatch(now);
        if (started > 0) schedLog(`[workflow-dispatch] started ${started} workflow run(s)`);
    } catch (err) {
        schedLog(`[workflow-dispatch] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// F-001 — stuck-run watchdog. Threshold is generous (30 min) because some
// agent runs legitimately take ~5-10 min; only "started long ago AND zero
// output" is a confident "stuck" signal. Returns the number of runs flipped
// to `error`.
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
        const flipped = await db
            .updateTable('agent_runs')
            .set({
                status: 'error',
                completed_at: nowIso,
                output_text:
                    '[watchdog] run stuck: no output_text in 30 minutes — subprocess presumed dead. ' +
                    'Auto-erroring so the workflow can park it with the Owner.',
            })
            .where('id', '=', row.id)
            .where('status', '=', 'in_progress') // race-safe: only flip if still in_progress
            .executeTakeFirst();
        // This path never reaches errorRun, so report the step directly or
        // its workflow run would wait for a step that is already dead.
        if (Number(flipped.numUpdatedRows ?? 0) > 0) await onStepFinished(row.id);
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
            console.warn(`[agent-schedule] poll tick failed: ${(err as Error).message}`);
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
