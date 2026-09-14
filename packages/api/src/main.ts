import Knex from 'knex';
import { buildApp } from './server.js';
import { runSeed } from './db/seed.js';
import { bootSchedules, catchUpMissedFires } from './services/schedule-registry.js';
import { startAgentSchedulerPoller } from './services/agent-schedule-registry.js';
import { syncToolCatalog } from './services/tool-catalog-sync.js';
import { syncAgentDefaults } from './services/agent-defaults-sync.js';
import { sweepOrphanSetupTmpfiles } from './services/project-setup-runner.js';
import { runOutputRegistry } from './services/agent-runner.js';
import { onStepFinished } from './services/workflow-engine.js';
import knexConfig from './db/knex-config.js';
import { bootStep } from './utils/boot-errors.js';
import { startMcpHost, stopMcpHost, type IMcpHostHandle } from './plugins/mcp-host.js';
import { apiPort } from './config.js';

const isDev = process.env['NODE_ENV'] !== 'production';

// Node 15+ terminates the process on an unhandled promise rejection by
// default. That's a sane production stance, but it means a single bad
// fire-and-forget task (e.g. a scheduler callback hitting a missing DB
// column during a migration window) takes the whole API down — which
// then surfaces as Vite proxy 500s on every web request, masking the
// actual cause. Log + continue is the right behaviour for this dev-tool
// runtime; the W8 baseline-drift incident is the canonical case.
process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? `${reason.stack ?? reason.message}` : String(reason);
    console.error(`[api] unhandled promise rejection (kept alive): ${msg}`);
});

// CER-2 follow-up — failOrphanedRuns historically only ran as a
// bootStep, which meant a run that died mid-stream (CLI crash, agent
// exits without calling performer_done, etc.) would sit in_progress
// forever as long as the API stayed up. This timer fires the reaper on
// a fixed cadence so stranded runs get reclaimed without an API
// restart. Re-entry guard `orphanReaperRunning` prevents two fires from
// stomping each other if a cycle ever stretches past the interval.
//
// Two cadences:
//   • Tick interval = 60 s — how often the reaper *checks* for
//     stranded runs.
//   • Periodic cutoff = 30 min — runs younger than this are NEVER
//     reaped on a periodic tick, even if the in-memory registry says
//     the CLI is gone (the registry filter inside failOrphanedRuns
//     also protects them, but the cutoff is the second safety net).
//     Real Architect/QA Writer runs take 3-10 min; Coder runs can go
//     10-30 min. The 30 min floor is comfortably above those ceilings.
//
// Pre-2026-06-01 the cutoff was 60 s on the periodic path too — that
// killed CER-4 / CER-5 mid-stream when their Architect / QA Writer
// runs crossed the 60 s mark.
const ORPHAN_REAPER_INTERVAL_MS = 60_000;
const ORPHAN_REAPER_PERIODIC_CUTOFF_MS = 30 * 60_000;
const PROCESS_STARTED_AT = Date.now();
let orphanReaperTimer: NodeJS.Timeout | null = null;
let orphanReaperRunning = false;

async function migrateLatest(): Promise<void> {
    const knex = Knex(knexConfig);
    try {
        const [batch, migrations] = await knex.migrate.latest();
        if ((migrations as string[]).length > 0) {
            console.log(`[db] applied batch ${batch}:`);
            for (const m of migrations as string[]) console.log(`  - ${m}`);
        }
    } finally {
        await knex.destroy();
    }
}

// W3 ship-readiness — orphaned-run cleanup. A crash-restart leaves any
// in-flight run stuck in 'queued' or 'in_progress' forever, which strands
// the underlying item in 'in_progress' and clogs the Queue UI. Mark any
// row whose run started > cutoffMs ago and is still non-terminal as
// 'error', append a note to output_text (no error_text column exists),
// and report each to the workflow engine, which parks its workflow run.
//
// Two call sites with different cutoffMs:
//   • Boot (`cutoffMs: 60_000`): runs once during bootStep. At boot the
//     in-memory `runOutputRegistry` is empty, so every in_progress row
//     is by definition stranded from a prior process; 60 s only
//     protects a row that was mid-insert during a graceful restart.
//   • Periodic (`cutoffMs: 30 * 60_000`): runs on a setInterval during
//     normal operation. Combined with the registry skip below, only
//     genuine zombies (Node thinks the child is alive when it isn't)
//     get reaped. A 30-minute floor is comfortably above the maximum
//     expected Architect/Coder run time so healthy long runs are safe.
//
// `runOutputRegistry` membership is the live-CLI signal. The registry
// is `.set(runId, '')` in spawnCli and `.delete(runId)` in BOTH the
// close-handler AND the error-handler — so a runId stays in the map
// iff the close/error path hasn't fired yet, i.e. the spawned child
// is still alive from this process's perspective. Skip any candidate
// orphan whose runId is in the registry; never kill a live run.
//
// Pre-2026-06-01 this function used a single 60 s cutoff and ran only
// at boot; making it periodic without the registry filter killed
// healthy 60-second-plus runs mid-stream (CER-4, CER-5 incident).
async function failOrphanedRuns(opts: { cutoffMs: number }): Promise<void> {
    try {
        const cutoff = new Date(Date.now() - opts.cutoffMs).toISOString();
        const knex = Knex(knexConfig);
        try {
            const candidates = await knex('agent_runs')
                .select('id as run_id')
                .whereIn('status', ['queued', 'in_progress'])
                .andWhere('started_at', '<', cutoff);

            // Never reap a run whose CLI is still alive in this process: the
            // close handler hasn't fired, and reaping would race completeRun.
            const orphans = candidates.filter((r) => !runOutputRegistry.has(r.run_id));
            if (candidates.length > orphans.length) {
                console.log(
                    `[api] orphan reaper: skipped ${candidates.length - orphans.length} run(s) still alive in registry`,
                );
            }
            if (orphans.length === 0) return;

            const orphanRunIds = orphans.map((r) => r.run_id);
            const result = await knex('agent_runs')
                .whereIn('id', orphanRunIds)
                .whereIn('status', ['queued', 'in_progress'])
                .update({
                    status: 'error',
                    output_text: knex.raw(
                        "COALESCE(output_text, '') || ?",
                        ['\n[ERROR] API restarted before run completed'],
                    ),
                    completed_at: new Date().toISOString(),
                });
            if (result > 0) {
                console.log(`[api] orphaned runs cleaned up: ${result}`);
            }

            // ADR 0014 — the workflow engine owns the item, the worktree and
            // delivery. Reporting the dead step parks its workflow run with
            // the Owner (worktree kept, committed work intact); pushing or
            // deleting the shared worktree here would destroy other steps'
            // work.
            for (const runId of orphanRunIds) {
                await onStepFinished(runId).catch((err: unknown) => {
                    console.warn(`[api] orphan reaper: step report failed for ${runId}: ${(err as Error).message}`);
                });
            }
        } finally {
            await knex.destroy();
        }
    } catch (err) {
        console.warn(
            `[api] orphaned-run cleanup skipped: ${(err as Error).message}`,
        );
    }
}

async function main(): Promise<void> {
    await bootStep('migration', migrateLatest);
    await bootStep('seed', runSeed);
    // Boot-time reap: every in_progress row is by definition a leftover
    // from a prior process (this process just started; the registry is
    // empty), so a 60 s cutoff is the right floor — only protects rows
    // mid-insert during a graceful restart.
    await bootStep('orphan run cleanup', () => failOrphanedRuns({ cutoffMs: 60_000 }));
    // 2026-06-22 — Terminal v1. CLI sessions whose PTY died with the
    // previous process get flipped to `paused` so the Resume affordance
    // is offered. See `failOrphanedCliSessions` for the rationale.
    //
    // Load-bearing ordering: this MUST run before `app.listen` binds the
    // HTTP/WS port. The sweep snapshots the in-memory SESSIONS map and
    // then queries DB for active rows; if a request handler raced in
    // between those two steps it'd insert a fresh active row that the
    // sweep would mistakenly flip to paused. We're still pre-bind here,
    // so no request can land yet.
    await bootStep('orphan cli session sweep', async () => {
        const { failOrphanedCliSessions } = await import('./services/cli-session-host.js');
        const n = await failOrphanedCliSessions();
        if (n > 0) console.log(`[api] orphan cli sessions flipped to paused: ${n}`);
    });
    // 2026-06-10 — Best-effort sweep of `atlas-setup-*.{ps1,sh}` files
    // older than 1 h in `os.tmpdir()`. Covers the case where the prior
    // process SIGKILL'd mid-setup and the `finally` unlink never ran,
    // leaving a tmpfile that has decrypted secrets inlined into its
    // body. See `services/project-setup-runner.ts`.
    await bootStep('orphan setup tmpfile sweep', () => sweepOrphanSetupTmpfiles().then(() => undefined));
    // Replace the migration's one-shot tool_catalog seed with a per-boot
    // re-sync from the canonical MCP tool list in services/tool-catalog-sync.ts.
    // Keeps the Settings → Allowed Tools matrix in sync with what MCP actually
    // exposes; updating that list is the only thing needed when MCP gains or
    // loses a tool.
    await bootStep('tool catalog sync', syncToolCatalog);
    // Reapply seeded prompts (only when prompt_version === 1, i.e. owner
    // hasn't edited). The spawned Claude CLI inherits Owner's user-level
    // MCP config (Atlas + Atlassian + Playwright + …) — no generated
    // mcp-config.json is needed.
    await bootStep('agent defaults sync', syncAgentDefaults);

    // Migrations may succeed against one DB and the runtime then point at a
    // different one if env vars drift between steps; ping confirms the
    // runtime can actually talk to the DB before the port is bound.
    await bootStep('db connectivity check', async () => {
        const knex = Knex(knexConfig);
        try {
            await knex.raw('select 1');
        } finally {
            await knex.destroy();
        }
    });

    // Use buildApp's default logger config (stdout + persistent log file via
    // Pino multi-target transport). Tests pass `logger: false` and bypass it.
    const server = await buildApp();
    await bootSchedules();
    await catchUpMissedFires();
    // One-minute tick: stuck-run watchdog, reminders, token refresh, the
    // workflow reconcile sweep and workflow dispatch. A scheduled workflow
    // whose fire passed while the server was off starts on the first tick.
    startAgentSchedulerPoller();

    // Periodic orphan-run reaper. Boot already ran `failOrphanedRuns`
    // once via bootStep above; this timer keeps it ticking so runs that
    // die mid-stream get reclaimed within ~1 minute even when the API
    // never restarts. `unref()` so the timer never blocks Node's exit
    // if the SIGINT/SIGTERM shutdown path is skipped.
    orphanReaperTimer = setInterval(() => {
        if (orphanReaperRunning) return;
        orphanReaperRunning = true;
        void (async () => {
            try {
                // A row that started before this process booted can't be one
                // of its runs, so it's reaped on the first tick instead of
                // waiting out the 30-min floor (the boot pass skips rows
                // under 60 s old — a step killed in its first minute by an
                // API restart would otherwise hold its workflow run for 30 min).
                const sinceBoot = Date.now() - PROCESS_STARTED_AT;
                await failOrphanedRuns({ cutoffMs: Math.min(ORPHAN_REAPER_PERIODIC_CUTOFF_MS, sinceBoot) });
            } finally {
                orphanReaperRunning = false;
            }
        })();
    }, ORPHAN_REAPER_INTERVAL_MS);
    orphanReaperTimer.unref();

    // Honor API_PORT env var so the E2E suite can spin a dedicated api on
    // :6001 alongside any dev :4001 instance. Defaults preserved for the
    // standard dev flow.
    //
    // Prefer API_PORT so dev/prod/E2E never fight over a shared PORT var.
    // Fall back to PORT for tools that only set the generic var.
    const PORT = apiPort();
    const HOST = '127.0.0.1';

    // Live posture safety net: whenever ATLAS_MCP_TOKEN is empty, the
    // requireMcpToken plugin is in fully-open mode — every local process
    // (and any origin-spoofing caller from the LAN when ATLAS_LAN_ACCESS
    // is on) can POST/PATCH/DELETE freely. Surface this at boot regardless
    // of ATLAS_AI_ENABLED — the write gate's posture is independent of
    // whether the agent runner is live.
    if (!(process.env['ATLAS_MCP_TOKEN'] ?? '').trim()) {
        const msg =
            '[security] ATLAS_MCP_TOKEN is empty — MCP write gate is OPEN. ' +
            'Any local process can POST/PATCH/DELETE against this API. Set ' +
            'ATLAS_MCP_TOKEN to a 64-char random value in .env before going live.';
        // Dual-log so the warning is visible in the terminal regardless of
        // ATLAS_LOG_LEVEL or transport buffering, AND in the structured/file
        // log for the audit trail.
        server.log.warn(msg);
        console.warn(msg);
    }

    // Graceful shutdown: stop the scheduler poller and close Fastify before
    // exit so SIGINT/SIGTERM doesn't leak the per-minute timer or leave the
    // PG pool draining mid-tick. Idempotent — both signals route here.
    let mcpHost: IMcpHostHandle | null = null;
    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        server.log.info(`[api] ${signal} received — shutting down`);
        try {
            const { stopAgentSchedulerPoller } = await import(
                './services/agent-schedule-registry.js'
            );
            stopAgentSchedulerPoller();
            if (orphanReaperTimer) {
                clearInterval(orphanReaperTimer);
                orphanReaperTimer = null;
            }
            await stopMcpHost(mcpHost);
            await server.close();
        } catch (err) {
            server.log.error({ err }, '[api] error during shutdown');
        } finally {
            process.exit(0);
        }
    };
    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });

    try {
        await server.listen({ port: PORT, host: HOST });
        console.log(
            `\nAtlas API running at http://${HOST}:${PORT} (env: ${isDev ? 'dev' : 'prod'})\n`,
        );
        // Start the fixed-port MCP HTTP listener AFTER the API is up so the
        // first request the MCP forwards to apiBase actually has somewhere
        // to land. First-boot-wins: if another stack already owns :4500 the
        // host returns null and this instance runs API-only.
        mcpHost = await startMcpHost({
            apiBase: `http://127.0.0.1:${PORT}`,
            mcpToken: process.env['ATLAS_MCP_TOKEN'] ?? '',
            log: server.log,
        });
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
}

try {
    await main();
} catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[boot] startup failed, refusing to start:\n${msg}`);
    process.exit(1);
}
