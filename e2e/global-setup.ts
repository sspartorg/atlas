import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
// Playwright loads globalSetup as ESM in 1.40+; __dirname isn't
// defined unless we recompute from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// E2E global setup. Owns the dedicated `atlas_e2e` Postgres DB +
// spawns api on :6001 + web on :6000. Tear-down lives in
// `global-teardown.ts`; the two share state via a tiny PID file
// (`e2e-logs/pids.json`) which records both child PIDs + the windows
// shell flag so teardown can SIGTERM / taskkill the right tree.
//
// Prereq: `docker compose up -d atlas-postgres` (the same instance
// the dev stack uses — we just create another database inside it, and
// reach it on host port 5500).

const E2E_DB = 'atlas_e2e';
const API_PORT = 6001;
// 2026-06-23 — moved off 6000 (X11 server port) because it sits on the
// WHATWG "bad ports" blocklist. Node's undici-backed fetch refuses it
// (`bad port` error) and bundled Chromium blocks it as ERR_UNSAFE_PORT,
// so both the global-setup HTTP probe AND the actual test browser
// navigation would otherwise fail before any spec runs.
const WEB_PORT = 6010;
const REPO_ROOT = resolve(__dirname, '..');
const LOG_DIR = join(REPO_ROOT, 'e2e-logs');
const PID_FILE = join(LOG_DIR, 'pids.json');

async function dropAndCreateDb(): Promise<void> {
    // atlas user owns the cluster — we connect to `postgres` and
    // recreate the e2e DB to guarantee a clean slate. FORCE detaches
    // any open connections (a previous flaky run might have left
    // some open).
    const psql = async (sql: string) => {
        await execFileP(
            'docker',
            ['exec', 'atlas-postgres', 'psql', '-U', 'atlas', '-d', 'postgres', '-c', sql],
            { maxBuffer: 4 * 1024 * 1024 },
        );
    };
    try {
        await psql(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE);`);
    } catch {
        // Older PG without FORCE — fall through; CREATE will fail
        // loudly if the DB is still attached, which is what we want.
    }
    await psql(`CREATE DATABASE ${E2E_DB};`);
}

async function migrate(): Promise<void> {
    // Reuse the api's run-migrations.ts. DATABASE_URL points at
    // the e2e DB; everything else inherits.
    const url = `postgres://atlas:atlas@localhost:5500/${E2E_DB}`;
    await execFileP(
        'pnpm',
        ['--filter', '@atlas/api', 'exec', 'tsx', 'src/db/run-migrations.ts', 'latest'],
        {
            cwd: REPO_ROOT,
            env: { ...process.env, DATABASE_URL: url },
            maxBuffer: 8 * 1024 * 1024,
            shell: process.platform === 'win32',
        },
    );
}

async function seed(): Promise<void> {
    // Run the small `e2e/fixtures/run-seed.ts` wrapper which imports
    // `runSeed()` from the api module. Inline `tsx -e` shell-quoting
    // is unreliable on Windows; a dedicated file is cleaner.
    const url = `postgres://atlas:atlas@localhost:5500/${E2E_DB}`;
    await execFileP(
        'pnpm',
        ['exec', 'tsx', 'e2e/fixtures/run-seed.ts'],
        {
            cwd: REPO_ROOT,
            env: { ...process.env, DATABASE_URL: url },
            maxBuffer: 8 * 1024 * 1024,
            shell: process.platform === 'win32',
        },
    );
}

async function waitForUrl(url: string, label: string, maxMs = 60_000): Promise<void> {
    const deadline = Date.now() + maxMs;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok || res.status === 404) return;
        } catch (e) {
            lastErr = e;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`[e2e] ${label} did not become ready at ${url}: ${String(lastErr).slice(0, 200)}`);
}

function startApi(): ChildProcess {
    const logPath = join(LOG_DIR, 'api.log');
    const out = createWriteStream(logPath, { flags: 'w' });
    // 2026-06-22 — Terminal v1. cli-session-host spawns this binary for
    // every PTY. Defaulting to the fake-claude fixture keeps the E2E
    // hermetic (no real Anthropic auth needed, no $$$ per run). The
    // override hook honours an explicit env var so a developer can point
    // at the real `claude` if they want to drive a live session in a
    // local E2E debug run.
    const fakeClaudePath = join(
        REPO_ROOT,
        'e2e',
        'fixtures',
        process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.js',
    );
    const claudeBinary =
        process.env['ATLAS_CLAUDE_BINARY'] && process.env['ATLAS_CLAUDE_BINARY'].length > 0
            ? process.env['ATLAS_CLAUDE_BINARY']
            : fakeClaudePath;
    // 2026-06-25 — Mirror block for copilot. Same shape as claude above:
    // default to the fake-copilot fixture so copilot PTY sessions work in
    // the hermetic e2e stack (no real `gh copilot` install needed). An
    // explicit env override is honoured so a developer can drive the real
    // binary in a live e2e debug run.
    const fakeCopilotPath = join(
        REPO_ROOT,
        'e2e',
        'fixtures',
        process.platform === 'win32' ? 'fake-copilot.cmd' : 'fake-copilot.js',
    );
    const copilotBinary =
        process.env['ATLAS_COPILOT_BINARY'] && process.env['ATLAS_COPILOT_BINARY'].length > 0
            ? process.env['ATLAS_COPILOT_BINARY']
            : fakeCopilotPath;
    const child = spawn(
        'pnpm',
        ['--filter', '@atlas/api', 'dev'],
        {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                API_PORT: String(API_PORT),
                // 2026-06-23 — the API's MCP-token gate trusts the browser
                // origins built from WEB_PORT (see utils/lan-origins.ts).
                // Without this the e2e web at 127.0.0.1:6010 hits the API's
                // 401 path on every write, since the trusted set defaults
                // to the dev port (4000). The dev pnpm script sets this
                // automatically; the e2e spawn has to be explicit.
                WEB_PORT: String(WEB_PORT),
                DATABASE_URL: `postgres://atlas:atlas@localhost:5500/${E2E_DB}`,
                ATLAS_AI_ENABLED: 'false',
                ATLAS_LOG_LEVEL: 'error',
                // Disable per-request log noise.
                ATLAS_REQUEST_LOG: 'false',
                ATLAS_CLAUDE_BINARY: claudeBinary,
                ATLAS_COPILOT_BINARY: copilotBinary,
            },
            shell: process.platform === 'win32',
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
    return child;
}

function startWeb(): ChildProcess {
    const logPath = join(LOG_DIR, 'web.log');
    const out = createWriteStream(logPath, { flags: 'w' });
    // Web port + proxy target are picked up by vite.config.ts from
    // env (WEB_PORT + API_PROXY_TARGET). Invoking vite directly through
    // `pnpm exec` bypasses any port flags the package's dev script
    // might set.
    // 2026-06-23 — `--host 127.0.0.1` mirrors what the api binds to so
    // the waitForUrl probe (also 127.0.0.1) finds a listener. Without
    // this Vite 6 defaults to `server.host='localhost'` which on Windows
    // binds IPv6-only (`::1`), and the v4 probe times out while Vite
    // happily reports "ready" in the log.
    //
    // T1 — `ATLAS_E2E_PROD=1` switches the web from `vite` (dev) to
    // `vite preview` (serves the production build). Required for prod-
    // build perf measurement: dev-mode TTI is dominated by on-demand
    // module compilation tails and does not reflect what users see.
    const prodMode = process.env['ATLAS_E2E_PROD'] === '1';
    const viteArgs = prodMode
        ? ['preview', '--strictPort', '--host', '127.0.0.1', '--port', String(WEB_PORT)]
        : ['--strictPort', '--host', '127.0.0.1'];
    const child = spawn(
        'pnpm',
        ['--filter', '@atlas/web', 'exec', 'vite', ...viteArgs],
        {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                WEB_PORT: String(WEB_PORT),
                API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
                VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
            },
            shell: process.platform === 'win32',
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
    return child;
}

export default async function globalSetup(): Promise<void> {
    mkdirSync(LOG_DIR, { recursive: true });

    // Skip the heavy setup when running in "specs only" debug mode —
    // useful when the API + Web are already up from a `pnpm dev`
    // session and you just want to iterate on a spec.
    if (process.env['E2E_SKIP_SETUP'] === '1') {
        if (!existsSync(PID_FILE)) writeFileSync(PID_FILE, JSON.stringify({ skipped: true }));
        return;
    }

    // eslint-disable-next-line no-console
    console.log('[e2e] dropping + creating atlas_e2e...');
    await dropAndCreateDb();
    // eslint-disable-next-line no-console
    console.log('[e2e] running migrations...');
    await migrate();
    // eslint-disable-next-line no-console
    console.log('[e2e] seeding...');
    await seed();

    // eslint-disable-next-line no-console
    console.log(`[e2e] spawning api on :${API_PORT}...`);
    const apiChild = startApi();
    // eslint-disable-next-line no-console
    console.log(`[e2e] spawning web on :${WEB_PORT}...`);
    const webChild = startWeb();

    writeFileSync(
        PID_FILE,
        JSON.stringify({
            apiPid: apiChild.pid,
            webPid: webChild.pid,
            platform: process.platform,
        }),
    );

    // 2026-06-23 — Both api (`HOST='127.0.0.1'` in api/src/main.ts) and
    // vite (default `server.host='localhost'` → 127.0.0.1) bind to the
    // IPv4 loopback. On Windows, Node's fetch resolves `localhost` to
    // `::1` first and the connect to the IPv6 loopback hangs because no
    // listener is there; happy-eyeballs fallback to v4 doesn't reliably
    // kick in within the per-poll timeout. Hit the IPv4 address directly.
    await waitForUrl(`http://127.0.0.1:${API_PORT}/api/agents`, 'api');
    await waitForUrl(`http://127.0.0.1:${WEB_PORT}/`, 'web');

    // eslint-disable-next-line no-console
    console.log('[e2e] stack ready');
}
