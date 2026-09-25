import { execFile, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { GUARDRAIL_SCRIPT_SEEDS, runSeed } from './seed.js';
import { db } from './kysely-client.js';
import { marketplaceService } from '../services/marketplace.js';
import { loadCatalog } from '../marketplace/catalog-loader.js';
import { truncateAll } from '../../tests/_pg-db.js';

const BASELINE_SQL = readFileSync(
    resolve(__dirname, 'migrations', '001_baseline.sql'),
    'utf8',
);

describe('baseline SQL guardrails', () => {
    it('seeds the global no-test-execution guardrail row', () => {
        // The baseline SQL contains the INSERT for `seed-net-no-test-execution`
        // — a single source of truth that the constitution composer prepends
        // to every agent's compiled prompt at runtime.
        expect(BASELINE_SQL).toContain("'seed-net-no-test-execution'");
        expect(BASELINE_SQL).toContain("'side_effects_network'");
        expect(BASELINE_SQL).toMatch(
            /seed-net-no-test-execution.*side_effects_network.*Never execute the project''s test suite/s,
        );
        // Severity must be `block`, not `warn` or `ask_owner` — the rule is
        // categorical, not negotiable.
        expect(BASELINE_SQL).toMatch(/seed-net-no-test-execution[^\n]*'block'/);
    });
});

// 2026-06-04 — runSeed never creates rows in `agents`. The on-disk catalog
// is synced into `marketplace_agents` (so the Marketplace UI lists every
// entry as "Install"); users install what they need via
// `POST /api/marketplace/agents/:id/install`. This reverses the prior
// "B17 idempotent top-up" contract — auto-installing every catalog entry
// on every boot resurrected agents the Owner had explicitly deleted. See
// `.claude/plans/there-is-a-problem-zazzy-rivest.md`.
describe('runSeed — agents table is owned by marketplace install, not the seed', () => {
    beforeEach(async () => {
        await truncateAll();
    });

    it('leaves the agents table empty on a fresh install', async () => {
        await runSeed();
        const rows = await db.selectFrom('agents').select('id').execute();
        expect(rows).toEqual([]);
    });

    it('still syncs the on-disk catalog into marketplace_agents', async () => {
        await runSeed();
        const catalog = await db.selectFrom('marketplace_agents').select('id').execute();
        expect(catalog.length).toBe(loadCatalog().length);
        expect(catalog.length).toBeGreaterThan(0);
    });

    it('carries every manifest\'s cli, model and effort into marketplace_agents', async () => {
        // `effort` used to be absent from the seed row while the column
        // defaults to 'medium' and `install` copies that default onto the
        // agent — so the manifest field was dead config and the entire fleet
        // ran at 'medium' whatever the catalog declared. `effort` is the one
        // dial that changes how many turns an agent takes, so a silent
        // fallback here is the difference between choosing it and only
        // appearing to.
        await runSeed();
        const rows = await db
            .selectFrom('marketplace_agents')
            .select(['id', 'cli', 'model', 'effort'])
            .execute();
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const entry of loadCatalog()) {
            const row = byId.get(entry.manifest.id);
            expect(row, `${entry.manifest.id} missing from marketplace_agents`).toBeDefined();
            expect(row!.cli).toBe(entry.manifest.cli);
            expect(row!.model).toBe(entry.manifest.model);
            expect(row!.effort).toBe(entry.manifest.effort);
        }
    });

    it('does not resurrect an agent the Owner deleted (the bug this plan fixes)', async () => {
        await runSeed();
        await marketplaceService.install('agent-knowledge-base');
        // Hard-delete via the same path the API DELETE handler uses
        // (services/agents.ts:517). FKs CASCADE clean up dependents.
        await db.deleteFrom('agents').where('id', '=', 'agent-knowledge-base').execute();
        await runSeed();
        const row = await db
            .selectFrom('agents')
            .select('id')
            .where('id', '=', 'agent-knowledge-base')
            .executeTakeFirst();
        expect(row).toBeUndefined();
    });

    it('does not touch agents the Owner edited (prompt_version > 1)', async () => {
        await runSeed();
        await marketplaceService.install('agent-po-writer');
        const ownerEdit = '# OWNER-EDITED PROMPT — do not overwrite';
        await db
            .updateTable('agents')
            .set({ prompt_md: ownerEdit, prompt_version: 5 })
            .where('id', '=', 'agent-po-writer')
            .execute();
        await runSeed();
        const row = await db
            .selectFrom('agents')
            .select(['prompt_md', 'prompt_version'])
            .where('id', '=', 'agent-po-writer')
            .executeTakeFirst();
        expect(row?.prompt_md).toBe(ownerEdit);
        expect(row?.prompt_version).toBe(5);
    });
});

// Phase 3 — 6 per-agent SDLC validation scripts land in
// `guardrail_scripts`. The `constitution-assembler` pipeline writes
// them as `.atlas/scripts/{bash,powershell}/check-<id>.{sh,ps1}` per
// worktree; the per-agent slash-command bodies invoke them before
// emitting `outcome: done`. Idempotent via ON CONFLICT (id) DO UPDATE.
describe('GUARDRAIL_SCRIPT_SEEDS — Phase 3 per-agent validators', () => {
    const EXPECTED_IDS = [
        'prereqs',
        'po-writer-output',
        'architect-spec-md',
        'qa-writer-csv',
        // 2026-06-09 — Automation Engineer gate added (the prompt referenced
        // this script for months, but the seed was missing it; both
        // agent-automation and agent-automation-reviewer were silently
        // substituting `pnpm typecheck + pnpm lint`).
        'check-automation-tests',
        'commit-discipline',
        // 2026-09-25 (ADR 0024) — `coder-tests-green` and the four `gate-*`
        // scripts were deleted. Each of them guessed at the customer's stack:
        // a UI file-extension allowlist, a 95% coverage floor Atlas invented,
        // 100ms/200ms budgets, package-manager detection by lockfile. A gate
        // node now dispatches a checker agent that reads the repo and names
        // the command, and the engine runs that. Everything still in this list
        // checks an ATLAS artifact and assumes nothing about the project.
    ] as const;

    it('exports every seed with the canonical ids', () => {
        expect(GUARDRAIL_SCRIPT_SEEDS).toHaveLength(EXPECTED_IDS.length);
        const ids = GUARDRAIL_SCRIPT_SEEDS.map((s) => s.id).sort();
        expect(ids).toEqual([...EXPECTED_IDS].sort());
    });

    it('every seed carries non-empty body_sh and body_ps1', () => {
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            expect(seed.body_sh.length, `${seed.id} body_sh`).toBeGreaterThan(0);
            expect(seed.body_ps1.length, `${seed.id} body_ps1`).toBeGreaterThan(0);
        }
    });

    it('every PowerShell body is pure ASCII (PS 5.1 parser compat)', () => {
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            for (let i = 0; i < seed.body_ps1.length; i++) {
                const c = seed.body_ps1.charCodeAt(i);
                expect(
                    c,
                    `${seed.id} body_ps1 char ${i} (${JSON.stringify(seed.body_ps1.slice(Math.max(0, i - 10), i + 10))}) must be ASCII`,
                ).toBeLessThan(128);
            }
        }
    });



    // Async exec: the fake Atlas API below lives in THIS process, so a sync
    // exec would block the event loop the server needs to answer curl.
    async function runGate(
        id: string,
        cwd: string,
        arg: string,
        env: Record<string, string | undefined> = {},
    ): Promise<{ code: number; out: string }> {
        const body = GUARDRAIL_SCRIPT_SEEDS.find((s) => s.id === id)?.body_sh ?? '';
        writeFileSync(join(cwd, `${id}.sh`), body);
        return new Promise((done) => {
            execFile('bash', [`${id}.sh`, arg], { cwd, env: { ...process.env, ...env } }, (err, stdout) =>
                done({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout }),
            );
        });
    }

    describe.skipIf(process.platform === 'win32')("po-writer-output verifies the Task's sub-tasks via the Atlas API", () => {
        type SubTask = { id: string; title: string; acceptance_criteria: string; labels: string[] };
        let subTasks: SubTask[] = [];
        let links: Record<string, Array<{ relation_type: string; direction: string; item_id: string }>> = {};
        let server: Server;
        let apiUrl = '';
        const cwd = mkdtempSync(join(tmpdir(), 'po-gate-'));

        beforeAll(async () => {
            server = createServer((req, res) => {
                const task = /^\/api\/tasks\/ATL-1\/full$/.exec(req.url ?? '');
                const link = /^\/api\/issues\/sub_task\/([^/]+)\/links$/.exec(req.url ?? '');
                if (!task && !link) {
                    res.statusCode = 404;
                    return res.end('{}');
                }
                res.setHeader('content-type', 'application/json');
                // reason: `link` is non-null whenever `task` is null (checked above).
                res.end(JSON.stringify(task ? { task: { id: 'ATL-1' }, sub_tasks: subTasks } : (links[link![1]!] ?? [])));
            });
            await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
            apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        });
        afterAll(() => new Promise<void>((r) => server.close(() => r())));

        beforeEach(() => {
            subTasks = [
                // A complete set under the v2 contract: the dev sub-task carries
                // `dev` plus exactly one layer label, and has BOTH twins.
                { id: 'ATL-2', title: 'Sign in', acceptance_criteria: '- Given x', labels: ['dev', 'fullstack'] },
                { id: 'ATL-3', title: 'Sign in [QA]', acceptance_criteria: '- Given x', labels: ['qa'] },
                { id: 'ATL-5', title: 'Sign in [DOC]', acceptance_criteria: '- Given x', labels: ['doc'] },
            ];
            // tested_by is created QA -> dev, so it is incoming on the dev sub-task.
            links = { 'ATL-2': [{ relation_type: 'tested_by', direction: 'incoming', item_id: 'ATL-3' }] };
        });

        it('passes a complete dev + [QA] twin set', async () => {
            expect(await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: apiUrl })).toEqual({ code: 0, out: '' });
        });

        it('fails with a clear gap when ATLAS_API_URL is unset', async () => {
            const r = await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: undefined });
            expect(r.code).toBe(1);
            expect(r.out).toContain('ATLAS_API_URL is not set');
        });

        it('fails when the task has no dev sub-tasks', async () => {
            subTasks = [];
            const r = await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: apiUrl });
            expect(r.code).toBe(1);
            expect(r.out).toContain('no dev sub-tasks');
        });

        it('lists every gap: empty AC, missing labels, missing twin link, missing twins', async () => {
            subTasks[0]!.acceptance_criteria = '  ';
            subTasks[1]!.labels = [];
            subTasks.push({ id: 'ATL-4', title: 'Sign out', acceptance_criteria: '- Given y', labels: [] });
            links = {};
            const r = await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: apiUrl });
            expect(r.code).toBe(1);
            expect(r.out).toMatch(/ATL-2 has empty acceptance_criteria/);
            expect(r.out).toMatch(/ATL-3 is missing the qa label/);
            expect(r.out).toMatch(/ATL-4 is missing the dev label/);
            expect(r.out).toMatch(/ATL-2 has no tested_by link/);
            expect(r.out).toMatch(/ATL-4 has no \[QA\] twin/);
            // A missing [QA] twin used to `continue` past the [DOC] check, so a
            // sub-task with neither reported one gap per round instead of both.
            expect(r.out).toMatch(/ATL-4 has no \[DOC\] twin/);
            expect(r.out).toMatch(/ATL-4 must carry exactly one layer label/);
        });

        it('rejects a dev sub-task with no layer label, or with two', async () => {
            subTasks[0]!.labels = ['dev'];
            let r = await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: apiUrl });
            expect(r.code).toBe(1);
            expect(r.out).toMatch(/ATL-2 must carry exactly one layer label \(be\|fe\|fullstack\); it has none/);

            subTasks[0]!.labels = ['dev', 'be', 'fe'];
            r = await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: apiUrl });
            expect(r.code).toBe(1);
            expect(r.out).toMatch(/it has be, fe/);
        });

        it('rejects a dev sub-task with no [DOC] twin', async () => {
            subTasks = subTasks.filter((s) => !s.title.endsWith('[DOC]'));
            const r = await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: apiUrl });
            expect(r.code).toBe(1);
            expect(r.out).toMatch(/ATL-2 has no \[DOC\] twin/);
        });

        it('rejects a [DOC] twin that is missing the doc label', async () => {
            subTasks[2]!.labels = [];
            const r = await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: apiUrl });
            expect(r.code).toBe(1);
            expect(r.out).toMatch(/ATL-5 is missing the doc label/);
        });

        it('accepts the tested_by link from either direction', async () => {
            links = { 'ATL-2': [{ relation_type: 'tested_by', direction: 'outgoing', item_id: 'ATL-3' }] };
            expect((await runGate('po-writer-output', cwd, 'ATL-1', { ATLAS_API_URL: apiUrl })).code).toBe(0);
        });
    });

    describe.skipIf(process.platform === 'win32')('QA CSV gates use the Jira-importable schema', () => {
        const HEADER = 'Summary,Description,Issue Type,Priority,Labels,Components';
        const row = (summary: string, labels: string) =>
            `"${summary}","## Steps\n1. Open, then submit\n\n## Expected\nIt works\n\nAC: ac-1",Test,normal,${labels},`;

        function qaRepo(csv: string, changed: Record<string, string> = {}, touchCsvLast = true): string {
            const dir = mkdtempSync(join(tmpdir(), 'qa-gate-'));
            const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
            sh('git init -q -b main && git config user.email t@t && git config user.name t');
            writeFileSync(join(dir, 'README.md'), 'x');
            sh('git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD');
            for (const [p, body] of Object.entries(changed)) writeFileSync(join(dir, p), body);
            if (Object.keys(changed).length) sh('git add -A && git commit -qm tests');
            mkdirSync(join(dir, 'tests', 'qa'), { recursive: true });
            writeFileSync(join(dir, 'tests', 'qa', 'ATL-3.csv'), csv);
            sh('git add -A && git commit -qm csv');
            if (!touchCsvLast) {
                writeFileSync(join(dir, 'other.txt'), 'y');
                sh('git add -A && git commit -qm later');
            }
            return dir;
        }

        it('qa-writer-csv passes the Jira header + a multi-line quoted row committed at HEAD', async () => {
            const dir = qaRepo(`${HEADER}\n${row('Sign in, valid creds', 'ac-1;automation-yes;kind-functional')}\n`);
            expect(await runGate('qa-writer-csv', dir, 'ATL-3')).toEqual({ code: 0, out: '' });
        });

        it('qa-writer-csv rejects the retired test-id header, a header-only file, and a stale HEAD', async () => {
            const old = await runGate('qa-writer-csv', qaRepo('test-id,criterion-id,kind,automation-yes-no,scenario,expected\nT1,AC1,f,yes,s,e\n'), 'ATL-3');
            expect(old.code).toBe(1);
            expect(old.out).toContain('header mismatch');
            const empty = await runGate('qa-writer-csv', qaRepo(`${HEADER}\n\n`), 'ATL-3');
            expect(empty.out).toContain('no test rows');
            const stale = await runGate('qa-writer-csv', qaRepo(`${HEADER}\n${row('A', 'ac-1;automation-no;kind-edge')}\n`, {}, false), 'ATL-3');
            expect(stale.out).toContain('HEAD commit does not touch');
        });

        it('check-automation-tests passes when every automation-yes Summary is in a changed test file', async () => {
            const csv = `${HEADER}\n${row('Rejects bad password, shows error', 'ac-1;automation-yes;kind-edge')}\n${row('Manual visual check', 'ac-1;automation-no;kind-e2e')}\n`;
            const ts = qaRepo(csv, { 'login.test.ts': "it('Rejects bad password, shows error', () => {});" });
            expect(await runGate('check-automation-tests', ts, 'ATL-3')).toEqual({ code: 0, out: '' });
            const py = qaRepo(csv, { 'test_login.py': 'def test_x():\n    """Rejects bad password, shows error"""' });
            expect((await runGate('check-automation-tests', py, 'ATL-3')).code).toBe(0);
        });

        it('check-automation-tests fails for an uncovered automation-yes row and ignores automation-no rows', async () => {
            const csv = `${HEADER}\n${row('Locks after five attempts', 'ac-2;automation-yes;kind-edge')}\n`;
            const r = await runGate('check-automation-tests', qaRepo(csv, { 'a.test.js': "it('other', () => {});" }), 'ATL-3');
            expect(r.code).toBe(1);
            expect(r.out).toContain('Locks after five attempts');
            const manualOnly = qaRepo(`${HEADER}\n${row('Manual only', 'ac-1;automation-no;kind-e2e')}\n`);
            expect((await runGate('check-automation-tests', manualOnly, 'ATL-3')).code).toBe(0);
        });
    });

    // The budget exists so an embedded shell script cannot quietly become a
    // program. Since ADR 0024 every script left here checks an Atlas artifact,
    // and none of them has a reason to grow: a check that needs branching over
    // what the project happens to use belongs in a checker agent's prompt,
    // where it can read the repo instead of guessing.
    const LINE_BUDGET = 80;

    it('each script body is within its line budget', () => {
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            const shLines = seed.body_sh.split('\n').length;
            const psLines = seed.body_ps1.split('\n').length;
            expect(shLines, `${seed.id} bash lines`).toBeLessThanOrEqual(LINE_BUDGET);
            expect(psLines, `${seed.id} powershell lines`).toBeLessThanOrEqual(LINE_BUDGET);
        }
    });

    // A Windows project must not silently get a weaker check than a Unix one.
    // The ps1 for one script ran two of the nine checks its bash sibling ran,
    // and nothing caught it because no test compared them. Parity is asserted
    // on executable tokens rather than prose, so a script cannot pass by
    // DESCRIBING a check it does not run.
    const withoutComments = (body: string) =>
        body
            .split('\n')
            .filter((l) => !l.trim().startsWith('#'))
            .join('\n');

    it('every script body is non-trivial on both platforms', () => {
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            expect(withoutComments(seed.body_sh).trim().length, `${seed.id} bash`).toBeGreaterThan(40);
            expect(withoutComments(seed.body_ps1).trim().length, `${seed.id} powershell`).toBeGreaterThan(40);
        }
    });

    describe('runSeed seeds guardrail_scripts rows', () => {
        beforeEach(async () => {
            await truncateAll();
        });

        it('inserts every canonical row on a fresh DB', async () => {
            await runSeed();
            const rows = await db
                .selectFrom('guardrail_scripts')
                .select(['id', 'name', 'body_sh', 'body_ps1'])
                .where('id', 'in', [...EXPECTED_IDS])
                .execute();
            const byId = new Map(rows.map((r) => [r.id, r]));
            for (const id of EXPECTED_IDS) {
                const row = byId.get(id);
                expect(row, `${id} should be seeded`).toBeDefined();
                expect(row?.body_sh.length).toBeGreaterThan(0);
                expect(row?.body_ps1.length).toBeGreaterThan(0);
            }
        });

        it('is idempotent — running twice keeps exactly one row per id', async () => {
            await runSeed();
            await runSeed();
            const rows = await db
                .selectFrom('guardrail_scripts')
                .select(['id'])
                .where('id', 'in', [...EXPECTED_IDS])
                .execute();
            expect(rows).toHaveLength(EXPECTED_IDS.length);
            const ids = rows.map((r) => r.id).sort();
            expect(ids).toEqual([...EXPECTED_IDS].sort());
        });

        it('ON CONFLICT updates the body when the seed source changes', async () => {
            await runSeed();
            // Stomp a body to simulate stale on-disk data.
            await db
                .updateTable('guardrail_scripts')
                .set({ body_sh: 'STALE', body_ps1: 'STALE' })
                .where('id', '=', 'prereqs')
                .execute();
            await runSeed();
            const row = await db
                .selectFrom('guardrail_scripts')
                .select(['body_sh', 'body_ps1'])
                .where('id', '=', 'prereqs')
                .executeTakeFirstOrThrow();
            expect(row.body_sh).not.toBe('STALE');
            expect(row.body_ps1).not.toBe('STALE');
            const seed = GUARDRAIL_SCRIPT_SEEDS.find((s) => s.id === 'prereqs')!;
            expect(row.body_sh).toBe(seed.body_sh);
            expect(row.body_ps1).toBe(seed.body_ps1);
        });
    });
});

// Why no `gate-*` script is tested here any more (ADR 0024).
//
// The golden set's `frontend-only` fixture existed to exercise `gate-visual`,
// and on the first v4 run the gate SKIPPED it: the sandbox is a server-rendered
// Express app that builds its HTML in `src/render.js`, and the detection was an
// extension list — tsx|jsx|vue|svelte|css|scss|less|html — that no `.js` file
// can ever match. Every server-rendered app had no visual checking at all,
// silently, while the gate reported a pass. `gate-coverage` looked for a
// COVERAGE script only and, finding none, skipped the measurement AND the test
// run, on a sandbox that declares `"test": "node --test"`.
//
// Both were fixed, and both fixes were more guessing: a wider regex, a second
// script-name list. The fix that holds is to stop guessing — a checker agent
// reads the repo and names the command. What used to be tested here as bash
// behaviour is now tested as routing (`gate-check-routing.test.ts`) and as
// engine behaviour (`workflow-engine.integration.test.ts`), because that is
// where the remaining logic lives.
