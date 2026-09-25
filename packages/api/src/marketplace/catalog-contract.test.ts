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
// On the prompt budget: it is a BLOAT GUARD, not a cost lever. The PR1 baseline
// measured 18.25M cache-read tokens against 550 uncached input tokens across 38
// dispatches — roughly 480K cached tokens per dispatch, almost all of it the
// repository being pulled into context. A 1,500-token prompt is ~0.3% of one
// dispatch. Trimming well-tuned prompts would buy a rounding error and cost
// real instruction quality; the budgets below exist to catch a prompt that
// balloons, not to squeeze the ones that work.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentEffortSchema, validateWorkflowGraph } from '@atlas/shared';
import type { IWorkflowTemplate } from '@atlas/shared';
import { loadCatalog } from './catalog-loader.js';
import { AgentBundleManifestSchema } from '../services/agent-bundle.js';
import { GUARDRAIL_SCRIPT_SEEDS } from '../db/seed.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { catalogLockEntries, readCatalogLock } from './catalog-lock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = join(__dirname, 'workflows');

const catalog = loadCatalog();
const catalogIds = new Set(catalog.map((e) => e.manifest.id));

/** `cli` and `model_name` are both slugs, so a plain separator is unambiguous. */
function modelKey(cli: string, model: string): string {
    return `${cli}::${model}`;
}

/**
 * Prompt budgets, in estimated tokens. Routed SDLC agents run inside the
 * delivery chain and their prompt is read on every dispatch; the autonomous
 * scouts run standalone and one of them (AI Readiness) legitimately enumerates
 * the 8-12 documents it scaffolds.
 *
 * Headroom is deliberate — see the header. These catch a prompt doubling, not a
 * prompt that is 200 tokens over.
 */
const PROMPT_BUDGET_ROUTED = 1_800;
const PROMPT_BUDGET_AUTONOMOUS = 7_000;

// Per-agent carve-outs. A budget raised to make a check pass is the exact move
// `agent-fix-reviewer` exists to catch, so each entry names what bought the
// room — and the default stays where it is, so nothing else drifts.
//
// agent-po-writer: the Owner's brief requires it to read the codebase and
// establish whether the functionality already exists before it asks anything,
// and to ask without a question cap. Both are steps, not prose; the prompt was
// trimmed twice before this number moved. Cheap in context too — the PR1
// baseline measured ~480K cache-read tokens per dispatch, next to which a 2K
// prompt is a rounding error.
const PROMPT_BUDGET_OVERRIDE: Record<string, number> = { 'agent-po-writer': 2100 };

/** Same 4-chars-per-token heuristic `services/context-budget.ts` uses. */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function templates(): IWorkflowTemplate[] {
    return readdirSync(WORKFLOWS)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(WORKFLOWS, f), 'utf8')) as IWorkflowTemplate);
}

let registry: Set<string>;
let roleIds: Set<string>;
let scriptIds: Set<string>;

beforeAll(async () => {
    // `truncateAll()` is what RESTORES the reference registry — two test files
    // deliberately empty `cli_models` to assert on an empty one, and nothing
    // else puts it back. Without this call the contract test reads whatever
    // registry the previously-run file happened to leave behind, which made it
    // pass or fail depending on suite order.
    await truncateAll();
    const models = await testDb.selectFrom('cli_models').select(['cli', 'model_name']).execute();
    registry = new Set(models.map((m) => modelKey(m.cli, m.model_name)));
    const roles = await testDb.selectFrom('roles').select('id').execute();
    roleIds = new Set(roles.map((r) => r.id));
    // `truncateAll()` does not restore guardrail_scripts, so read the seeds the
    // way production does rather than the table.
    scriptIds = new Set(GUARDRAIL_SCRIPT_SEEDS.map((g) => g.id));
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

            it('ships at least one REQUIRED checklist row', () => {
                // `agent-runner-outcome-routing.ts` returns apply_on_pass the
                // moment the required list is empty, so an agent with none is
                // believed unconditionally when it says `done`. That is
                // campaign finding F-012, and `reviewer-checklists.test.ts`
                // only ever globbed `*-reviewer` — which is how agent-architect
                // and agent-automation, the two steps that decide what
                // everyone downstream builds, shipped able to self-certify.
                const required = entry.checklists.filter((c) => c.required);
                if (required.length === 0) {
                    throw new Error(
                        `${manifest.id} has no required checklist rows, so its \`done\` is an ` +
                            `automatic pass (agent-runner-outcome-routing.ts). See F-012.`,
                    );
                }
                expect(required.length).toBeGreaterThan(0);
            });

            it('checklist rows are well-formed and uniquely ordered', () => {
                const orders = entry.checklists.map((c) => c.sort_order);
                expect(new Set(orders).size).toBe(entry.checklists.length);
                for (const c of entry.checklists) {
                    expect(c.label.trim().length).toBeGreaterThan(0);
                    expect(typeof c.required).toBe('boolean');
                }
            });

            it('uses a six-digit hex accent colour', () => {
                expect(manifest.accent_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
            });

            it('sets effort explicitly rather than inheriting the column default', () => {
                // `effort` is passed straight through to the CLI as `--effort`
                // and is the single dial that moves how many turns an agent
                // takes. Every manifest omitted it until PR2, so the whole
                // fleet silently ran at the `'medium'` DB default and nobody
                // had ever chosen it. An unset value is not a neutral default,
                // it is an unmade decision.
                if (!manifest.effort) {
                    throw new Error(
                        `${manifest.id} does not set \`effort\`, so it inherits the DB default ` +
                            `'medium'. Choose one deliberately and record why.`,
                    );
                }
                expect(AgentEffortSchema.options).toContain(manifest.effort);
            });

            it('keeps its prompt inside the budget for its kind', () => {
                const budget =
                    PROMPT_BUDGET_OVERRIDE[manifest.id] ??
                    (manifest.role_id ? PROMPT_BUDGET_ROUTED : PROMPT_BUDGET_AUTONOMOUS);
                const size = estimateTokens(entry.prompt_md);
                if (size > budget) {
                    throw new Error(
                        `${manifest.id}/prompt.md is ~${size} tokens, over the ${budget} budget for a ` +
                            `${manifest.role_id ? 'routed' : 'autonomous'} agent. This budget is a bloat guard: ` +
                            `if the prompt genuinely needs the room, raise the constant and say why.`,
                    );
                }
                expect(size).toBeLessThanOrEqual(budget);
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

            it('references only guardrail scripts that ship as seeds', () => {
                // A gate step naming a script that does not exist resolves to
                // `unavailable` at runtime, which ADR 0020 turns into a parked
                // run rather than a failure — so it would look like a stuck
                // workflow rather than a typo.
                const missing = t.graph.nodes
                    .filter((n) => n.type === 'gate')
                    .map((n) => n.script_id)
                    .filter((id): id is string => typeof id === 'string' && !scriptIds.has(id));
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

            // An Owner node on a fail edge holds the run until a human answers.
            // That is right when the agent is asking a question and wrong when
            // it is reporting work: the Release Reviewer's `rejected` means "a
            // performer can close this", and routing it through an Owner made
            // every cross-cutting nit page the Owner (ADR 0022, amended).
            // `asked_question` still parks the run — that is engine behaviour,
            // not an edge, so the Owner stays reachable either way.
            it('routes a reviewer rejection to a performer, not to the Owner', () => {
                const ownerIds = new Set(t.graph.nodes.filter((n) => n.type === 'owner').map((n) => n.id));
                const offenders = t.graph.edges
                    .filter((e) => e.kind === 'fail' && ownerIds.has(e.target))
                    .map((e) => e.source)
                    // PO Writer is the deliberate exception: at that point there
                    // are no sub-tasks and nothing to hand work to, so its fail
                    // edge genuinely is a question.
                    .filter((src) => t.graph.nodes.find((n) => n.id === src)?.agent_id !== 'agent-po-writer');
                expect(offenders).toEqual([]);
            });
        });
    }
});

// A bundle only reaches an EXISTING install if its version goes up:
// `upgrade_available` is `installed_version < catalogVersion` and nothing more
// (`services/marketplace.ts`). Editing a prompt without bumping the version is
// therefore silent — new installs get the change, every existing one stays on
// the version it pulled, forever, and nothing anywhere says so.
//
// It already happened: three PRs of prompt, checklist and manifest edits
// shipped against `version: 1` bundles and reached nobody. It surfaced only
// because a golden-set run was about to measure the old prompts and report
// them as the new ones.
// ── Starter tests (ADR 0023 phase 4) ─────────────────────────────────────
//
// A customer installing an agent from the marketplace does it on trust. These
// are what make "does this work?" something they can press on day one — so
// what ships has to be worth pressing.

describe('starter tests', () => {
    for (const { manifest, tests } of catalog) {
        if (tests.length === 0) continue;
        describe(manifest.id, () => {
            it('gives every test an id, a name and something to act on', () => {
                for (const t of tests) {
                    expect(t.id, `${manifest.id}: every test needs an id`).toMatch(/^[a-z0-9-]+$/);
                    expect(t.name.length, `${t.id}: needs a name`).toBeGreaterThan(0);
                    expect(t.item_template.title.length, `${t.id}: needs an item to act on`).toBeGreaterThan(0);
                    expect(['task', 'sub_task']).toContain(t.item_template.issue_type);
                }
            });

            it('has unique ids', () => {
                expect(new Set(tests.map((t) => t.id)).size).toBe(tests.length);
            });

            // A test that asserts nothing passes vacuously — the shape of
            // campaign finding F-012, one level up.
            it('asserts at least one thing per test', () => {
                for (const t of tests) {
                    expect(Object.keys(t.expectations).length, `${t.id} asserts nothing`).toBeGreaterThan(0);
                }
            });

            // One run of an agent is cents, but a shipped test that can run
            // away is not shippable: the Owner pressed a button, not a blank
            // cheque.
            it('puts a cost ceiling on every test', () => {
                for (const t of tests) {
                    expect(t.expectations['max_cost_usd'], `${t.id} has no max_cost_usd`).toBeTypeOf('number');
                }
            });

            // What a starter test catches is the part that teaches. Without
            // it a red verdict is a puzzle rather than a finding.
            it('says what each test catches', () => {
                for (const t of tests) {
                    expect(t.notes.length, `${t.id} does not say what it catches`).toBeGreaterThan(40);
                }
            });
        });
    }

    // ADR 0023: "`asked_question` as a pass matters as much as `done`." A
    // starter set that can only express success cannot say that an agent
    // which asked rather than inventing a feature has SUCCEEDED — which is
    // the single most valuable thing these tests exist to check.
    it('ships at least one test where asking or refusing is the pass', () => {
        const kinds = catalog.flatMap((e) => e.tests.map((t) => t.expectations['outcome_kind']));
        expect(kinds).toContain('asked_question');
    });

    it('ships tests for a meaningful part of the fleet', () => {
        const withTests = catalog.filter((e) => e.tests.length > 0);
        expect(withTests.length).toBeGreaterThanOrEqual(8);
    });
});

describe('catalog lock', () => {
    const onDisk = catalogLockEntries();
    const locked = readCatalogLock();

    it('locks every shipped bundle', () => {
        expect(Object.keys(onDisk).sort()).toEqual(Object.keys(locked).sort());
    });

    for (const [id, now] of Object.entries(onDisk)) {
        it(`${id} bumped its version if its content changed`, () => {
            const was = locked[id];
            expect(was, `${id} is not in catalog.lock.json — run \`pnpm -F @atlas/api catalog:lock\``).toBeDefined();
            if (was!.hash === now.hash) {
                expect(now.version, `${id} content is unchanged but its version moved`).toBe(was!.version);
                return;
            }
            expect(
                now.version,
                `${id} content changed but version is still ${now.version}. ` +
                    `Every existing install is frozen at v${was!.version} and will never receive this. ` +
                    `Bump the manifest version, then run \`pnpm -F @atlas/api catalog:lock\`.`,
            ).toBeGreaterThan(was!.version);
        });
    }
});
