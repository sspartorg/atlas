import { sql } from 'kysely';
import path from 'node:path';
import { db } from '../db/kysely-client.js';
import type { IProject } from '@atlas/shared';
import { randomUUID } from 'crypto';

/**
 * Reject any workspace / git path that contains a path-traversal component
 * (`..`). Absolute paths and simple relative-or-empty strings are accepted.
 * Used as a guard in `create` and `update` to prevent callers from storing a
 * path that could escape the intended workspace root when later resolved.
 */
export function rejectTraversalPath(p: string | undefined, field = 'git_path'): void {
    if (!p) return;
    const normalized = path.normalize(p);
    // path.normalize('../../etc/passwd') → '../../etc/passwd' on POSIX /
    // '..\\..\etc\\passwd' on Windows — both contain '..'.
    const parts = normalized.split(/[/\\]/);
    if (parts.includes('..')) {
        throw new Error(`${field} must not contain path-traversal components (got "${p}")`);
    }
}

// "Last activity" must move when ANYTHING in the project changes — schedule
// runs, guardrail edits, item edits. In the unified model that's a single
// MAX over: project.updated_at, schedule.last_run_at, guardrail.updated_at,
// and items.updated_at (which covers all five issue types).
const LAST_ACTIVITY_SQL = sql<string>`
    GREATEST(
      p.updated_at,
      COALESCE((SELECT MAX(last_run_at) FROM project_schedules ps WHERE ps.project_id = p.id), p.updated_at),
      COALESCE((SELECT MAX(updated_at) FROM project_guardrails pg WHERE pg.project_id = p.id), p.updated_at),
      COALESCE((SELECT MAX(updated_at) FROM items i WHERE i.project_id = p.id), p.updated_at)
    )
`;

// 074 dropped the `retired` reason. A prefix is now either live (still
// attached to an existing project) or free for reuse — deletion no longer
// permanently retires the 3-letter key.
export type PrefixCollisionReason = 'in_use';

export class PrefixCollisionError extends Error {
    reason: PrefixCollisionReason;
    conflict: string | null;
    constructor(reason: PrefixCollisionReason, conflict?: string) {
        super(`Issue key prefix already used by "${conflict ?? ''}"`);
        this.reason = reason;
        this.conflict = conflict ?? null;
    }
}

async function checkPrefixAvailable(
    prefix: string,
): Promise<{ available: true } | { available: false; reason: PrefixCollisionReason; conflict?: string }> {
    const live = await db
        .selectFrom('projects')
        .select('name')
        .where('issue_key_prefix', '=', prefix)
        .executeTakeFirst();
    if (live) return { available: false, reason: 'in_use', conflict: live.name };
    return { available: true };
}

function projectFromRow(r: Record<string, unknown>): IProject {
    return {
        id: r['id'] as string,
        name: r['name'] as string,
        issue_key_prefix: r['issue_key_prefix'] as string,
        git_path: r['git_path'] as string,
        git_url: r['git_url'] as string,
        credential_id: (r['credential_id'] as string | null) ?? null,
        default_branch: r['default_branch'] as string,
        clone_status: r['clone_status'] as IProject['clone_status'],
        description: r['description'] as string,
        status: r['status'] as string,
        guardrails_md: r['guardrails_md'] as string,
        setup_sh_body: (r['setup_sh_body'] as string | null) ?? '',
        setup_ps1_body: (r['setup_ps1_body'] as string | null) ?? '',
        created_at: r['created_at'] as string,
        updated_at: r['updated_at'] as string,
        last_activity_at:
            ((r['last_activity_at'] as string | null) ?? (r['updated_at'] as string)) || (r['updated_at'] as string),
    };
}

export const projectsService = {
    async list(): Promise<IProject[]> {
        const rows = await db
            .selectFrom('projects as p')
            .select((_eb) => [
                'p.id',
                'p.name',
                'p.issue_key_prefix',
                'p.git_path',
                'p.git_url',
                'p.credential_id',
                'p.default_branch',
                'p.clone_status',
                'p.description',
                'p.status',
                'p.guardrails_md',
                'p.setup_sh_body',
                'p.setup_ps1_body',
                'p.created_at',
                'p.updated_at',
                LAST_ACTIVITY_SQL.as('last_activity_at'),
            ])
            .orderBy('p.created_at', 'desc')
            .execute();
        return rows.map((r) => projectFromRow(r as never));
    },

    // Page-scoped variant of list() for the Projects table — the full list()
    // is still used by Onboarding prefetch and internal connect-check, but the
    // visible /projects page should not fetch every row just to render twenty.
    async listPaged(opts: {
        page: number;
        limit: number;
    }): Promise<{ rows: IProject[]; total: number; page: number; limit: number }> {
        const page = Math.max(1, Math.floor(opts.page) || 1);
        const limit = Math.min(100, Math.max(1, Math.floor(opts.limit) || 20));
        const offset = (page - 1) * limit;

        const [rowsRes, totalRes] = await Promise.all([
            db
                .selectFrom('projects as p')
                .select((_eb) => [
                    'p.id',
                    'p.name',
                    'p.issue_key_prefix',
                    'p.git_path',
                    'p.git_url',
                    'p.credential_id',
                    'p.default_branch',
                    'p.clone_status',
                    'p.description',
                    'p.status',
                    'p.guardrails_md',
                    'p.setup_sh_body',
                    'p.setup_ps1_body',
                    'p.created_at',
                    'p.updated_at',
                    LAST_ACTIVITY_SQL.as('last_activity_at'),
                ])
                .orderBy('p.created_at', 'desc')
                .limit(limit)
                .offset(offset)
                .execute(),
            db
                .selectFrom('projects')
                .select(({ fn }) => [fn.countAll<string>().as('total')])
                .executeTakeFirst(),
        ]);

        const rows = rowsRes.map((r) => projectFromRow(r as never));
        const total = Number(totalRes?.total ?? 0);
        return { rows, total, page, limit };
    },

    async get(id: string): Promise<IProject | undefined> {
        const row = await db
            .selectFrom('projects as p')
            .select((_eb) => [
                'p.id',
                'p.name',
                'p.issue_key_prefix',
                'p.git_path',
                'p.git_url',
                'p.credential_id',
                'p.default_branch',
                'p.clone_status',
                'p.description',
                'p.status',
                'p.guardrails_md',
                'p.setup_sh_body',
                'p.setup_ps1_body',
                'p.created_at',
                'p.updated_at',
                LAST_ACTIVITY_SQL.as('last_activity_at'),
            ])
            .where('p.id', '=', id)
            .executeTakeFirst();
        return row ? projectFromRow(row as never) : undefined;
    },

    checkPrefix: checkPrefixAvailable,

    async create(data: {
        name: string;
        issue_key_prefix: string;
        git_path?: string;
        description?: string;
    }): Promise<IProject> {
        rejectTraversalPath(data.git_path);
        const id = randomUUID();
        await db.transaction().execute(async (trx) => {
            const check = await checkPrefixAvailable(data.issue_key_prefix);
            if (!check.available) {
                throw new PrefixCollisionError(check.reason, check.conflict);
            }
            await trx
                .insertInto('projects')
                .values({
                    id,
                    name: data.name,
                    issue_key_prefix: data.issue_key_prefix,
                    git_path: data.git_path ?? '',
                    description: data.description ?? '',
                    clone_status: 'ready',
                })
                .execute();
            await trx
                .insertInto('project_issue_counters')
                .values({ project_id: id, last_seq: 0 })
                .execute();
        });
        return (await this.get(id))!;
    },

    async update(
        id: string,
        data: {
            name?: string | undefined;
            git_path?: string | undefined;
            description?: string | undefined;
            status?: string | undefined;
            guardrails_md?: string | undefined;
            setup_sh_body?: string | undefined;
            setup_ps1_body?: string | undefined;
        },
    ): Promise<IProject> {
        rejectTraversalPath(data.git_path);
        const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
        if (keys.length === 0) return (await this.get(id))!;
        await db.updateTable('projects').set(data as never).where('id', '=', id).execute();
        return (await this.get(id))!;
    },

    async delete(id: string): Promise<void> {
        // CASCADE wipes counters + children (items, schedules, guardrails,
        // env vars, item_links, comments, issue_events, agent_runs). The
        // 074 migration dropped the BEFORE-DELETE trigger that used to
        // permanently retire `issue_key_prefix` — the prefix is free for
        // reuse the moment this DELETE commits.
        await db.deleteFrom('projects').where('id', '=', id).execute();
    },

    async count(): Promise<number> {
        const r = await db
            .selectFrom('projects')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .executeTakeFirst();
        return Number(r?.n ?? 0);
    },

    async createFromClone(data: {
        name: string;
        issue_key_prefix: string;
        git_url: string;
        git_path: string;
        credential_id: string;
        default_branch: string;
        description?: string;
    }): Promise<IProject> {
        const id = randomUUID();
        await db.transaction().execute(async (trx) => {
            const check = await checkPrefixAvailable(data.issue_key_prefix);
            if (!check.available) {
                throw new PrefixCollisionError(check.reason, check.conflict);
            }
            await trx
                .insertInto('projects')
                .values({
                    id,
                    name: data.name,
                    issue_key_prefix: data.issue_key_prefix,
                    git_path: data.git_path,
                    git_url: data.git_url,
                    credential_id: data.credential_id,
                    default_branch: data.default_branch,
                    clone_status: 'ready',
                    description: data.description ?? '',
                })
                .execute();
            await trx
                .insertInto('project_issue_counters')
                .values({ project_id: id, last_seq: 0 })
                .execute();
        });
        return (await this.get(id))!;
    },
};
