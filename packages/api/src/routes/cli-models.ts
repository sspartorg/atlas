import type { FastifyInstance } from 'fastify';
import { CreateCliModelSchema, UpdateCliModelSchema } from '@atlas/shared';
import { cliModelsService } from '../services/cli-models.js';

export async function cliModelsRoutes(app: FastifyInstance) {
    app.get('/api/cli-models', async (_req, reply) => {
        return reply.send(await cliModelsService.list());
    });

    app.post('/api/cli-models', async (req, reply) => {
        const body = CreateCliModelSchema.parse(req.body);
        try {
            const created = await cliModelsService.create(body);
            return reply.status(201).send(created);
        } catch (err) {
            // Postgres unique-violation surfaces as `error code 23505`.
            const e = err as { code?: string; message?: string };
            if (e.code === '23505' || /unique/i.test(e.message ?? '')) {
                return reply.status(409).send({ error: 'Model already in registry for this CLI' });
            }
            throw err;
        }
    });

    app.patch('/api/cli-models/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = UpdateCliModelSchema.parse(req.body);
        const updated = await cliModelsService.update(id, body);
        if (!updated) return reply.status(404).send({ error: 'Model not found' });
        return reply.send(updated);
    });

    app.delete('/api/cli-models/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        await cliModelsService.remove(id);
        return reply.status(204).send();
    });
}
