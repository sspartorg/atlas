// Catalog contract — the free tier of the agent eval harness.
//
// Everything Atlas ships to a customer install comes from this directory and
// from `./workflows/*.json`, and until now almost none of it was checked before
// it reached a database:
//
//   - `catalog-loader.ts:87` JSON-parses each manifest, deletes the legacy keys
//     and casts. A malformed manifest surfaces as an opaque insert failure at
//     seed time, or as a composite-FK 500 at install time.
//   - `agents.model` carries a composite FK into `cli_models(cli, model_name)`
//     with ON DELETE RESTRICT. A manifest naming a model that is not registered
//     cannot be installed at all — this is exactly how marketplace install
//     broke once before (see `packages/api/AGENTS.md`).
//   - `agents.role_id` is an FK into `roles`, and five `SdlcRole` slugs are
//     type-level only with no seeded row (`.agents/role-catalog.md`).
//   - A workflow template naming an agent that is not in the catalog installs a
//     graph whose node can never resolve; the run parks on first dispatch.
//
// These are shape assertions, not behaviour assertions. What an agent DOES is
// measured by the live golden set (`evals/`); what it IS has to be true before
// the run starts.
//
// Deliberately NOT asserted here yet: explicit `effort` on every manifest and a
// per-prompt token budget. Both land with the change that makes them true,
// because a contract test that fails on the tree it ships with is not a
// contract.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkflowGraph } from '@atlas/shared';
import type { IWorkflowTemplate } from '@atlas/shared';
import { loadCatalog } from './catalog-loader.js';
import { AgentBundleManifestSchema } from '../services/agent-bundle.js';
import { closeTestDb, testDb } from '../../tests/_pg-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = join(__dirname, 'workflows');

const catalog = loadCatalog();
const catalogIds = new Set(catalog.map((e) => e.manifest.id));

/** `cli` and `model_name` are both slugs, so a plain separator is unambiguous. */
function modelKey(cli: string, model: string): string {
    return `${cli}::${model}`;
}

function templates(): IWorkflowTemplate[] {
    return readdirSync(WORKFLOWS)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(WORKFLOWS, f), 'utf8')) as IWorkflowTemplate);
}

let registry: Set<string>;
let roleIds: Set<string>;

beforeAll(async () => {
    // Read-only: both tables are seeded by migrations, not by any test.
    const models = await testDb.selectFrom('cli_models').select(['cli', 'model_name']).execute();
    registry = new Set(models.map((m) => modelKey(m.cli, m.model_name)));
    const roles = await testDb.selectFrom('roles').select('id').execute();
    roleIds = new Set(roles.map((r) => r.id));
});

afterAll(async () => {
    await closeTestDb();
});

describe('catalog contract', () => {
    it('loads every bundle on disk', () => {
        // An empty catalog would make every per-entry case below vacuous.
        expect(catalog.length).toBeGreaterThanOrEqual(16);
    });

    it('has no duplicate sort_order', () => {
        const orders = catalog.map((e) => e.manifest.sort_order);
        expect(new Set(orders).size).toBe(orders.length);
    });

    for (const entry of catalog) {
        const { manifest } = entry;

        describe(manifest.id, () => {
            it('validates against the bundle manifest schema', () => {
                const parsed = AgentBundleManifestSchema.safeParse(manifest);
                if (!parsed.success) {
                    throw new Error(
                        `${manifest.id}/manifest.json is invalid: ` +
                            parsed.error.issues
                                .map((i) => `${i.path.join('.')}: ${i.message}`)
                                .join('; '),
                    );
                }
                expect(parsed.success).toBe(true);
            });

            it('id matches its directory', () => {
                expect(catalogIds.has(manifest.id)).toBe(true);
            });

            it('names a (cli, model) pair that is in the registry', () => {
                const key = modelKey(manifest.cli, manifest.model);
                if (!registry.has(key)) {
                    throw new Error(
                        `${manifest.id} names model '${manifest.model}' for cli '${manifest.cli}', ` +
                            `which is not in cli_models — install would fail on the composite FK.`,
                    );
                }
                expect(registry.has(key)).toBe(true);
            });

            it('names a role that exists in the catalog, or none at all', () => {
                // null is legal and means "autonomous, outside the SDLC chain".
                if (!manifest.role_id) return;
                if (!roleIds.has(manifest.role_id)) {
                    throw new Error(
                        `${manifest.id} claims role '${manifest.role_id}', which has no row in ` +
                            `\`roles\` — agentsService.create would return 400 ROLE_NOT_IN_CATALOG. ` +
                            `See .agents/role-catalog.md.`,
                    );
                }
                expect(roleIds.has(manifest.role_id)).toBe(true);
            });

            it('ships a non-empty prompt that reaches the outcome contract', () => {
                expect(entry.prompt_md.trim().length).toBeGreaterThan(0);
                // Every workflow-routed agent must reach `.atlas/outcome.md`; the
                // engine parks a run whose step emitted no `atlas-outcome` block
                // (agent-runner-outcome-routing.ts). Autonomous agents are not
                // routed by a graph, so they are exempt.
                if (manifest.role_id) {
                    expect(entry.prompt_md).toMatch(/atlas-outcome|outcome\.md/);
                }
            });

            it('uses a six-digit hex accent colour', () => {
                expect(manifest.accent_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
            });
        });
    }
});

describe('workflow templates', () => {
    const all = templates();

    it('finds the shipped templates', () => {
        expect(all.length).toBeGreaterThanOrEqual(4);
    });

    for (const t of all) {
        describe(t.id, () => {
            it('has a valid graph for its input kind', () => {
                const errors = validateWorkflowGraph(t.graph, t.input_kind);
                if (errors.length > 0) {
                    throw new Error(
                        `${t.id}: ` +
                            errors.map((e) => `${e.node_id ?? '(graph)'}: ${e.message}`).join('; '),
                    );
                }
                expect(errors).toEqual([]);
            });

            it('references only agents that exist in the catalog', () => {
                const missing = t.graph.nodes
                    .filter((n) => n.type === 'agent')
                    .map((n) => n.agent_id)
                    .filter((id): id is string => typeof id === 'string' && !catalogIds.has(id));
                expect(missing).toEqual([]);
            });

            it('references only sub-workflows that ship as templates', () => {
                const ids = new Set(all.map((x) => x.id));
                const missing = t.graph.nodes
                    .filter((n) => n.type === 'subtasks')
                    .map((n) => n.sub_workflow_id)
                    .filter((ref): ref is string => typeof ref === 'string' && ref.startsWith('template:'))
                    .map((ref) => ref.slice('template:'.length))
                    .filter((id) => !ids.has(id));
                expect(missing).toEqual([]);
            });
        });
    }
});
