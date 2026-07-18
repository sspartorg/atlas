import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import {
    spawnAgentRun,
    runOutputRegistry,
    cancelRun,
    LiveRunOnItemError,
} from '../services/agent-runner.js';
import { findLiveRunOnItem } from '../services/agent-dispatcher.js';
import { broadcastSSE } from './events.js';
import { asAgentRun } from '../services/agents.js';
import {
    DependenciesNotReadyError,
    assertDepsAllDoneForDispatch,
} from '../services/dependency-guard.js';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import {
    RUNNABLE_ISSUE_TYPES,
    type ApiErrorBody,
    type IssueType,
} from '@atlas/shared';

// List-mode projection for `output_text`: keep the head (so the
// `[SIMULATED…]` marker that `isSimulatedRun` looks for survives) plus
// the tail (the queue drawer renders the last ~160 chars as a live
// preview). Strings shorter than the head+tail budget pass through
// unchanged. Cuts the per-row payload from multi-KB CLI transcripts to
// ~400 chars, dropping the Queue/Agents `/api/run?limit=500` body from
// ~1.8 MB to ~200 KB.
const OUTPUT_TEXT_LIST_SQL = sql<string | null>`CASE
    WHEN r.output_text IS NULL THEN NULL
    WHEN length(r.output_text) <= 400 THEN r.output_text
    ELSE left(r.output_text, 100) || E'\n…[elided]…\n' || right(r.output_text, 300)
END`;

export async function runRoutes(app: FastifyInstance) {
    app.post('/api/run', async (req, reply) => {
        const { agent_id, issue_type, issue_id } = req.body as {
            agent_id?: string;
            issue_type?: string;
            issue_id?: string;
        };

        if (!agent_id) {
            throw new ApiError('validation_error', 'agent_id is required', 400);
        }

        const hasItem = Boolean(issue_type && issue_id);

        if (hasItem && !RUNNABLE_ISSUE_TYPES.includes(issue_type as IssueType)) {
            throw new ApiError(
                'validation_error',
                `issue_type must be one of: ${RUNNABLE_ISSUE_TYPES.join(', ')}`,
                400,
            );
        }

        const agent = await db
            .selectFrom('agents')
            .select(['id', 'status', 'requires_item'])
            .where('id', '=', agent_id)
            .executeTakeFirst();
        if (!agent) throw new ApiError('not_found', 'Agent not found', 404);
        if (agent.status !== 'active')
            throw new ApiError('conflict', 'Agent is not active', 400);

        // Freedom-mode agents (`requires_item = false`) can be launched with
        // no item — runner spawns with null item params and the prompt
        // builder emits the freedom preamble. Item-driven agents still
        // require both fields.
        if (!hasItem && agent.requires_item) {
            throw new ApiError(
                'validation_error',
                'issue_type and issue_id are required for item-driven agents',
                400,
            );
        }

        // Item-level run lock — block manual dispatch when another run is
        // already active on this item, regardless of which agent owns it.
        // Mirrors the auto-dispatcher's `findLiveRunOnItem` check so the
        // lock is uniform across manual + automated trigger paths.
        // Freedom-mode (no item) is exempt.
        if (hasItem) {
            const blocker = await findLiveRunOnItem(issue_id!);
            if (blocker) {
                throw new ApiError(
                    'conflict',
                    `Item ${issue_id} already has an active run by ${blocker.agentId} (run ${blocker.runId}). Wait for it to finish before triggering a new run.`,
                    409,
                );
            }
        }

        // B04 depends_on hard-gate. Pulled UP from spawnAgentRun's prologue
        // so the 409 + blocker payload still surfaces synchronously after
        // the perf split (background spawn can't propagate HTTP errors).
        // Same error shape clients + tests already consume.
        if (hasItem) {
            try {
                await assertDepsAllDoneForDispatch(issue_id!, agent_id);
            } catch (err) {
                if (err instanceof DependenciesNotReadyError) {
                    const body: ApiErrorBody & { blockers: typeof err.blockers } = {
                        error: 'dependencies_not_ready',
                        kind: 'conflict',
                        blockers: err.blockers,
                    };
                    return reply.status(409).send(body);
                }
                /* v8 ignore next */
                throw err;
            }
        }

        // Split-handler dispatch (perf fix 2026-06-10):
        //
        // The old code awaited `spawnAgentRun(...)` end-to-end before sending
        // 202 — but spawnAgentRun does worktree provisioning, constitution
        // assembly, commands/templates writes, and prompt building BEFORE
        // its INSERT. That's where the 2.5–3.5 s tail comes from, every
        // dispatch was tripping the 250 ms slow-request log.
        //
        // Now:
        //   1. We INSERT the `agent_runs` row here, synchronously, with
        //      prompt_snapshot=null. Same uniqueness-race handling as
        //      spawnAgentRun's original block.
        //   2. We return 202 with the runId.
        //   3. `queueMicrotask` runs the slow work (worktree → CLI fork)
        //      off the request thread. `existingRunId` tells
        //      spawnAgentRun to UPDATE the prompt_snapshot instead of
        //      doing a second INSERT.
        //   4. On any error in the background task we mark the row
        //      status='error' so the failure surfaces in the same UI
        //      surfaces that render every other run failure.
        const runId = randomUUID();
        const now = new Date().toISOString();
        try {
            await db
                .insertInto('agent_runs')
                .values({
                    id: runId,
                    agent_id,
                    item_id: hasItem ? issue_id! : null,
                    status: 'queued',
                    prompt_snapshot: null,
                    started_at: now,
                })
                .execute();
        } catch (err) {
            // Same race-guard spawnAgentRun used to do — the unique
            // partial index `agent_runs_one_live_per_item` blocks a
            // second live row per item.
            const code = (err as { code?: string }).code;
            if (code === '23505' && hasItem) {
                throw new ApiError(
                    'conflict',
                    `Item ${issue_id} already has an active run (race-blocked at DB invariant).`,
                    409,
                );
            }
            // Log the raw error server-side (with any DB shape / connection
            // detail intact) but return a generic message to the client so
            // a schema / driver failure doesn't disclose column names or
            // connection strings.
            /* v8 ignore next 2 */
            req.log.error({ err }, 'agent_runs insert failed');
            throw new ApiError('internal_error', 'Could not queue run', 500);
        }

        broadcastSSE({
            type: 'run_queued',
            agentId: agent_id,
            runId,
            ...(hasItem ? { issueType: issue_type as IssueType, issueId: issue_id } : {}),
        });

        queueMicrotask(() => {
            void spawnAgentRun({
                agentId: agent_id,
                issueType: hasItem ? (issue_type as IssueType) : null,
                issueId: hasItem ? issue_id! : null,
                existingRunId: runId,
            }).catch(async (err: unknown) => {
                // Surface background failures via the row instead of HTTP:
                // depends_on gate / worktree provisioning / prompt build
                // failures all land here. Skip-and-log strategy keeps the
                // run discoverable from the UI's runs tab.
                const reason =
                    /* v8 ignore next 2 */
                    err instanceof DependenciesNotReadyError
                        ? `dependencies not ready: ${err.blockers.map((b) => b.id).join(', ')}`
                        : /* v8 ignore next */
                          err instanceof LiveRunOnItemError
                          ? `item already has an active run (${err.itemId})`
                          : (err as Error).message;
                req.log.error({ err, runId }, 'spawn-failed');
                try {
                    await db
                        .updateTable('agent_runs')
                        .set({
                            status: 'error',
                            completed_at: new Date().toISOString(),
                            outcome_summary: reason,
                        })
                        .where('id', '=', runId)
                        .execute();
                } catch (updateErr) {
                    /* v8 ignore next */
                    req.log.error({ err: updateErr, runId }, 'spawn-failed: could not mark row as error');
                }
            });
        });

        return reply.status(202).send({ runId });
    });

    app.get('/api/run/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const { since } = req.query as { since?: string };
        const row = await db
            .selectFrom('agent_runs as r')
            .leftJoin('items as i', 'i.id', 'r.item_id')
            .select([
                'r.id as id',
                'r.agent_id as agent_id',
                'r.item_id as item_id',
                'i.type as item_type',
                'i.title as item_title',
                'r.status as status',
                'r.prompt_snapshot as prompt_snapshot',
                'r.output_text as output_text',
                'r.setup_output_text as setup_output_text',
                'r.started_at as started_at',
                'r.completed_at as completed_at',
                'r.created_at as created_at',
                'r.input_tokens as input_tokens',
                'r.output_tokens as output_tokens',
                'r.cache_creation_tokens as cache_creation_tokens',
                'r.cache_read_tokens as cache_read_tokens',
                'r.total_cost_usd as total_cost_usd',
                'r.credits as credits',
            ])
            .where('r.id', '=', id)
            .executeTakeFirst();
        if (!row) throw new ApiError('not_found', 'Run not found', 404);

        // While the run is in-flight the in-memory accumulator is fresher
        // than the DB row (DB flushes every 10s). Prefer the registry when
        // present so a refresh during a run never shows a stale snapshot.
        const liveOutput = runOutputRegistry.get(id);
        const effectiveOutput =
            typeof liveOutput === 'string' ? liveOutput : (row.output_text ?? '');

        // ?since=<n>: client tells us how many bytes it already has, we
        // return only the tail. Used for the gap-fill refetch after SSE
        // opens (see AgentRunDetail.tsx). Clamp to [0, length]; bogus
        // values fall through to the full string.
        let sliced = effectiveOutput;
        if (typeof since === 'string' && since.length > 0) {
            const n = Number.parseInt(since, 10);
            if (Number.isFinite(n) && n >= 0) {
                sliced = effectiveOutput.slice(Math.min(n, effectiveOutput.length));
            }
        }

        const enriched = { ...row, output_text: sliced };
        return reply.send(
            asAgentRun(enriched as never, (row.item_type as IssueType) ?? 'story'),
        );
    });

    // P9 — Delete-a-run + item unstick. When a run is left hung (CLI
    // crash, server SIGKILL mid-flight, etc.) the item it owns stays
    // stuck: assignee pinned to the dead agent, status sitting in
    // in_progress / in_review so the next dispatcher tick skips it.
    // Deleting the run row removes child reviewer runs via the
    // existing `parent_run_id ON DELETE CASCADE` FK on agent_runs,
    // and also wipes any other still-in-flight runs (queued /
    // in_progress) on the same item so a single click fully frees
    // the item for the next pass. The item is reset back to `ready`
    // unless it never left `draft` (Owner hadn't promoted it yet),
    // in which case we leave it where it was.
    app.delete('/api/run/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const run = await db
            .selectFrom('agent_runs')
            .select(['id', 'item_id'])
            .where('id', '=', id)
            .executeTakeFirst();
        if (!run) throw new ApiError('not_found', 'Run not found', 404);

        await db.transaction().execute(async (tx) => {
            // Drop the row first — CASCADE clears reviewer-child runs that
            // share `parent_run_id`. The other in-flight cleanup below
            // covers sibling runs on the same item that are NOT in the
            // parent/child chain (e.g. two queued attempts).
            await tx.deleteFrom('agent_runs').where('id', '=', id).execute();

            if (run.item_id) {
                // Drop any sibling in-flight runs on the same item so the
                // item is fully unstuck (no orphan 'queued' or
                // 'in_progress' row that the runner might still flush
                // late-arriving output to).
                await tx
                    .deleteFrom('agent_runs')
                    .where('item_id', '=', run.item_id)
                    .where('status', 'in', ['queued', 'in_progress'])
                    .execute();

                const item = await tx
                    .selectFrom('items')
                    .select(['status'])
                    .where('id', '=', run.item_id)
                    .executeTakeFirst();
                if (item) {
                    // Owner-promotion semantics: if the Owner hadn't moved
                    // it past `draft`, deleting a run shouldn't fake-
                    // promote it to `ready`. Every other state (ready,
                    // in_progress, in_review, waiting_for_info) collapses
                    // back to `ready` — the dispatcher's natural
                    // re-pickup point.
                    const nextStatus = item.status === 'draft' ? 'draft' : 'ready';
                    await tx
                        .updateTable('items')
                        .set({ status: nextStatus, assignee_agent_id: null })
                        .where('id', '=', run.item_id)
                        .execute();
                }
            }
        });

        // Best-effort cleanup of the in-memory streaming buffer so a
        // refresh after the delete doesn't briefly show stale tail
        // bytes for a row that no longer exists.
        runOutputRegistry.delete(id);

        return reply.status(204).send();
    });

    // Workstream #6 (2026-06-02) — UI-driven stop-a-run kill switch.
    // Unlike DELETE above (which removes the row to unstick a hung
    // run) this endpoint preserves the row, flips its status to
    // `cancelled`, and kills the live subprocess via
    // `cancelRun(runId)`. The child's `exit` handler then runs the
    // usual post-run hook (push committed work + cleanup the
    // worktree) but `completeRun`/`errorRun` honour the cancelled
    // status and skip the on-pass handoff so the chain doesn't
    // advance on half-done work.
    //
    // Idempotent: stopping an already-terminal run returns 409 with
    // the current row; the UI can refetch and move on.
    app.post('/api/run/:id/stop', async (req, reply) => {
        const { id } = req.params as { id: string };
        const run = await db
            .selectFrom('agent_runs')
            .select(['id', 'agent_id', 'status'])
            .where('id', '=', id)
            .executeTakeFirst();
        if (!run) throw new ApiError('not_found', 'Run not found', 404);

        const TERMINAL = new Set(['completed', 'error', 'cancelled']);
        if (TERMINAL.has(run.status as string)) {
            const body: ApiErrorBody = {
                error: `Run is already ${run.status as string}`,
                kind: 'conflict',
            };
            return reply.status(409).send(body);
        }

        const now = new Date().toISOString();
        await db
            .updateTable('agent_runs')
            .set({ status: 'cancelled', completed_at: now })
            .where('id', '=', id)
            .where('status', 'in', ['queued', 'in_progress'])
            .execute();

        // Best-effort subprocess kill — the DB write above is the
        // source of truth; the kill is bonus. `cancelRun` returns
        // gracefully when the runId isn't in the live-children
        // registry (queued-but-not-spawned, or already exited).
        const kill = await cancelRun(id).catch((err) => {
            console.warn(
                `[run-stop] cancelRun(${id}) threw: ${(err as Error).message}`,
            );
            return { cancelled: false, pidKilled: null };
        });

        // Re-read the row AFTER both the UPDATE and the kill, then
        // broadcast / respond with whatever the DB now says. The UPDATE
        // is guarded by `status in (queued, in_progress)`; if the runner
        // finalised the row in parallel (between our SELECT at the top
        // of the handler and the UPDATE, or while we awaited the kill),
        // that no-ops silently and the row already carries a different
        // terminal status (`completed`/`error`). Broadcasting a
        // hard-coded `'cancelled'` would lie to clients — refetches
        // would then disagree with the SSE payload and the UI could
        // flicker between states. Single PK lookup; cheap.
        const after = await db
            .selectFrom('agent_runs')
            .select(['status'])
            .where('id', '=', id)
            .executeTakeFirst();
        /* v8 ignore next */
        const finalStatus = (after?.status ?? 'cancelled') as
            | 'queued'
            | 'in_progress'
            | 'completed'
            | 'error'
            | 'cancelled';

        broadcastSSE({
            type: 'run_completed',
            agentId: run.agent_id as string,
            runId: id,
            status: finalStatus,
        });

        return reply.send({
            runId: id,
            status: finalStatus,
            killedSubprocess: kill.cancelled,
            pidKilled: kill.pidKilled,
        });
    });

    app.get('/api/run', async (req, reply) => {
        const { issue_id, project_id, limit } = req.query as {
            issue_type?: string;
            issue_id?: string;
            project_id?: string;
            limit?: string;
        };
        // The previous ceiling was 200; bumping to 500 to match the Queue /
        // Agents pages' actual fetch volume. The summary projection below
        // keeps the payload manageable even at 500 rows.
        // Guard against non-numeric ?limit=<garbage>: `Number('abc') = NaN`
        // → `.limit(NaN)` produces `LIMIT NaN` which PG rejects at parse.
        // Coerce non-finite to the default 50; clamp to [1, 500].
        const rawN = Number(limit ?? 50);
        const n = Math.min(Math.max(Number.isFinite(rawN) ? rawN : 50, 1), 500);
        let q = db
            .selectFrom('agent_runs as r')
            .leftJoin('items as i', 'i.id', 'r.item_id')
            .select([
                'r.id as id',
                'r.agent_id as agent_id',
                'r.item_id as item_id',
                'i.type as item_type',
                'i.title as item_title',
                'r.status as status',
                // List mode never needs the full prompt — saves multi-KB per row.
                sql<string | null>`NULL::text`.as('prompt_snapshot'),
                OUTPUT_TEXT_LIST_SQL.as('output_text'),
                'r.started_at as started_at',
                'r.completed_at as completed_at',
                'r.created_at as created_at',
                'r.input_tokens as input_tokens',
                'r.output_tokens as output_tokens',
                'r.cache_creation_tokens as cache_creation_tokens',
                'r.cache_read_tokens as cache_read_tokens',
                'r.total_cost_usd as total_cost_usd',
                'r.credits as credits',
            ]);
        if (issue_id) q = q.where('r.item_id', '=', issue_id);
        // Filter by project via the existing items join — picks up runs
        // against any item in the project regardless of level (epic /
        // story / bug / sub-task / sub-bug), so the Project History tab
        // sees the full chronology without the client having to enumerate
        // every child id.
        if (project_id) q = q.where('i.project_id', '=', project_id);
        const rows = await q.orderBy('r.created_at', 'desc').limit(n).execute();
        /* v8 ignore next */
        return reply.send(rows.map((r) => asAgentRun(r as never, (r.item_type as IssueType) ?? 'story')));
    });

    // Task 12 — the `/review` and `/performer-done` routes are gone.
    // Agents no longer call back to the orchestrator with their identity;
    // the orchestrator parses the `atlas-outcome` block out of the
    // captured CLI output in `completeRun()` directly. The DB columns
    // `performer_outcome`, `performer_summary`, `performer_checklist_results`,
    // `review_outcome`, `review_reason` were dropped in migration 085.
}
