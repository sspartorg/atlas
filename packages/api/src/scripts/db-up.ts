// Start the local Atlas Postgres container and wait until it accepts
// connections. Cross-platform replacement for the former db-up.ps1.
//
// Targets the dev container by default. When `ATLAS_ENV=prod` is set,
// targets the prod container instead so dev and prod stacks stay isolated:
//   dev  -> service `postgres`,      container `atlas-postgres`,      db `atlas`
//   prod -> service `postgres-prod`, container `atlas-postgres-prod`, db `atlas_prod`
//
// Spawns:
//   docker compose up -d <service>   (with cwd = repo root)
//   docker exec <container> pg_isready -U <user> -d <db>   (polled)
//
// Requires `docker` on PATH. The compose file lives at the repo root.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

const isProd = process.env['ATLAS_ENV']?.toLowerCase() === 'prod';
const service = isProd ? 'postgres-prod' : 'postgres';
const container = isProd ? 'atlas-postgres-prod' : 'atlas-postgres';
const dbUser = isProd
    ? process.env['POSTGRES_USER_PROD'] ?? 'atlas'
    : process.env['POSTGRES_USER'] ?? 'atlas';
const dbName = isProd
    ? process.env['POSTGRES_DB_PROD'] ?? 'atlas_prod'
    : process.env['POSTGRES_DB'] ?? 'atlas';

function run(cmd: string, args: readonly string[], opts: { cwd?: string; stdio?: 'inherit' | 'ignore' } = {}): number {
    const result = spawnSync(cmd, args, {
        cwd: opts.cwd,
        stdio: opts.stdio ?? 'inherit',
        shell: false,
    });
    if (result.error) {
        console.error(`[db-up] failed to spawn ${cmd}: ${result.error.message}`);
        return 1;
    }
    return result.status ?? 1;
}

type ContainerState = 'running' | 'stopped' | 'absent';

// container_name in docker-compose.yml is a global Docker name. When the same
// db:up is run from two different folders, compose creates two different
// "projects" but tries to claim the same global container name and Docker
// refuses with a Conflict error. Make the script idempotent: if the
// container already exists, reuse it; only fall through to `compose up` when
// nothing is there yet.
function inspectContainer(name: string): ContainerState {
    const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', name], {
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false,
    });
    if (result.status !== 0) return 'absent';
    return String(result.stdout ?? '').trim() === 'true' ? 'running' : 'stopped';
}

async function main(): Promise<void> {
    console.log(`[db-up] target=${isProd ? 'prod' : 'dev'} service=${service} container=${container} db=${dbName}`);

    const state = inspectContainer(container);
    if (state === 'running') {
        console.log(`[db-up] container ${container} already running, reusing.`);
    } else if (state === 'stopped') {
        console.log(`[db-up] container ${container} exists but stopped; starting it...`);
        const startCode = run('docker', ['start', container]);
        if (startCode !== 0) {
            console.error(`[db-up] docker start failed with exit code ${startCode}`);
            process.exit(startCode);
        }
    } else {
        console.log('[db-up] no existing container; creating via docker compose up...');
        const upCode = run('docker', ['compose', 'up', '-d', service], { cwd: REPO_ROOT });
        if (upCode !== 0) {
            console.error(`[db-up] docker compose up failed with exit code ${upCode}`);
            process.exit(upCode);
        }
    }

    console.log('[db-up] waiting for postgres to accept connections...');
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const ready = run(
            'docker',
            ['exec', container, 'pg_isready', '-U', dbUser, '-d', dbName],
            { stdio: 'ignore' },
        );
        if (ready === 0) {
            console.log('[db-up] postgres is ready.');
            return;
        }
        await new Promise((r) => setTimeout(r, 500));
    }

    console.error('[db-up] postgres did not become ready within 60s');
    process.exit(1);
}

void main();
