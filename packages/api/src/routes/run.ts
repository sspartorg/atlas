import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { spawnAgentRun, runOutputRegistry, cancelRun } from '../services/agent-runner.js';
import { cancelWorkflowRun, onStepFinished } from '../services/workflow-engine.js';
import { broadcastSSE } from './events.js';
import { asAgentRun } from '../services/agents.js';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { type ApiErrorBody, type IssueType } from '@atlas/shared';

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
    // ADR 0014 — an ad-hoc run of one agent against the project (or nothing),
    // e.g. a quick check of a scout's prompt. Work on an item always goes
    // through a workflow: that is what provisions the worktree, routes the
    // result, and delivers the PR.
    app.post('/api/run', async (req, reply) => {
        const { agent_id, issue_type, issue_id, project_id } = req.body as {
            agent_id?: string;
            issue_type?: string;
            issue_id?: string;
            project_id?: string;
        };

        if (!agent_id) {
            throw new ApiError('validation_error', 'agent_id is required', 400);
        }
        if (issue_type || issue_id) {
            throw new ApiError(
                'validation_error',
                'Runs on an item go through a workflow — assign the item to a workflow and start it there',
                400
            );
        }

        const agent = await db
            .selectFrom('agents')
            .select(['id', 'status'])
            .where('id', '=', agent_id)
            .executeTakeFirst();
        if (!agent) throw new ApiError('not_found', 'Agent not found', 404);
        if (agent.status !== 'active') throw new ApiError('conflict', 'Agent is not active', 400);

        // Insert synchronously so the 202 carries a real run id and returns in
        // ~50 ms; `existingRunId` tells spawnAgentRun to UPDATE this row instead
        // of inserting a second one. Background failures land on the row.
        const runId = randomUUID();
        const now = new Date().toISOString();
        await db
            .insertInto('agent_runs')
            .values({
                id: runId,
                agent_id,
                item_id: null,
                project_id: project_id ?? null,
                status: 'queued',
                prompt_snapshot: null,
                started_at: now,
            })
            .execute();

        broadcastSSE({ type: 'run_queued', agentId: agent_id, runId });

        queueMicrotask(() => {
            void spawnAgentRun({
                agentId: agent_id,
                projectId: project_id ?? null,
                existingRunId: runId,
            }).catch(async (err: unknown) => {
                req.log.error({ err, runId }, 'spawn-failed');
                try {
                    await db
                        .updateTable('agent_runs')
                        .set({
                            status: 'error',
                            completed_at: new Date().toISOString(),
                            outcome_summary: (err as Error).message,
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
                // 2026-09-12 — these four were mapped by `asAgentRun` but never
                // SELECTed here, so they always came back null. That made a
                // pre-spawn failure completely invisible: the route writes the
                // reason to `outcome_summary` (worktree provisioning, deps not
                // ready, live-run conflict), the DB row has it, and the API
                // dropped it — leaving the Run Detail page showing "Error" with
                // an empty output pane and nothing to explain it.
                'r.outcome_kind as outcome_kind',
                'r.outcome_summary as outcome_summary',
                'r.outcome_reason as outcome_reason',
                'r.outcome_checklist as outcome_checklist',
                'r.parent_run_id as parent_run_id',
                'r.started_at as started_at',
                'r.completed_at as completed_at',
                'r.created_at as created_at',
                'r.input_tokens as input_tokens',
                'r.output_tokens as output_tokens',
                'r.cache_creation_tokens as cache_creation_tokens',
                'r.cache_read_tokens as cache_read_tokens',
                'r.total_cost_usd as total_cost_usd',
                'r.credits as credits',
                'r.workflow_run_id as workflow_run_id',
                'r.node_id as node_id',
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
        return reply.send(asAgentRun(enriched as never, (row.item_type as IssueType) ?? 'story'));
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
            .select(['id', 'item_id', 'workflow_run_id'])
            .where('id', '=', id)
            .executeTakeFirst();
        if (!run) throw new ApiError('not_found', 'Run not found', 404);

        // A workflow step: stop its workflow run first (kills the live step,
        // keeps committed work, parks the item with the Owner). Resetting the
        // item to `ready` below would immediately re-queue it.
        if (run.workflow_run_id) {
            await cancelWorkflowRun(run.workflow_run_id);
            await db.deleteFrom('agent_runs').where('id', '=', id).execute();
            runOutputRegistry.delete(id);
            return reply.status(204).send();
        }

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
            console.warn(`[run-stop] cancelRun(${id}) threw: ${(err as Error).message}`);
            return { cancelled: false, pidKilled: null };
        });
        // Stopping a workflow step stops its workflow run. A queued step that
        // never spawned has no finalize path to report this, so report here;
        // the engine ignores the duplicate when the killed CLI reports too.
        await onStepFinished(id);

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
            'queued' | 'in_progress' | 'completed' | 'error' | 'cancelled';

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
        const { issue_type, issue_id, project_id, agent_id, limit } = req.query as {
            issue_type?: string;
            issue_id?: string;
            project_id?: string;
            agent_id?: string;
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
                'r.workflow_run_id as workflow_run_id',
                'r.node_id as node_id',
            ]);
        if (issue_id) q = q.where('r.item_id', '=', issue_id);
        // 2026-09-12: `agent_id` and `issue_type` were in the accepted query
        // shape but never applied — `?agent_id=anything` returned every run in
        // the workspace, including for agents with none. `routes-map.md`
        // documented the agent filter and `api.ts::run.list` sends
        // `issue_type`, so both read as supported. A filter that silently
        // doesn't filter is worse than no filter. (The Agent Detail Runs tab
        // uses the dedicated `GET /api/agents/:id/runs`, which always
        // filtered correctly — so nothing user-facing was wrong.)
        if (agent_id) q = q.where('r.agent_id', '=', agent_id);
        if (issue_type) q = q.where('i.type', '=', issue_type as IssueType);
        // Filter by project via the existing items join — picks up runs
        // against any item in the project regardless of level (epic /
        // story / bug / sub-task / sub-bug), so the Project History tab
        // sees the full chronology without the client having to enumerate
        // every child id.
        if (project_id) q = q.where('i.project_id', '=', project_id);
        const rows = await q.orderBy('r.created_at', 'desc').limit(n).execute();
        /* v8 ignore next */
        return reply.send(
            rows.map((r) => asAgentRun(r as never, (r.item_type as IssueType) ?? 'story'))
        );
    });

    // Task 12 — the `/review` and `/performer-done` routes are gone.
    // Agents no longer call back to the orchestrator with their identity;
    // the orchestrator parses the `atlas-outcome` block out of the
    // captured CLI output in `completeRun()` directly. The DB columns
    // `performer_outcome`, `performer_summary`, `performer_checklist_results`,
    // `review_outcome`, `review_reason` were dropped in migration 085.
}
