#!/usr/bin/env node
// `pnpm -F @atlas/web start`: serve the production build.
//
//   ATLAS_HTTPS_PORT unset → `vite preview` (HTTP/1.1 on WEB_PORT), as before.
//   ATLAS_HTTPS_PORT set   → Caddy (HTTPS + HTTP/2/3) with ./Caddyfile — ADR 0031.
//
// Env comes from the shell, then .env / .env.prod (ATLAS_ENV=prod), the same
// files vite.config.ts and the API read.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.ATLAS_ENV?.toLowerCase() === 'prod';
loadDotenv({ path: join(WEB, '..', '..', isProd ? '.env.prod' : '.env'), quiet: true });

const httpsPort = process.env.ATLAS_HTTPS_PORT;
const [cmd, args] = httpsPort
    ? ['caddy', ['run', '--config', join(WEB, 'Caddyfile'), '--adapter', 'caddyfile']]
    : ['vite', ['preview', '--host', ...process.argv.slice(2)]];

const child = spawn(cmd, args, {
    cwd: WEB,
    stdio: 'inherit',
    env: {
        ...process.env,
        ATLAS_WEB_DIST: join(WEB, 'dist'),
        API_PORT: process.env.API_PORT || '4001',
    },
});
child.on('error', (err) => {
    if (httpsPort && err.code === 'ENOENT') {
        console.error('ATLAS_HTTPS_PORT is set but `caddy` is not installed (brew install caddy).');
    } else {
        console.error(err);
    }
    process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
if (httpsPort) console.log(`Atlas web: https://localhost:${httpsPort} (HTTP/2 via Caddy)`);
