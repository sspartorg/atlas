// Single source of truth for env vars: the monorepo root `.env`, or
// `.env.prod` when `ATLAS_ENV=prod`.
//
// Every entry point that needs env access imports this module for its
// side effect:
//
//     import './load-env.js';
//
// We resolve the env file relative to *this file's* location (compiled to
// `dist/load-env.js`, or executed as `src/load-env.ts` under tsx),
// not via `process.cwd()`. That keeps the path stable whether the API
// is launched via `pnpm dev` from root or `pnpm --filter @atlas/api
// start` from anywhere else.
//
// History: per-package `.env` files (packages/api/.env, etc.) used to
// duplicate root keys and drift silently. They're gone now — the only
// per-mode env files live at the root (`.env`, `.env.prod`).

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/api/src/load-env.ts  -> repo root is ../../../
// packages/api/dist/load-env.js -> repo root is ../../../ (same depth)
const repoRoot = path.resolve(here, '..', '..', '..');

const mode = process.env['ATLAS_ENV']?.toLowerCase() === 'prod' ? 'prod' : 'dev';
const envFile = mode === 'prod' ? '.env.prod' : '.env';
const envPath = path.resolve(repoRoot, envFile);

const result = config({ path: envPath });
if (result.error) {
    console.error(`[load-env] failed to load ${envFile}: ${result.error.message}`);
} else {
    console.log(`[load-env] mode=${mode}, file=${envFile}`);
}
