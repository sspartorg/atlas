import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { settingsRoutes } from './routes/settings.js';
import { agentsRoutes } from './routes/agents.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { rolesRoutes } from './routes/roles.js';
import { projectsRoutes } from './routes/projects.js';
import { credentialsRoutes } from './routes/credentials.js';
import { epicsRoutes } from './routes/epics.js';
import { labelsRoutes } from './routes/labels.js';
import { storiesRoutes } from './routes/stories.js';
import { bugsRoutes } from './routes/bugs.js';
import { issuesRoutes } from './routes/issues.js';
import { commentsRoutes } from './routes/comments.js';
import { notificationsRoutes } from './routes/notifications.js';
import { pushSubscriptionsRoutes } from './routes/push-subscriptions.js';
import { searchRoutes } from './routes/search.js';
import { countsRoutes } from './routes/counts.js';
import { eventsRoutes } from './routes/events.js';
import { runRoutes } from './routes/run.js';
import { fsRoutes } from './routes/fs.js';
import { schedulesRoutes } from './routes/schedules.js';
import { remindersRoutes } from './routes/reminders.js';
import { scratchPadRoutes } from './routes/scratchPad.js';
import { cliModelsRoutes } from './routes/cli-models.js';
import { toolCatalogRoutes } from './routes/tool-catalog.js';
import { serverRoutes } from './routes/server.js';
import { guardrailsRoutes } from './routes/guardrails.js';
import { projectGuardrailsRoutes } from './routes/project-guardrails.js';
import { guardrailScriptsRoutes } from './routes/guardrail-scripts.js';
import { projectGuardrailScriptsRoutes } from './routes/project-guardrail-scripts.js';
import { environmentSecretsRoutes } from './routes/environment-secrets.js';
import { analyticsRoutes } from './routes/analytics.js';
import { cliSessionsRoutes } from './routes/cli-sessions.js';
import { perfRoutes } from './routes/perf.js';
import { recordTiming } from './services/perf-stats.js';
// Plan E (Owner request, 2026-06-01) — `repoExecRoutes` removed alongside
// the `mcp__atlas__execGitHub` tool. Orchestrator owns push + PR creation
// directly (no HTTP indirection from the MCP server back into the API
// for git operations). See `services/worktree-orchestrator.ts`.
import { ApiError, asErrorBody } from './utils/errors.js';
import { getAllowedOrigins, getLanOrigins } from './utils/lan-origins.js';
import { requireMcpToken } from './plugins/mcp-auth.js';
import type { ApiErrorBody } from '@atlas/shared';

// ATLAS_LOG_LEVEL is the source of truth for the Fastify logger level.
// Editable via Settings → Environment; the file-on-disk change takes effect
// on the next server start, OR the live runtime can be flipped without a
// restart via `POST /api/settings/log-level` (see routes/settings.ts).
const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof VALID_LOG_LEVELS)[number];

export function isValidLogLevel(s: string): s is LogLevel {
    return (VALID_LOG_LEVELS as readonly string[]).includes(s);
}

export function resolveLogLevel(): LogLevel {
    const raw = process.env['ATLAS_LOG_LEVEL']?.toLowerCase() ?? '';
    return isValidLogLevel(raw) ? raw : 'info';
}

// packages/api/src/server.ts (or dist/server.js) → up three to repo root → /logs/atlas-api.log.
function defaultLogFilePath(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', '..', '..', 'logs', 'atlas-api.log');
}

// P6 — Surface silent Pino failures.
//
// Pino's multi-target transport runs each target in a worker thread. If a
// target throws on init (bad path, ENOSPC, permission, mkdir of a UNC path,
// etc.), the worker emits an `error` on `ThreadStream` and either takes the
// whole process down with an uncaught error or — worse on some platforms —
// just stops flushing without raising anything visible to the user. Either
// way, the user sees "logs disappeared" with no signal as to why.
//
// We can't catch worker errors from this side of the transport boundary,
// but we CAN pre-validate the things that fail in practice:
//   1. The log-file directory is creatable (or already exists). If we can't
//      mkdir it, we fall back to stdout-only and emit a stderr warning so
//      the next request still produces output.
//   2. The ATLAS_LOG_LEVEL value is one we recognise; otherwise we coerce
//      to `info` and warn.
//
// We also install a `process.on('uncaughtException')` filter that catches
// the specific ThreadStream ENOENT/EACCES kind of crash and reduces it to
// a stderr line + stdout-only fallback rather than killing the API.
function ensureLogFileDirWritable(filePath: string): { ok: true } | { ok: false; reason: string } {
    try {
        const dir = path.dirname(filePath);
        // mkdirSync with recursive:true is idempotent and surfaces EACCES /
        // ENOENT-on-UNC-root synchronously, before Pino's worker swallows it.
        // We deliberately use the sync API so the failure is observable here.
        fs.mkdirSync(dir, { recursive: true });
        // Verify we can write — touch and remove a probe file.
        const probe = path.join(dir, '.atlas-log-probe');
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return { ok: true };
    } catch (err) {
        const reason = err instanceof Error ? (err.message || err.name) : String(err);
        return { ok: false, reason };
    }
}

// Default Fastify logger: tee to stdout AND a file via Pino's multi-target
// transport. Pino's 'pino/file' target with `destination: 1` keeps stdout,
// and a second target with `mkdir: true` writes to the persistent log file.
// ATLAS_LOG_FILE=off skips the file target entirely (e.g. CI, tests).
// Tests pass `logger: false` and never hit this branch.
type LogTarget = { target: string; level: LogLevel; options: Record<string, unknown> };
export function buildDefaultLoggerOptions(): {
    level: LogLevel;
    transport: { targets: LogTarget[] };
} {
    // Honour the raw env first so we can warn if it's invalid.
    const rawLevel = process.env['ATLAS_LOG_LEVEL']?.toLowerCase() ?? '';
    let level: LogLevel = 'info';
    if (rawLevel === '') {
        level = 'info';
    } else if (isValidLogLevel(rawLevel)) {
        level = rawLevel;
    } else {
        // Invalid value — coerce + warn on stderr so the user sees the misconfig.
        // We can't use the logger here because it's what we're trying to build.
        process.stderr.write(
            `[atlas] WARN ATLAS_LOG_LEVEL=${JSON.stringify(rawLevel)} is not one of ` +
                `${VALID_LOG_LEVELS.join('|')}; falling back to 'info'.\n`,
        );
    }

    const logFileEnv = (process.env['ATLAS_LOG_FILE'] ?? '').trim();
    const targets: LogTarget[] = [
        { target: 'pino/file', level, options: { destination: 1 } },
    ];
    if (logFileEnv.toLowerCase() !== 'off') {
        const filePath = logFileEnv.length > 0 ? logFileEnv : defaultLogFilePath();
        const check = ensureLogFileDirWritable(filePath);
        if (check.ok) {
            targets.push({
                target: 'pino/file',
                level,
                options: { destination: filePath, mkdir: true },
            });
        } else {
            // Don't take the API down for a bad log path; surface clearly
            // and fall back to stdout-only.
            process.stderr.write(
                `[atlas] WARN log-file target disabled: cannot prepare ${filePath} ` +
                    `(${check.reason}). Set ATLAS_LOG_FILE=off to silence this warning, ` +
                    `or point it at a writable directory. Continuing with stdout-only logs.\n`,
            );
        }
    }
    return { level, transport: { targets } };
}

// Decide whether to disable Fastify's per-request "incoming request" /
// "request completed" lifecycle lines. ATLAS_REQUEST_LOG forces an answer
// either way; otherwise we auto-enable the chatter when the user explicitly
// asked for debug/trace, because the alternative ("I set debug and hit a
// route and saw zero lines") is exactly the confusing failure mode this
// plan exists to fix.
export function resolveRequestLoggingDisabled(): boolean {
    const flag = (process.env['ATLAS_REQUEST_LOG'] ?? '').toLowerCase();
    if (flag === 'true' || flag === '1') return false;
    if (flag === 'false' || flag === '0') return true;
    // Unset: auto by log level.
    const level = resolveLogLevel();
    return level !== 'debug' && level !== 'trace';
}

// One-time install of a ThreadStream error rescue. If Pino's worker thread
// still emits an `error` event despite the pre-validation above (e.g. the
// disk fills up mid-run), Node otherwise crashes the whole process with an
// "Unhandled 'error' event" trace. Translate it into a stderr warning so the
// API keeps serving even if the file appender dies.
let threadStreamRescueInstalled = false;
function installThreadStreamRescue(): void {
    if (threadStreamRescueInstalled) return;
    threadStreamRescueInstalled = true;
    process.on('uncaughtException', (err) => {
        const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
        // Heuristic: ThreadStream-from-Pino crashes surface ENOENT/EACCES on
        // mkdir/open inside a worker. If it's that family, swallow + warn.
        // Anything else re-throws so Node's default handler runs.
        if (/ThreadStream|pino\/file|thread-stream/.test(msg) || /mkdir|ENOENT|EACCES|EPERM/.test(msg)) {
            process.stderr.write(
                `[atlas] WARN Pino transport worker error swallowed (logs may stop ` +
                    `writing to the file appender):\n${msg}\n`,
            );
            return;
        }
        // Not ours — re-raise so the existing main.ts handler / Node default
        // surfaces it.
        throw err;
    });
}

/**
 * Constructs the Fastify app: registers CORS, swagger, every route plugin,
 * and the timestamp-normalisation pre-serialization hook. Does NOT seed the
 * DB, boot the cron schedules, or call `.listen()` — those are boot-time
 * side effects that `main.ts` handles, and that tests need to skip when
 * standing up an in-memory app.
 *
 * Pass `logger: false` from tests to suppress Fastify's per-request logging.
 * Importing this module has zero side effects — no DB created, no port bound,
 * no schedules registered.
 */
export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
    installThreadStreamRescue();
    const server = Fastify({
        logger: opts.logger ?? buildDefaultLoggerOptions(),
        // Per-request lifecycle logs (one "incoming request" + one "request completed"
        // line per HTTP call at info level) are the dominant console noise in dev with
        // the web client polling sidenav-counts + tree + SSE.
        //
        // Off by default at info+ levels, BUT auto-enabled when the user explicitly
        // asks for debug/trace verbosity — otherwise "I set ATLAS_LOG_LEVEL=debug
        // and hit /api/health and saw nothing" is the experience, because the
        // healthcheck handler itself emits no log line and Fastify's lifecycle
        // chatter is gated by this flag. ATLAS_REQUEST_LOG=true forces it on
        // even at info; ATLAS_REQUEST_LOG=false forces it off even at debug.
        disableRequestLogging: resolveRequestLoggingDisabled(),
        ...opts,
    });

    // W4 — Typed error envelope. Route + service code throws `ApiError`;
    // this handler maps it to `{ error, kind, details? }` with the carried
    // status. Fastify's own validation errors and Zod `.parse()` throws are
    // mapped to `kind: 'validation_error'` so the client can branch on a
    // single code without sniffing message text. Everything else is treated
    // as `internal_error` with the original message preserved.
    server.setErrorHandler((err, req, reply) => {
        if (err instanceof ApiError) {
            return reply.status(err.status).send(asErrorBody(err));
        }
        // Fastify 5 types this callback's err as `unknown`. Narrow once via a
        // structural cast so the remaining branches can read the fields any
        // FastifyError / Error / Zod throw will carry.
        const e = err as {
            message?: string;
            statusCode?: number;
            validation?: unknown[];
            issues?: Array<{ message: string }>;
        };
        // Zod errors (from CreateXSchema.parse(req.body) calls in routes that
        // don't catch locally) carry a `.issues` array of validation problems.
        if (Array.isArray(e.issues) && e.issues.length > 0) {
            const body: ApiErrorBody = {
                error: e.issues.map((i) => i.message).join('; '),
                kind: 'validation_error',
                details: e.issues,
            };
            return reply.status(400).send(body);
        }
        // Fastify schema-validation rejections — `validation` array, no
        // explicit status code yet.
        if (e.validation) {
            const body: ApiErrorBody = {
                error: e.message ?? 'Validation error',
                kind: 'validation_error',
                details: e.validation,
            };
            return reply.status(e.statusCode ?? 400).send(body);
        }
        // Catch-all. Log at error level so the file appender captures it;
        // wire the original message so legacy callers reading `body.error`
        // still see a useful string.
        req.log.error({ err }, 'Unhandled error in route');
        const body: ApiErrorBody = {
            error: e.message || 'Internal server error',
            kind: 'internal_error',
        };
        return reply.status(e.statusCode ?? 500).send(body);
    });

    // Global MCP-token gate for write methods. The plugin allows trusted
    // browser origins (the local React app) through unchanged, so the UI
    // works without ever sending a token; external MCP clients must send
    // X-Atlas-Token when ATLAS_MCP_TOKEN is set. Reads (GET) are unaffected.
    // Per-route `preHandler: requireMcpToken` still works alongside this — it
    // just runs after the same plugin already passed.
    const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    server.addHook('onRequest', async (req, reply) => {
        if (!WRITE_METHODS.has(req.method)) return;
        await requireMcpToken(req, reply);
    });

    const lanOrigins = getLanOrigins();
    if (lanOrigins.length > 0) {
        server.log.info(
            `[security] ATLAS_LAN_ACCESS=true — trusting LAN origins for CORS + MCP-token gate: ${lanOrigins.join(', ')}`,
        );
    }
    await server.register(cors, {
        origin: getAllowedOrigins(),
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        credentials: true,
    });

    // Marketplace zip import (POST /api/agents/import) accepts file uploads.
    // Limit set generously (5 MB) — agent bundles are mostly small markdown.
    await server.register(multipart, {
        limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    });
    // Raw zip body support (curl + MCP) — register a parser so the import
    // route's `req.body instanceof Buffer` branch lights up.
    server.addContentTypeParser(
        'application/zip',
        { parseAs: 'buffer' },
        (_req, body, done) => done(null, body),
    );

    // 2026-06-22 — Terminal v1. WebSocket plugin powers the PTY byte-stream
    // route `/api/cli/sessions/:id/stream`. Bytes go bidirectionally; the
    // existing SSE bus only carries metadata-change events for the same
    // sessions (status, cost rollup, closed).
    await server.register(websocket);

    await server.register(swagger, {
        openapi: {
            info: {
                title: 'Atlas API',
                version: '0.2.0',
                description:
                    'Internal API for the Atlas agent orchestration UI. See .agents/api-surface.md for the human index.',
            },
            servers: [
                {
                    url: `http://localhost:${process.env['API_PORT'] ?? process.env['PORT'] ?? 4001}`,
                    description: process.env['ATLAS_ENV']?.toLowerCase() === 'prod' ? 'Local prod' : 'Local dev',
                },
            ],
        },
    });

    await server.register(swaggerUi, {
        routePrefix: '/api/docs',
        uiConfig: { docExpansion: 'list', deepLinking: true },
    });

    server.get('/api/health', async () => ({
        status: 'ok',
        service: 'atlas-api',
        version: '0.2.0',
    }));

    await server.register(settingsRoutes);
    await server.register(agentsRoutes);
    await server.register(marketplaceRoutes);
    await server.register(rolesRoutes);
    await server.register(projectsRoutes);
    await server.register(schedulesRoutes);
    await server.register(remindersRoutes);
    await server.register(scratchPadRoutes);
    await server.register(credentialsRoutes);
    await server.register(epicsRoutes);
    await server.register(labelsRoutes);
    await server.register(storiesRoutes);
    await server.register(bugsRoutes);
    await server.register(issuesRoutes);
    await server.register(commentsRoutes);
    await server.register(notificationsRoutes);
    await server.register(pushSubscriptionsRoutes);
    await server.register(searchRoutes);
    await server.register(countsRoutes);
    await server.register(eventsRoutes);
    await server.register(runRoutes);
    await server.register(fsRoutes);
    await server.register(cliModelsRoutes);
    await server.register(toolCatalogRoutes);
    await server.register(serverRoutes);
    await server.register(guardrailsRoutes);
    await server.register(projectGuardrailsRoutes);
    await server.register(guardrailScriptsRoutes);
    await server.register(projectGuardrailScriptsRoutes);
    await server.register(environmentSecretsRoutes);
    await server.register(analyticsRoutes);
    await server.register(cliSessionsRoutes);
    await server.register(perfRoutes);

    installPerfHook(server);

    return server;
}

// Audit 2026-06-09 — request-timing perf hook.
//
// Two modes, both opt-in so default boot is unchanged:
//
//   - ATLAS_PERF=1 — log every request with method/url/status/duration.
//   - ATLAS_SLOW_REQUEST_MS=<n> (default 250) — always log when a
//     request takes ≥ n ms regardless of ATLAS_PERF, at warn level.
//
// Logged via `req.log` so it tees to file + stdout the same way as
// the rest of the API logs.
function installPerfHook(server: FastifyInstance): void {
    const perfEnabled = process.env['ATLAS_PERF'] === '1';
    const slowThresholdMs = Number(process.env['ATLAS_SLOW_REQUEST_MS'] ?? 250);
    server.addHook('onResponse', async (req, reply) => {
        const durationMs = reply.elapsedTime;
        // Record into the in-memory per-route registry for the /api/_perf
        // endpoint even when ATLAS_PERF is off. The registry is bounded
        // (500-sample window, 2000-key cap) so this is safe as an always-on.
        const routeTemplate =
            (req as unknown as { routeOptions?: { url?: string } }).routeOptions?.url ??
            req.url.split('?')[0] ??
            '<UNKNOWN>';
        recordTiming(req.method, routeTemplate, reply.statusCode, durationMs, slowThresholdMs);
        const slow = durationMs >= slowThresholdMs;
        if (!perfEnabled && !slow) return;
        const fields = {
            tag: 'atlas:perf:request',
            method: req.method,
            url: req.url,
            status: reply.statusCode,
            duration_ms: Math.round(durationMs * 100) / 100,
            slow,
        };
        if (slow) req.log.warn(fields, 'slow request');
        else req.log.info(fields, 'perf request');
    });
}
