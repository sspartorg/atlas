import type { FastifyInstance } from 'fastify';
import { rolesService } from '../services/roles.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { SDLC_ROLES, SdlcRoleSchema, UpdateRoleSchema, type SdlcRole } from '@atlas/shared';

// A08 — SDLC role catalog routes. `GET /api/roles` powers the Agents
// page's Role filter chip and any future Roles admin surface. `PATCH
// /api/roles/:id` lets the Owner edit a role's curated default prompts
// without touching any existing agent. There's no POST or DELETE — the
// catalog shape is defined by the `SdlcRole` enum in shared and only
// changes via migration.

export async function rolesRoutes(app: FastifyInstance) {
    app.get('/api/roles', async (_req, reply) => reply.send(await rolesService.list()));

    app.get('/api/roles/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const parseId = SdlcRoleSchema.safeParse(id);
        if (!parseId.success) {
            return reply.status(400).send({
                error: 'invalid role id',
                detail: `expected one of ${SDLC_ROLES.join(', ')}`,
            });
        }
        const role = await rolesService.get(parseId.data as SdlcRole);
        if (!role) return reply.status(404).send({ error: 'Role not found' });
        return reply.send(role);
    });

    app.patch('/api/roles/:id', { preHandler: requireMcpToken }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const parseId = SdlcRoleSchema.safeParse(id);
        if (!parseId.success) {
            return reply.status(400).send({
                error: 'invalid role id',
                detail: `expected one of ${SDLC_ROLES.join(', ')}`,
            });
        }
        const body = UpdateRoleSchema.parse(req.body);
        const updated = await rolesService.update(parseId.data as SdlcRole, body);
        if (!updated) return reply.status(404).send({ error: 'Role not found' });
        return reply.send(updated);
    });
}
