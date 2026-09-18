# Workflows Phase 1: Additive Schema + Shared Graph Contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the workflow data model (tables, Kysely types, shared graph contract and validator) and start recording which cli/model/effort/prompt_version each agent run used. Runtime behavior does not change.

**Architecture:**
- `@atlas/shared` gains a `workflows/` module: node/edge/graph interfaces, a Zod `WorkflowGraphSchema` for shape, and a pure `validateWorkflowGraph` for graph rules (one Start, pass-edge DAG, reachability…). The API's PATCH route (phase 3) and the builder UI (phase 4) both call it.
- Migration `035_workflows.ts` adds `workflows` and `workflow_runs`, plus new columns on `agent_runs` and `items`. Nothing reads them yet, except `spawnAgentRun`, which now snapshots the agent's config onto each run row.

**Tech Stack:** TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Zod 4, Vitest 4, Postgres 16, Knex (migrations), Kysely (queries).

**Spec:** `docs/adr/0014-workflows-replace-agent-handoffs.md`. Phases 2–6 get their own plan after this one merges.

## Global Constraints

- `packages/shared` edits are Owner-sanctioned for this feature (ADR 0014). Touch only the files named here.
- Shared coverage threshold is **100% lines/branches/functions/statements**. Every branch in `workflows/index.ts` must be exercised.
- Named exports only; interfaces use the `I` prefix; snake_case fields; no `any`; no `!` without a WHY comment.
- Comments explain WHY only.
- Migrations are append-only, export both `up` and `down`, and use `knex.schema.raw` with CHECK constraints (no enum types).
- API responses must match `@atlas/shared` types. This phase adds **no** response fields, because run and item rows are mapped field-by-field (`services/agents.ts:124 asAgentRun`, `services/items.ts:63-192 rowTo*`).
- API tests run against a private DB so they don't queue behind other sessions: prefix every api test command with both `DATABASE_URL` and `TEST_DATABASE_URL` set to `postgres://atlas:atlas@localhost:5500/atlas_test_wf1` (globalSetup reads `DATABASE_URL`). globalSetup creates it and runs migrations.
- Git in this worktree: use `/usr/bin/git` (the rtk rewrite of `git` is refused by the worktree guard).
- Update `.agents/` docs in the same task as the code they describe.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `packages/shared/src/workflows/index.ts` | Create | Workflow enums, `IWorkflow*` interfaces, `WorkflowGraphSchema`, `validateWorkflowGraph` |
| `packages/shared/src/workflows/workflows.test.ts` | Create | Validator + schema tests (100% branch coverage) |
| `packages/shared/src/index.ts` | Modify | Re-export `./workflows/index.js` |
| `packages/api/src/db/migrations/035_workflows.ts` | Create | Tables, triggers, indexes, new columns |
| `packages/api/src/db/types.ts` | Modify | `WorkflowsTable`, `WorkflowRunsTable`, new `AgentRunsTable` / `ItemsTable` columns, `DB` keys |
| `packages/api/tests/_pg-db.ts` | Modify | Add `workflow_runs`, `workflows` to `TRUNCATE_TABLES` |
| `packages/api/vitest.config.ts` | Modify | Add both new api test files to the explicit `test.include` allow-list |
| `packages/api/src/db/workflows-migration.test.ts` | Create | Constraint behavior of migration 035 |
| `packages/api/src/services/agent-runner.ts` | Modify (~2372-2396) | Snapshot `cli/model/effort/prompt_version` on both write paths |
| `packages/api/src/services/agent-runner-run-config.integration.test.ts` | Create | Asserts the snapshot on INSERT and `existingRunId` paths |
| `.agents/data-model.md`, `.agents/api-surface.md` | Modify | New entities, migration row, IAgentRun columns |

---

### Task 1: Shared workflow graph contract

**Files:**
- Create: `packages/shared/src/workflows/index.ts`
- Create: `packages/shared/src/workflows/workflows.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `SchedulePreset` from `packages/shared/src/types/index.ts:1398`.
- Produces, all re-exported from `@atlas/shared`:
  - `WORKFLOW_NODE_TYPES`, `WorkflowNodeType`, `WORKFLOW_EDGE_KINDS`, `WorkflowEdgeKind`, `WORKFLOW_INPUT_KINDS`, `WorkflowInputKind`, `WORKFLOW_TRIGGERS`, `WorkflowTrigger`, `WORKFLOW_RUN_STATUSES`, `WorkflowRunStatus`
  - `IWorkflowNode`, `IWorkflowEdge`, `IWorkflowGraph`, `IWorkflow`, `IWorkflowRun`, `IWorkflowGraphError { node_id: string | null; message: string }`
  - `WorkflowGraphSchema: z.ZodType<IWorkflowGraph>`
  - `validateWorkflowGraph(graph: IWorkflowGraph): IWorkflowGraphError[]`, which returns `[]` when valid

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/workflows/workflows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    WorkflowGraphSchema,
    validateWorkflowGraph,
    type IWorkflowEdge,
    type IWorkflowGraph,
    type IWorkflowNode,
    type WorkflowEdgeKind,
    type WorkflowNodeType,
} from './index.js';

const node = (id: string, type: WorkflowNodeType, extra: Partial<IWorkflowNode> = {}): IWorkflowNode => ({
    id,
    type,
    position: { x: 0, y: 0 },
    ...extra,
});

const edge = (source: string, target: string, kind: WorkflowEdgeKind = 'pass'): IWorkflowEdge => ({
    id: `${source}-${kind}-${target}`,
    source,
    target,
    kind,
});

// Start → Coder → Reviewer → End, with Reviewer failing back to Coder.
function devGraph(): IWorkflowGraph {
    return {
        nodes: [
            node('start', 'start'),
            node('coder', 'agent', { agent_id: 'agent-coder' }),
            node('review', 'agent', { agent_id: 'agent-code-reviewer' }),
            node('end', 'end', { child_workflow_id: 'wf-dev' }),
        ],
        edges: [edge('start', 'coder'), edge('coder', 'review'), edge('review', 'end'), edge('review', 'coder', 'fail')],
    };
}

const errorsOf = (graph: IWorkflowGraph): string[] =>
    validateWorkflowGraph(graph).map((e) => `${e.node_id ?? '*'}: ${e.message}`);

describe('WorkflowGraphSchema', () => {
    it('accepts a well-formed graph', () => {
        expect(WorkflowGraphSchema.safeParse(devGraph()).success).toBe(true);
    });

    it('rejects an unknown node type', () => {
        const graph = { nodes: [{ id: 'x', type: 'parallel', position: { x: 0, y: 0 } }], edges: [] };
        expect(WorkflowGraphSchema.safeParse(graph).success).toBe(false);
    });
});

describe('validateWorkflowGraph', () => {
    it('accepts a fail edge that loops back', () => {
        expect(errorsOf(devGraph())).toEqual([]);
    });

    it('rejects an empty graph', () => {
        expect(errorsOf({ nodes: [], edges: [] })).toEqual([
            '*: A workflow needs exactly one Start node',
            '*: A workflow needs at least one End node',
        ]);
    });

    it('rejects duplicate node ids and a second Start', () => {
        const graph = devGraph();
        graph.nodes.push(node('start', 'start'));
        expect(errorsOf(graph)).toEqual([
            '*: Node ids must be unique',
            '*: A workflow needs exactly one Start node',
        ]);
    });

    it('rejects edges from or to a missing node', () => {
        const graph = devGraph();
        graph.edges.push(edge('coder', 'ghost', 'fail'), edge('ghost', 'end', 'fail'));
        expect(errorsOf(graph)).toEqual([
            '*: Connection coder-fail-ghost points at a node that does not exist',
            '*: Connection ghost-fail-end points at a node that does not exist',
        ]);
    });

    it('rejects an agent node with no agent and a misplaced agent_id / child_workflow_id', () => {
        const graph = devGraph();
        graph.nodes[0] = node('start', 'start', { agent_id: 'agent-coder' });
        graph.nodes[1] = node('coder', 'agent', { child_workflow_id: 'wf-x' });
        expect(errorsOf(graph)).toEqual([
            'start: Only agent nodes reference an agent',
            'coder: Choose an agent for this node',
            'coder: Only End nodes route children to a workflow',
        ]);
    });

    it('rejects connections into Start and out of End', () => {
        const graph = devGraph();
        graph.nodes.push(node('owner', 'owner'));
        graph.edges.push(edge('end', 'owner'), edge('owner', 'start'));
        // start → coder → review → end → owner → start is also an all-pass loop.
        expect(errorsOf(graph)).toEqual([
            'start: Nothing can connect into Start',
            'end: End cannot have outgoing connections',
            'start: Pass connections form a loop; loop back with a fail connection instead',
        ]);
    });

    it('requires exactly one pass connection and limits fail connections', () => {
        const graph = devGraph();
        graph.nodes.push(node('owner', 'owner'), node('end2', 'end'));
        graph.edges.push(
            edge('start', 'end2', 'fail'),
            edge('coder', 'end2'),
            edge('coder', 'owner', 'fail'),
            edge('coder', 'end', 'fail'),
        );
        expect(errorsOf(graph)).toEqual([
            'start: Only agent nodes can have a fail connection',
            'coder: Needs exactly one pass connection',
            'coder: At most one fail connection',
            'owner: Needs exactly one pass connection',
        ]);
    });

    it('rejects nodes that Start cannot reach', () => {
        const graph = devGraph();
        graph.nodes.push(node('orphan', 'agent', { agent_id: 'agent-coder' }));
        graph.edges.push(edge('orphan', 'end'));
        expect(errorsOf(graph)).toEqual(['orphan: Not reachable from Start']);
    });

    it('rejects a loop made only of pass connections', () => {
        const graph = devGraph();
        // Every node still has exactly one pass edge; only the loop is wrong.
        // DFS from start reaches coder again while it is still `visiting`.
        graph.edges = [edge('start', 'coder'), edge('coder', 'review'), edge('review', 'coder'), edge('review', 'end', 'fail')];
        expect(errorsOf(graph)).toEqual([
            'coder: Pass connections form a loop; loop back with a fail connection instead',
        ]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @atlas/shared exec vitest run src/workflows/workflows.test.ts`
Expected: FAIL with `Failed to resolve import "./index.js"`.

- [ ] **Step 3: Implement the module**

Create `packages/shared/src/workflows/index.ts`:

```ts
import { z } from 'zod';
import type { SchedulePreset } from '../types/index.js';

export const WORKFLOW_NODE_TYPES = ['start', 'agent', 'owner', 'end'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const WORKFLOW_EDGE_KINDS = ['pass', 'fail'] as const;
export type WorkflowEdgeKind = (typeof WORKFLOW_EDGE_KINDS)[number];

export const WORKFLOW_INPUT_KINDS = ['item', 'none'] as const;
export type WorkflowInputKind = (typeof WORKFLOW_INPUT_KINDS)[number];

export const WORKFLOW_TRIGGERS = ['manual', 'schedule', 'item_ready'] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const WORKFLOW_RUN_STATUSES = ['running', 'waiting_for_owner', 'completed', 'cancelled', 'error'] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export interface IWorkflowNode {
    id: string;
    type: WorkflowNodeType;
    agent_id?: string | undefined;
    child_workflow_id?: string | undefined;
    position: { x: number; y: number };
}

export interface IWorkflowEdge {
    id: string;
    source: string;
    target: string;
    kind: WorkflowEdgeKind;
}

export interface IWorkflowGraph {
    nodes: IWorkflowNode[];
    edges: IWorkflowEdge[];
}

export interface IWorkflow {
    id: string;
    project_id: string | null;
    name: string;
    description: string | null;
    status: 'active' | 'inactive';
    graph: IWorkflowGraph;
    input_kind: WorkflowInputKind;
    trigger: WorkflowTrigger;
    use_worktree: boolean;
    push_code: boolean;
    raises_pr: boolean;
    max_loops: number;
    schedule_preset: SchedulePreset | null;
    schedule_time_of_day: string | null;
    schedule_weekday: number | null;
    cron_expr: string | null;
    next_run_at: string | null;
    last_run_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface IWorkflowRun {
    id: string;
    workflow_id: string;
    item_id: string | null;
    project_id: string | null;
    status: WorkflowRunStatus;
    graph_snapshot: IWorkflowGraph;
    current_node_id: string | null;
    parked_node_id: string | null;
    loop_count: number;
    branch: string | null;
    worktree_path: string | null;
    setup_done: boolean;
    pr_url: string | null;
    started_at: string;
    updated_at: string;
    finished_at: string | null;
}

export interface IWorkflowGraphError {
    node_id: string | null;
    message: string;
}

const ID = z.string().min(1).max(200);

export const WorkflowGraphSchema: z.ZodType<IWorkflowGraph> = z.object({
    nodes: z
        .array(
            z.object({
                id: ID,
                type: z.enum(WORKFLOW_NODE_TYPES),
                agent_id: ID.optional(),
                child_workflow_id: ID.optional(),
                position: z.object({ x: z.number(), y: z.number() }),
            }),
        )
        .max(100),
    edges: z
        .array(z.object({ id: ID, source: ID, target: ID, kind: z.enum(WORKFLOW_EDGE_KINDS) }))
        .max(300),
});

export function validateWorkflowGraph(graph: IWorkflowGraph): IWorkflowGraphError[] {
    const errors: IWorkflowGraphError[] = [];
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (ids.size !== graph.nodes.length) errors.push({ node_id: null, message: 'Node ids must be unique' });

    const starts = graph.nodes.filter((n) => n.type === 'start');
    if (starts.length !== 1) errors.push({ node_id: null, message: 'A workflow needs exactly one Start node' });
    if (!graph.nodes.some((n) => n.type === 'end')) {
        errors.push({ node_id: null, message: 'A workflow needs at least one End node' });
    }

    for (const e of graph.edges) {
        if (!ids.has(e.source) || !ids.has(e.target)) {
            errors.push({ node_id: null, message: `Connection ${e.id} points at a node that does not exist` });
        }
    }

    for (const n of graph.nodes) {
        const out = graph.edges.filter((e) => e.source === n.id);
        const passCount = out.filter((e) => e.kind === 'pass').length;
        const failCount = out.length - passCount;
        if (n.type !== 'agent' && n.agent_id) errors.push({ node_id: n.id, message: 'Only agent nodes reference an agent' });
        if (n.type === 'agent' && !n.agent_id) errors.push({ node_id: n.id, message: 'Choose an agent for this node' });
        if (n.type !== 'end' && n.child_workflow_id) {
            errors.push({ node_id: n.id, message: 'Only End nodes route children to a workflow' });
        }
        if (n.type === 'start' && graph.edges.some((e) => e.target === n.id)) {
            errors.push({ node_id: n.id, message: 'Nothing can connect into Start' });
        }
        if (n.type === 'end') {
            if (out.length > 0) errors.push({ node_id: n.id, message: 'End cannot have outgoing connections' });
            continue;
        }
        if (n.type !== 'agent' && failCount > 0) {
            errors.push({ node_id: n.id, message: 'Only agent nodes can have a fail connection' });
        }
        if (passCount !== 1) errors.push({ node_id: n.id, message: 'Needs exactly one pass connection' });
        if (n.type === 'agent' && failCount > 1) errors.push({ node_id: n.id, message: 'At most one fail connection' });
    }

    if (starts.length === 1) {
        const reached = new Set(starts.map((s) => s.id));
        const stack = [...reached];
        for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
            for (const e of graph.edges) {
                if (e.source === id && !reached.has(e.target)) {
                    reached.add(e.target);
                    stack.push(e.target);
                }
            }
        }
        for (const n of graph.nodes) {
            if (!reached.has(n.id)) errors.push({ node_id: n.id, message: 'Not reachable from Start' });
        }
    }

    // The engine caps loops by counting fail-edge traversals; a cycle of
    // pass edges would never touch that counter and could spin forever.
    const loopAt = findPassLoop(graph);
    if (loopAt !== null) {
        errors.push({ node_id: loopAt, message: 'Pass connections form a loop; loop back with a fail connection instead' });
    }

    return errors;
}

function findPassLoop(graph: IWorkflowGraph): string | null {
    const next = new Map<string, string[]>();
    for (const e of graph.edges) {
        if (e.kind === 'pass') next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
    }
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string): string | null => {
        const seen = state.get(id);
        if (seen === 'done') return null;
        if (seen === 'visiting') return id;
        state.set(id, 'visiting');
        for (const target of next.get(id) ?? []) {
            const hit = visit(target);
            if (hit !== null) return hit;
        }
        state.set(id, 'done');
        return null;
    };
    for (const n of graph.nodes) {
        const hit = visit(n.id);
        if (hit !== null) return hit;
    }
    return null;
}
```

Append to `packages/shared/src/index.ts`:

```ts
export * from './workflows/index.js';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @atlas/shared exec vitest run src/workflows/workflows.test.ts`
Expected: PASS.
- Expectations were traced by hand against the implementation. Error order follows `validateWorkflowGraph`: global checks → edges → per-node (node order) → reachability → loop.
- If a case fails, re-trace that graph before editing anything, and fix whichever side is actually wrong.

- [ ] **Step 5: Run the full shared suite with coverage, plus typecheck**

Run: `pnpm -F @atlas/shared test:coverage && pnpm -F @atlas/shared typecheck`
Expected: all tests pass and coverage stays at 100/100/100/100.
- If a branch in `workflows/index.ts` is uncovered, add a test case that exercises it. Don't add `/* v8 ignore */`.
- A likely gap is `next.get(e.source) ?? []` when a node has two pass edges, which the "requires exactly one pass connection" case covers via `coder`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/shared/src/workflows packages/shared/src/index.ts
/usr/bin/git commit -m "feat(shared): workflow graph contract and validator (ADR 0014)"
```

---

### Task 2: Migration 035 + Kysely types + docs

**Files:**
- Create: `packages/api/src/db/migrations/035_workflows.ts`
- Create: `packages/api/src/db/workflows-migration.test.ts`
- Modify: `packages/api/src/db/types.ts` (imports at :1-2, `ItemsTable` :453-501, `AgentRunsTable` :529-579, `DB` :697-736)
- Modify: `packages/api/tests/_pg-db.ts` (`TRUNCATE_TABLES`, before `'cli_sessions'`)
- Modify: `packages/api/vitest.config.ts` (`test.include` allow-list)
- Modify: `.agents/data-model.md` (new `### IWorkflow` / `### IWorkflowRun` sections before `### IProjectSchedule`), `.agents/api-surface.md` (migrations table row after 034)

**Interfaces:**
- Consumes: `IWorkflowGraph`, `WorkflowInputKind`, `WorkflowTrigger`, `WorkflowRunStatus`, `SchedulePreset` from `@atlas/shared` (Task 1).
- Produces:
  - Kysely `DB['workflows']`: `WorkflowsTable`, `DB['workflow_runs']`: `WorkflowRunsTable`.
  - `AgentRunsTable` gains `workflow_run_id`, `node_id`, `cli`, `model`, `effort`, `prompt_version`.
  - `ItemsTable` gains `workflow_id`, `created_by_workflow_run_id`.
  - DB index `workflow_runs_one_live_per_item`.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/db/workflows-migration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Insertable } from 'kysely';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';
import type { WorkflowRunsTable, WorkflowsTable } from './types.js';

const EMPTY_GRAPH = JSON.stringify({ nodes: [], edges: [] });

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Epic' });
});

afterAll(async () => {
    await closeTestDb();
});

async function insertWorkflow(overrides: Partial<Insertable<WorkflowsTable>> = {}): Promise<void> {
    await testDb
        .insertInto('workflows')
        .values({ id: 'wf-dev', project_id: 'p1', name: 'Dev', ...overrides })
        .execute();
}

function runRow(overrides: Partial<Insertable<WorkflowRunsTable>> = {}): Insertable<WorkflowRunsTable> {
    return { id: 'wr-1', workflow_id: 'wf-dev', item_id: 'ATL-1', project_id: 'p1', graph_snapshot: EMPTY_GRAPH, ...overrides };
}

describe('migration 035 — workflows', () => {
    it('lets only one live workflow run hold an item, counting parked runs as live', async () => {
        await insertWorkflow();
        await testDb.insertInto('workflow_runs').values(runRow({ status: 'waiting_for_owner' })).execute();

        await expect(
            testDb.insertInto('workflow_runs').values(runRow({ id: 'wr-2' })).execute(),
        ).rejects.toMatchObject({ code: '23505' });

        await testDb.updateTable('workflow_runs').set({ status: 'completed' }).where('id', '=', 'wr-1').execute();
        await testDb.insertInto('workflow_runs').values(runRow({ id: 'wr-2' })).execute();
    });

    it('requires a project unless the workflow takes no input and uses no worktree', async () => {
        await expect(insertWorkflow({ project_id: null })).rejects.toMatchObject({ code: '23514' });
        await insertWorkflow({ id: 'wf-news', project_id: null, input_kind: 'none', use_worktree: false });
    });

    it('defaults a new workflow to an active, manual, item-driven, PR-raising flow', async () => {
        await insertWorkflow();
        const row = await testDb.selectFrom('workflows').selectAll().where('id', '=', 'wf-dev').executeTakeFirstOrThrow();
        expect(row).toMatchObject({
            status: 'active',
            trigger: 'manual',
            input_kind: 'item',
            use_worktree: true,
            push_code: true,
            raises_pr: true,
            max_loops: 3,
            graph: { nodes: [], edges: [] },
        });
    });

    it('keeps agent step rows and items when a workflow is deleted', async () => {
        await insertAgent({ id: 'agent-coder' });
        await insertWorkflow();
        await testDb.insertInto('workflow_runs').values(runRow()).execute();
        await testDb.updateTable('items').set({ workflow_id: 'wf-dev', created_by_workflow_run_id: 'wr-1' }).where('id', '=', 'ATL-1').execute();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'run-1',
                agent_id: 'agent-coder',
                item_id: 'ATL-1',
                status: 'completed',
                workflow_run_id: 'wr-1',
                node_id: 'coder',
                cli: 'claude',
                model: 'claude-opus-4-7',
                effort: 'high',
                prompt_version: 2,
            })
            .execute();

        await testDb.deleteFrom('workflows').where('id', '=', 'wf-dev').execute();

        const step = await testDb.selectFrom('agent_runs').selectAll().where('id', '=', 'run-1').executeTakeFirstOrThrow();
        expect(step).toMatchObject({ workflow_run_id: null, node_id: 'coder', cli: 'claude', model: 'claude-opus-4-7', effort: 'high', prompt_version: 2 });
        const item = await testDb.selectFrom('items').select(['workflow_id', 'created_by_workflow_run_id']).where('id', '=', 'ATL-1').executeTakeFirstOrThrow();
        expect(item).toEqual({ workflow_id: null, created_by_workflow_run_id: null });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

First add the file to the api allow-list, or vitest reports "No test files found". In `packages/api/vitest.config.ts` `test.include`, after `'src/db/catalog-sync-migration.test.ts',`, add:

```ts
            // ADR 0014 — workflows schema constraints (migration 035).
            'src/db/workflows-migration.test.ts',
```

Run: `DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 TEST_DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 pnpm -F @atlas/api exec vitest run src/db/workflows-migration.test.ts`
Expected: FAIL at runtime with `relation "workflows" does not exist` (vitest doesn't typecheck; the missing `WorkflowsTable` type surfaces in Step 5).

- [ ] **Step 3: Write the migration**

Create `packages/api/src/db/migrations/035_workflows.ts`:

```ts
import type { Knex } from 'knex';

// Workflows (ADR 0014) — additive only. Nothing routes through these tables
// until the workflow engine lands; the agent-level schedule / handoff / git
// columns they replace are dropped in a later migration.
//
// `graph` is JSONB, not node + edge tables: the builder saves whole graphs
// and every run needs a frozen copy (`graph_snapshot`) regardless. Shape is
// enforced by `WorkflowGraphSchema` in @atlas/shared.
//
// CHECK, not enum types — same reasoning as link_kind in 020.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE public.workflows (
            id text PRIMARY KEY,
            project_id text REFERENCES public.projects(id) ON DELETE CASCADE,
            name text NOT NULL,
            description text,
            status text NOT NULL DEFAULT 'active'
                CONSTRAINT workflows_status_check CHECK (status IN ('active', 'inactive')),
            graph jsonb NOT NULL DEFAULT '{"nodes": [], "edges": []}'::jsonb,
            input_kind text NOT NULL DEFAULT 'item'
                CONSTRAINT workflows_input_kind_check CHECK (input_kind IN ('item', 'none')),
            trigger text NOT NULL DEFAULT 'manual'
                CONSTRAINT workflows_trigger_check CHECK (trigger IN ('manual', 'schedule', 'item_ready')),
            use_worktree boolean NOT NULL DEFAULT true,
            push_code boolean NOT NULL DEFAULT true,
            raises_pr boolean NOT NULL DEFAULT true,
            max_loops integer NOT NULL DEFAULT 3
                CONSTRAINT workflows_max_loops_check CHECK (max_loops BETWEEN 1 AND 20),
            schedule_preset text
                CONSTRAINT workflows_schedule_preset_check
                CHECK (schedule_preset IN ('hourly', 'every_4h', 'daily', 'weekly', 'custom')),
            schedule_time_of_day text,
            schedule_weekday integer,
            cron_expr text,
            next_run_at timestamp with time zone,
            last_run_at timestamp with time zone,
            created_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now(),
            -- An item queue or a worktree needs a repo; only a no-input,
            -- no-worktree workflow (a news digest, say) can be project-less.
            CONSTRAINT workflows_project_required_check
                CHECK (project_id IS NOT NULL OR (input_kind = 'none' AND NOT use_worktree))
        );
        CREATE TRIGGER workflows_set_updated_at BEFORE UPDATE ON public.workflows
            FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();

        CREATE TABLE public.workflow_runs (
            id text PRIMARY KEY,
            workflow_id text NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
            item_id text REFERENCES public.items(id) ON DELETE SET NULL,
            -- No FK, like agent_runs.project_id: the workflow FK already
            -- cascades on project delete.
            project_id text,
            status text NOT NULL DEFAULT 'running'
                CONSTRAINT workflow_runs_status_check
                CHECK (status IN ('running', 'waiting_for_owner', 'completed', 'cancelled', 'error')),
            graph_snapshot jsonb NOT NULL,
            current_node_id text,
            parked_node_id text,
            loop_count integer NOT NULL DEFAULT 0,
            branch text,
            worktree_path text,
            setup_done boolean NOT NULL DEFAULT false,
            pr_url text,
            started_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now(),
            finished_at timestamp with time zone
        );
        CREATE TRIGGER workflow_runs_set_updated_at BEFORE UPDATE ON public.workflow_runs
            FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();
        -- Between steps and during the End push / PR no agent_runs row is
        -- live, so agent_runs_one_live_per_item (003) cannot hold the item.
        -- A parked run still owns its worktree, so it counts as live too.
        CREATE UNIQUE INDEX workflow_runs_one_live_per_item ON public.workflow_runs (item_id)
            WHERE status IN ('running', 'waiting_for_owner');
        CREATE INDEX workflow_runs_workflow_started_idx ON public.workflow_runs (workflow_id, started_at DESC);

        -- SET NULL, not CASCADE: step rows (cost, outcome, model) are the
        -- evaluation history and must outlive a deleted workflow.
        ALTER TABLE public.agent_runs
            ADD COLUMN workflow_run_id text REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
            ADD COLUMN node_id text,
            ADD COLUMN cli text,
            ADD COLUMN model text,
            ADD COLUMN effort text,
            ADD COLUMN prompt_version integer;
        CREATE INDEX agent_runs_workflow_run_id_idx ON public.agent_runs (workflow_run_id)
            WHERE workflow_run_id IS NOT NULL;

        ALTER TABLE public.items
            ADD COLUMN workflow_id text REFERENCES public.workflows(id) ON DELETE SET NULL,
            ADD COLUMN created_by_workflow_run_id text REFERENCES public.workflow_runs(id) ON DELETE SET NULL;
        CREATE INDEX items_workflow_status_idx ON public.items (workflow_id, status)
            WHERE workflow_id IS NOT NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.items
            DROP COLUMN IF EXISTS created_by_workflow_run_id,
            DROP COLUMN IF EXISTS workflow_id;
        ALTER TABLE public.agent_runs
            DROP COLUMN IF EXISTS prompt_version,
            DROP COLUMN IF EXISTS effort,
            DROP COLUMN IF EXISTS model,
            DROP COLUMN IF EXISTS cli,
            DROP COLUMN IF EXISTS node_id,
            DROP COLUMN IF EXISTS workflow_run_id;
        DROP TABLE IF EXISTS public.workflow_runs;
        DROP TABLE IF EXISTS public.workflows;
    `);
}
```

- [ ] **Step 4: Add the Kysely types and truncate entries**

In `packages/api/src/db/types.ts`, replace line 2:

```ts
import type {
    AgentCli,
    IWorkflowGraph,
    SchedulePreset,
    WorkflowInputKind,
    WorkflowRunStatus,
    WorkflowTrigger,
} from '@atlas/shared';
```

Add at the end of `ItemsTable` (before `created_at`, :498):

```ts
    // ADR 0014 — the workflow this item is queued for, and the run that
    // created it (child routing at End for project-level runs, which have
    // no parent item to match on).
    workflow_id: StrN;
    created_by_workflow_run_id: StrN;
```

Add at the end of `AgentRunsTable` (before `created_at`, :579):

```ts
    // ADR 0014 — workflow step linkage, plus the agent config the step ran
    // with. Snapshotted at spawn so later agent edits don't rewrite history
    // that model comparison reads.
    workflow_run_id: StrN;
    node_id: StrN;
    cli: ColumnType<AgentCli | null, AgentCli | null | undefined, AgentCli | null | undefined>;
    model: StrN;
    effort: StrN;
    prompt_version: IntN;
```

Add before `export interface DB` (:697):

```ts
// ADR 0014 — see migration 035_workflows.ts. JSONB columns select as parsed
// objects; inserts / updates pass JSON.stringify'd strings (same convention
// as agent_runs.outcome_checklist).
export interface WorkflowsTable {
    id: string;
    project_id: StrN;
    name: string;
    description: StrN;
    status: ColumnType<'active' | 'inactive', 'active' | 'inactive' | undefined, 'active' | 'inactive'>;
    graph: ColumnType<IWorkflowGraph, string | undefined, string>;
    input_kind: ColumnType<WorkflowInputKind, WorkflowInputKind | undefined, WorkflowInputKind>;
    trigger: ColumnType<WorkflowTrigger, WorkflowTrigger | undefined, WorkflowTrigger>;
    use_worktree: ColumnType<boolean, boolean | undefined, boolean>;
    push_code: ColumnType<boolean, boolean | undefined, boolean>;
    raises_pr: ColumnType<boolean, boolean | undefined, boolean>;
    max_loops: Int;
    schedule_preset: ColumnType<SchedulePreset | null, SchedulePreset | null | undefined, SchedulePreset | null | undefined>;
    schedule_time_of_day: StrN;
    schedule_weekday: IntN;
    cron_expr: StrN;
    next_run_at: TSn;
    last_run_at: TSn;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface WorkflowRunsTable {
    id: string;
    workflow_id: string;
    item_id: StrN;
    project_id: StrN;
    status: ColumnType<WorkflowRunStatus, WorkflowRunStatus | undefined, WorkflowRunStatus>;
    graph_snapshot: ColumnType<IWorkflowGraph, string, string>;
    current_node_id: StrN;
    parked_node_id: StrN;
    loop_count: Int;
    branch: StrN;
    worktree_path: StrN;
    setup_done: ColumnType<boolean, boolean | undefined, boolean>;
    pr_url: StrN;
    started_at: CreatedAt;
    updated_at: UpdatedAt;
    finished_at: TSn;
}
```

Add inside `export interface DB` (after `agent_runs: AgentRunsTable;`):

```ts
    workflows: WorkflowsTable;
    workflow_runs: WorkflowRunsTable;
```

In `packages/api/tests/_pg-db.ts` `TRUNCATE_TABLES`, insert directly before `'cli_sessions',` (its comment block stays attached to it):

```ts
    // ADR 0014 — listed explicitly for the same reason as cli_sessions.
    'workflow_runs',
    'workflows',
```

- [ ] **Step 5: Run the test and the api typecheck**

Run: `DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 TEST_DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 pnpm -F @atlas/api exec vitest run src/db/workflows-migration.test.ts src/db/migrations.test.ts src/db/migrations-rollback.test.ts && pnpm -F @atlas/api typecheck`
Expected: all PASS, and typecheck `Done`.
- If `insertAgent` rejects `cli`/`model` pairs, confirm the fixture seeds `cli_models` (`tests/_items.ts:66`); it does for its defaults.
- If `timestamp` columns select as `Date` instead of `string`, match how `agent_runs.started_at` behaves. Don't change the type parser.

- [ ] **Step 6: Verify `down()` round-trips on the private DB**

`run-migrations.ts rollback` reverts a whole *batch*. On a freshly created test DB, globalSetup applied all 35 migrations as batch 1, so that command would revert the baseline too. Revert only the last migration with `migrate.down()` instead:

```bash
DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 pnpm -F @atlas/api exec tsx -e "
import Knex from 'knex';
import config from './src/db/knex-config.js';
(async () => {
  const knex = Knex(config);
  try {
    console.log('down:', await knex.migrate.down());
    console.log('up:', await knex.migrate.up());
  } finally {
    await knex.destroy();
  }
})();
"
```
Expected: `down: [ <batch>, [ '035_workflows.ts' ] ]` then `up: [ <batch>, [ '035_workflows.ts' ] ]`, with no error.
**Only ever point this at `atlas_test_wf1`, never at the `atlas` dev DB.**

- [ ] **Step 7: Update `.agents` docs**

In `.agents/data-model.md`, insert before `### IProjectSchedule`:

```markdown
### IWorkflow (ADR 0014)
**Why this entity exists**: Orchestration moves off agents. A workflow is the Owner-designed graph that decides which agents run, in what order, and where the work goes (worktree, push, PR, child workflow). Agents stay reusable across many workflows because they no longer carry routing or schedule state.

Fields: `id, project_id, name, description, status, graph, input_kind, trigger, use_worktree, push_code, raises_pr, max_loops, schedule_preset, schedule_time_of_day, schedule_weekday, cron_expr, next_run_at, last_run_at, created_at, updated_at`

- `graph` JSONB: `{ nodes: [{id, type: start|agent|owner|end, agent_id?, child_workflow_id?, position}], edges: [{id, source, target, kind: pass|fail}] }`. Shape comes from `WorkflowGraphSchema`, rules from `validateWorkflowGraph` (`@atlas/shared` `workflows/`): one Start, at least one End, one pass edge per non-End node, a fail edge only on agent nodes, pass edges acyclic, everything reachable from Start.
- `project_id` may be null only when `input_kind = 'none'` and `use_worktree = false` (`workflows_project_required_check`).
- Schedule columns mirror `IProjectSchedule` so `materializeCron` is reused.
- Phase 1 status: schema only; no route or engine reads it yet.

### IWorkflowRun (ADR 0014)
**Why this entity exists**: One execution of a workflow over one item (or the project). It owns the worktree and branch for its whole life, so consecutive agent steps share state without a push / re-provision between them.

Fields: `id, workflow_id, item_id, project_id, status, graph_snapshot, current_node_id, parked_node_id, loop_count, branch, worktree_path, setup_done, pr_url, started_at, updated_at, finished_at`

- `status` ∈ `running | waiting_for_owner | completed | cancelled | error`.
- `workflow_runs_one_live_per_item` allows one `running` or `waiting_for_owner` run per item. It covers the gaps between steps where no `agent_runs` row is live.
- Each step is an ordinary `agent_runs` row with `workflow_run_id` + `node_id` set.
```

In the `### IAgentRun` section of `.agents/data-model.md`, after the `**Two-persona columns:**` paragraph, add:

```markdown
**Workflow + config snapshot columns (migration 035):** `workflow_run_id` (FK → `workflow_runs`, ON DELETE SET NULL) and `node_id` tie a run to a workflow step. `cli`, `model`, `effort`, `prompt_version` record the agent config the run spawned with. They're written by `spawnAgentRun` on both write paths and are internal only (not on `IAgentRun` yet).
```

In `.agents/data-model.md` `### IEpic`, append a blockquote after the `> **All issue types carry a nullable `reporter_agent_id`**…` paragraph (that section is where all-item-type columns are documented):

```markdown
> **All issue types also carry `workflow_id` and `created_by_workflow_run_id`** (migration 035, ADR 0014). `workflow_id` (FK → `workflows`, SET NULL) is the workflow the item is queued for; `created_by_workflow_run_id` (FK → `workflow_runs`, SET NULL) is the run that created it. Both are internal and unused until the workflow engine lands; they're not on the per-type API shapes yet.
```

In `.agents/api-surface.md`, add a row directly after the `034_catalog_description_checklist_sync.ts` row:

```markdown
| `035_workflows.ts` | **Workflows schema (ADR 0014), additive.** Creates `workflows` (graph JSONB, input_kind, trigger, git flags, max_loops, schedule columns mirroring `project_schedules`; `workflows_project_required_check`) and `workflow_runs` (graph_snapshot, current/parked node, loop_count, branch, worktree_path, setup_done, pr_url; partial unique `workflow_runs_one_live_per_item` over `running`/`waiting_for_owner`). Adds `agent_runs.workflow_run_id` (SET NULL, keeps step history), `node_id`, `cli`, `model`, `effort`, `prompt_version`, and `items.workflow_id` / `created_by_workflow_run_id` (both SET NULL). Both tables get `atlas_set_updated_at` triggers. `down()` drops the columns, then the tables. Tested by `src/db/workflows-migration.test.ts`. |
```

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add packages/api/src/db/migrations/035_workflows.ts packages/api/src/db/workflows-migration.test.ts packages/api/src/db/types.ts packages/api/tests/_pg-db.ts packages/api/vitest.config.ts .agents/data-model.md .agents/api-surface.md
/usr/bin/git commit -m "feat(api): migration 035 adds workflows and workflow_runs (ADR 0014)"
```

---

### Task 3: Snapshot agent config onto every run

**Files:**
- Modify: `packages/api/src/services/agent-runner.ts:2372-2396` (the `existingRunId` UPDATE and the INSERT in `spawnAgentRun`)
- Create: `packages/api/src/services/agent-runner-run-config.integration.test.ts`
- Modify: `packages/api/vitest.config.ts` (`test.include`: add `'src/services/agent-runner-run-config.integration.test.ts',` right after `'src/services/agent-dispatcher.integration.test.ts',`, or the file never runs)

**Interfaces:**
- Consumes: `AgentRunsTable.cli/model/effort/prompt_version` (Task 2). `agent` is the local variable from `getAgent(agentId)` at `agent-runner.ts:2029`, with fields `cli`, `model`, `effort`, `prompt_version` (see `IAgent`, `packages/shared/src/types/index.ts:160`).
- Produces: every `agent_runs` row spawned through `spawnAgentRun` carries the agent's `cli/model/effort/prompt_version` as of spawn time. Phase 3's workflow engine and the later eval feature read these.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/services/agent-runner-run-config.integration.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnAgentRun } from './agent-runner.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

// Fake timers stop the simulated CLI (400ms setTimeout when ATLAS_AI_ENABLED
// is unset) from completing the run after the test — same reason as
// agent-dispatcher.integration.test.ts.

beforeEach(async () => {
    vi.useFakeTimers();
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active', model: 'claude-sonnet-4-6', prompt_version: 4 });
    await testDb.updateTable('agents').set({ effort: 'high' }).where('id', '=', 'agent-coder').execute();
    await insertItem({ id: 'ATL-100', type: 'epic', project_id: 'p1', title: 'Parent epic' });
    await insertItem({
        id: 'ATL-2',
        type: 'story',
        project_id: 'p1',
        parent_id: 'ATL-100',
        parent_type: 'epic',
        title: 'Story',
        status: 'ready',
        assignee_agent_id: 'agent-coder',
    });
});

afterEach(() => {
    vi.useRealTimers();
});

afterAll(async () => {
    await closeTestDb();
});

const EXPECTED = { cli: 'claude', model: 'claude-sonnet-4-6', effort: 'high', prompt_version: 4 };

describe('spawnAgentRun — agent config snapshot', () => {
    it('records cli, model, effort and prompt_version on the inserted run', async () => {
        const runId = await spawnAgentRun({ agentId: 'agent-coder', issueType: 'story', issueId: 'ATL-2' });

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['cli', 'model', 'effort', 'prompt_version'])
            .where('id', '=', runId)
            .executeTakeFirstOrThrow();
        expect(row).toEqual(EXPECTED);
    });

    it('records the same snapshot when the caller pre-inserted the row (POST /api/run path)', async () => {
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-pre', agent_id: 'agent-coder', item_id: 'ATL-2', status: 'queued', prompt_snapshot: null })
            .execute();

        await spawnAgentRun({ agentId: 'agent-coder', issueType: 'story', issueId: 'ATL-2', existingRunId: 'run-pre' });

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['cli', 'model', 'effort', 'prompt_version'])
            .where('id', '=', 'run-pre')
            .executeTakeFirstOrThrow();
        expect(row).toEqual(EXPECTED);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 TEST_DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 pnpm -F @atlas/api exec vitest run src/services/agent-runner-run-config.integration.test.ts`
Expected: FAIL on both tests, with `expected { cli: null, model: null, effort: null, prompt_version: null } to deeply equal { cli: 'claude', … }`.
- If a test instead throws before reaching the assertions (for example `spawnAgentRun` rejecting the pre-inserted row path), read `agent-runner.ts:2019-2100` for the precondition it hit and fix the **fixture**, not the runner.
- `insertAgent` accepts `prompt_version` (`tests/_items.ts:54`). `effort` is set by the UPDATE because the fixture doesn't accept it.

- [ ] **Step 3: Implement the snapshot**

In `packages/api/src/services/agent-runner.ts`, directly above `if (existingRunId) {` (~:2372), add:

```ts
    // ADR 0014 — the config this run actually spawned with. Agents are
    // editable, so reading agents.* later would misattribute cost and
    // outcomes when comparing models across runs.
    const runConfig = {
        cli: agent.cli,
        model: agent.model,
        effort: agent.effort,
        prompt_version: agent.prompt_version,
    };
```

Change the UPDATE's `.set({ prompt_snapshot: fullPrompt })` to:

```ts
            .set({ prompt_snapshot: fullPrompt, ...runConfig })
```

Add `...runConfig,` to the INSERT's `.values({ … })` object, after `started_at: now,`:

```ts
                    started_at: now,
                    ...runConfig,
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 TEST_DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 pnpm -F @atlas/api exec vitest run src/services/agent-runner-run-config.integration.test.ts && pnpm -F @atlas/api typecheck`
Expected: 2 tests PASS, typecheck `Done`.
If typecheck rejects `agent.effort` against `StrN`, check `IAgent['effort']` in shared. It's a string union, which is assignable to `string | null`, so no cast is needed.

- [ ] **Step 5: Run the runner-adjacent suites for regressions**

Run: `DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 TEST_DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 pnpm -F @atlas/api exec vitest run src/services/agent-dispatcher.integration.test.ts src/routes/run.test.ts src/services/agent-schedule-registry-tick.test.ts`
Expected: PASS, with the same pass counts as on `main`. If anything fails, run the same command on the parent checkout to confirm whether it's a pre-existing failure before touching code.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/api/src/services/agent-runner.ts packages/api/src/services/agent-runner-run-config.integration.test.ts packages/api/vitest.config.ts
/usr/bin/git commit -m "feat(api): snapshot cli, model, effort and prompt version on each agent run"
```

---

### Task 4: Phase gate + PR

**Files:** none new.

- [ ] **Step 1: Run the full gate for touched packages, one package at a time**

Run:
```bash
pnpm -F @atlas/shared typecheck && pnpm -F @atlas/shared test:coverage
DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 TEST_DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_wf1 pnpm -F @atlas/api test:coverage
pnpm -F @atlas/api typecheck && pnpm -F @atlas/web typecheck && pnpm -F @atlas/mcp typecheck
pnpm -w run lint:knip
pnpm -F @atlas/shared lint && pnpm -F @atlas/api lint
```
Expected: all green.
- Shared coverage must stay 100%; api coverage must stay at or above its tier floor (ADR 0009).
- Web and mcp typecheck confirm the shared re-export broke nothing downstream.
- If knip flags a new unused export in `packages/api`, it will be one of the new `db/types.ts` interfaces. `db/types.ts` is already in knip's `ignore`, so a flag means something else; read the message.

- [ ] **Step 2: Confirm nothing forbidden is staged, then push and open the PR**

Run: `/usr/bin/git status --short` and confirm there are no `e2e-logs/`, `.atlas/`, screenshots or `test-results/` files (AGENTS.md hard rule 6).

```bash
/usr/bin/git push -u origin worktree-workflows-phase-1
gh pr create --base main --title "Workflows phase 1: schema and shared graph contract" --body "$(cat <<'EOF'
## Summary
- ADR 0014: workflows replace per-agent schedules, handoff rules and git flags (design spec)
- `@atlas/shared` `workflows/`: node/edge/graph types, `WorkflowGraphSchema`, `validateWorkflowGraph` (100% covered)
- Migration 035: `workflows`, `workflow_runs` (one live run per item), workflow + config snapshot columns on `agent_runs`, `workflow_id` on `items`
- `spawnAgentRun` records `cli/model/effort/prompt_version` on every run

No runtime behavior change; nothing routes through workflows yet (phase 3).

## Test plan
- [ ] `pnpm -F @atlas/shared test:coverage` (100%)
- [ ] `pnpm -F @atlas/api test:coverage` incl. `workflows-migration.test.ts`, `agent-runner-run-config.integration.test.ts`
- [ ] typecheck shared / api / web / mcp, knip, lint

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01JZRiMCQ6M6BYN6r1vGHusJ
EOF
)"
```

Only push and open the PR once the Owner has confirmed they want it opened.
