import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { resolve as resolvePath, dirname, join } from 'node:path';
import { requireMcpToken } from '../plugins/mcp-auth.js';

interface FsEntry {
    name: string;
    is_directory: boolean;
}

interface FsListResponse {
    path: string;
    parent: string | null;
    entries: FsEntry[];
}

async function listWindowsDrives(): Promise<FsEntry[]> {
    const candidates = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `${c}:\\`);
    const results = await Promise.all(
        candidates.map(async (drive) => {
            try {
                await fs.access(drive);
                return drive;
            } catch {
                return null;
            }
        })
    );
    return results
        .filter((d): d is string => d !== null)
        .map((d) => ({ name: d, is_directory: true }));
}

async function listChildren(absPath: string): Promise<FsEntry[]> {
    const items = await fs.readdir(absPath, { withFileTypes: true });
    const dirs: FsEntry[] = [];
    for (const item of items) {
        if (!item.isDirectory()) continue;
        if (item.name.startsWith('.')) continue;
        dirs.push({ name: item.name, is_directory: true });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return dirs;
}

export async function fsRoutes(app: FastifyInstance) {
    // These four routes let a caller enumerate arbitrary server-side
    // directories, expose absolute paths, and validate typed paths. That
    // is a high-value info-disclosure surface (drive layout, project
    // folder names, user home path) and MUST NOT be reachable without
    // the write gate. Applied via preHandler on every route below.
    app.get('/api/fs/list', { preHandler: requireMcpToken }, async (req, reply) => {
        const { path: raw } = req.query as { path?: string };
        const trimmed = (raw ?? '').trim();

        // Empty or "drives" sentinel on Windows → return drives. On POSIX, return "/".
        if (trimmed === '' || trimmed.toLowerCase() === 'drives') {
            /* v8 ignore next */
            if (process.platform === 'win32') {
                const entries = await listWindowsDrives();
                const body: FsListResponse = { path: '', parent: null, entries };
                return reply.send(body);
            }
            /* v8 ignore next 9 */
            try {
                const entries = await listChildren('/');
                const body: FsListResponse = { path: '/', parent: null, entries };
                return reply.send(body);
            } catch (err) {
                req.log.warn({ err }, 'GET /api/fs/list root: readdir failed');
                return reply.status(500).send({ error: 'Could not list root' });
            }
        }

        const absolute = resolvePath(trimmed);

        let stat;
        try {
            stat = await fs.stat(absolute);
        } catch {
            return reply.status(404).send({ error: 'Path not found' });
        }
        if (!stat.isDirectory()) {
            return reply.status(400).send({ error: 'Path is not a directory' });
        }

        let entries: FsEntry[];
        try {
            entries = await listChildren(absolute);
        } catch (err) /* v8 ignore next */ {
            req.log.warn({ err, path: absolute }, 'GET /api/fs/list: readdir failed');
            return reply.status(403).send({ error: 'Could not read directory' });
        }

        const parentDir = dirname(absolute);
        // On Windows, dirname('C:\\') === 'C:\\' — treat self-equal as no parent (drive root).
        // On POSIX, dirname('/') === '/'.
        const parent = parentDir === absolute ? null : parentDir;

        const body: FsListResponse = { path: absolute, parent, entries };
        return reply.send(body);
    });

    // Used by the picker to validate a typed path without listing it.
    app.get('/api/fs/stat', { preHandler: requireMcpToken }, async (req, reply) => {
        const { path: raw } = req.query as { path?: string };
        const trimmed = (raw ?? '').trim();
        if (trimmed === '') return reply.status(400).send({ error: 'path required' });
        const absolute = resolvePath(trimmed);
        try {
            const stat = await fs.stat(absolute);
            return reply.send({ path: absolute, exists: true, is_directory: stat.isDirectory() });
        } catch {
            return reply.send({ path: absolute, exists: false, is_directory: false });
        }
    });

    // join — server-side path join so the web side doesn't have to know separator rules.
    app.get('/api/fs/join', { preHandler: requireMcpToken }, async (req, reply) => {
        const { base, name } = req.query as { base?: string; name?: string };
        if (!base || !name) return reply.status(400).send({ error: 'base and name required' });
        const joined =
            base.endsWith(':\\') || base.endsWith(':/') ? `${base}${name}` : join(base, name);
        return reply.send({ path: joined });
    });

    // home — quick affordance so the picker can offer "Home" as a starting point.
    app.get('/api/fs/home', { preHandler: requireMcpToken }, async (_req, reply) => {
        return reply.send({ path: homedir() });
    });
}
