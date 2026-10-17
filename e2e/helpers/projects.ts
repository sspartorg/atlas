import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIRequestContext, Page } from '@playwright/test';
import { API, apiPost } from './api.js';
import { sql } from './db.js';

// Throwaway projects for the Projects / Tasks specs, so they never edit the
// seed project other specs rely on (firstProjectId, ETM-1, ETM-2).

export interface ProjectRow {
    id: string;
    name: string;
    issue_key_prefix: string;
}

export function createProject(request: APIRequestContext, name: string, prefix: string, description?: string) {
    return apiPost<ProjectRow>(request, '/api/projects', { name, issue_key_prefix: prefix, ...(description ? { description } : {}) });
}

/** Delete a project and everything under it; quiet when it is already gone. */
export async function deleteProject(request: APIRequestContext, id: string): Promise<void> {
    await request.delete(`${API}/api/projects/${id}`);
}

/** Every project whose prefix starts with one of these letters pairs (e.g. 'Q' for QAA…QZZ). */
export async function deleteProjectsByPrefix(request: APIRequestContext, first: string): Promise<void> {
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix LIKE '${first}%'`)) await deleteProject(request, id ?? '');
}

/** A git clone with a local bare origin, like the seed's fixture. */
export function gitFixture(name: string): { origin: string; clone: string } {
    const dir = join(tmpdir(), 'atlas-e2e-fixtures', `pt-${name}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const origin = join(dir, 'origin.git');
    const clone = join(dir, 'clone');
    const git = (...args: string[]) => execFileSync('git', args, { stdio: 'pipe' });
    git('init', '--bare', '-b', 'main', origin);
    git('clone', origin, clone);
    git('-C', clone, 'config', 'user.email', 'e2e@atlas.local');
    git('-C', clone, 'config', 'user.name', 'Atlas E2E Bot');
    git('-C', clone, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(clone, 'README.md'), '# fixture\n');
    git('-C', clone, 'add', 'README.md');
    git('-C', clone, 'commit', '-m', 'init');
    git('-C', clone, 'push', '-u', 'origin', 'main');
    return { origin, clone };
}

/** A repo row straight into the DB (the API's add-repo path needs a GitHub URL and a live ls-remote). */
export function insertRepo(projectId: string, r: { id: string; name: string; git_path: string; git_url?: string; credential_id?: string | null; default_branch?: string; position?: number }): void {
    const lit = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
    sql(
        `INSERT INTO project_repos (id, project_id, name, git_path, git_url, credential_id, default_branch, clone_status, position)
         VALUES (${lit(r.id)}, ${lit(projectId)}, ${lit(r.name)}, ${lit(r.git_path)}, ${lit(r.git_url ?? '')}, ${lit(r.credential_id ?? null)}, ${lit(r.default_branch ?? 'main')}, 'ready', ${r.position ?? 0})`,
    );
}

/** Commit a new file in the bare origin, through a second clone, so the fixture clone is behind by one. */
export function pushUpstream(origin: string, file: string): void {
    const dir = join(tmpdir(), 'atlas-e2e-fixtures', `push-${Date.now()}`);
    const git = (...args: string[]) => execFileSync('git', args, { stdio: 'pipe' });
    git('clone', origin, dir);
    git('-C', dir, 'config', 'user.email', 'e2e@atlas.local');
    git('-C', dir, 'config', 'user.name', 'Atlas E2E Bot');
    git('-C', dir, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, file), `${file}\n`);
    git('-C', dir, 'add', file);
    git('-C', dir, 'commit', '-m', `add ${file}`);
    git('-C', dir, 'push', 'origin', 'main');
    rmSync(dir, { recursive: true, force: true });
}

/** The Project actions (⋯) menu on Project Detail. */
export async function projectAction(page: Page, item: RegExp | string): Promise<void> {
    await page.getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('menuitem', { name: item }).click();
}
