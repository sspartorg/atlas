import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assembleProbes } from './probes-assembler.js';

const roots: string[] = [];
function worktree(): string {
    const d = mkdtempSync(join(tmpdir(), 'atlas-probes-'));
    roots.push(d);
    return d;
}

afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('assembleProbes', () => {
    it('stages every probe into .atlas/probes/', () => {
        const dir = worktree();
        const written = assembleProbes(dir);
        expect(written.length).toBeGreaterThanOrEqual(2);
        for (const name of ['perf-probe.mjs', 'visual-probe.mjs']) {
            const p = join(dir, '.atlas', 'probes', name);
            expect(existsSync(p), `${name} was not staged`).toBe(true);
            expect(readFileSync(p, 'utf8').length).toBeGreaterThan(0);
        }
    });

    it('is idempotent — a second run overwrites rather than duplicating', () => {
        const dir = worktree();
        const first = assembleProbes(dir);
        const again = assembleProbes(dir);
        expect(again).toEqual(first);
    });

    it('creates .atlas/probes when the worktree has no .atlas yet', () => {
        const dir = worktree();
        expect(existsSync(join(dir, '.atlas'))).toBe(false);
        assembleProbes(dir);
        expect(existsSync(join(dir, '.atlas', 'probes'))).toBe(true);
    });
});

// The probes are the half of gate-perf / gate-visual that runs when a project
// ships no perf or visual tooling of its own — which, before them, meant the
// 100ms/200ms budgets were enforced only on projects that had already built
// that tooling themselves.
describe.skipIf(process.platform === 'win32')('perf-probe', () => {
    function project(files: Record<string, string>): string {
        const dir = worktree();
        for (const [name, body] of Object.entries(files)) {
            mkdirSync(join(dir, name, '..'), { recursive: true });
            writeFileSync(join(dir, name), body);
        }
        assembleProbes(dir);
        return dir;
    }

    function run(dir: string, diff: string, port: number): { code: number; out: string } {
        try {
            const out = execFileSync(process.execPath, ['.atlas/probes/perf-probe.mjs'], {
                cwd: dir,
                encoding: 'utf8',
                env: { ...process.env, ATLAS_DIFF: diff, PORT: String(port) },
            });
            return { code: 0, out };
        } catch (err) {
            const e = err as { status: number; stdout: string };
            return { code: e.status, out: e.stdout };
        }
    }

    const SERVER = `import { createServer } from 'node:http';
createServer((req, res) => {
  if (req.url === '/api/slow') { const t = Date.now(); while (Date.now() - t < 160); res.end('slow'); return; }
  res.end('ok');
}).listen(Number(process.env.PORT || 3000));
`;

    it('fails an API route over the 100ms budget and passes one under it', () => {
        const dir = project({ 'package.json': '{"scripts":{"start":"node server.mjs"}}', 'server.mjs': SERVER });
        const diff = "+++ b/server.mjs\n+ if (req.url === '/api/slow')\n+ if (req.url === '/api/fast')\n";
        const r = run(dir, diff, 39211);
        expect(r.code).toBe(1);
        expect(r.out).toMatch(/\/api\/slow: p95 \d+/);
        expect(r.out).toContain('exceeds the 100ms budget');
        // The fast route was measured and did not breach.
        expect(r.out).toContain('/api/fast');
    }, 60_000);

    it('honours a project budget override', () => {
        const dir = project({
            'package.json': '{"scripts":{"start":"node server.mjs"}}',
            'server.mjs': SERVER,
            '.atlas/perf-budget.json': '{"api_p95_ms": 500, "samples": 5, "warmup": 1}',
        });
        const r = run(dir, "+++ b/server.mjs\n+ if (req.url === '/api/slow')\n", 39212);
        expect(r.code).toBe(0);
        expect(r.out).toContain('within budget');
    }, 60_000);

    it('skips — never fails — when the project declares no start script', () => {
        // ADR 0020: a probe that cannot run is absence of evidence.
        const dir = project({ 'package.json': '{"scripts":{}}' });
        const r = run(dir, "+++ b/x.js\n+ '/api/thing'\n", 39213);
        expect(r.code).toBe(0);
        expect(r.out).toContain('no `start` script');
    });

    it('skips when the diff names no route, rather than inventing one', () => {
        const dir = project({ 'package.json': '{"scripts":{"start":"node server.mjs"}}', 'server.mjs': SERVER });
        const r = run(dir, "+++ b/README.md\n+ some prose\n", 39214);
        expect(r.code).toBe(0);
        expect(r.out).toContain('no route literal');
    });

    it('does not mistake an asset path or an import for a route', () => {
        const dir = project({ 'package.json': '{"scripts":{"start":"node server.mjs"}}', 'server.mjs': SERVER });
        const diff = "+++ b/a.js\n+ import x from '/src/thing.js'\n+ const css = '/styles/main.css'\n";
        const r = run(dir, diff, 39215);
        expect(r.code).toBe(0);
        expect(r.out).toContain('no route literal');
    });
});
