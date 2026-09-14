// Workflow CRUD, starter templates and run read-models (ADR 0014). Execution
// lives in `workflow-engine.ts`.

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    WorkflowGraphSchema,
    validateWorkflowGraph,
    type CreateWorkflowInput,
    type IWorkflow,
    type IWorkflowGraph,
    type IWorkflowRunDetail,
    type IWorkflowRunSummary,
    type IWorkflowTemplate,
    type IssueType,
    type UpdateWorkflowInput,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';
import { materializeCron } from './cron-materializer.js';
import { computeNextWorkflowFire } from './workflow-engine.js';
import { marketplaceService } from './marketplace.js';
import { broadcastSSE } from '../routes/events.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'marketplace', 'workflows');
// End nodes in templates name the child workflow by template (`template:dev`);
// it resolves to that template's workflow in the same project, if one exists.
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
        max_loops: row['max_loops'] as number,
        schedule_preset: (row['schedule_preset'] as IWorkflow['schedule_preset']) ?? null,
        schedule_time_of_day: (row['schedule_time_of_day'] as string | null) ?? null,
        schedule_weekday: (row['schedule_weekday'] as number | null) ?? null,
        cron_expr: (row['cron_expr'] as string | null) ?? null,
        next_run_at: (row['next_run_at'] as string | null) ?? null,
        last_run_at: (row['last_run_at'] as string | null) ?? null,
        created_at: row['created_at'] as string,
        updated_at: row['updated_at'] as string,
    };
}

function asRunSummary(row: Record<string, unknown>): IWorkflowRunSummary {
    return {
        id: row['id'] as string,
        workflow_id: row['workflow_id'] as string,
        item_id: (row['item_id'] as string | null) ?? null,
        project_id: (row['project_id'] as string | null) ?? null,
        status: row['status'] as IWorkflowRunSummary['status'],
        graph_snapshot: row['graph_snapshot'] as IWorkflowGraph,
        current_node_id: (row['current_node_id'] as string | null) ?? null,
        parked_node_id: (row['parked_node_id'] as string | null) ?? null,
        loop_count: row['loop_count'] as number,
        branch: (row['branch'] as string | null) ?? null,
        worktree_path: (row['worktree_path'] as string | null) ?? null,
        setup_done: row['setup_done'] as boolean,
        pr_url: (row['pr_url'] as string | null) ?? null,
        started_at: row['started_at'] as string,
        updated_at: row['updated_at'] as string,
        finished_at: (row['finished_at'] as string | null) ?? null,
        item_title: (row['item_title'] as string | null) ?? null,
    };
}

async function assertValidGraph(graph: IWorkflowGraph): Promise<void> {
    const errors = validateWorkflowGraph(graph);
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
    if (errors.length > 0) {
        throw new ApiError('validation_error', errors[0]?.message ?? 'Invalid workflow graph', 400, { graph_errors: errors });
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
            { id: 'start', type: 'start', position: { x: 0, y: 120 } },
            { id: 'end', type: 'end', position: { x: 480, y: 120 } },
        ],
        edges: [{ id: 'e-start', source: 'start', target: 'end', kind: 'pass' }],
    };
}

function broadcastWorkflowsChanged(): void {
    broadcastSSE({ type: 'counts_changed', scope: 'sidenav' });
}

export const workflowsService = {
    async list(projectId?: string): Promise<IWorkflow[]> {
        let q = db.selectFrom('workflows').selectAll().orderBy('name', 'asc');
        if (projectId) q = q.where('project_id', '=', projectId);
        return (await q.execute()).map((r) => asWorkflow(r as never));
    },

    async get(id: string): Promise<IWorkflow | null> {
        const row = await db.selectFrom('workflows').selectAll().where('id', '=', id).executeTakeFirst();
        return row ? asWorkflow(row as never) : null;
    },

    async create(input: CreateWorkflowInput): Promise<IWorkflow> {
        const graph = input.graph ?? emptyGraph();
        await assertValidGraph(graph);
        const base = {
            project_id: input.project_id ?? null,
            input_kind: input.input_kind ?? 'item',
            use_worktree: input.use_worktree ?? true,
        };
        assertProjectRule(base);
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
                status: input.status ?? 'active',
                graph: JSON.stringify(graph),
                trigger: input.trigger ?? 'manual',
                push_code: input.push_code ?? true,
                raises_pr: input.raises_pr ?? true,
                max_loops: input.max_loops ?? 3,
                schedule_preset: input.schedule_preset ?? null,
                schedule_time_of_day: input.schedule_time_of_day ?? null,
                schedule_weekday: input.schedule_weekday ?? null,
                ...schedule,
            })
            .execute();
        broadcastWorkflowsChanged();
        return (await this.get(id)) as IWorkflow;
    },

    async update(id: string, patch: UpdateWorkflowInput): Promise<IWorkflow> {
        const current = await this.get(id);
        if (!current) throw new ApiError('not_found', 'Workflow not found', 404);
        if (patch.graph) await assertValidGraph(patch.graph);
        const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const merged = { ...current, ...defined } as IWorkflow;
        assertProjectRule(merged);
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

    /** Installs any catalog agents the template needs, then creates the workflow. */
    async createFromTemplate(templateId: string, projectId: string): Promise<IWorkflow> {
        const template = this.listTemplates().find((t) => t.id === templateId);
        if (!template) throw new ApiError('not_found', 'Template not found', 404);
        const project = await db.selectFrom('projects').select('id').where('id', '=', projectId).executeTakeFirst();
        if (!project) throw new ApiError('not_found', 'Project not found', 404);

        for (const agentId of new Set(template.graph.nodes.flatMap((n) => (n.agent_id ? [n.agent_id] : [])))) {
            const exists = await db.selectFrom('agents').select('id').where('id', '=', agentId).executeTakeFirst();
            if (!exists) await marketplaceService.install(agentId);
        }

        const nodes = [];
        for (const node of template.graph.nodes) {
            if (node.child_workflow_id?.startsWith(TEMPLATE_REF)) {
                const childTemplate = this.listTemplates().find((t) => `${TEMPLATE_REF}${t.id}` === node.child_workflow_id);
                const child = childTemplate
                    ? await db
                          .selectFrom('workflows')
                          .select('id')
                          .where('project_id', '=', projectId)
                          .where('name', '=', childTemplate.name)
                          .executeTakeFirst()
                    : undefined;
                const { child_workflow_id: _ref, ...rest } = node;
                nodes.push(child ? { ...rest, child_workflow_id: child.id } : rest);
            } else {
                nodes.push(node);
            }
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
            graph: { nodes, edges: template.graph.edges },
        });
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
        return {
            ...asRunSummary(row as never),
            workflow_name: row.workflow_name,
            steps: steps.map((s) => ({
                id: s.id,
                node_id: s.node_id ?? null,
                agent_id: s.agent_id,
                agent_name: s.agent_name ?? null,
                status: s.status,
                cli: s.cli ?? null,
                model: s.model ?? null,
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
        const item = await db.selectFrom('items').select(['id', 'type', 'project_id']).where('id', '=', itemId).executeTakeFirst();
        if (!item) throw new ApiError('not_found', 'Item not found', 404);
        if (workflowId) {
            const wf = await this.get(workflowId);
            if (!wf) throw new ApiError('not_found', 'Workflow not found', 404);
            if (wf.input_kind !== 'item') throw new ApiError('validation_error', 'That workflow does not take items', 400);
            if (wf.project_id && wf.project_id !== item.project_id) {
                throw new ApiError('validation_error', 'That workflow belongs to a different project', 400);
            }
        }
        await db.updateTable('items').set({ workflow_id: workflowId }).where('id', '=', itemId).execute();
        broadcastSSE({ type: 'counts_changed', issueType: item.type as IssueType, issueId: itemId });
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
