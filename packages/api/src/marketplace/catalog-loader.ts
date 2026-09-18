// Catalog loader. Walks packages/api/src/marketplace/catalog/* and returns a
// normalized in-memory representation. The seed script consumes this to
// upsert marketplace_agents; the runtime never reads the catalog folder
// directly (DB is the source of truth at request time).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IAgentBundleManifest } from '@atlas/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_ROOT = resolve(__dirname, 'catalog');

// Agent routing/scheduling fields dropped by ADR 0014 (migration 036). Older
// manifest.json files may still carry them; strip them so they neither leak
// into marketplace_agents nor perturb content_hash.
const DROPPED_MANIFEST_KEYS = [
    'handoff_prompt_md',
    'max_rounds',
    'requires_item',
    'requires_worktree',
    'push_code',
    'raises_pr',
    'schedule_hours',
    'schedule_preset',
    'schedule_time_of_day',
    'schedule_weekdays',
    'schedule_day_of_month',
    'cron_expr',
    'concurrent_runs',
    'last_run_at',
    'next_run_at',
];

interface CatalogEntryChecklist {
    label: string;
    sort_order: number;
    required: boolean;
}

export interface CatalogEntry {
    manifest: IAgentBundleManifest;
    prompt_md: string;
    memory_md: string;
    checklists: CatalogEntryChecklist[];
    /** Hash over a canonical JSON projection of all four files. Used to
     *  decide whether to bump marketplace_agents.version on re-seed. */
    content_hash: string;
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readManifest(path: string): IAgentBundleManifest {
    const raw = readJson<Record<string, unknown>>(path);
    for (const key of DROPPED_MANIFEST_KEYS) delete raw[key];
    return raw as unknown as IAgentBundleManifest;
}

function readTextIfExists(path: string): string {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function hashEntry(parts: {
    manifest: IAgentBundleManifest;
    prompt_md: string;
    memory_md: string;
    checklists: CatalogEntryChecklist[];
}): string {
    // Canonical projection excludes the version field so that the FIRST
    // bump can only happen via an actual content change. Sort checklists
    // for stability (catalog files are checked into git so ordering should
    // already be stable, but defense in depth is cheap).
    const sortedChecklists = [...parts.checklists].sort((a, b) => a.sort_order - b.sort_order);
    const { version: _v, ...manifestWithoutVersion } = parts.manifest;
    const canonical = JSON.stringify({
        manifest: manifestWithoutVersion,
        prompt_md: parts.prompt_md,
        memory_md: parts.memory_md,
        checklists: sortedChecklists,
    });
    return createHash('sha256').update(canonical).digest('hex');
}

export function loadCatalog(root: string = CATALOG_ROOT): CatalogEntry[] {
    if (!existsSync(root)) return [];

    const folders = readdirSync(root).filter((name) => {
        const full = join(root, name);
        return statSync(full).isDirectory() && existsSync(join(full, 'manifest.json'));
    });

    const entries: CatalogEntry[] = [];
    for (const folder of folders) {
        const dir = join(root, folder);
        const manifest = readManifest(join(dir, 'manifest.json'));
        const prompt_md = readTextIfExists(join(dir, 'prompt.md'));
        const memory_md = readTextIfExists(join(dir, 'memory.md'));
        const checklists = existsSync(join(dir, 'checklists.json'))
            ? readJson<CatalogEntryChecklist[]>(join(dir, 'checklists.json'))
            : [];
        const content_hash = hashEntry({ manifest, prompt_md, memory_md, checklists });
        entries.push({ manifest, prompt_md, memory_md, checklists, content_hash });
    }

    entries.sort((a, b) => a.manifest.sort_order - b.manifest.sort_order);
    return entries;
}
