import type { FastifyInstance } from 'fastify';
import { CreateScratchPadSchema, UpdateScratchPadSchema } from '@atlas/shared';
import { scratchPadService } from '../services/scratch-pad.js';

// P12 — REST surface for the Scratch Pad. Free-form markdown tiles for the
// Owner; no agent / project linkage. CRUD only — list / create / patch /
// delete. The page autosaves on a 5s tick while open, so PATCH is the hot
// path; a SQL UPDATE with a `RETURNING *` keeps the round-trip honest.

export async function scratchPadRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/scratch-pad', async () => scratchPadService.list());

    app.get('/api/scratch-pad/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const row = await scratchPadService.get(id);
        if (!row) return reply.status(404).send({ error: 'scratch pad not found' });
        return row;
    });

    app.post('/api/scratch-pad', async (req, reply) => {
        /* v8 ignore next */
        const body = CreateScratchPadSchema.parse(req.body ?? {});
        const created = await scratchPadService.create(body);
        return reply.status(201).send(created);
    });

    app.patch('/api/scratch-pad/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const patch = UpdateScratchPadSchema.parse(req.body);
        const row = await scratchPadService.update(id, patch);
        if (!row) return reply.status(404).send({ error: 'scratch pad not found' });
        return row;
    });

    app.delete('/api/scratch-pad/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const ok = await scratchPadService.delete(id);
        if (!ok) return reply.status(404).send({ error: 'scratch pad not found' });
        return reply.status(204).send();
    });
}
