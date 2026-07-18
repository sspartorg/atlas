import type { FastifyInstance } from 'fastify';
import { CreateCredentialSchema, UpdateCredentialSchema } from '@atlas/shared';
import {
    credentialsService,
    stripSecretsForApi,
    CredentialValidationError,
} from '../services/credentials.js';
import { refreshCredential } from '../services/github-app-tokens.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { ApiError } from '../utils/errors.js';

export async function credentialsRoutes(app: FastifyInstance) {
    app.get('/api/credentials', async (_req, reply) => {
        const rows = await credentialsService.list();
        return reply.send(rows.map(stripSecretsForApi));
    });

    app.get('/api/credentials/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const c = await credentialsService.get(id);
        if (!c) throw new ApiError('not_found', 'Credential not found', 404);
        return reply.send(stripSecretsForApi(c));
    });

    app.post('/api/credentials', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = CreateCredentialSchema.parse(req.body);
        try {
            const cred =
                body.kind === 'pat'
                    ? await credentialsService.create({
                          label: body.label,
                          host: body.host,
                          kind: 'pat',
                          username: body.username,
                          token: body.token,
                          scope: body.scope,
                          expires_at: body.expires_at,
                      })
                    : await credentialsService.create({
                          label: body.label,
                          host: body.host,
                          kind: 'github_app',
                          bot_info_path: body.bot_info_path,
                          app_installation_owner: body.app_installation_owner,
                          scope: body.scope,
                          human_name: body.human_name ?? null,
                          human_email: body.human_email ?? null,
                          human_gh_login: body.human_gh_login ?? null,
                      });
            return reply.status(201).send(stripSecretsForApi(cred));
        } catch (err) {
            if (err instanceof CredentialValidationError) {
                throw new ApiError('validation_error', err.message, 400);
            }
            throw err;
        }
    });

    app.patch('/api/credentials/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await credentialsService.get(id)))
            throw new ApiError('not_found', 'Credential not found', 404);
        const body = UpdateCredentialSchema.parse(req.body);
        try {
            const updated = await credentialsService.update(id, body);
            return reply.send(stripSecretsForApi(updated));
        } catch (err) {
            if (err instanceof CredentialValidationError) {
                throw new ApiError('validation_error', err.message, 400);
            }
            throw err;
        }
    });

    app.delete('/api/credentials/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        if (!(await credentialsService.get(id)))
            throw new ApiError('not_found', 'Credential not found', 404);
        await credentialsService.delete(id);
        return reply.status(204).send();
    });

    // Force-refresh a `github_app` credential now, bypassing the pre-warm
    // window. Returns the updated row (with ciphertext stripped) so the
    // UI can show the fresh expires_at without a separate GET.
    app.post(
        '/api/credentials/:id/refresh',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const { id } = req.params as { id: string };
            const cred = await credentialsService.get(id);
            if (!cred) throw new ApiError('not_found', 'Credential not found', 404);
            if (cred.kind !== 'github_app') {
                throw new ApiError(
                    'validation_error',
                    'Only github_app credentials can be refreshed',
                    400,
                );
            }
            try {
                await refreshCredential(id);
            } catch (err) {
                // Classify well-known GitHub failures as 4xx so the UI can
                // surface an actionable message. Everything else falls
                // through to the default 500 handler. We match on the HTTP
                // status the ghGet/ghPost helpers embed in the message
                // (`-> 404`, `-> 401`, etc.) rather than substring-parsing
                // GitHub's human-readable body.
                const msg = err instanceof Error ? err.message : String(err);
                const statusMatch = /->\s*(\d{3})/.exec(msg);
                const ghStatus = statusMatch ? Number(statusMatch[1]) : null;
                // Strip GitHub's raw response body from the caller-facing
                // message; keep only the prefix + status so we don't echo
                // installation topology or rate-limit correlation ids.
                const safeMsg = msg.split(/:\s+/)[0] ?? msg;
                if (ghStatus === 401 || ghStatus === 403) {
                    throw new ApiError(
                        'validation_error',
                        `GitHub rejected the App JWT — check the private key and app id (${safeMsg})`,
                        400,
                    );
                }
                if (ghStatus === 404) {
                    throw new ApiError(
                        'validation_error',
                        `GitHub could not find the App installation on the configured owner — check app_installation_owner (${safeMsg})`,
                        400,
                    );
                }
                throw err;
            }
            const fresh = await credentialsService.get(id);
            // reason: refreshCredential succeeded without throwing, so the
            // row still exists — a concurrent DELETE mid-refresh is not a
            // supported race in this personal-install service.
            return reply.send(stripSecretsForApi(fresh!));
        },
    );
}
