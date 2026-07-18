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

interface CatalogEntryHandoff {
    target_agent_id: string;
    kind: 'on-pass' | 'on-fail';
    status: string;
}

interface CatalogEntryChecklist {
    label: string;
    sort_order: number;
    required: boolean;
}

export interface CatalogEntry {
    manifest: IAgentBundleManifest;
    prompt_md: string;
    memory_md: string;
    handoff_rules: CatalogEntryHandoff[];
    checklists: CatalogEntryChecklist[];
    /** Hash over a canonical JSON projection of all five files. Used to
     *  decide whether to bump marketplace_agents.version on re-seed. */
    content_hash: string;
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readTextIfExists(path: string): string {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function hashEntry(parts: {
    manifest: IAgentBundleManifest;
    prompt_md: string;
    memory_md: string;
    handoff_rules: CatalogEntryHandoff[];
    checklists: CatalogEntryChecklist[];
}): string {
    // Canonical projection excludes the version field so that the FIRST
    // bump can only happen via an actual content change. Sort handoffs +
    // checklists for stability (catalog files are checked into git so
    // ordering should already be stable, but defense in depth is cheap).
    const sortedHandoffs = [...parts.handoff_rules].sort((a, b) => {
        const ak = `${a.kind}|${a.target_agent_id}|${a.status}`;
        const bk = `${b.kind}|${b.target_agent_id}|${b.status}`;
        return ak.localeCompare(bk);
    });
    const sortedChecklists = [...parts.checklists].sort((a, b) => a.sort_order - b.sort_order);
    const { version: _v, ...manifestWithoutVersion } = parts.manifest;
    const canonical = JSON.stringify({
        manifest: manifestWithoutVersion,
        prompt_md: parts.prompt_md,
        memory_md: parts.memory_md,
        handoff_rules: sortedHandoffs,
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
        const manifest = readJson<IAgentBundleManifest>(join(dir, 'manifest.json'));
        const prompt_md = readTextIfExists(join(dir, 'prompt.md'));
        const memory_md = readTextIfExists(join(dir, 'memory.md'));
        const handoff_rules = existsSync(join(dir, 'handoff_rules.json'))
            ? readJson<CatalogEntryHandoff[]>(join(dir, 'handoff_rules.json'))
            : [];
        const checklists = existsSync(join(dir, 'checklists.json'))
            ? readJson<CatalogEntryChecklist[]>(join(dir, 'checklists.json'))
            : [];
        const content_hash = hashEntry({
            manifest,
            prompt_md,
            memory_md,
            handoff_rules,
            checklists,
        });
        entries.push({ manifest, prompt_md, memory_md, handoff_rules, checklists, content_hash });
    }

    entries.sort((a, b) => a.manifest.sort_order - b.manifest.sort_order);
    return entries;
}
