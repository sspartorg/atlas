import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A shipped bundle only reaches an existing install if its `version` goes up:
// `upgrade_available` is `installed_version < catalogVersion` and nothing else
// (`services/marketplace.ts`). So editing a prompt without bumping the version
// is silent — fresh installs get the new text, every existing one is frozen at
// the version it pulled, forever, with no warning anywhere.
//
// That is not hypothetical. Three PRs of prompt, checklist and manifest changes
// shipped against `version: 1` bundles and reached nobody; it surfaced only
// because a golden-set run was about to measure the old prompts and call them
// the new ones.
//
// This lock is the record of what each version actually contains. The contract
// test compares it against the catalog on disk: change a bundle's content and
// you must either bump its version or explain why not. Regenerate with
// `pnpm -F @atlas/api catalog:lock` as part of releasing.

const CATALOG_DIR = join(dirname(fileURLToPath(import.meta.url)), 'catalog');
/** The files a customer actually receives. */
const BUNDLE_FILES = ['manifest.json', 'prompt.md', 'memory.md', 'checklists.json', 'tests.json'] as const;

export interface ICatalogLockEntry {
    version: number;
    hash: string;
}

/**
 * Content hash of one bundle, deliberately excluding `manifest.version`.
 *
 * The version is the thing being checked, so hashing it would make every
 * entry self-consistent and the check vacuous: bump the version, the hash
 * changes, the test passes, and nobody notices the prompt never moved.
 */
function bundleHash(dir: string): string {
    const h = createHash('sha256');
    for (const file of BUNDLE_FILES) {
        let body: string;
        try {
            body = readFileSync(join(dir, file), 'utf8');
        } catch {
            // An absent optional file contributes NOTHING, rather than an
            // empty body. It used to feed `name + '' ` into the hash, which
            // meant adding a new optional file to this list changed the hash
            // of every bundle that did not have one — 24 version bumps to
            // ship a file 8 bundles carry. All four original files exist in
            // every bundle, so this leaves their hashes byte-identical.
            continue;
        }
        if (file === 'manifest.json') {
            const { version: _version, ...rest } = JSON.parse(body) as Record<string, unknown>;
            body = JSON.stringify(rest, Object.keys(rest).sort());
        }
        h.update(file).update('\0').update(body).update('\0');
    }
    return h.digest('hex').slice(0, 16);
}

/** Every bundle on disk, by id, with its declared version and content hash. */
export function catalogLockEntries(): Record<string, ICatalogLockEntry> {
    const out: Record<string, ICatalogLockEntry> = {};
    for (const id of readdirSync(CATALOG_DIR).sort()) {
        const dir = join(CATALOG_DIR, id);
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
            version?: number;
        };
        out[id] = { version: manifest.version ?? 1, hash: bundleHash(dir) };
    }
    return out;
}

export function readCatalogLock(): Record<string, ICatalogLockEntry> {
    return JSON.parse(readFileSync(join(CATALOG_DIR, '..', 'catalog.lock.json'), 'utf8')) as Record<
        string,
        ICatalogLockEntry
    >;
}
