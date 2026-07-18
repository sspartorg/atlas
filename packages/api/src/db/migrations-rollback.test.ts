import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// W13 — Migration rollback static safety check.
//
// Every migration file under `packages/api/src/db/migrations/` MUST
// export both `up` and `down` so Knex can roll back individual
// migrations during a recovery or rebase. Without `down` the rollback
// path is broken and a botched migration can't be reverted on prod
// without manual SQL.
//
// This check is static-source — reads each .ts migration via
// fs.readFileSync and asserts the regex shape. The integration test
// for ROUND-TRIP rollback + re-apply is a manual recipe (see
// .agents/api-surface.md migrations section) since it would tear down
// `atlas_test_p_main` mid-suite and break sibling tests.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

function loadMigrationSources(): Array<{ file: string; src: string }> {
    return readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.ts'))
        .sort()
        .map((file) => ({
            file,
            src: readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
        }));
}

describe('migrations — rollback safety', () => {
    const migrations = loadMigrationSources();

    it('at least 18 numbered migration .ts files present', () => {
        // Sanity floor — the baseline (001) + 17 subsequent deltas should
        // all be present. If this drops the rebase regressed.
        expect(migrations.length).toBeGreaterThanOrEqual(18);
    });

    for (const { file, src } of (migrations.length > 0 ? migrations : [{ file: 'none', src: '' }])) {
        if (file === 'none') continue;
        it(`${file} exports both up() and down()`, () => {
            // Match either named-export or arrow form:
            //   export async function up(...) { ... }
            //   export const up = async (...) => { ... }
            const hasUp = /\bexport\s+(async\s+)?(function\s+up\b|const\s+up\b)/.test(src);
            const hasDown = /\bexport\s+(async\s+)?(function\s+down\b|const\s+down\b)/.test(src);
            if (!hasUp) {
                throw new Error(`${file}: missing exported up()`);
            }
            if (!hasDown) {
                throw new Error(`${file}: missing exported down() — rollback broken`);
            }
            expect(hasUp).toBe(true);
            expect(hasDown).toBe(true);
        });
    }
});

describe('migrations — numbering monotonic', () => {
    it('files sort numerically with no gaps', () => {
        const numbered = readdirSync(MIGRATIONS_DIR)
            .filter((f) => /^\d{3}_.*\.ts$/.test(f))
            .map((f) => parseInt(f.slice(0, 3), 10))
            .sort((a, b) => a - b);

        // No duplicate numbers.
        const seen = new Set();
        for (const n of numbered) {
            if (seen.has(n)) throw new Error(`Duplicate migration number ${n}`);
            seen.add(n);
        }

        // No gaps (1, 2, 3, ... contiguous).
        for (let i = 1; i < numbered.length; i++) {
            if (numbered[i]! - numbered[i - 1]! !== 1) {
                throw new Error(
                    `Migration gap between ${numbered[i - 1]} and ${numbered[i]} — rebase pulled mismatched files`,
                );
            }
        }
        expect(numbered[0]).toBe(1);
    });
});
