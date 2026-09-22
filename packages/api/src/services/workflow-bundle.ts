// Workflow bundle: a zip that imports into any Atlas install.
//
//   workflow.json          the workflow's portable fields (no id, no project)
//                          and `format_version`
//   workflows/<ref>.json   each sub-workflow its Sub-tasks steps run; those
//                          steps' `sub_workflow_id` is the bundle-local <ref>
//   agents/<agent-id>/     every agent the graphs use, in the agent bundle
//                          format (`agent-bundle.ts`)

import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { sql, type Selectable } from 'kysely';
import { z } from 'zod';
import {
    CreateWorkflowSchema,
    WORKFLOW_INPUT_KINDS,
    WorkflowGraphSchema,
    type IPublishedWorkflow,
    type IPublishedWorkflowDetail,
    type IWorkflow,
    type IWorkflowGraph,
    type IWorkflowImportResult,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import type { PublishedWorkflowsTable } from '../db/types.js';
import { ApiError } from '../utils/errors.js';
import { AgentBundleParseError, readAgentBundle, writeAgentBundle, type AgentBundle } from './agent-bundle.js';
import { ModelNotInRegistryError } from './agents.js';
import { MarketplaceNotFoundError, marketplaceService } from './marketplace.js';
import { workflowsService } from './workflows.js';

const PortableWorkflowSchema = CreateWorkflowSchema.omit({ project_id: true, status: true }).extend({
    input_kind: z.enum(WORKFLOW_INPUT_KINDS),
    graph: WorkflowGraphSchema,
});
type PortableWorkflow = z.infer<typeof PortableWorkflowSchema>;

export interface WorkflowBundle {
    workflow: PortableWorkflow;
    /** By bundle-local ref. */
    sub_workflows: Map<string, PortableWorkflow>;
    /** Every agent the graphs reference, by agent id. */
    agents: Map<string, AgentBundle>;
}

const TEMPLATE_REF = 'template:';

/** Bump when a bundle changes in a way an older Atlas can't read. */
const WORKFLOW_BUNDLE_FORMAT = 1;

const bad = (message: string) => new ApiError('validation_error', `Workflow bundle: ${message}`, 400);
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

function subRefs(graph: IWorkflowGraph): string[] {
    return [...new Set(graph.nodes.flatMap((n) => (n.type === 'subtasks' && n.sub_workflow_id ? [n.sub_workflow_id] : [])))];
}

function agentRefs(graphs: IWorkflowGraph[]): string[] {
    return [...new Set(graphs.flatMap((g) => g.nodes.flatMap((n) => (n.agent_id ? [n.agent_id] : []))))];
}

function remapSubs(graph: IWorkflowGraph, ids: Map<string, string>): IWorkflowGraph {
    return {
        ...graph,
        nodes: graph.nodes.map((n) => (n.sub_workflow_id && ids.has(n.sub_workflow_id) ? { ...n, sub_workflow_id: ids.get(n.sub_workflow_id) } : n)),
    };
}

function slug(name: string, taken: Set<string>): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
    let ref = base;
    for (let i = 2; taken.has(ref); i++) ref = `${base}-${i}`;
    taken.add(ref);
    return ref;
}

/** "Delivery" → "Delivery (imported)" → "Delivery (imported 2)" … */
function uniqueName(name: string, taken: Set<string>): string {
    let next = name;
    for (let n = 1; taken.has(next); n++) next = `${name} (imported${n === 1 ? '' : ` ${n}`})`;
    taken.add(next);
    return next;
}

async function pack(
    root: unknown,
    loadSub: (id: string) => Promise<unknown>,
    loadAgent: (id: string) => Promise<AgentBundle>,
): Promise<{ filename: string; data: Buffer }> {
    // Parsing strips everything local (id, project, status, timestamps).
    const workflow = PortableWorkflowSchema.parse(root);
    const zip = new JSZip();
    const refs = new Map<string, string>();
    const taken = new Set<string>();
    const graphs = [workflow.graph];
    for (const id of subRefs(workflow.graph)) {
        const raw = await loadSub(id);
        if (!raw) throw new ApiError('not_found', `Sub-workflow ${id} does not exist`, 404);
        const sub = PortableWorkflowSchema.parse(raw);
        const ref = slug(sub.name, taken);
        refs.set(id, ref);
        graphs.push(sub.graph);
        zip.file(`workflows/${ref}.json`, json(sub));
    }
    zip.file('workflow.json', json({ format_version: WORKFLOW_BUNDLE_FORMAT, ...workflow, graph: remapSubs(workflow.graph, refs) }));
    for (const id of agentRefs(graphs)) {
        let agent: AgentBundle;
        try {
            agent = await loadAgent(id);
        } catch (err) {
            if (err instanceof MarketplaceNotFoundError) throw new ApiError('not_found', `Agent ${id} does not exist`, 404);
            throw err;
        }
        // folder() is null only for a RegExp argument.
        writeAgentBundle(zip.folder(`agents/${id}`)!, agent);
    }
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { filename: `${slug(workflow.name, new Set())}.zip`, data };
}

export async function exportWorkflowBundle(workflowId: string): Promise<{ filename: string; data: Buffer }> {
    const wf = await workflowsService.get(workflowId);
    if (!wf) throw new ApiError('not_found', 'Workflow not found', 404);
    return pack(wf, (id) => workflowsService.get(id), (id) => marketplaceService.localBundle(id));
}

/** A shipped template, its `template:` sub-workflows and its catalog agents. */
export async function exportTemplateBundle(templateId: string): Promise<{ filename: string; data: Buffer }> {
    const templates = workflowsService.listTemplates();
    const template = templates.find((t) => t.id === templateId);
    if (!template) throw new ApiError('not_found', 'Template not found', 404);
    return pack(
        template,
        async (ref) => templates.find((t) => `${TEMPLATE_REF}${t.id}` === ref) ?? null,
        (id) => marketplaceService.catalogBundle(id),
    );
}

async function readWorkflowJson(zip: JSZip, path: string): Promise<PortableWorkflow> {
    const raw = await zip.file(path)?.async('string');
    if (raw === undefined) throw bad(`missing ${path}`);
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw bad(`${path} is not valid JSON: ${(err as Error).message}`);
    }
    // Checked before the schema: a newer format may not parse as this one.
    // Bundles from before format_version existed are format 1.
    const format = (parsed as { format_version?: unknown } | null)?.format_version ?? 1;
    if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) throw bad(`${path} has an invalid format_version`);
    if (format > WORKFLOW_BUNDLE_FORMAT) throw bad(`made by a newer Atlas (format ${format}); update Atlas to import it`);
    const result = PortableWorkflowSchema.safeParse(parsed);
    if (!result.success) {
        throw bad(`${path} failed validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    return result.data;
}

export async function unpackWorkflowBundle(data: Buffer | Uint8Array): Promise<WorkflowBundle> {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(data);
    } catch (err) {
        throw bad(`not a valid zip archive: ${(err as Error).message}`);
    }
    const workflow = await readWorkflowJson(zip, 'workflow.json');
    const sub_workflows = new Map<string, PortableWorkflow>();
    for (const ref of subRefs(workflow.graph)) sub_workflows.set(ref, await readWorkflowJson(zip, `workflows/${ref}.json`));
    const agents = new Map<string, AgentBundle>();
    for (const id of agentRefs([workflow.graph, ...[...sub_workflows.values()].map((w) => w.graph)])) {
        if (!zip.file(`agents/${id}/manifest.json`)) throw bad(`missing agents/${id}/manifest.json`);
        try {
            // folder() is null only for a RegExp argument.
            agents.set(id, await readAgentBundle(zip.folder(`agents/${id}`)!));
        } catch (err) {
            if (err instanceof AgentBundleParseError) throw bad(`agents/${id}/${err.message}`);
            throw err;
        }
    }
    return { workflow, sub_workflows, agents };
}

/**
 * Creates the bundle's workflows in one project. Agents already installed
 * are reused untouched; missing ones are imported from the bundle. All or
 * nothing: a failure deletes whatever this import created.
 */
/**
 * `source` is set when the bundle came from a marketplace entry rather than an
 * uploaded file, and is what lets the imported workflow be upgraded later. An
 * uploaded zip passes nothing: it came from "somewhere else" and has no
 * upstream to track, exactly as `marketplaceService.importBundle` treats the
 * agents inside it.
 */
export async function importWorkflowBundle(
    bundle: WorkflowBundle,
    projectId: string,
    source?: { id: string; version: number }
): Promise<IWorkflowImportResult> {
    const project = await db.selectFrom('projects').select('id').where('id', '=', projectId).executeTakeFirst();
    if (!project) throw new ApiError('not_found', 'Project not found', 404);

    const agentIds = [...bundle.agents.keys()];
    const existing = new Set(
        agentIds.length > 0 ? (await db.selectFrom('agents').select('id').where('id', 'in', agentIds).execute()).map((a) => a.id) : [],
    );
    const names = new Set((await db.selectFrom('workflows').select('name').where('project_id', '=', projectId).execute()).map((w) => w.name));
    const installed: string[] = [];
    const created: string[] = [];
    const upgradedWorkflows: string[] = [];
    const skippedWorkflows: string[] = [];
    const reusedWorkflows: string[] = [];
    const create = async (w: PortableWorkflow, graph: IWorkflowGraph, provenance?: { source_id: string; pulled_version: number }) => {
        // A scheduled workflow would start firing agents on its own; it
        // arrives paused so the Owner turns it on after a look.
        const wf = await workflowsService.create({
            ...w,
            graph,
            name: uniqueName(w.name, names),
            project_id: projectId,
            status: w.trigger === 'schedule' ? 'inactive' : 'active',
        }, provenance);
        created.push(wf.id);
        return wf;
    };

    // workflowsService.create and marketplaceService.importBundle each commit
    // on their own, so the rollback is explicit.
    try {
        // Missing agents come from the BUNDLE, not the catalog: an uploaded
        // zip may reference agents the catalog has never heard of, and those
        // stay deliberately un-back-linked (`importBundle` nulls provenance).
        //
        // Agents that are already here are a different question, and the old
        // `if (existing.has(id)) continue;` answered it wrongly — it skipped
        // them whatever version they were, so a workflow could import
        // "successfully" onto agents that no longer matched the graph it
        // shipped with. `link` lets a catalog-linked one be brought up to date,
        // unless the Owner has edited it.
        const agentReport = await marketplaceService.resolveAgentDependencies([...bundle.agents.keys()], {
            install: async (id) => {
                const agent = bundle.agents.get(id);
                /* v8 ignore next -- id comes from bundle.agents.keys(), so the lookup always hits */
                if (!agent) return;
                await marketplaceService.importBundle(agent, { agent_id: id });
            },
            link: true,
        });
        installed.push(...agentReport.installed);
        // The engine parks on an inactive agent (same as createFromTemplate).
        if (installed.length > 0) await db.updateTable('agents').set({ status: 'active' }).where('id', 'in', installed).execute();

        // Reuse-or-create, keyed on provenance. Importing the same marketplace
        // entry twice used to fork the whole tree -- "Delivery (imported)",
        // "Test sub-task (imported 2)" -- and every copy landed with a NULL
        // source id, so the duplicates were unupgradable as well as unwanted.
        //
        // Only marketplace-sourced imports reuse. An uploaded zip keeps the old
        // suffixing behaviour: it came from somewhere else, has no upstream, and
        // two uploads of two different files that happen to share a name are
        // genuinely two workflows.
        const reuseOrCreate = async (
            w: PortableWorkflow,
            graph: IWorkflowGraph,
            sourceId: string | null
        ): Promise<IWorkflow> => {
            if (!source || !sourceId) return create(w, graph);
            const existing = await db
                .selectFrom('workflows')
                .select('id')
                .where('project_id', '=', projectId)
                .where('marketplace_source_id', '=', sourceId)
                .executeTakeFirst();
            if (!existing) {
                return create(w, graph, { source_id: sourceId, pulled_version: source.version });
            }
            const current = await workflowsService.get(existing.id);
            /* v8 ignore next -- the row was just selected, so it resolves */
            if (!current) return create(w, graph, { source_id: sourceId, pulled_version: source.version });
            // Behind and untouched -> bring it up. Edited since it was pulled ->
            // leave it exactly as the Owner left it and report it; the explicit
            // upgrade endpoint is still there when they want it.
            const stale = (current.marketplace_pulled_version ?? 0) < source.version;
            if (stale && !workflowsService.isEditedSincePull(current)) {
                await workflowsService.applySource(existing.id, w, graph, source.version);
                upgradedWorkflows.push(existing.id);
                return (await workflowsService.get(existing.id)) as IWorkflow;
            }
            if (stale) skippedWorkflows.push(existing.id);
            reusedWorkflows.push(existing.id);
            return current;
        };

        const subIds = new Map<string, string>();
        const sub_workflows = [];
        for (const [ref, sub] of bundle.sub_workflows) {
            // A sub-workflow belongs to the entry rather than being one, so its
            // id is scoped to the entry it arrived in.
            const wf = await reuseOrCreate(sub, sub.graph, source ? `${source.id}:${ref}` : null);
            subIds.set(ref, wf.id);
            sub_workflows.push(wf);
        }
        const workflow = await reuseOrCreate(
            bundle.workflow,
            remapSubs(bundle.workflow.graph, subIds),
            source ? source.id : null
        );
        return {
            workflow,
            sub_workflows,
            installed_agents: installed,
            reused_agents: agentIds.filter((id) => existing.has(id)),
            agents: agentReport,
            workflows: {
                created,
                upgraded: upgradedWorkflows,
                reused: reusedWorkflows,
                skipped_edited: skippedWorkflows,
            },
        };
    } catch (err) {
        if (created.length > 0) await db.deleteFrom('workflows').where('id', 'in', created).execute();
        if (installed.length > 0) await db.deleteFrom('agents').where('id', 'in', installed).execute();
        if (err instanceof ModelNotInRegistryError) throw new ApiError('validation_error', err.message, 400);
        throw err;
    }
}

// ── Marketplace: workflows the Owner published ──────────────────────────────

type PublishedRow = Selectable<PublishedWorkflowsTable>;

// pg returns timestamptz as a Date.
const iso = (v: unknown) => new Date(v as string).toISOString();

function publishedEntry(row: PublishedRow, bundle: WorkflowBundle): IPublishedWorkflow {
    const w = bundle.workflow;
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        source_workflow_id: row.source_workflow_id,
        version: row.version,
        input_kind: w.input_kind,
        // Defaults mirror workflowsService.create.
        trigger: w.trigger ?? 'manual',
        push_code: w.push_code ?? true,
        raises_pr: w.raises_pr ?? !w.push_to_default,
        push_to_default: w.push_to_default ?? false,
        agent_ids: [...bundle.agents.keys()],
        published_at: iso(row.published_at),
        updated_at: iso(row.updated_at),
    };
}

async function publishedRow(id: string): Promise<PublishedRow> {
    const row = await db.selectFrom('published_workflows').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new ApiError('not_found', 'Published workflow not found', 404);
    return row;
}

/** Stores the workflow's export bundle; publishing it again replaces its entry. */
export async function publishWorkflow(workflowId: string): Promise<IPublishedWorkflow> {
    const { data } = await exportWorkflowBundle(workflowId);
    const bundle = await unpackWorkflowBundle(data);
    const fields = { name: bundle.workflow.name, description: bundle.workflow.description ?? null, bundle: data };
    const row = await db
        .insertInto('published_workflows')
        .values({ id: randomUUID(), source_workflow_id: workflowId, ...fields })
        // Republish bumps `version`. The row is overwritten in place, so
        // without a counter an install that used this entry yesterday had no
        // way to tell it changed today — the bundle bytes simply differ.
        .onConflict((oc) =>
            oc.column('source_workflow_id').doUpdateSet({
                ...fields,
                version: sql<number>`published_workflows.version + 1`,
                updated_at: sql<string>`now()`,
            })
        )
        .returningAll()
        .executeTakeFirstOrThrow();
    return publishedEntry(row, bundle);
}

export async function listPublishedWorkflows(): Promise<IPublishedWorkflow[]> {
    const rows = await db.selectFrom('published_workflows').selectAll().orderBy('published_at', 'desc').execute();
    // ponytail: unzips every stored bundle per list call; store the summary
    // columns at publish time if the Owner ever publishes more than a few dozen.
    return Promise.all(rows.map(async (row) => publishedEntry(row, await unpackWorkflowBundle(row.bundle))));
}

export async function getPublishedWorkflow(id: string): Promise<IPublishedWorkflowDetail> {
    const row = await publishedRow(id);
    const bundle = await unpackWorkflowBundle(row.bundle);
    return {
        ...publishedEntry(row, bundle),
        graph: bundle.workflow.graph,
        sub_workflows: [...bundle.sub_workflows].map(([ref, w]) => ({ ref, name: w.name })),
    };
}

export async function publishedWorkflowZip(id: string): Promise<{ filename: string; data: Buffer }> {
    const row = await publishedRow(id);
    return { filename: `${slug(row.name, new Set())}.zip`, data: row.bundle };
}

export async function importPublishedWorkflow(id: string, projectId: string): Promise<IWorkflowImportResult> {
    const row = await publishedRow(id);
    // The imported workflow stays linked to the entry it came from, so a
    // republish (which bumps `published_workflows.version`) can be detected.
    return importWorkflowBundle(await unpackWorkflowBundle(row.bundle), projectId, {
        id: row.id,
        version: row.version,
    });
}

/**
 * Re-apply a published entry to the workflow that came from it.
 *
 * The entry's graph lives in the stored bundle, so this unpacks it, resolves
 * its sub-refs against the sub-workflows this project already has from the same
 * entry (creating any the entry has since gained), and writes the result.
 *
 * Explicit, like the template counterpart: the Owner asked, so it applies even
 * over local edits. Resolving dependencies first means an upgrade can never
 * leave the graph pointing at an agent or sub-workflow that does not exist.
 */
export async function upgradeFromPublished(workflowId: string): Promise<IWorkflow> {
    const wf = await workflowsService.get(workflowId);
    if (!wf) throw new ApiError('not_found', 'Workflow not found', 404);
    if (!wf.marketplace_source_id) throw new ApiError('validation_error', 'This workflow did not come from the marketplace', 400);
    if (!wf.project_id) throw new ApiError('validation_error', 'Workflow has no project', 400);
    const row = await publishedRow(wf.marketplace_source_id);
    const bundle = await unpackWorkflowBundle(row.bundle);

    await marketplaceService.resolveAgentDependencies([...bundle.agents.keys()], {
        install: async (id) => {
            const agent = bundle.agents.get(id);
            /* v8 ignore next -- id comes from bundle.agents.keys() */
            if (!agent) return;
            await marketplaceService.importBundle(agent, { agent_id: id });
        },
        link: true,
    });

    const subIds = new Map<string, string>();
    for (const [ref, sub] of bundle.sub_workflows) {
        const sourceId = `${row.id}:${ref}`;
        const existing = await db
            .selectFrom('workflows')
            .select('id')
            .where('project_id', '=', wf.project_id)
            .where('marketplace_source_id', '=', sourceId)
            .executeTakeFirst();
        if (existing) {
            await workflowsService.applySource(existing.id, sub, sub.graph, row.version);
            subIds.set(ref, existing.id);
        } else {
            const made = await workflowsService.create(
                { ...sub, graph: sub.graph, project_id: wf.project_id, status: sub.trigger === 'schedule' ? 'inactive' : 'active' },
                { source_id: sourceId, pulled_version: row.version }
            );
            subIds.set(ref, made.id);
        }
    }
    await workflowsService.applySource(workflowId, bundle.workflow, remapSubs(bundle.workflow.graph, subIds), row.version);
    return (await workflowsService.get(workflowId)) as IWorkflow;
}

export async function unpublishWorkflow(id: string): Promise<void> {
    const res = await db.deleteFrom('published_workflows').where('id', '=', id).executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) throw new ApiError('not_found', 'Published workflow not found', 404);
}
