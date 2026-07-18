// Stop and remove the local Atlas Postgres container, optionally wiping the
// data volume. Cross-platform replacement for the former db-down.ps1.
//
// Targets only the dev container by default (so `pnpm db:down` / `db:down:purge`
// in the dev workflow can never touch the prod container or its volume). When
// `ATLAS_ENV=prod` is set, targets the prod container instead.
//   dev  -> stop+rm `atlas-postgres`,      purge wipes `atlas-pg`
//   prod -> stop+rm `atlas-postgres-prod`, purge wipes `atlas-pg-prod`
//
// Usage:
//   tsx db-down.ts           -> stop + remove container, keep data volume
//   tsx db-down.ts --purge   -> stop + remove container AND drop the volume

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

const purge = process.argv.includes('--purge');
const isProd = process.env['ATLAS_ENV']?.toLowerCase() === 'prod';
const service = isProd ? 'postgres-prod' : 'postgres';
const volume = isProd ? 'atlas-pg-prod' : 'atlas-pg';

function run(cmd: string, args: readonly string[], opts: { cwd?: string; stdio?: 'inherit' | 'ignore' } = {}): number {
    const result = spawnSync(cmd, args, {
        cwd: opts.cwd,
        stdio: opts.stdio ?? 'inherit',
        shell: false,
    });
    if (result.error) {
        console.error(`[db-down] failed to spawn ${cmd}: ${result.error.message}`);
        return 1;
    }
    return result.status ?? 1;
}

console.log(`[db-down] target=${isProd ? 'prod' : 'dev'} service=${service}${purge ? ' (purge volume)' : ''}`);
console.log(
    purge
        ? '[db-down] stopping postgres and wiping volume...'
        : '[db-down] stopping postgres (keeping volume)...',
);

const stopCode = run('docker', ['compose', 'stop', service], { cwd: REPO_ROOT });
if (stopCode !== 0) {
    console.error(`[db-down] docker compose stop failed with exit code ${stopCode}`);
    process.exit(stopCode);
}

const rmCode = run('docker', ['compose', 'rm', '-f', service], { cwd: REPO_ROOT });
if (rmCode !== 0) {
    console.error(`[db-down] docker compose rm failed with exit code ${rmCode}`);
    process.exit(rmCode);
}

if (purge) {
    const volCode = run('docker', ['volume', 'rm', '-f', volume], { cwd: REPO_ROOT });
    if (volCode !== 0) {
        console.error(`[db-down] docker volume rm ${volume} failed with exit code ${volCode}`);
        process.exit(volCode);
    }
}

console.log('[db-down] done.');
