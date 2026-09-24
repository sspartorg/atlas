import { execFile, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
        'coder-tests-green',
        'qa-writer-csv',
        // 2026-06-09 — Automation Engineer gate added (the prompt referenced
        // this script for months, but the seed was missing it; both
        // agent-automation and agent-automation-reviewer were silently
        // substituting `pnpm typecheck + pnpm lint`).
        'check-automation-tests',
        'commit-discipline',
        // 2026-09-24 — the four `gate` node scripts. These are not run by an
        // agent at all: a gate step executes them and routes on the exit code,
        // so a green branch spends no tokens on them and a fixer agent is
        // dispatched only when one goes red.
        'gate-hygiene',
        'gate-coverage',
        'gate-perf',
        'gate-visual',
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

    describe.skipIf(process.platform === 'win32')('gate-hygiene tells residue from identifiers', () => {
        const seed = GUARDRAIL_SCRIPT_SEEDS.find((s) => s.id === 'gate-hygiene');

        function repoWithDiff(added: string): number {
            const dir = mkdtempSync(join(tmpdir(), 'hygiene-gate-'));
            const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
            sh('git init -q -b main && git config user.email t@t && git config user.name t');
            writeFileSync(join(dir, 'package.json'), '{"scripts":{}}');
            writeFileSync(join(dir, 'a.js'), 'const base = 1;\n');
            sh('git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD');
            writeFileSync(join(dir, 'a.js'), `const base = 1;\n${added}\n`);
            sh('git add -A && git commit -qm change');
            writeFileSync(join(dir, 'gate.sh'), seed?.body_sh ?? '');
            try {
                execSync('bash gate.sh X', { cwd: dir, stdio: 'pipe' });
                return 0;
            } catch (err) {
                return (err as { status: number }).status;
            }
        }

        // The first live run of delivery v2 spent a whole fixer dispatch
        // renaming `HTTP_TODOS` and rewording `TODO_FILE` because the pattern
        // was `TODO[^(]`, which matches any identifier that merely starts with
        // those four letters. On a todo app that is every other line.
        it.each([
            ['const TODO_FILE = process.env.TODO_FILE;', 'an env var named TODO_FILE'],
            ['const HTTP_TODOS = [];', 'a fixture named HTTP_TODOS'],
            ['const STATS_TODOS = [];', 'a fixture named STATS_TODOS'],
            ['// TODO(ATL-12): tracked and allowed', 'a tracked TODO marker'],
        ])('passes %s (%s)', (line) => {
            expect(repoWithDiff(line)).toBe(0);
        });

        it.each([
            ['// TODO come back to this', 'a bare TODO'],
            ['// FIXME broken', 'a bare FIXME'],
            ['console.log("debug");', 'a console.log'],
            ['debugger;', 'a debugger statement'],
        ])('fails on %s (%s)', (line) => {
            expect(repoWithDiff(line)).toBe(1);
        });

        // `console.log` is debug residue in a library and the PRODUCT'S stdout
        // in a CLI. Flagging it everywhere told a CLI project its own
        // user-facing output was residue, and the fixer rightly refused to
        // rewrite spec-mandated output as `process.stdout.write` to appease a
        // script. Entry points are exempt; everything else still is not.
        function repoWithCliDiff(): { code: number; out: string } {
            const dir = mkdtempSync(join(tmpdir(), 'hygiene-cli-'));
            const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
            sh('git init -q -b main && git config user.email t@t && git config user.name t');
            mkdirSync(join(dir, 'src'), { recursive: true });
            writeFileSync(join(dir, 'package.json'), '{"bin":{"todo":"src/cli.js"},"scripts":{}}');
            writeFileSync(join(dir, 'src/cli.js'), 'const a = 1;\n');
            writeFileSync(join(dir, 'src/lib.js'), 'const b = 1;\n');
            sh('git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD');
            writeFileSync(join(dir, 'src/cli.js'), 'const a = 1;\nconsole.log("user facing");\n');
            writeFileSync(join(dir, 'src/lib.js'), 'const b = 1;\nconsole.log("debug left behind");\n');
            sh('git add -A && git commit -qm change');
            writeFileSync(join(dir, 'gate.sh'), seed?.body_sh ?? '');
            try {
                const out = execSync('bash gate.sh X', { cwd: dir, stdio: 'pipe' }).toString();
                return { code: 0, out };
            } catch (err) {
                const e = err as { status: number; stdout: Buffer };
                return { code: e.status, out: e.stdout.toString() };
            }
        }

        it('exempts a declared bin from the console.log check but not a library file', () => {
            const r = repoWithCliDiff();
            expect(r.code).toBe(1);
            expect(r.out).toContain('src/lib.js');
            expect(r.out).not.toContain('src/cli.js');
        });
    });

    describe.skipIf(process.platform === 'win32')('coder-tests-green runs on non-pnpm projects', () => {
        const seed = GUARDRAIL_SCRIPT_SEEDS.find((s) => s.id === 'coder-tests-green');

        function repoWith(files: Record<string, string>, changed: Record<string, string>): string {
            const dir = mkdtempSync(join(tmpdir(), 'coder-gate-'));
            const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
            sh('git init -q -b main && git config user.email t@t && git config user.name t');
            const write = (p: string, body: string) => {
                // Nested paths (specs/…, tests/qa/…) need their parent; a no-op
                // for the flat filenames the other cases use.
                mkdirSync(dirname(join(dir, p)), { recursive: true });
                writeFileSync(join(dir, p), body);
            };
            for (const [p, body] of Object.entries(files)) write(p, body);
            sh('git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD');
            for (const [p, body] of Object.entries(changed)) write(p, body);
            sh('git add -A && git commit -qm change');
            writeFileSync(join(dir, 'gate.sh'), seed?.body_sh ?? '');
            return dir;
        }

        function gateExit(dir: string, flag = ''): number {
            try {
                execSync(`bash gate.sh X ${flag}`, { cwd: dir, stdio: 'pipe' });
                return 0;
            } catch (err) {
                return (err as { status: number }).status;
            }
        }

        it('passes a plain npm + JS project with a changed *.test.js and no typecheck/lint scripts', () => {
            const dir = repoWith(
                { 'package.json': '{"scripts":{"test":"node --test"}}' },
                { 'a.test.js': 'x' },
            );
            expect(gateExit(dir)).toBe(0);
        });

        it('still fails when a declared typecheck script fails', () => {
            const dir = repoWith(
                { 'package.json': '{"scripts":{"typecheck":"exit 1"}}' },
                { 'a.test.ts': 'x' },
            );
            expect(gateExit(dir)).toBe(1);
        });

        it('runs the declared test script only with --run-tests', () => {
            const dir = repoWith({ 'package.json': '{"scripts":{"test":"exit 1"}}' }, { 'a.test.js': 'x' });
            expect(gateExit(dir)).toBe(0);
            expect(gateExit(dir, '--run-tests')).toBe(1);
        });

        it('still fails when no test file changed', () => {
            const dir = repoWith({ 'package.json': '{"scripts":{}}' }, { 'a.js': 'x' });
            expect(gateExit(dir)).toBe(1);
        });

        // A multi-repo Task stages its Task-wide artefacts — the Architect's
        // spec and the QA plan — into the FIRST repo (ADR 0017/0018). When that
        // repo receives no product code, a changed-test requirement there can
        // never be satisfied and the run parks at End forever. Found by running
        // a Jira Story through the real Delivery workflow: the artefact repo
        // blocked delivery of a sibling that was entirely green.
        it('passes a repo whose only changes are Task-wide artefacts', () => {
            const dir = repoWith(
                { 'package.json': '{"scripts":{}}' },
                {
                    'specs/2-add-count/spec.md': '# spec',
                    'tests/qa/ATL-11.csv': 'Summary,Description\\nx,y',
                },
            );
            expect(gateExit(dir, '--run-tests')).toBe(0);
        });

        // The other half of the rule, and the one that matters: artefacts must
        // not excuse untested code sitting beside them.
        it('still fails when artefacts ship alongside untested code', () => {
            const dir = repoWith(
                { 'package.json': '{"scripts":{}}' },
                { 'specs/2-add-count/spec.md': '# spec', 'src.js': 'export const f = 1;' },
            );
            expect(gateExit(dir, '--run-tests')).toBe(1);
        });
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
    // program. `gate-hygiene` is the one carve-out: it runs five declared
    // tools, standalone secretlint, a dependency audit and three diff scans,
    // which is ~12 lines per check rather than one bloated check. Anything
    // that grows past ITS ceiling belongs in `marketplace/probes/` as a real
    // `.mjs` file, the way `gate-perf` and `gate-visual` did.
    // `gate-coverage` measures coverage, ratchets the floor, AND runs the suite
    // when no coverage script is declared (ATL-149). The prose was trimmed twice
    // before this number moved; what is left is the logic.
    const LINE_BUDGET: Record<string, number> = { 'gate-hygiene': 120, 'gate-coverage': 90 };
    const DEFAULT_LINE_BUDGET = 80;

    it('each script body is within its line budget', () => {
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            const budget = LINE_BUDGET[seed.id] ?? DEFAULT_LINE_BUDGET;
            const shLines = seed.body_sh.split('\n').length;
            const psLines = seed.body_ps1.split('\n').length;
            expect(shLines, `${seed.id} bash lines`).toBeLessThanOrEqual(budget);
            expect(psLines, `${seed.id} powershell lines`).toBeLessThanOrEqual(budget);
        }
    });

    // A Windows project must not silently get a weaker gate than a Unix one.
    // The ps1 for gate-hygiene ran only lint and typecheck while the bash ran
    // nine checks, and nothing caught it because no test compared them.
    //
    // Comments are stripped first, and every token below is one that can only
    // appear in an executable position. Matching prose would let a script pass
    // this by DESCRIBING a check it does not run — which is the same trick
    // `agent-fix-reviewer` exists to catch in a fixer's diff.
    const withoutComments = (body: string) =>
        body
            .split('\n')
            .filter((l) => !l.trim().startsWith('#'))
            .join('\n');

    it('gate-hygiene runs the same checks on both platforms', () => {
        const seed = GUARDRAIL_SCRIPT_SEEDS.find((s) => s.id === 'gate-hygiene');
        expect(seed).toBeDefined();
        const sh = withoutComments(seed!.body_sh);
        const ps = withoutComments(seed!.body_ps1);
        for (const token of [
            'knip', // the declared-script loop
            '--maskSecrets', // standalone secretlint over the diff
            'audit-level', // dependency advisories
            'TODO\\(\\.agents\\)', // stale-marker regex, not the prose in the gap message
            'debugger;', // debug residue
        ]) {
            expect(sh, `bash does not run ${token}`).toContain(token);
            expect(ps, `powershell does not run ${token}`).toContain(token);
        }
    });

    // Template literals eat a single backslash. A `\+` written as one in the TS
    // source reaches PowerShell as a bare `+`, which is an invalid quantifier,
    // and `TODO\(\.agents\)` becomes a capture group that matches the wrong
    // thing. Both happened; neither is visible by reading the TS.
    it('powershell regex literals survive the template literal', () => {
        const seed = GUARDRAIL_SCRIPT_SEEDS.find((s) => s.id === 'gate-hygiene');
        for (const line of seed!.body_ps1.split('\n')) {
            if (line.trim().startsWith('#')) continue;
            expect(line, 'bare ^+ is an invalid quantifier').not.toMatch(/-(not)?match '\^\+/);
        }
        expect(seed!.body_ps1).toContain('TODO\\(\\.agents\\)');
        expect(seed!.body_ps1).toContain('package\\.json');
    });

    describe('runSeed seeds guardrail_scripts rows', () => {
        beforeEach(async () => {
            await truncateAll();
        });

        it('inserts all 6 rows on a fresh DB', async () => {
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

// The golden set's `frontend-only` fixture is the one that exists to exercise
// `gate-visual`, and on the first v4 run the gate SKIPPED it: the sandbox is a
// server-rendered Express app that builds its HTML in `src/render.js`, and the
// detection was an extension list — tsx|jsx|vue|svelte|css|scss|less|html — that
// no `.js` file can ever match. Every server-rendered app (Express templates,
// EJS, Pug, Go templates, Rails, PHP) therefore had no visual checking at all,
// silently, while the gate reported a pass.
describe.skipIf(process.platform === 'win32')('gate-visual decides what counts as a UI change', () => {
    function repoWithChange(files: Record<string, string>): string {
        const dir = mkdtempSync(join(tmpdir(), 'visual-gate-'));
        const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
        sh('git init -q -b main && git config user.email t@t && git config user.name t');
        writeFileSync(join(dir, 'package.json'), '{"scripts":{}}');
        writeFileSync(join(dir, 'seed.txt'), 'base\n');
        sh('git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD');
        for (const [name, body] of Object.entries(files)) {
            mkdirSync(join(dir, name, '..'), { recursive: true });
            writeFileSync(join(dir, name), body);
        }
        sh('git add -A && git commit -qm change');
        return dir;
    }

    function run(dir: string): string {
        const body = GUARDRAIL_SCRIPT_SEEDS.find((x) => x.id === 'gate-visual')?.body_sh ?? '';
        writeFileSync(join(dir, 'gate.sh'), body);
        try {
            return execSync('bash gate.sh ATL-1', { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        } catch (err) {
            return String((err as { stdout?: Buffer }).stdout ?? '');
        }
    }

    it('runs for server-rendered markup inside a .js file', () => {
        const out = run(
            repoWithChange({
                'src/render.js': "export const row = (t) => `<li class=\"todo\"><span>${t.title}</span></li>`;\n",
            }),
        );
        expect(out, 'a server-rendered page is a UI change').not.toContain('skipped - no UI files changed');
    });

    it('runs for a style rule added in any file', () => {
        const out = run(
            repoWithChange({ 'src/page.js': "const css = 'body{margin:0}'; const el = '<div style=\"width:300px\">x</div>';\n" }),
        );
        expect(out).not.toContain('skipped - no UI files changed');
    });

    it('still runs on a plain .css file', () => {
        const out = run(repoWithChange({ 'styles/app.css': '.todo { color: red; }\n' }));
        expect(out).not.toContain('skipped - no UI files changed');
    });

    // The other half: widening the trigger must not make every backend change
    // pay for starting the app and driving three viewports in two themes.
    it('skips a backend change that renders nothing', () => {
        const out = run(
            repoWithChange({
                'src/cache.js': 'export function load(f) { return JSON.parse(readFileSync(f)); }\n',
                'test/cache.test.js': "it('caches', () => { expect(load(f)).toEqual([]); });\n",
            }),
        );
        expect(out).toContain('skipped - no UI files changed and no markup added');
    });
});

// A gate that skips is not a gate. `gate-coverage` looked for a COVERAGE script
// only, and finding none skipped the measurement AND the test run. The sandbox
// declares `"test": "node --test"` - it has tests, and the gate never ran them.
//
// On ATL-110 a doc sub-task rewrote a README line a sibling sub-task's test
// asserted on. The suite went red at HEAD and all four gates reported pass; an
// LLM reviewer caught it, not the deterministic chain built for exactly that.
// ADR 0020's "absence of evidence is not a failure" covers the measurement,
// which genuinely cannot be taken without coverage tooling. It does not cover
// tests the project already has.
describe.skipIf(process.platform === 'win32')('gate-coverage runs the suite it can run', () => {
    function repo(pkg: Record<string, unknown>, files: Record<string, string> = {}): string {
        const dir = mkdtempSync(join(tmpdir(), 'cov-gate-'));
        writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
        for (const [name, body] of Object.entries(files)) {
            mkdirSync(join(dir, name, '..'), { recursive: true });
            writeFileSync(join(dir, name), body);
        }
        return dir;
    }

    function run(dir: string): { code: number; out: string } {
        const body = GUARDRAIL_SCRIPT_SEEDS.find((x) => x.id === 'gate-coverage')?.body_sh ?? '';
        writeFileSync(join(dir, 'gate.sh'), body);
        try {
            return { code: 0, out: execSync('bash gate.sh ATL-1', { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) };
        } catch (err) {
            const e = err as { status: number; stdout: Buffer };
            return { code: e.status, out: String(e.stdout ?? '') };
        }
    }

    const PASSING = "const assert = require('node:assert');\nassert.equal(1, 1);\n";
    const FAILING = "const assert = require('node:assert');\nassert.equal(1, 2);\n";

    it('runs the declared test script when no coverage script exists', () => {
        const r = run(repo({ scripts: { test: 'node t.js' } }, { 't.js': PASSING }));
        expect(r.code).toBe(0);
        expect(r.out).toContain('tests pass, coverage not measured');
    });

    it('FAILS on a red suite even though coverage cannot be measured', () => {
        const r = run(repo({ scripts: { test: 'node t.js' } }, { 't.js': FAILING }));
        expect(r.code).toBe(1);
        expect(r.out).toContain('the test suite failed');
    });

    it('still skips, and never fails, when there is no test script either', () => {
        const r = run(repo({ scripts: {} }));
        expect(r.code).toBe(0);
        expect(r.out).toContain('no coverage script and no test script declared');
    });

    // The fallback must not shadow the real path: a project WITH coverage
    // tooling keeps its floor and its ratchet untouched.
    it('leaves a declared coverage script on its original path', () => {
        const r = run(
            repo(
                { scripts: { 'test:coverage': 'node c.js', test: 'node t.js' } },
                {
                    'c.js': "require('fs').mkdirSync('coverage',{recursive:true});require('fs').writeFileSync('coverage/coverage-summary.json',JSON.stringify({total:{statements:{pct:99}}}));",
                    't.js': FAILING,
                },
            ),
        );
        // The coverage script ran and passed the floor; the failing `test`
        // script was never invoked, exactly as before.
        expect(r.code).toBe(0);
        expect(r.out).not.toContain('the test suite failed');
    });

    it('checks the same things on both platforms', () => {
        const seed = GUARDRAIL_SCRIPT_SEEDS.find((x) => x.id === 'gate-coverage');
        const strip = (b: string) =>
            b.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
        for (const token of ['the test suite failed', 'coverage not measured', 'no test script declared']) {
            expect(strip(seed!.body_sh), `bash is missing ${token}`).toContain(token);
            expect(strip(seed!.body_ps1), `powershell is missing ${token}`).toContain(token);
        }
    });
});
