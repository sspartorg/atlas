import { basename } from 'node:path';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { IProject, IProjectRepo } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';
import { projectsService } from './projects.js';

// ADR 0017 — a Project's repos: its own git columns are the PRIMARY repo
// (id = project id, so its worktree paths and git lock stay what they were);
// `project_repos` holds the extras. Everything that works on "the repos of a
// project / Task" goes through here.

function slug(s: string): string {
    return (
        s
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'main'
    );
}

function primaryRepo(p: IProject): IProjectRepo {
    return {
        id: p.id,
        project_id: p.id,
        name: slug(basename(p.git_path || p.name)),
        primary: true,
        git_url: p.git_url,
        git_path: p.git_path,
        credential_id: p.credential_id,
        default_branch: p.default_branch,
        clone_status: p.clone_status,
        setup_sh_body: p.setup_sh_body,
        setup_ps1_body: p.setup_ps1_body,
    };
}

type RepoRow = Awaited<ReturnType<typeof extraRows>>[number];

function extraRows(projectId: string) {
    return db
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
        primary: false,
        git_url: r.git_url,
        git_path: r.git_path,
        credential_id: r.credential_id,
        default_branch: r.default_branch,
        clone_status: r.clone_status,
        setup_sh_body: r.setup_sh_body,
        setup_ps1_body: r.setup_ps1_body,
    };
}

async function list(projectId: string): Promise<IProjectRepo[]> {
    const project = await projectsService.get(projectId);
    if (!project) throw new ApiError('not_found', 'Project not found', 404);
    return [primaryRepo(project), ...(await extraRows(projectId)).map(fromRow)];
}

/** Every project's repos (its primary, then its extras), for pickers that span projects. */
async function listAll(): Promise<IProjectRepo[]> {
    const [projects, extras] = await Promise.all([
        projectsService.list(),
        db
            .selectFrom('project_repos')
            .selectAll()
            .orderBy('position', 'asc')
            .orderBy('created_at', 'asc')
            .execute(),
    ]);
    return projects.flatMap((p) => [
        primaryRepo(p),
        ...extras.filter((r) => r.project_id === p.id).map(fromRow),
    ]);
}

/** The repos a Task works on, in its order; `[]` (or only unknown ids) = the primary. */
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

async function insert(input: {
    project_id: string;
    name: string;
    git_url: string;
    git_path: string;
    credential_id: string;
    default_branch: string;
}): Promise<IProjectRepo> {
    const position = (await extraRows(input.project_id)).length + 1;
    const row = await db
        .insertInto('project_repos')
        .values({ id: randomUUID(), ...input, clone_status: 'ready', position })
        .returningAll()
        .executeTakeFirstOrThrow();
    return fromRow(row);
}

async function update(
    projectId: string,
    repoId: string,
    patch: { default_branch?: string | undefined; setup_sh_body?: string | undefined; setup_ps1_body?: string | undefined }
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
    if (!row) throw new ApiError('not_found', 'Repo not found (the primary repo is edited on the project)', 404);
    return fromRow(row);
}

/** Unregisters an extra repo (its folder stays on disk) and drops it from every Task of the project. */
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
        throw new ApiError('not_found', 'Repo not found (the primary repo cannot be removed)', 404);
    }
    await db
        .updateTable('items')
        .set({ repo_ids: sql`repo_ids - ${repoId}::text` as never })
        .where('project_id', '=', projectId)
        .execute();
}

/** The project an extra repo at this path belongs to, if any. */
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
    list,
    listAll,
    forTask,
    validateIds,
    assertNameFree,
    insert,
    update,
    remove,
    slug,
};
