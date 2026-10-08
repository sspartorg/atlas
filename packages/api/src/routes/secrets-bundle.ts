import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { MIN_PASSPHRASE, SecretsBundleSchema, secretsBundle } from '../services/secrets-bundle.js';

const Passphrase = z.string().min(MIN_PASSPHRASE, `Passphrase must be at least ${MIN_PASSPHRASE} characters`);

// Move every secret but git credentials to another machine, sealed with a passphrase.
export async function secretsBundleRoutes(app: FastifyInstance) {
    app.post('/api/secrets-bundle/export', { preHandler: requireMcpToken }, async (req, reply) => {
        const { passphrase } = z.object({ passphrase: Passphrase }).strict().parse(req.body);
        const bundle = await secretsBundle.export(passphrase);
        req.log.info({ tag: 'secret_reveal', scope: 'secrets_bundle' }, 'secrets bundle exported');
        return reply.send(bundle);
    });

    app.post('/api/secrets-bundle/import', { preHandler: requireMcpToken }, async (req, reply) => {
        const { passphrase, bundle } = z
            .object({ passphrase: z.string().min(1), bundle: SecretsBundleSchema })
            .strict()
            .parse(req.body);
        return reply.send(await secretsBundle.import(bundle, passphrase));
    });
}
