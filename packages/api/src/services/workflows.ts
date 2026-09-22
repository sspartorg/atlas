// Workflow CRUD, starter templates and run read-models (ADR 0014). Execution
// lives in `workflow-engine.ts`.

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    WorkflowGraphSchema,
    validateWorkflowGraph,
    type AgentEffort,
    type CreateWorkflowInput,
    type IWorkflow,
    type IWorkflowGraph,
    type IWorkflowRunDetail,
    type IWorkflowRunSummary,
    type IWorkflowTemplate,
    type IssueType,
    type UpdateWorkflowInput,
} from '@atlas/shared';
import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';
import { materializeCron } from './cron-materializer.js';
import { computeNextWorkflowFire } from './workflow-engine.js';
import { marketplaceService } from './marketplace.js';
import { eventsLog } from './events-log.js';
import { broadcastSSE } from '../routes/events.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'marketplace', 'workflows');
// Sub-tasks nodes in templates name their sub-workflow by template
// (`template:build`); it resolves to that template's workflow in the same
// project, created from the template when the project lacks it.
const TEMPLATE_REF = 'template:';

function asWorkflow(row: Record<string, unknown>): IWorkflow {
    return {
        id: row['id'] as string,
        project_id: (row['project_id'] as string | null) ?? null,
        name: row['name'] as string,
        description: (row['description'] as string | null) ?? null,
        status: row['status'] as IWorkflow['status'],
        graph: row['graph'] as IWorkflowGraph,
        input_kind: row['input_kind'] as IWorkflow['input_kind'],
        trigger: row['trigger'] as IWorkflow['trigger'],
        use_worktree: row['use_worktree'] as boolean,
        push_code: row['push_code'] as boolean,
        raises_pr: row['raises_pr'] as boolean,
        push_to_default: row['push_to_default'] as boolean,
        max_loops: row['max_loops'] as number,
        max_parallel_runs: row['max_parallel_runs'] as number,
        schedule_preset: (row['schedule_preset'] as IWorkflow['schedule_preset']) ?? null,
        schedule_time_of_day: (row['schedule_time_of_day'] as string | null) ?? null,
        schedule_weekday: (row['schedule_weekday'] as number | null) ?? null,
        cron_expr: (row['cron_expr'] as string | null) ?? null,
        next_run_at: (row['next_run_at'] as string | null) ?? null,
        last_run_at: (row['last_run_at'] as string | null) ?? null,
        marketplace_source_id: (row['marketplace_source_id'] as string | null) ?? null,
        marketplace_pulled_version: (row['marketplace_pulled_version'] as number | null) ?? null,
        // toISOString, NOT String(): pg hands back a Date, and String(Date)
        // drops milliseconds. Truncating to the second made `updated_at`
        // (full precision) look later than the pull on a row nobody had
        // touched, so untouched workflows read as Owner-edited and quietly
        // stopped accepting upgrades.
        marketplace_pulled_at: row['marketplace_pulled_at'] ? new Date(row['marketplace_pulled_at'] as string).toISOString() : null,
        // Filled in by `withUpgradeFlags`; resolving the source's current
        // version needs a lookup the row mapper has no business doing.
        upgrade_available: false,
        created_at: row['created_at'] as string,
        updated_at: new Date(row['updated_at'] as string).toISOString(),
    };
}

export function asRunSummary(row: Record<string, unknown>): IWorkflowRunSummary {
    return {
        id: row['id'] as string,
        workflow_id: row['workflow_id'] as string,
        item_id: (row['item_id'] as string | null) ?? null,
        project_id: (row['project_id'] as string | null) ?? null,
        status: row['status'] as IWorkflowRunSummary['status'],
        graph_snapshot: row['graph_snapshot'] as IWorkflowGraph,
        parent_workflow_run_id: (row['parent_workflow_run_id'] as string | null) ?? null,
        parent_node_id: (row['parent_node_id'] as string | null) ?? null,
        current_node_id: (row['current_node_id'] as string | null) ?? null,
        parked_node_id: (row['parked_node_id'] as string | null) ?? null,
        park_reason: (row['park_reason'] as string | null) ?? null,
        loop_count: row['loop_count'] as number,
        branch: (row['branch'] as string | null) ?? null,
        worktree_path: (row['worktree_path'] as string | null) ?? null,
        setup_done: row['setup_done'] as boolean,
        pr_url: (row['pr_url'] as string | null) ?? null,
        pr_urls: (row['pr_urls'] as string[] | null) ?? [],
        started_at: row['started_at'] as string,
        updated_at: row['updated_at'] as string,
        finished_at: (row['finished_at'] as string | null) ?? null,
        item_title: (row['item_title'] as string | null) ?? null,
    };
}

async function assertValidGraph(
    graph: IWorkflowGraph,
    w: Pick<IWorkflow, 'input_kind' | 'project_id'> & { id?: string },
): Promise<void> {
    const errors = validateWorkflowGraph(graph, w.input_kind);
    const agentIds = [...new Set(graph.nodes.flatMap((n) => (n.agent_id ? [n.agent_id] : [])))];
    if (agentIds.length > 0) {
        const found = await db.selectFrom('agents').select('id').where('id', 'in', agentIds).execute();
        const known = new Set(found.map((a) => a.id));
        for (const node of graph.nodes) {
            if (node.agent_id && !known.has(node.agent_id)) {
                errors.push({ node_id: node.id, message: `Agent ${node.agent_id} does not exist` });
            }
        }
    }
    const subIds = [...new Set(graph.nodes.flatMap((n) => (n.type === 'subtasks' && n.sub_workflow_id ? [n.sub_workflow_id] : [])))];
    if (subIds.length > 0) {
        const subs = await db.selectFrom('workflows').select(['id', 'input_kind', 'project_id']).where('id', 'in', subIds).execute();
        const byId = new Map(subs.map((sw) => [sw.id, sw]));
        for (const node of graph.nodes) {
            if (node.type !== 'subtasks' || !node.sub_workflow_id) continue;
            const sub = byId.get(node.sub_workflow_id);
            if (!sub) errors.push({ node_id: node.id, message: `Workflow ${node.sub_workflow_id} does not exist` });
            else if (sub.input_kind !== 'sub_task') errors.push({ node_id: node.id, message: 'Pick a sub-task workflow for this step' });
            else if (sub.project_id !== w.project_id) errors.push({ node_id: node.id, message: 'The sub-workflow belongs to a different project' });
        }
    }
    if (errors.length > 0) {
        throw new ApiError('validation_error', errors[0]?.message ?? 'Invalid workflow graph', 400, { graph_errors: errors });
    }
}

/** Rules across the scalar fields; `w` is the workflow as it will be saved. */
function assertDeliveryRules(w: Pick<IWorkflow, 'input_kind' | 'trigger' | 'push_code' | 'raises_pr' | 'push_to_default'>): void {
    // A sub-workflow runs only inside its Task's run, on the Task's worktree,
    // and never delivers on its own.
    if (w.input_kind === 'sub_task' && w.trigger !== 'manual') {
        throw new ApiError('validation_error', 'A sub-task workflow only runs from a Task workflow’s Sub-tasks step', 400);
    }
    if (w.push_to_default && (!w.push_code || w.raises_pr)) {
        throw new ApiError('validation_error', 'Pushing to the default branch needs push on and pull request off', 400);
    }
}

interface ScheduleFields {
    trigger: IWorkflow['trigger'];
    schedule_preset: IWorkflow['schedule_preset'];
    schedule_time_of_day: string | null;
    schedule_weekday: number | null;
    cron_expr: string | null;
}

/** Materializes the preset into `cron_expr` and the next fire time. */
async function resolveSchedule(s: ScheduleFields): Promise<{ cron_expr: string | null; next_run_at: string | null }> {
    if (s.trigger !== 'schedule') return { cron_expr: s.cron_expr, next_run_at: null };
    if (!s.schedule_preset) {
        throw new ApiError('validation_error', 'A scheduled workflow needs a schedule', 400);
    }
    let cron: string;
    try {
        cron = materializeCron({
            preset: s.schedule_preset,
            time_of_day: s.schedule_time_of_day ?? '09:00',
            weekday: s.schedule_weekday,
            cron_expression: s.cron_expr ?? '',
        }).cron_expression;
    } catch (err) {
        throw new ApiError('validation_error', (err as Error).message, 400);
    }
    const settings = await db.selectFrom('settings').select('quiet_hours_timezone').where('id', '=', 1).executeTakeFirst();
    const next = computeNextWorkflowFire(cron, new Date(), settings?.quiet_hours_timezone ?? undefined);
    return { cron_expr: cron, next_run_at: next?.toISOString() ?? null };
}

function assertProjectRule(w: Pick<IWorkflow, 'project_id' | 'input_kind' | 'use_worktree'>): void {
    if (!w.project_id && (w.input_kind === 'item' || w.use_worktree)) {
        throw new ApiError('validation_error', 'Pick a project — this workflow works on items or a repository', 400);
    }
}

function emptyGraph(): IWorkflowGraph {
    return {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            { id: 'end', type: 'end', position: { x: 0, y: 260 } },
        ],
        edges: [{ id: 'e-start', source: 'start', target: 'end', kind: 'pass' }],
    };
}

function broadcastWorkflowsChanged(): void {
    broadcastSSE({ type: 'counts_changed', scope: 'sidenav' });
}

/** Cost of every agent step across the given workflow runs. */
async function runCost(runIds: string[]): Promise<number> {
    const row = await db
        .selectFrom('agent_runs')
        .select((eb) => eb.fn.sum<string | number | null>('total_cost_usd').as('total'))
        .where('workflow_run_id', 'in', runIds)
        .executeTakeFirst();
    return Number(row?.total ?? 0);
}

export const workflowsService = {
    async list(projectId?: string): Promise<IWorkflow[]> {
        let q = db.selectFrom('workflows').selectAll().orderBy('name', 'asc');
        if (projectId) q = q.where('project_id', '=', projectId);
        return this.withUpgradeFlags((await q.execute()).map((r) => asWorkflow(r as never)));
    },

    async get(id: string): Promise<IWorkflow | null> {
        const row = await db.selectFrom('workflows').selectAll().where('id', '=', id).executeTakeFirst();
        if (!row) return null;
        const [one] = await this.withUpgradeFlags([asWorkflow(row as never)]);
        return one ?? null;
    },

    /**
     * The version a marketplace source is currently at, or null when the id
     * names nothing we can resolve (a deleted published entry, a template that
     * shipped out of the catalog). Null means "cannot tell", and the caller
     * treats that as "no upgrade" — never as "upgrade to nothing".
     *
     * Three shapes of id, because a sub-workflow imported from a published
     * entry belongs to that entry rather than being one itself:
     *   `delivery`              a shipped template
     *   `<uuid>`                a published entry
     *   `<uuid>:<bundle-ref>`   a sub-workflow inside a published entry
     */
    async sourceVersion(sourceId: string): Promise<number | null> {
        const entryId = sourceId.includes(':') ? sourceId.slice(0, sourceId.indexOf(':')) : sourceId;
        const template = this.listTemplates().find((t) => t.id === entryId);
        if (template) return template.version;
        const row = await db
            .selectFrom('published_workflows')
            .select('version')
            .where('id', '=', entryId)
            .executeTakeFirst();
        return row?.version ?? null;
    },

    /** Batch-resolves `upgrade_available` so a list costs one query per source. */
    async withUpgradeFlags(workflows: IWorkflow[]): Promise<IWorkflow[]> {
        const sourceIds = [...new Set(workflows.flatMap((w) => (w.marketplace_source_id ? [w.marketplace_source_id] : [])))];
        if (sourceIds.length === 0) return workflows;
        const versions = new Map<string, number | null>();
        for (const id of sourceIds) versions.set(id, await this.sourceVersion(id));
        return workflows.map((w) => {
            const current = w.marketplace_source_id ? versions.get(w.marketplace_source_id) : null;
            return {
                ...w,
                upgrade_available:
                    current != null && w.marketplace_pulled_version != null && w.marketplace_pulled_version < current,
            };
        });
    },

    /**
     * `provenance` is a service-only argument on purpose. It is deliberately
     * NOT part of `CreateWorkflowSchema`: that schema is what `POST
     * /api/workflows` validates, so putting it there would let a client forge
     * `marketplace_source_id` and claim a workflow came from a template it
     * never came from — which is exactly the field upgrade resolution trusts.
     * Only the code that actually pulled from a marketplace source may set it.
     */
    async create(
        input: CreateWorkflowInput,
        provenance?: { source_id: string; pulled_version: number }
    ): Promise<IWorkflow> {
        const graph = input.graph ?? emptyGraph();
        const base = {
            project_id: input.project_id ?? null,
            input_kind: input.input_kind ?? 'item',
            use_worktree: input.use_worktree ?? true,
        };
        await assertValidGraph(graph, base);
        assertProjectRule(base);
        const delivery = {
            push_code: input.push_code ?? true,
            raises_pr: input.raises_pr ?? !input.push_to_default,
            push_to_default: input.push_to_default ?? false,
        };
        assertDeliveryRules({ ...base, ...delivery, trigger: input.trigger ?? 'manual' });
        // A self-triggering workflow with no agent in its graph would be swept
        // up by the very next dispatch tick, take every ready Task in the
        // project, and run each one through nothing — reaching End immediately
        // and delivering. Harmless while `manual` was the only default; not
        // once a blank workflow can be born `item_ready`. So it starts
        // inactive, and the builder's Active switch turns it on once there is
        // a graph worth running. An explicit `status` still wins.
        const selfStarting = (input.trigger ?? 'manual') !== 'manual';
        const hasAgentNode = graph.nodes.some((n) => n.type === 'agent');
        const status = input.status ?? (selfStarting && !hasAgentNode ? 'inactive' : 'active');
        const schedule = await resolveSchedule({
            trigger: input.trigger ?? 'manual',
            schedule_preset: input.schedule_preset ?? null,
            schedule_time_of_day: input.schedule_time_of_day ?? null,
            schedule_weekday: input.schedule_weekday ?? null,
            cron_expr: input.cron_expr ?? null,
        });
        const id = randomUUID();
        await db
            .insertInto('workflows')
            .values({
                id,
                name: input.name,
                description: input.description ?? null,
                ...base,
                status,
                graph: JSON.stringify(graph),
                trigger: input.trigger ?? 'manual',
                ...delivery,
                max_loops: input.max_loops ?? 3,
                max_parallel_runs: input.max_parallel_runs ?? 1,
                schedule_preset: input.schedule_preset ?? null,
                schedule_time_of_day: input.schedule_time_of_day ?? null,
                schedule_weekday: input.schedule_weekday ?? null,
                ...schedule,
                marketplace_source_id: provenance?.source_id ?? null,
                marketplace_pulled_version: provenance?.pulled_version ?? null,
                // MUST come from the DB clock, not JS. `updated_at` is written by
                // the `workflows_set_updated_at` trigger with now(); a JS timestamp a
                // few ms behind makes `updated_at > marketplace_pulled_at` true on a
                // row nobody has touched, which reads as "Owner edited" forever and
                // silently stops every future upgrade.
                marketplace_pulled_at: provenance ? sql<string>`now()` : null,
            })
            .execute();
        broadcastWorkflowsChanged();
        return (await this.get(id)) as IWorkflow;
    },

    async update(id: string, patch: UpdateWorkflowInput): Promise<IWorkflow> {
        const current = await this.get(id);
        if (!current) throw new ApiError('not_found', 'Workflow not found', 404);
        const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const merged = { ...current, ...defined } as IWorkflow;
        // A new input kind or project can invalidate the stored graph too.
        if (patch.graph || patch.input_kind || patch.project_id !== undefined) await assertValidGraph(merged.graph, merged);
        assertProjectRule(merged);
        assertDeliveryRules(merged);
        const schedule = await resolveSchedule(merged);
        const { graph, ...scalars } = patch;
        await db
            .updateTable('workflows')
            .set({
                ...scalars,
                ...(graph ? { graph: JSON.stringify(graph) } : {}),
                ...schedule,
            })
            .where('id', '=', id)
            .execute();
        broadcastWorkflowsChanged();
        return (await this.get(id)) as IWorkflow;
    },

    async remove(id: string): Promise<void> {
        const live = await db
            .selectFrom('workflow_runs')
            .select('id')
            .where('workflow_id', '=', id)
            .where('status', 'in', ['running', 'waiting_for_owner'])
            .executeTakeFirst();
        if (live) throw new ApiError('conflict', 'Stop this workflow’s live runs before deleting it', 409);
        const users = await this.workflowsUsingSubWorkflow(id);
        if (users.length > 0) {
            throw new ApiError('conflict', `Used as a sub-workflow by ${users.map((u) => u.name).join(', ')} — remove it from there first`, 409);
        }
        const res = await db.deleteFrom('workflows').where('id', '=', id).executeTakeFirst();
        if (Number(res.numDeletedRows ?? 0) === 0) throw new ApiError('not_found', 'Workflow not found', 404);
        broadcastWorkflowsChanged();
    },

    listTemplates(): IWorkflowTemplate[] {
        return readdirSync(TEMPLATES_DIR)
            .filter((f) => f.endsWith('.json'))
            .map((f) => {
                const raw = JSON.parse(readFileSync(join(TEMPLATES_DIR, f), 'utf8')) as IWorkflowTemplate;
                return { ...raw, graph: WorkflowGraphSchema.parse(raw.graph) };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    },

    /**
     * `template:<id>` → that template's workflow in this project, created from
     * the template when the project lacks it. Shared by create and upgrade so
     * the two can never disagree about which workflow a Sub-tasks step means.
     *
     * Matched on `marketplace_source_id`, not on name. Name-matching meant
     * renaming "Build sub-task" made the next Delivery create a second copy
     * instead of reusing it, and conversely any workflow that happened to carry
     * the template's name was adopted as a build step whatever its graph
     * contained. The name fallback stays for rows created before provenance
     * existed.
     */
    async resolveTemplateRef(ref: string | undefined, projectId: string): Promise<string | undefined> {
        if (!ref?.startsWith(TEMPLATE_REF)) return ref;
        const childTemplate = this.listTemplates().find((t) => `${TEMPLATE_REF}${t.id}` === ref);
        if (!childTemplate) return undefined;
        const existing = await db
            .selectFrom('workflows')
            .select('id')
            .where('project_id', '=', projectId)
            .where((eb) =>
                eb.or([
                    eb('marketplace_source_id', '=', childTemplate.id),
                    eb.and([eb('marketplace_source_id', 'is', null), eb('name', '=', childTemplate.name)]),
                ])
            )
            .executeTakeFirst();
        return (existing ?? (await this.createFromTemplate(childTemplate.id, projectId))).id;
    },

    /** Installs any catalog agents the template needs, then creates the workflow. */
    async createFromTemplate(templateId: string, projectId: string): Promise<IWorkflow> {
        const template = this.listTemplates().find((t) => t.id === templateId);
        if (!template) throw new ApiError('not_found', 'Template not found', 404);
        const project = await db.selectFrom('projects').select('id').where('id', '=', projectId).executeTakeFirst();
        if (!project) throw new ApiError('not_found', 'Project not found', 404);

        // Every agent this template needs, ITS SUB-TEMPLATES' INCLUDED.
        // Scanning only `template.graph` under-reported badly: Delivery's own
        // graph names four agents, but running it needs ten — the other six
        // belong to the Build and Test sub-templates. They used to arrive only
        // as a side effect of the recursive call below, and not at all when the
        // project already had a sub-workflow, so a stale sub-workflow left its
        // agents uninstalled and the run parked on a missing agent.
        const agentIds = [...new Set(this.templateAgentIds(templateId))];
        // Installs what's missing and brings back-linked, unedited agents up to
        // the catalog. Previously this only checked existence, so a template
        // could be applied onto agents several versions behind the graph it
        // shipped with — silently, and with no way to tell. Agents the Owner
        // has edited are left exactly as they are.
        // Activates what it installs (a brand-new agent's `inactive` is a
        // manifest leftover, not a decision) and leaves an agent the Owner
        // paused alone, reporting it instead. The blanket "activate every agent
        // the graph names" that used to sit here silently undid that pause; the
        // builder now warns on the step itself, which covers the hand-built and
        // imported paths too.
        await marketplaceService.resolveAgentDependencies(agentIds, { link: true });

        // `template:<id>` → that template's workflow in this project, created
        // from the template when the project lacks it.
        //
        // Matched on `marketplace_source_id`, not on name. Name-matching meant
        // renaming "Build sub-task" made the next Delivery create a second copy
        // instead of reusing it, and conversely any workflow that happened to
        // carry the template's name was adopted as a build step whatever its
        // graph contained. The name fallback stays for rows created before
        // provenance existed.
        const nodes = [];
        for (const { sub_workflow_id, ...rest } of template.graph.nodes) {
            const sub = await this.resolveTemplateRef(sub_workflow_id, projectId);
            nodes.push({ ...rest, ...(sub ? { sub_workflow_id: sub } : {}) });
        }

        return this.create({
            name: template.name,
            description: template.description,
            project_id: projectId,
            input_kind: template.input_kind,
            trigger: template.trigger,
            use_worktree: template.use_worktree,
            push_code: template.push_code,
            raises_pr: template.raises_pr,
            push_to_default: template.push_to_default ?? false,
            graph: { nodes, edges: template.graph.edges },
        }, { source_id: template.id, pulled_version: template.version });
    },

    /**
     * Every agent id a template needs to run, walking its `template:` sub-refs.
     *
     * The web has had this rollup for a while (`pages/workflows/labels.ts`
     * `templateAgentIds`) and used it for display; the API did not, which is
     * why `createFromTemplate` installed four agents for Delivery when running
     * it needs ten. One level of recursion is enough: a `sub_task` workflow
     * cannot itself carry Sub-tasks steps (`validateWorkflowGraph`).
     */
    templateAgentIds(templateId: string): string[] {
        const templates = this.listTemplates();
        const root = templates.find((t) => t.id === templateId);
        if (!root) return [];
        const graphs = [root.graph];
        for (const node of root.graph.nodes) {
            const ref = node.sub_workflow_id;
            if (!ref?.startsWith(TEMPLATE_REF)) continue;
            const child = templates.find((t) => `${TEMPLATE_REF}${t.id}` === ref);
            if (child) graphs.push(child.graph);
        }
        return [...new Set(graphs.flatMap((g) => g.nodes.flatMap((n) => (n.agent_id ? [n.agent_id] : []))))];
    },

    /**
     * Has this workflow been edited since it last took its upstream?
     *
     * The `workflows_set_updated_at` trigger moves `updated_at` on every write,
     * including the upgrade's own, which is why the comparison is against
     * `marketplace_pulled_at` rather than `created_at`: the upgrade sets both
     * together, so the baseline resets and an upgraded workflow does not read as
     * edited forever after.
     */
    isEditedSincePull(w: IWorkflow): boolean {
        if (!w.marketplace_pulled_at) return false;
        return new Date(w.updated_at).getTime() > new Date(w.marketplace_pulled_at).getTime();
    },

    /**
     * Overwrite a workflow's portable fields and graph from its source, and
     * reset the pull baseline. Shared by both upgrade paths so a template
     * upgrade and a published-entry upgrade cannot drift apart.
     */
    async applySource(
        id: string,
        source: { name: string; description?: string | null | undefined },
        graph: IWorkflowGraph,
        version: number
    ): Promise<void> {
        const wf = await this.get(id);
        if (!wf) throw new ApiError('not_found', 'Workflow not found', 404);
        await assertValidGraph(graph, { input_kind: wf.input_kind, project_id: wf.project_id, id });
        await db
            .updateTable('workflows')
            .set({
                description: source.description ?? null,
                graph: JSON.stringify(graph),
                marketplace_pulled_version: version,
                // Same statement AND the same clock as the trigger's `updated_at`.
                // now() is fixed for the transaction, so the two are identical and
                // the row reads as untouched immediately after an upgrade.
                marketplace_pulled_at: sql<string>`now()`,
            })
            .where('id', '=', id)
            .execute();
        broadcastWorkflowsChanged();
    },

    /**
     * Re-apply a template to the workflow that came from it.
     *
     * Explicit, so it applies whatever the Owner has changed — asking for an
     * upgrade IS the decision. The automatic path (import) is the one that
     * checks `isEditedSincePull` first, because there nobody asked.
     */
    async upgradeFromTemplate(id: string): Promise<IWorkflow> {
        const wf = await this.get(id);
        if (!wf) throw new ApiError('not_found', 'Workflow not found', 404);
        if (!wf.marketplace_source_id) {
            throw new ApiError('validation_error', 'This workflow did not come from the marketplace', 400);
        }
        const template = this.listTemplates().find((t) => t.id === wf.marketplace_source_id);
        if (!template) throw new ApiError('not_found', 'Template not found', 404);
        if (!wf.project_id) throw new ApiError('validation_error', 'Workflow has no project', 400);

        // Same closure the initial create resolves, so an upgrade can never
        // leave the graph pointing at an agent that was added upstream.
        await marketplaceService.resolveAgentDependencies(this.templateAgentIds(template.id), { link: true });

        const nodes = [];
        for (const { sub_workflow_id, ...rest } of template.graph.nodes) {
            const sub = await this.resolveTemplateRef(sub_workflow_id, wf.project_id);
            nodes.push({ ...rest, ...(sub ? { sub_workflow_id: sub } : {}) });
        }
        const graph = { nodes, edges: template.graph.edges };
        await assertValidGraph(graph, { input_kind: template.input_kind, project_id: wf.project_id, id });
        await db
            .updateTable('workflows')
            .set({
                description: template.description,
                graph: JSON.stringify(graph),
                marketplace_pulled_version: template.version,
                marketplace_pulled_at: sql<string>`now()`,
            })
            .where('id', '=', id)
            .execute();
        broadcastWorkflowsChanged();
        return (await this.get(id)) as IWorkflow;
    },

    async listRuns(workflowId: string, limit = 50): Promise<IWorkflowRunSummary[]> {
        const rows = await db
            .selectFrom('workflow_runs as wr')
            .leftJoin('items as i', 'i.id', 'wr.item_id')
            .selectAll('wr')
            .select('i.title as item_title')
            .where('wr.workflow_id', '=', workflowId)
            .orderBy('wr.started_at', 'desc')
            .limit(limit)
            .execute();
        return rows.map((r) => asRunSummary(r as never));
    },

    async listRunsForItem(itemId: string): Promise<IWorkflowRunSummary[]> {
        const rows = await db
            .selectFrom('workflow_runs as wr')
            .leftJoin('items as i', 'i.id', 'wr.item_id')
            .selectAll('wr')
            .select('i.title as item_title')
            .where('wr.item_id', '=', itemId)
            .orderBy('wr.started_at', 'desc')
            .limit(20)
            .execute();
        return rows.map((r) => asRunSummary(r as never));
    },

    async getRun(runId: string): Promise<IWorkflowRunDetail | null> {
        const row = await db
            .selectFrom('workflow_runs as wr')
            .innerJoin('workflows as w', 'w.id', 'wr.workflow_id')
            .leftJoin('items as i', 'i.id', 'wr.item_id')
            .selectAll('wr')
            .select(['i.title as item_title', 'w.name as workflow_name'])
            .where('wr.id', '=', runId)
            .executeTakeFirst();
        if (!row) return null;
        const steps = await db
            .selectFrom('agent_runs as ar')
            .leftJoin('agents as a', 'a.id', 'ar.agent_id')
            .select([
                'ar.id',
                'ar.node_id',
                'ar.agent_id',
                'a.name as agent_name',
                'ar.status',
                'ar.cli',
                'ar.model',
                'ar.effort',
                'ar.outcome_kind',
                'ar.outcome_summary',
                'ar.outcome_reason',
                'ar.total_cost_usd',
                'ar.started_at',
                'ar.completed_at',
            ])
            .where('ar.workflow_run_id', '=', runId)
            .orderBy('ar.created_at', 'asc')
            .execute();
        const children = await db
            .selectFrom('workflow_runs as wr')
            .leftJoin('items as i', 'i.id', 'wr.item_id')
            .selectAll('wr')
            .select('i.title as item_title')
            .where('wr.parent_workflow_run_id', '=', runId)
            .orderBy('wr.started_at', 'asc')
            .execute();
        return {
            ...asRunSummary(row as never),
            workflow_name: row.workflow_name,
            children: children.map((c) => asRunSummary(c as never)),
            total_cost_usd: await runCost([runId, ...children.map((c) => c.id)]),
            steps: steps.map((s) => ({
                id: s.id,
                node_id: s.node_id ?? null,
                agent_id: s.agent_id,
                agent_name: s.agent_name ?? null,
                status: s.status,
                cli: s.cli ?? null,
                model: s.model ?? null,
                // agent_runs.effort is plain text; the runner only writes AgentEffort values.
                effort: (s.effort as AgentEffort | null) ?? null,
                outcome_kind: s.outcome_kind ?? null,
                outcome_summary: s.outcome_summary ?? null,
                outcome_reason: s.outcome_reason ?? null,
                total_cost_usd: s.total_cost_usd === null ? null : Number(s.total_cost_usd),
                started_at: s.started_at ?? null,
                completed_at: s.completed_at ?? null,
            })),
        };
    },

    /** Queue (or unqueue) an item for a workflow. */
    async setItemWorkflow(itemId: string, workflowId: string | null): Promise<void> {
        const item = await db
            .selectFrom('items')
            .select(['id', 'type', 'project_id', 'status', 'repo_ids'])
            .where('id', '=', itemId)
            .executeTakeFirst();
        if (!item) throw new ApiError('not_found', 'Item not found', 404);
        if (workflowId) {
            // ADR 0018 — a Task's repos can be removed out from under it; a run
            // with nothing to check out would fail at worktree provisioning.
            if ((item.repo_ids ?? []).length === 0) {
                throw new ApiError('conflict', 'This Task has no repos — add one to the project first', 409);
            }
            // Sub-tasks run inside their Task's workflow run (ADR 0015).
            if (item.type !== 'task') throw new ApiError('validation_error', 'Only Tasks are queued for workflows', 400);
            const wf = await this.get(workflowId);
            if (!wf) throw new ApiError('not_found', 'Workflow not found', 404);
            if (wf.input_kind !== 'item') throw new ApiError('validation_error', 'That workflow does not take Tasks', 400);
            if (wf.project_id && wf.project_id !== item.project_id) {
                throw new ApiError('validation_error', 'That workflow belongs to a different project', 400);
            }
        }
        // Assigning a draft Task queues it: dispatch only picks up Ready Tasks,
        // and "pick a workflow, then also set Ready" was one step too many.
        const queue = workflowId !== null && item.status === 'draft';
        await db
            .updateTable('items')
            .set({ workflow_id: workflowId, ...(queue ? { status: 'ready' } : {}) })
            .where('id', '=', itemId)
            .execute();
        if (queue) {
            await eventsLog.record({
                item_id: itemId,
                item_type: item.type as IssueType,
                event_type: 'status_changed',
                actor_agent_id: null,
                field: 'status',
                from_value: 'draft',
                to_value: 'ready',
                detail: `queued_for_workflow: ${workflowId}`,
            });
        }
        broadcastSSE({ type: 'counts_changed', issueType: item.type as IssueType, issueId: itemId });
    },

    /** Delete guard: a workflow a Sub-tasks step runs cannot be deleted. */
    async workflowsUsingSubWorkflow(workflowId: string): Promise<Array<{ id: string; name: string }>> {
        return db
            .selectFrom('workflows')
            .select(['id', 'name'])
            .where('graph', '@>', JSON.stringify({ nodes: [{ sub_workflow_id: workflowId }] }) as never)
            .execute();
    },

    /** Agent delete guard: an agent a workflow graph uses cannot be deleted. */
    async workflowsUsingAgent(agentId: string): Promise<Array<{ id: string; name: string }>> {
        const rows = await db
            .selectFrom('workflows')
            .select(['id', 'name'])
            .where('graph', '@>', JSON.stringify({ nodes: [{ agent_id: agentId }] }) as never)
            .execute();
        return rows;
    },
};
