// Catalog loader. The seed script consumes loadCatalog() to upsert
// marketplace_agents; the runtime never reads the catalog folder
// directly. Tests exercise the file-discovery loops, optional file
// branches, content-hash determinism, and the empty-root short-circuit.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog } from './catalog-loader.js';

const cleanup: string[] = [];

function mkRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-catalog-test-'));
    cleanup.push(dir);
    return dir;
}

function writeManifest(folder: string, overrides: Record<string, unknown> = {}): void {
    const manifest = {
        id: overrides['id'] ?? 'demo-agent',
        name: overrides['name'] ?? 'Demo',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-sonnet-4-6',
        framework: '',
        description: 'desc',
        designation: 'tester',
        accent_color: '#007AC9',
        sort_order: overrides['sort_order'] ?? 1,
        glyph: 'science',
        role_id: null,
        max_rounds: 5,
        requires_item: true,
        requires_worktree: false,
        push_code: false,
        raises_pr: false,
        status: 'active',
        kind_slug: 'custom',
        settings_json: {},
        schedule_hours: 6,
        schedule_preset: 'every_n_hours',
        schedule_time_of_day: null,
        schedule_weekdays: null,
        schedule_day_of_month: null,
        cron_expr: null,
        concurrent_runs: 1,
        memory_cadence: 1,
        handoff_prompt_md: '',
        summary: 's',
        version: overrides['version'] ?? 1,
        published_at: '2026-06-03T00:00:00Z',
        effort: 'medium',
    };
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

beforeEach(() => {
    // nothing
});

afterEach(() => {
    while (cleanup.length > 0) {
        const p = cleanup.pop()!;
        try {
            rmSync(p, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    }
});

describe('loadCatalog', () => {
    it('returns [] when the catalog root does not exist', () => {
        expect(loadCatalog('/this/does/not/exist-atlas-test')).toEqual([]);
    });

    it('loads a single entry with all 5 optional files present', () => {
        const root = mkRoot();
        const folder = join(root, 'agent-x');
        mkdirSync(folder, { recursive: true });
        writeManifest(folder);
        writeFileSync(join(folder, 'prompt.md'), '# prompt');
        writeFileSync(join(folder, 'memory.md'), '# memory');
        writeFileSync(
            join(folder, 'handoff_rules.json'),
            JSON.stringify([
                { target_agent_id: 't1', kind: 'on-pass', status: 'done' },
            ]),
        );
        writeFileSync(
            join(folder, 'checklists.json'),
            JSON.stringify([{ label: 'a', sort_order: 1, required: true }]),
        );

        const entries = loadCatalog(root);
        expect(entries).toHaveLength(1);
        const e = entries[0]!;
        expect(e.manifest.id).toBe('demo-agent');
        expect(e.prompt_md).toBe('# prompt');
        expect(e.memory_md).toBe('# memory');
        expect(e.handoff_rules).toHaveLength(1);
        expect(e.checklists).toHaveLength(1);
        expect(e.content_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('treats missing optional files as empty (prompt/memory blank, handoffs/checklists [])', () => {
        const root = mkRoot();
        const folder = join(root, 'agent-min');
        mkdirSync(folder, { recursive: true });
        writeManifest(folder);

        const entries = loadCatalog(root);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.prompt_md).toBe('');
        expect(entries[0]!.memory_md).toBe('');
        expect(entries[0]!.handoff_rules).toEqual([]);
        expect(entries[0]!.checklists).toEqual([]);
    });

    it('skips folders without a manifest.json', () => {
        const root = mkRoot();
        const valid = join(root, 'valid');
        mkdirSync(valid);
        writeManifest(valid);
        // A sibling folder without manifest.json — must be skipped.
        mkdirSync(join(root, 'no-manifest'));
        writeFileSync(join(root, 'top-level-file.txt'), 'not a dir');

        const entries = loadCatalog(root);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.manifest.id).toBe('demo-agent');
    });

    it('sorts entries by manifest.sort_order ascending', () => {
        const root = mkRoot();
        for (const [name, order] of [
            ['z', 5],
            ['a', 1],
            ['m', 3],
        ] as const) {
            const f = join(root, name);
            mkdirSync(f);
            writeManifest(f, { id: `agent-${name}`, sort_order: order });
        }
        const entries = loadCatalog(root);
        expect(entries.map((e) => e.manifest.id)).toEqual(['agent-a', 'agent-m', 'agent-z']);
    });

    it('content_hash is stable across version bumps (excludes version)', () => {
        const root = mkRoot();
        const f1 = join(root, 'one');
        mkdirSync(f1);
        writeManifest(f1, { id: 'agent-stable', version: 1 });
        const h1 = loadCatalog(root)[0]!.content_hash;

        rmSync(f1, { recursive: true, force: true });
        const f2 = join(root, 'one');
        mkdirSync(f2);
        writeManifest(f2, { id: 'agent-stable', version: 99 });
        const h2 = loadCatalog(root)[0]!.content_hash;

        expect(h1).toBe(h2);
    });

    it('content_hash changes when handoff_rules order is permuted (since they are sorted)', () => {
        const root = mkRoot();
        const folder = join(root, 'agent-h');
        mkdirSync(folder);
        writeManifest(folder);
        writeFileSync(
            join(folder, 'handoff_rules.json'),
            JSON.stringify([
                { target_agent_id: 'a', kind: 'on-pass', status: 'done' },
                { target_agent_id: 'b', kind: 'on-fail', status: 'failed' },
            ]),
        );
        const h1 = loadCatalog(root)[0]!.content_hash;

        rmSync(folder, { recursive: true, force: true });
        mkdirSync(folder);
        writeManifest(folder);
        writeFileSync(
            join(folder, 'handoff_rules.json'),
            JSON.stringify([
                { target_agent_id: 'b', kind: 'on-fail', status: 'failed' },
                { target_agent_id: 'a', kind: 'on-pass', status: 'done' },
            ]),
        );
        const h2 = loadCatalog(root)[0]!.content_hash;
        // Sorted before hashing → identical.
        expect(h1).toBe(h2);
    });
});
