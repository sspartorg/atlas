import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogLockEntries } from '../marketplace/catalog-lock.js';

// Regenerates `catalog.lock.json` from the catalog on disk. Run it as part of
// releasing a bundle change, AFTER bumping the versions you meant to bump —
// running it first would simply record the freeze it exists to catch.

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'marketplace', 'catalog.lock.json');
const entries = catalogLockEntries();
writeFileSync(target, JSON.stringify(entries, null, 2) + '\n');
console.log(`Wrote ${Object.keys(entries).length} bundles to ${target}`);
