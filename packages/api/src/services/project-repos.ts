import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { IProjectRepo } from '@atlas/shared';
import type { DB } from '../db/types.js';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';

// ADR 0018 — a Project's repos. Every repo is a `project_repos` row and they
// are all equal; the rows carrying a project's own id are the ones migration
// 045 folded in. Everything that works on "the repos of a project / Task"
// goes through here.

type ReposExecutor = Kysely<DB> | Transaction<DB>;

/**
 * The workspace folder a repo added AFTER project creation clones into.
 *
 * F-009 — this used to be an unconditional `<project-slug>-<repo-name>`, while
 * project create clones to `<project_name>` bare. A repo whose name already
 * starts with its project's therefore stuttered on disk:
 * `atlas-sdlc-sandbox-atlas-sdlc-sandbox-web`. The prefix still earns its keep
 * for a repo called `web` or `api`, which would otherwise collide across
 * projects in a flat workspace — so it is skipped only when it would repeat.
 *
 * Both inputs are slugs, so the result can never escape the workspace root.
 */
function repoFolderName(projectName: string, repoName: string): string {
    const projectSlug = slug(projectName);
    return repoName === projectSlug || repoName.startsWith(`${projectSlug}-`)
        ? repoName
        : `${projectSlug}-${repoName}`;
}

function slug(s: string): string {
    return (
        s
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'main'
    );
}

type RepoRow = Awaited<ReturnType<typeof repoRows>>[number];

// Order is load-bearing: the first repo of a Task holds its Task-wide files
// and lends its credential to the agents (ADR 0018).
function repoRows(projectId: string, exec: ReposExecutor = db) {
    return exec
        .selectFrom('project_repos')
        .selectAll()
        .where('project_id', '=', projectId)
        .orderBy('position', 'asc')
        .orderBy('created_at', 'asc')
        .execute();
}

function fromRow(r: RepoRow): IProjectRepo {
    return {
        id: r.id,
        project_id: r.project_id,
        name: r.name,
        git_url: r.git_url,
        git_path: r.git_path,
        credential_id: r.credential_id,
        default_branch: r.default_branch,
        clone_status: r.clone_status,
        setup_sh_body: r.setup_sh_body,
        setup_ps1_body: r.setup_ps1_body,
        verify_command: r.verify_command,
    };
}

/** A project's repos, in order. Empty when it has none; 404 when it is gone. */
async function list(projectId: string): Promise<IProjectRepo[]> {
    const project = await db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .executeTakeFirst();
    if (!project) throw new ApiError('not_found', 'Project not found', 404);
    return (await repoRows(projectId)).map(fromRow);
}

/** One repo by id, whichever project it belongs to. */
async function get(repoId: string): Promise<IProjectRepo | undefined> {
    const row = await db
        .selectFrom('project_repos')
        .selectAll()
        .where('id', '=', repoId)
        .executeTakeFirst();
    return row ? fromRow(row) : undefined;
}

/** Every repo of every project, for pickers and lists that span projects. */
async function listAll(): Promise<IProjectRepo[]> {
    const rows = await db
        .selectFrom('project_repos')
        .selectAll()
        .orderBy('project_id', 'asc')
        .orderBy('position', 'asc')
        .orderBy('created_at', 'asc')
        .execute();
    return rows.map(fromRow);
}

/** The repos a Task works on, in its order. Pre-0018 rows with `[]` get the first repo. */
async function forTask(task: { project_id: string; repo_ids: string[] }): Promise<IProjectRepo[]> {
    const all = await list(task.project_id);
    const picked = task.repo_ids.flatMap((id) => all.filter((r) => r.id === id));
    return picked.length > 0 ? picked : all.slice(0, 1);
}

/** Throws 400 unless every id is a repo of the project. Returns them deduped, in order. */
async function validateIds(projectId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const known = new Set((await list(projectId)).map((r) => r.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
        throw new ApiError('validation_error', `Not repos of this project: ${unknown.join(', ')}`, 400);
    }
    return [...new Set(ids)];
}

async function assertNameFree(projectId: string, name: string): Promise<void> {
    if ((await list(projectId)).some((r) => r.name === name)) {
        throw new ApiError('conflict', `This project already has a repo named "${name}"`, 409);
    }
}

async function insert(
    input: {
        project_id: string;
        name: string;
        git_url: string;
        git_path: string;
        credential_id: string | null;
        default_branch: string;
    },
    exec: ReposExecutor = db
): Promise<IProjectRepo> {
    const existing = await repoRows(input.project_id, exec);
    const position = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1;
    const row = await exec
        .insertInto('project_repos')
        .values({ id: randomUUID(), ...input, clone_status: 'ready', position })
        .returningAll()
        .executeTakeFirstOrThrow();
    return fromRow(row);
}

async function update(
    projectId: string,
    repoId: string,
    patch: {
        default_branch?: string | undefined;
        setup_sh_body?: string | undefined;
        setup_ps1_body?: string | undefined;
        verify_command?: string | undefined;
    }
): Promise<IProjectRepo> {
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const q = db.updateTable('project_repos').where('id', '=', repoId).where('project_id', '=', projectId);
    const row =
        Object.keys(values).length > 0
            ? await q.set(values).returningAll().executeTakeFirst()
            : await db
                  .selectFrom('project_repos')
                  .selectAll()
                  .where('id', '=', repoId)
                  .where('project_id', '=', projectId)
                  .executeTakeFirst();
    if (!row) throw new ApiError('not_found', 'Repo not found', 404);
    return fromRow(row);
}

/** Unregisters a repo (its folder stays on disk) and drops it from every Task of the project. */
async function remove(projectId: string, repoId: string): Promise<void> {
    const live = await db
        .selectFrom('workflow_runs as r')
        .innerJoin('items as i', 'i.id', 'r.item_id')
        .select('r.id')
        .where('i.project_id', '=', projectId)
        .where('r.status', 'in', ['running', 'waiting_for_owner'])
        .where(sql<boolean>`i.repo_ids @> ${JSON.stringify([repoId])}::jsonb`)
        .executeTakeFirst();
    if (live) {
        throw new ApiError('conflict', 'A workflow run is working on this repo; stop it first', 409);
    }
    const deleted = await db
        .deleteFrom('project_repos')
        .where('id', '=', repoId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
    if (Number(deleted.numDeletedRows) === 0) {
        throw new ApiError('not_found', 'Repo not found', 404);
    }
    await db
        .updateTable('items')
        .set({ repo_ids: sql`repo_ids - ${repoId}::text` as never })
        .where('project_id', '=', projectId)
        .execute();
    // A Jira source names its repos the same way (migration 010), so it needs
    // the same strip — otherwise the next sync imports Tasks pointing at a repo
    // that no longer exists, or skips the source entirely once its last repo
    // goes.
    await db
        .updateTable('jira_sources')
        .set({ repo_ids: sql`repo_ids - ${repoId}::text` as never })
        .where('project_id', '=', projectId)
        .execute();
}

/** The project a repo at this path belongs to, if any. */
function ownerOfPath(gitPath: string): Promise<{ id: string; name: string } | undefined> {
    return db
        .selectFrom('project_repos as r')
        .innerJoin('projects as p', 'p.id', 'r.project_id')
        .select(['p.id', 'p.name'])
        .where('r.git_path', '=', gitPath)
        .executeTakeFirst();
}

export const projectReposService = {
    ownerOfPath,
    get,
    list,
    listAll,
    forTask,
    validateIds,
    assertNameFree,
    insert,
    update,
    remove,
    slug,
    repoFolderName,
};
