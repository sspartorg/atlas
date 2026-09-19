# Repos Without a Primary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "primary repo" from Atlas: every repo in a project is an
ordinary `project_repos` row with its own clone, reclone, auto-fetch schedule,
terminal, credential, default branch and setup scripts.

**Architecture:** Migration `045` copies each project's git columns into a
`project_repos` row **whose id is the project id** (so worktree folders,
git-lock keys, `items.repo_ids` and `jira_sources.repo_id` stay valid), then
drops those columns from `projects` and re-keys `project_schedules` and
`cli_sessions` on `repo_id`. Services that took a project now take a repo;
project-level git endpoints move under `/api/projects/:id/repos/:repoId/`.

**Tech Stack:** pnpm monorepo · Fastify 5 + Kysely (queries) + Knex
(migrations) + PostgreSQL 16 · React 19 + MUI + TanStack Query · Vitest ·
Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-repos-without-primary-design.md`

## Global Constraints

- **`packages/shared` edits are Owner-approved for this change only** (AGENTS.md
  hard rule 1). Reason: with no primary, `IProject` cannot describe one.
- API responses match `@atlas/shared` types exactly, snake_case, no extra
  fields (AGENTS.md hard rule 4).
- TypeScript strict; no `any` without a WHY comment; no non-null `!` without a
  comment; `exactOptionalPropertyTypes` is on.
- DB access only from `packages/api/src/services/**`, never in routes.
- Migrations are append-only. `045` is the next number. **`down()` is
  mandatory** — `src/db/migrations-rollback.test.ts` greps every migration for
  an exported `down` and asserts contiguous numbering.
- New test files must be added to the `include:` allowlist in
  `packages/api/vitest.config.ts` or they never run.
- Web: MUI `sx` only, `theme.palette.*` / `theme.spacing()` / `tokens.ts`, no
  hardcoded hex or px. Counts/dates/ids use `sx={{ fontFamily: 'mono' }}`.
- No default exports; `I`-prefixed interfaces; kebab-case utils, PascalCase
  components.
- `.agents/` docs are updated in the same change (Task 15).
- Commit after every task. Test DB:
  `postgres://atlas:atlas@localhost:5500/atlas_test`, created by
  `packages/api/tests/_global-setup.ts`. Parallel agents must each set their
  own `TEST_DATABASE_URL` (e.g. `…/atlas_test_t7`) — concurrent runs on one DB
  serialize on an advisory lock.

**Commands**

| task | command |
|---|---|
| api tests | `pnpm -F @atlas/api test` |
| one api file | `pnpm -F @atlas/api exec vitest run <path>` |
| web tests | `pnpm -F @atlas/web test` |
| typecheck | `pnpm typecheck` |
| lint | `pnpm lint` |
| migrate dev DB | `pnpm db:migrate` |
| e2e | `pnpm e2e` |

**Key invariants (do not break)**

1. The migrated repo keeps `id = project.id`. `computeWorktreePath` puts
   worktrees under `worktrees/<repo id>/`, and `items.repo_ids` /
   `jira_sources.repo_id` already hold project ids.
2. `projectReposService.list(projectId)` returns repos ordered by
   `position, created_at`; the migrated repo is `position 0`. `forTask`'s
   "first repo" fallback and the multi-repo workspace root depend on that
   order.

---

### Task 1: Migration 045 + DB types

**Files:**
- Create: `packages/api/src/db/migrations/045_repos_without_primary.ts`
- Create: `packages/api/src/db/repos-without-primary-migration.test.ts`
- Modify: `packages/api/src/db/types.ts:268-285` (drop 7 columns from
  `ProjectsTable`), `:249-266` (`ProjectReposTable` unchanged), the
  `ProjectSchedulesTable` and `CliSessionsTable` interfaces (add `repo_id`)
- Modify: `packages/api/vitest.config.ts` (add the new test path to `include`)

**Interfaces:**
- Consumes: nothing.
- Produces: `project_repos` rows for every project (`id = project id`,
  `position 0`); `projects` without git columns; `project_schedules.repo_id`
  (PK); `cli_sessions.repo_id`; `items.repo_ids` backfilled to `[projectId]`.

- [ ] **Step 1: Write the failing migration test**

Create `packages/api/src/db/repos-without-primary-migration.test.ts`, modelled
exactly on `src/db/jira-sources-migration.test.ts` (second Knex handle, each
case in a transaction that runs `down()` first and is always rolled back):

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Knex from 'knex';
import type { Knex as KnexT } from 'knex';
import { closeTestDb, truncateAll } from '../../tests/_pg-db.js';
import { down, up } from './migrations/045_repos_without_primary.js';

const knex = Knex({
    client: 'pg',
    connection: process.env['DATABASE_URL'] ?? '',
    pool: { min: 0, max: 1 },
});

afterAll(async () => {
    await knex.destroy();
    await closeTestDb();
});

beforeEach(async () => {
    await truncateAll();
});

// Runs `fn` against the pre-045 schema and always rolls back.
async function inPre045(fn: (trx: KnexT.Transaction) => Promise<void>): Promise<void> {
    const trx = await knex.transaction();
    try {
        await down(trx);
        await fn(trx);
    } finally {
        await trx.rollback();
    }
}

async function plantProject(
    trx: KnexT.Transaction,
    id: string,
    over: Record<string, unknown> = {},
): Promise<void> {
    await trx('projects').insert({
        id,
        name: id,
        issue_key_prefix: id.toUpperCase().slice(0, 3),
        git_path: `/tmp/atlas/${id}`,
        git_url: `https://github.com/acme/${id}.git`,
        default_branch: 'main',
        clone_status: 'ready',
        status: 'active',
        ...over,
    });
}

describe('045 — repos without a primary', () => {
    it('moves each project git row into project_repos, keeping the project id', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha', { setup_sh_body: 'echo hi' });
            await up(trx);

            const repos = await trx('project_repos').select('*').where('project_id', 'alpha');
            expect(repos).toHaveLength(1);
            expect(repos[0]).toMatchObject({
                id: 'alpha',
                name: 'alpha',
                git_path: '/tmp/atlas/alpha',
                git_url: 'https://github.com/acme/alpha.git',
                default_branch: 'main',
                clone_status: 'ready',
                setup_sh_body: 'echo hi',
                position: 0,
            });
        });
    });

    it('drops the git columns from projects', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha');
            await up(trx);
            const cols = await trx('information_schema.columns')
                .select('column_name')
                .where('table_name', 'projects');
            const names = cols.map((c: { column_name: string }) => c.column_name);
            for (const dropped of [
                'git_path', 'git_url', 'credential_id', 'default_branch',
                'clone_status', 'setup_sh_body', 'setup_ps1_body',
            ]) {
                expect(names).not.toContain(dropped);
            }
        });
    });

    it('keeps an existing extra repo after the migrated one', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha');
            await trx('project_repos').insert({
                id: 'r-extra', project_id: 'alpha', name: 'web',
                git_url: 'https://github.com/acme/web.git', git_path: '/tmp/atlas/web',
                default_branch: 'main', clone_status: 'ready', position: 1,
            });
            await up(trx);
            const rows = await trx('project_repos')
                .select('id')
                .where('project_id', 'alpha')
                .orderBy('position');
            expect(rows.map((r: { id: string }) => r.id)).toEqual(['alpha', 'r-extra']);
        });
    });

    it('de-duplicates a folder name that an extra repo already took', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha');   // folder name -> "alpha"
            await trx('project_repos').insert({
                id: 'r-extra', project_id: 'alpha', name: 'alpha',
                git_url: '', git_path: '/tmp/atlas/other', position: 1,
            });
            await up(trx);
            const row = await trx('project_repos').select('name').where('id', 'alpha').first();
            expect(row.name).toBe('alpha-2');
        });
    });

    it('gives a project with no clone no repo row', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'empty', { git_path: '', git_url: '' });
            await up(trx);
            const rows = await trx('project_repos').select('id').where('project_id', 'empty');
            expect(rows).toHaveLength(0);
        });
    });

    it('backfills items.repo_ids with the project id', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha');
            await trx('items').insert({
                id: 'i1', project_id: 'alpha', type: 'task', title: 't',
                status: 'backlog', issue_key: 'ALP-1', repo_ids: JSON.stringify([]),
            });
            await up(trx);
            const row = await trx('items').select('repo_ids').where('id', 'i1').first();
            expect(row.repo_ids).toEqual(['alpha']);
        });
    });

    it('re-keys project_schedules and cli_sessions on repo_id', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha');
            await trx('project_schedules').insert({
                project_id: 'alpha', enabled: 1, preset: 'daily',
                cron_expression: '0 6 * * *', time_of_day: '06:00',
            });
            await trx('cli_sessions').insert({
                id: 's1', project_id: 'alpha', status: 'active', cli: 'claude',
                worktree_branch: 'atlas/x',
            });
            await up(trx);
            const sched = await trx('project_schedules').select('repo_id').first();
            expect(sched.repo_id).toBe('alpha');
            const sess = await trx('cli_sessions').select('repo_id').where('id', 's1').first();
            expect(sess.repo_id).toBe('alpha');
        });
    });

    it('down() restores the project git columns from the repo row', async () => {
        await inPre045(async (trx) => {
            await plantProject(trx, 'alpha');
            await up(trx);
            await down(trx);
            const row = await trx('projects').select('git_path', 'clone_status').where('id', 'alpha').first();
            expect(row.git_path).toBe('/tmp/atlas/alpha');
            expect(row.clone_status).toBe('ready');
        });
    });
});
```

Add its path to `packages/api/vitest.config.ts` `include`, next to the other
migration tests, with a comment:
`// Migration 045 — repos without a primary.`

- [ ] **Step 2: Run it and watch it fail**

`TEST_DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_test_t1 pnpm -F @atlas/api exec vitest run src/db/repos-without-primary-migration.test.ts`
Expected: FAIL — cannot resolve `./migrations/045_repos_without_primary.js`.

- [ ] **Step 3: Write the migration**

`packages/api/src/db/migrations/045_repos_without_primary.ts`:

```ts
import type { Knex } from 'knex';

// Repos without a primary — a Project is a container and every repo in it is
// an ordinary `project_repos` row. Each project's own git columns become one
// row whose id IS the project id, because worktree paths
// (`worktrees/<repo id>/`), git-lock keys, `items.repo_ids` and
// `jira_sources.repo_id` already hold that id — reusing it migrates the data
// without moving a single folder.
//
// Supersedes the primary-repo decision in ADR 0017; see ADR 0018.

const MIGRATE_ROWS = `
    INSERT INTO public.project_repos
        (id, project_id, name, git_url, git_path, credential_id,
         default_branch, clone_status, setup_sh_body, setup_ps1_body, position)
    SELECT
        p.id,
        p.id,
        -- folder name, slugified, de-duplicated against this project's extras
        COALESCE(taken.suffixed, base.name),
        p.git_url,
        p.git_path,
        p.credential_id,
        p.default_branch,
        p.clone_status,
        p.setup_sh_body,
        p.setup_ps1_body,
        0
    FROM public.projects p
    CROSS JOIN LATERAL (
        SELECT COALESCE(
            NULLIF(
                regexp_replace(
                    lower(regexp_replace(COALESCE(NULLIF(p.git_path, ''), p.name), '^.*[/\\\\]', '')),
                    '[^a-z0-9-]', '-', 'g'
                ), ''
            ),
            'repo'
        ) AS name
    ) base
    CROSS JOIN LATERAL (
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM public.project_repos r
                WHERE r.project_id = p.id AND r.name = base.name
            ) THEN base.name || '-2'
            ELSE NULL
        END AS suffixed
    ) taken
    WHERE p.git_path <> '' OR p.git_url <> '';
`;

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(MIGRATE_ROWS);

    await knex.schema.raw(`
        -- Every Task worked "the primary" implicitly; name it now.
        UPDATE public.items i
        SET repo_ids = jsonb_build_array(i.project_id)
        WHERE i.repo_ids = '[]'::jsonb
          AND EXISTS (SELECT 1 FROM public.project_repos r WHERE r.id = i.project_id);

        ALTER TABLE public.project_schedules ADD COLUMN repo_id text;
        UPDATE public.project_schedules SET repo_id = project_id;
        DELETE FROM public.project_schedules
        WHERE repo_id NOT IN (SELECT id FROM public.project_repos);
        ALTER TABLE public.project_schedules
            ALTER COLUMN repo_id SET NOT NULL,
            DROP CONSTRAINT project_schedules_pkey,
            ADD CONSTRAINT project_schedules_pkey PRIMARY KEY (repo_id),
            ADD CONSTRAINT project_schedules_repo_id_fkey
                FOREIGN KEY (repo_id) REFERENCES public.project_repos(id) ON DELETE CASCADE;

        ALTER TABLE public.cli_sessions ADD COLUMN repo_id text
            REFERENCES public.project_repos(id) ON DELETE SET NULL;
        UPDATE public.cli_sessions s
        SET repo_id = s.project_id
        WHERE s.project_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.project_repos r WHERE r.id = s.project_id);
        DROP INDEX IF EXISTS cli_sessions_one_active_per_project_branch;
        CREATE UNIQUE INDEX cli_sessions_one_active_per_repo_branch
            ON public.cli_sessions (repo_id, worktree_branch)
            WHERE status IN ('active', 'paused') AND worktree_branch IS NOT NULL;

        ALTER TABLE public.projects
            DROP COLUMN git_path,
            DROP COLUMN git_url,
            DROP COLUMN credential_id,
            DROP COLUMN default_branch,
            DROP COLUMN clone_status,
            DROP COLUMN setup_sh_body,
            DROP COLUMN setup_ps1_body;
    `);
}

// Lossy by design: repos that never had a project row (the ADR 0017 "extras")
// stay in project_repos, exactly as 043's own down() leaves them.
export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.projects
            ADD COLUMN git_path text NOT NULL DEFAULT '',
            ADD COLUMN git_url text NOT NULL DEFAULT '',
            ADD COLUMN credential_id text REFERENCES public.credentials(id) ON DELETE SET NULL,
            ADD COLUMN default_branch text NOT NULL DEFAULT 'main',
            ADD COLUMN clone_status text NOT NULL DEFAULT 'ready',
            ADD COLUMN setup_sh_body text NOT NULL DEFAULT '',
            ADD COLUMN setup_ps1_body text NOT NULL DEFAULT '';

        UPDATE public.projects p SET
            git_path = r.git_path,
            git_url = r.git_url,
            credential_id = r.credential_id,
            default_branch = r.default_branch,
            clone_status = r.clone_status,
            setup_sh_body = r.setup_sh_body,
            setup_ps1_body = r.setup_ps1_body
        FROM public.project_repos r
        WHERE r.id = p.id;

        DELETE FROM public.project_repos r WHERE r.id = r.project_id;

        DROP INDEX IF EXISTS cli_sessions_one_active_per_repo_branch;
        CREATE UNIQUE INDEX IF NOT EXISTS cli_sessions_one_active_per_project_branch
            ON public.cli_sessions (project_id, worktree_branch)
            WHERE status IN ('active', 'paused') AND worktree_branch IS NOT NULL;
        ALTER TABLE public.cli_sessions DROP COLUMN IF EXISTS repo_id;

        ALTER TABLE public.project_schedules
            DROP CONSTRAINT IF EXISTS project_schedules_repo_id_fkey,
            DROP CONSTRAINT IF EXISTS project_schedules_pkey,
            ADD CONSTRAINT project_schedules_pkey PRIMARY KEY (project_id),
            DROP COLUMN IF EXISTS repo_id;
    `);
}
```

- [ ] **Step 4: Run the test until green**

`TEST_DATABASE_URL=…_t1 pnpm -F @atlas/api exec vitest run src/db/repos-without-primary-migration.test.ts`
Expected: 8 passing. Fix the SQL, not the test, if a case fails.

- [ ] **Step 5: Update `db/types.ts`**

Delete `git_path`, `git_url`, `credential_id`, `default_branch`,
`clone_status`, `setup_sh_body`, `setup_ps1_body` from `ProjectsTable`
(`:268-285`). Add `repo_id: string` to the schedules table interface and
`repo_id: string | null` to the CLI-sessions table interface.
`pnpm -F @atlas/api typecheck` will now list every broken call site — that list is
Tasks 3-9. Do not fix them yet.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/db packages/api/vitest.config.ts
git commit -m "feat(db): migration 045 — every repo is a project_repos row, no primary"
```

---

### Task 2: `@atlas/shared` types and schemas

**Files:**
- Modify: `packages/shared/src/types/index.ts:290-336` (`IProject`,
  `IProjectRepo`), the `IProjectSchedule` interface, `ICliSession` if it
  mirrors the row
- Modify: `packages/shared/src/schemas/index.ts:188,197` (`CreateProjectSchema`,
  `UpdateProjectSchema`), `:541,572,589` (clone/repo schemas), `:881-891`
  (`CliSessionCreateSchema`)

**Interfaces:**
- Consumes: nothing.
- Produces: `IProject` without git/setup fields; `IProjectRepo` without
  `primary`; `IProjectSchedule.repo_id: string`;
  `CliSessionCreateSchema.repo_id?: string`.

- [ ] **Step 1: Edit the types**

In `IProject` delete `git_path`, `git_url`, `credential_id`, `default_branch`,
`clone_status`, `setup_sh_body`, `setup_ps1_body`. Replace the ADR-0017 doc
comment above `IProjectRepo` with:

```ts
/**
 * A git repo of a Project. Every repo is an ordinary `project_repos` row —
 * there is no primary (ADR 0018). Repos created before 0018 carry their
 * project's id, which is what kept their worktrees and Jira sources valid.
 */
```

and delete `primary: boolean` from the interface.

In `IProjectSchedule` add `repo_id: string;` above `project_id`.

- [ ] **Step 2: Edit the schemas**

- `CreateProjectSchema` / `UpdateProjectSchema`: drop `git_path`,
  `setup_sh_body`, `setup_ps1_body` (setup scripts are edited per repo).
- `CliSessionCreateSchema`: add `repo_id: z.string().max(200).optional()`.
- Leave `CloneProjectSchema` / `ConnectProjectSchema` / `CreateProjectRepoSchema`
  / `UpdateProjectRepoSchema` as they are — New Project still creates a repo.

- [ ] **Step 3: Typecheck shared**

Run: `pnpm -F @atlas/shared typecheck && pnpm -F @atlas/shared test`
Expected: PASS (shared has no dependents inside itself).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared)!: IProject drops its git fields; a repo is never primary"
```

---

### Task 3: `project-repos` and `projects` services

**Files:**
- Modify: `packages/api/src/services/project-repos.ts` (whole file)
- Modify: `packages/api/src/services/projects.ts:14,65-85,88-244,266-305`
- Modify: `packages/api/src/services/issue-tree.ts:21-45,71` (duplicate
  `projectFromRow`)
- Modify: `packages/api/src/services/prompt-builder.ts:648-651,684`
- Modify: `packages/api/src/services/external-links.ts:104-116`
- Test: `packages/api/src/services/project-repos.test.ts` (create),
  `packages/api/src/services/projects.test.ts` (update)

**Interfaces:**
- Consumes: Task 1's schema, Task 2's types.
- Produces:
  - `projectReposService.list(projectId): Promise<IProjectRepo[]>` — ordered
    by `position, created_at`; throws `ApiError('not_found', …, 404)` when the
    project is gone; `[]` when it has no repos.
  - `projectReposService.listAll(): Promise<IProjectRepo[]>`
  - `projectReposService.forTask({project_id, repo_ids}): Promise<IProjectRepo[]>`
  - `projectReposService.insert(input): Promise<IProjectRepo>` — `position =
    max(position)+1`
  - `projectReposService.update(projectId, repoId, patch): Promise<IProjectRepo>`
  - `projectReposService.remove(projectId, repoId): Promise<void>` — works on
    ANY repo
  - `projectsService.createFromClone(data): Promise<{project: IProject; repo: IProjectRepo}>`

- [ ] **Step 1: Write the failing service tests**

Add to `packages/api/src/services/project-repos.test.ts`:

```ts
it('lists repos in position order with no primary flag', async () => {
    await insertProject('p1', 'ATL');           // helper now creates repo p1
    await projectReposService.insert({
        project_id: 'p1', name: 'web', git_url: 'https://github.com/a/web.git',
        git_path: '/tmp/web', credential_id: null, default_branch: 'main',
    });
    const repos = await projectReposService.list('p1');
    expect(repos.map((r) => r.id)).toEqual(['p1', expect.any(String)]);
    expect(repos[0]).not.toHaveProperty('primary');
});

it('removes the last repo, leaving the project with none', async () => {
    await insertProject('p1', 'ATL');
    await projectReposService.remove('p1', 'p1');
    expect(await projectReposService.list('p1')).toEqual([]);
});

it('drops a removed repo from its Tasks', async () => {
    await insertProject('p1', 'ATL');
    const id = await insertItem({ id: 'i1', project_id: 'p1', type: 'task', repo_ids: ['p1'] });
    await projectReposService.remove('p1', 'p1');
    const row = await testDb.selectFrom('items').select('repo_ids').where('id', '=', id).executeTakeFirst();
    expect(row?.repo_ids).toEqual([]);
});

it('forTask falls back to the first repo when repo_ids is empty', async () => {
    await insertProject('p1', 'ATL');
    const repos = await projectReposService.forTask({ project_id: 'p1', repo_ids: [] });
    expect(repos.map((r) => r.id)).toEqual(['p1']);
});
```

- [ ] **Step 2: Run and watch it fail**

`pnpm -F @atlas/api exec vitest run src/services/project-repos.test.ts`
Expected: FAIL — `primaryRepo` still synthesizes a repo, `remove` 404s on the
project id.

- [ ] **Step 3: Rewrite `project-repos.ts`**

- Delete `primaryRepo()` (`:24-38`) and the `IProject` import.
- `fromRow` drops `primary`.
- `list(projectId)`: keep the 404 on a missing project (route code depends on
  it — see `routes/projects.ts:387`), then
  `selectFrom('project_repos').where('project_id','=',projectId).orderBy('position').orderBy('created_at')`.
- `listAll()`: one ordered select over `project_repos`.
- `forTask()`: unchanged logic; the `all.slice(0, 1)` fallback now means "the
  first repo" and is documented as the legacy-empty case.
- `insert()`: `position = (max(position) ?? -1) + 1`.
- `update()` / `remove()`: delete the primary-specific 404 messages; both work
  on any row. `remove()` keeps the live-run guard and the
  `repo_ids - <id>` Task update.

- [ ] **Step 4: Rewrite the project mappers**

- `projects.ts`: delete the seven columns from `projectFromRow`, `list`,
  `listPaged`, `get`; `create` no longer takes `git_path`;
  `update` no longer accepts `git_path` / `setup_*`;
  `createFromClone` inserts the project **and** its repo in one transaction
  and returns `{ project, repo }`:

```ts
async createFromClone(data: {
    name: string; issue_key_prefix: string; git_url: string; git_path: string;
    credential_id: string | null; default_branch: string; description?: string;
}): Promise<{ project: IProject; repo: IProjectRepo }> {
    rejectTraversalPath(data.git_path);
    return db.transaction().execute(async (trx) => {
        const project = await insertProjectRow(trx, data);
        const repo = await projectReposService.insert({
            project_id: project.id,
            name: projectReposService.slug(basename(data.git_path) || data.name),
            git_url: data.git_url,
            git_path: data.git_path,
            credential_id: data.credential_id,
            default_branch: data.default_branch,
        }, trx);
        return { project, repo };
    });
}
```

  (Give `insert` an optional `trx` parameter; default `db`.)
- `issue-tree.ts:21-45`: delete the same seven fields from its copy of
  `projectFromRow`; its `:71` `selectAll()` keeps working.
- `prompt-builder.ts:648-651,684`: the project-scope prompt reads the git path
  from the project's first repo — `const [repo] = await projectReposService.list(projectId)`
  then `const gitPath = repo?.git_path ?? '(unknown)'`.
- `external-links.ts:104-116`: `repoCredentials` loses the `projects` half and
  keeps only the `project_repos` query; drop the `projects.credential_id`
  select at `:121` and the `?? item.credential_id` fallback at `:137`.

- [ ] **Step 5: Update the test fixture**

`packages/api/tests/_items.ts` — `insertProject` keeps its signature (62 test
files call it) but now also inserts the repo row:

```ts
export async function insertProject(
    id: string = 'p1',
    prefix: string = 'ATL',
    overrides: Partial<{ name: string; git_path: string; git_url: string; default_branch: string }> = {},
): Promise<string> {
    await testDb.insertInto('projects').values({ id, name: overrides.name ?? id, issue_key_prefix: prefix, status: 'active' }).execute();
    await testDb.insertInto('project_repos').values({
        id,                                   // repo id = project id, as migration 045 does
        project_id: id,
        name: 'repo',
        git_path: overrides.git_path ?? `/tmp/atlas/${id}`,
        git_url: overrides.git_url ?? '',
        default_branch: overrides.default_branch ?? 'main',
        clone_status: 'ready',
        position: 0,
    }).execute();
    // …existing project_issue_counters insert…
    return id;
}
```

- [ ] **Step 6: Run the service tests**

`pnpm -F @atlas/api exec vitest run src/services/project-repos.test.ts src/services/projects.test.ts`
Expected: PASS. Update assertions in `projects.test.ts` that read git fields
off `IProject`.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services packages/api/tests/_items.ts
git commit -m "feat(api): project repos live in one table, with no primary"
```

---

### Task 4: `run-repos` — workspace root without a primary

**Files:**
- Modify: `packages/api/src/services/run-repos.ts:47-73`
- Modify: `packages/api/src/services/worktree-orchestrator.ts:127-167,199-203,462-466,499-520,1143-1157`
  (rename the `project` input field to `repo`, `projectGitPath` →
  `repoGitPath`, `WorktreeErrorCode` `'missing_project_git_path'` →
  `'missing_repo_git_path'`)
- Test: `packages/api/src/services/run-repos.test.ts`

**Interfaces:**
- Consumes: Task 3's `projectReposService`.
- Produces: `runRepos(run)` unchanged in shape; `EnsureWorktreeInput.repo:
  { id; git_path; credential_id; default_branch? }`;
  `cleanupWorktreeAfterPush({ itemId, repoId, repoGitPath, worktreePath, branch, credentialId })`.

- [ ] **Step 1: Write the failing test**

```ts
it('puts a multi-repo workspace under the Atlas workspace folder', async () => {
    await insertProject('p1', 'ATL');
    await projectReposService.insert({ project_id: 'p1', name: 'web', git_url: '', git_path: '/tmp/atlas/web', credential_id: null, default_branch: 'main' });
    await insertItem({ id: 'i1', project_id: 'p1', type: 'task', repo_ids: ['p1', /* web */ ] });
    const { workspace, repos } = await runRepos({ project_id: 'p1', item_id: 'i1', branch: 'atlas/i1' });
    expect(workspace).toBe('/tmp/atlas-workspace/worktrees/p1/ws/atlas__i1');
    expect(repos.map((r) => basename(r.path))).toEqual(['repo', 'web']);
});
```

(The test sets `settings.workspace_path` to `/tmp/atlas-workspace` first, the
way `src/services/project-env-file.test.ts` does.)

- [ ] **Step 2: Run it, watch it fail**

`pnpm -F @atlas/api exec vitest run src/services/run-repos.test.ts`
Expected: FAIL — the workspace is still derived from
`dirname(resolve(primary.git_path))`.

- [ ] **Step 3: Implement**

Replace `run-repos.ts:53-64` with the settings-derived root, keeping a
recorded path when the run already has one:

```ts
// A parked multi-repo run keeps the folder it was prepared in.
const settings = await settingsService.get();
const workspace =
    run.worktree_path ??
    join(settings.workspace_path, 'worktrees', run.project_id, 'ws', run.branch.replace(/\//g, '__'));
```

Then rename the orchestrator's `project` input to `repo` and update its two
callers (`workflow-engine.ts:341-348`, `routes/cli-sessions.ts:376-388`) plus
every `cleanupWorktreeAfterPush` call site.

- [ ] **Step 4: Run the affected suites**

`pnpm -F @atlas/api exec vitest run src/services/run-repos.test.ts src/services/worktree-orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): the multi-repo workspace hangs off the Atlas workspace folder"
```

---

### Task 5: Repo-scoped git routes (reveal, reclone, status, head)

**Files:**
- Modify: `packages/api/src/routes/projects.ts:142-252,264-319,424-443,464-499`
- Modify: `packages/api/src/services/reclone-runner.ts:10-14,71-81,191,226`
- Modify: `packages/api/src/services/delete-runner.ts:9-13,57-59`
- Test: `packages/api/src/routes/projects.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  `POST /api/projects/:id/repos/:repoId/{reveal,reclone}`,
  `GET /api/projects/:id/repos/:repoId/{status,head}`;
  `startReclone({ repoId, destination, branch })`;
  `startDelete({ projectId, mode })` (no `destination`).

- [ ] **Step 1: Write the failing route tests**

```ts
it('GET /api/projects/:id/repos/:repoId/head returns the repo HEAD', async () => {
    await insertProject('p1', 'ATL');
    const res = await app.inject({ method: 'GET', url: '/api/projects/p1/repos/p1/head' });
    expect(res.statusCode).toBe(200);
});

it('404s for a repo that does not belong to the project', async () => {
    await insertProject('p1', 'ATL');
    await insertProject('p2', 'WEB');
    const res = await app.inject({ method: 'GET', url: '/api/projects/p1/repos/p2/head' });
    expect(res.statusCode).toBe(404);
});

it('POST /api/projects/:id/repos/:repoId/reclone starts a reclone for that repo', async () => { /* … */ });
```

- [ ] **Step 2: Run, watch them fail (404 on the new paths)**

`pnpm -F @atlas/api exec vitest run src/routes/projects.test.ts`

- [ ] **Step 3: Move the handlers**

Add a small helper in `routes/projects.ts` and reuse it in all four handlers:

```ts
async function repoOr404(projectId: string, repoId: string, reply: FastifyReply) {
    const repos = await projectReposService.list(projectId);
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) { await reply.status(404).send({ error: 'repo not found', kind: 'not_found' }); return null; }
    return repo;
}
```

Re-register the four handlers under `/api/projects/:id/repos/:repoId/…`,
reading `repo.git_path`, `repo.default_branch`, `repo.credential_id` instead
of the project's. Delete the old paths. In `checkLocalClone` (`:264-319`) drop
the `projectsService.list()` half of the dual lookup — `ownerOfPath` covers it
now. The scaffold route (`:464-499`) takes `repo_id` in its body and gates on
that repo's `clone_status`.

`reclone-runner.ts`: `StartRecloneInput.projectId` → `repoId`; load the repo
through `projectReposService`, keep the "no credential" throw, and use
`repo.git_url` for fetch/pull. Broadcast `repoId` alongside `recloneId`.

`delete-runner.ts:57-59`: drop the `.filter(r => !r.primary)` and the
`input.destination` parameter — every folder now comes from
`projectReposService.list(projectId)`. Keep the workspace-root containment
guard for each path.

- [ ] **Step 4: Green the tests**

`pnpm -F @atlas/api exec vitest run src/routes/projects.test.ts src/services/reclone-runner.test.ts src/services/delete-runner.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): reveal, reclone, status and head are per repo"
```

---

### Task 6: Per-repo auto-fetch schedules

**Files:**
- Modify: `packages/api/src/services/schedules.ts` (every `projectId` → `repoId`)
- Modify: `packages/api/src/services/schedule-registry.ts:6-57`
- Modify: `packages/api/src/services/auto-fetch-runner.ts:65-147,211`
- Modify: `packages/api/src/routes/schedules.ts` (all five handlers)
- Test: `packages/api/src/services/schedules.test.ts`,
  `packages/api/src/services/auto-fetch-runner.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `schedulesService.{getOrDefault,upsert,delete,recordRun,incrementAuthFailure,resetAuthFailure,disable}(repoId, …)`;
  `listEnabled(): Promise<IProjectSchedule[]>` (each row carries `repo_id` and
  `project_id`); `runAutoFetch(repoId)`; routes under
  `/api/projects/:id/repos/:repoId/schedule`.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps one schedule per repo', async () => {
    await insertProject('p1', 'ATL');
    const web = await projectReposService.insert({ project_id: 'p1', name: 'web', git_url: '', git_path: '/tmp/web', credential_id: null, default_branch: 'main' });
    await schedulesService.upsert({ repo_id: 'p1', project_id: 'p1', enabled: 1, /* … */ });
    await schedulesService.upsert({ repo_id: web.id, project_id: 'p1', enabled: 1, /* … */ });
    expect(await schedulesService.listEnabled()).toHaveLength(2);
});

it('deletes a repo schedule with its repo', async () => {
    await insertProject('p1', 'ATL');
    await schedulesService.upsert({ repo_id: 'p1', project_id: 'p1', enabled: 1, /* … */ });
    await projectReposService.remove('p1', 'p1');
    expect(await schedulesService.listEnabled()).toEqual([]);
});
```

- [ ] **Step 2: Run, watch them fail**

`pnpm -F @atlas/api exec vitest run src/services/schedules.test.ts`

- [ ] **Step 3: Implement**

- `schedules.ts`: every query keys on `repo_id`; `upsert` conflicts on
  `repo_id` and writes `project_id` too; `defaultSchedule(repoId, projectId)`.
- `schedule-registry.ts`: `jobs` keyed by `repo_id`; `registerOne` fires
  `runAutoFetch(s.repo_id)`; `unregisterOne(repoId)`; `nextRun(repoId)`.
- `auto-fetch-runner.ts`: `runAutoFetch(repoId)` loads the repo, uses
  `repo.git_path` / `repo.git_url` / `repo.default_branch` /
  `repo.credential_id`, and keeps the agents-active guard on
  `repo.project_id`. Every `autofetch_*` SSE payload gains `repoId`.
- `routes/schedules.ts`: all five handlers move under
  `/api/projects/:id/repos/:repoId/schedule`, 404ing through `repoOr404`.
- `projects.ts:32` `LAST_ACTIVITY_SQL`: the `project_schedules` sub-select now
  joins through `project_repos` to reach the project.

- [ ] **Step 4: Green**

`pnpm -F @atlas/api exec vitest run src/services/schedules.test.ts src/services/auto-fetch-runner.integration.test.ts src/routes/schedules.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): every repo has its own auto-fetch schedule"
```

---

### Task 7: A Task always names its repos

**Files:**
- Modify: `packages/api/src/services/tasks.ts:81,111-122`
- Modify: `packages/api/src/services/workflow-queue.ts` (queue guard)
- Test: `packages/api/src/services/tasks.test.ts`,
  `packages/api/src/routes/items.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: `tasksService.create` fills `repo_ids` with the only repo when the
  project has exactly one, and 400s when the project has several and none was
  named; `update` 400s on `repo_ids: []`; queueing a repo-less Task 409s.

- [ ] **Step 1: Write the failing tests**

```ts
it('fills repo_ids when the project has exactly one repo', async () => {
    await insertProject('p1', 'ATL');
    const task = await tasksService.create({ project_id: 'p1', title: 't' });
    expect(task.repo_ids).toEqual(['p1']);
});

it('400s when a multi-repo project gets a Task with no repos', async () => {
    await insertProject('p1', 'ATL');
    await projectReposService.insert({ project_id: 'p1', name: 'web', git_url: '', git_path: '/tmp/web', credential_id: null, default_branch: 'main' });
    await expect(tasksService.create({ project_id: 'p1', title: 't' })).rejects.toMatchObject({ status: 400 });
});

it('400s when an update empties repo_ids', async () => {
    await insertProject('p1', 'ATL');
    const task = await tasksService.create({ project_id: 'p1', title: 't' });
    await expect(tasksService.update(task.id, { repo_ids: [] })).rejects.toMatchObject({ status: 400 });
});

it('409s when a Task with no repos is queued for a workflow', async () => { /* remove the repo, then queue */ });
```

- [ ] **Step 2: Run, watch them fail**

`pnpm -F @atlas/api exec vitest run src/services/tasks.test.ts`

- [ ] **Step 3: Implement**

In `tasks.ts:81`, after `validateIds`:

```ts
const repos = await projectReposService.list(data.project_id);
let repoIds = await projectReposService.validateIds(data.project_id, data.repo_ids ?? []);
if (repoIds.length === 0) {
    const [only] = repos;
    if (repos.length !== 1 || !only) {
        throw new ApiError('validation_error', 'A Task needs at least one repo', 400);
    }
    repoIds = [only.id];
}
```

`update` (`:111,:122`): reject an explicit `[]` with the same message. In the
workflow queue path, refuse a Task whose `repo_ids` is empty with 409
`'This Task has no repos — add one to the project first'`.

- [ ] **Step 4: Green + commit**

```bash
pnpm -F @atlas/api exec vitest run src/services/tasks.test.ts src/routes/items.test.ts
git commit -am "feat(api): a Task always names at least one repo"
```

---

### Task 8: Terminals pick a repo

**Files:**
- Modify: `packages/api/src/routes/cli-sessions.ts:318-600,1078-1210`
- Modify: `packages/api/src/services/project-setup-runner.ts:63-94`
- Test: `packages/api/src/routes/cli-sessions.test.ts`

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces: `POST /api/cli/sessions` accepts `repo_id`, defaults to the only
  repo, 400s when the project has several and none was named; the session row
  stores `repo_id`; `runProjectSetup({ projectId, repoId, worktreePath, runId })`
  always reads the repo's scripts.

- [ ] **Step 1: Write the failing tests**

```ts
it('defaults to the only repo', async () => {
    await insertProject('p1', 'ATL');
    const res = await app.inject({ method: 'POST', url: '/api/cli/sessions', payload: { project_id: 'p1' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().repo_id).toBe('p1');
});

it('400s when a multi-repo project gets no repo_id', async () => { /* … */ });
it('400s when the project has no repos at all', async () => { /* … */ });
```

- [ ] **Step 2: Run, watch them fail**

- [ ] **Step 3: Implement**

Replace the `!project.git_path` guard (`:322-326`) with repo resolution:

```ts
const repos = await projectReposService.list(body.project_id);
const repo = body.repo_id ? repos.find((r) => r.id === body.repo_id) : repos.length === 1 ? repos[0] : undefined;
if (!repo) {
    return reply.status(400).send({
        error: repos.length === 0 ? 'project has no repos; add one first' : 'repo_id is required for a multi-repo project',
        kind: 'validation_error',
    });
}
```

Then feed `repo` to `ensureWorktree`, `cleanupWorktreeAfterPush`,
`safeBuildGitAuth`, `pushWorktree`, `openPullRequest` and the diff endpoints
(`:876-914` use `repo.default_branch`), persist `repo_id` on the row, and pass
`repoId: repo.id` to `runProjectSetup`. In `project-setup-runner.ts:84-88`
delete the `opts.repoId !== opts.projectId` special case — always read the
repo row; `projects` no longer holds script bodies.

- [ ] **Step 4: Green + commit**

```bash
pnpm -F @atlas/api exec vitest run src/routes/cli-sessions.test.ts src/services/project-setup-runner.test.ts
git commit -am "feat(api): a terminal session runs in a repo of its project"
```

---

### Task 9: Remaining API call sites

**Files:**
- Modify: `packages/api/src/services/clone-runner.ts:40,139-151`
- Modify: `packages/api/src/services/agent-runner.ts:727-735,1425-1441`
- Modify: `packages/api/src/scripts/smoke-items.ts:14`
- Modify: `packages/mcp/src/tools/projects.ts:22`, `packages/mcp/src/tools/items.ts:163`
  (description strings only)

**Interfaces:**
- Consumes: Tasks 3-8.
- Produces: a green `pnpm typecheck` across the repo.

- [ ] **Step 1: Run the typechecker and work the list**

`pnpm -F @atlas/api typecheck` — every remaining error is a call site above.

- [ ] **Step 2: `clone-runner.ts`**

The no-`onCloned` branch calls the new `createFromClone`, which returns
`{ project, repo }`; the `clone_completed` payload carries **both** so
New Project can show the repo's path and branch.

- [ ] **Step 3: `agent-runner.ts`**

- `:727-735`: the commit-verification cwd falls back to the Task's **first
  repo's** `git_path` via `runRepos`, not `projects.git_path`.
- `:1425-1441`: `GH_TOKEN` comes from the first repo's credential:

```ts
// Agents get one token: the Task's first repo's credential (ADR 0018).
const [first] = await projectReposService.forTask({ project_id: projectId, repo_ids: repoIds });
const projectCredentialId = first?.credential_id ?? null;
```

- [ ] **Step 4: Full API suite**

Run: `pnpm -F @atlas/api test`
Expected: PASS. Fix fallout in the 25 test files that referenced project git
fields (see the spec's testing section) by moving the assertions onto the repo.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(api): the last project-git call sites move to repos"
```

---

### Task 10: Web API client, hooks and test doubles

**Files:**
- Modify: `packages/web/src/api/api.ts:492-569,617-635`
- Modify: `packages/web/src/hooks/useProjectSchedule.ts`,
  `useCloneJob.ts:5-44`, `useProjects.ts:41-64`
- Modify: `packages/web/src/test-utils/factories.ts:18-56`,
  `packages/web/src/test-utils/mock-handlers.ts:38-56`

**Interfaces:**
- Consumes: Task 2's types, Tasks 5-8's routes.
- Produces:
  - `api.projects.reclone(id, repoId)`, `.status(id, repoId)`,
    `.reveal(id, repoId)`, `.head(id, repoId)`
  - `api.repos.list()` → `GET /api/repos` (every repo, all projects)
  - `api.schedules.{get,save,delete,fire}(projectId, repoId, …)`
  - `useProjectSchedule(projectId, repoId)` and siblings
  - `makeProject()` without git fields; `makeProjectRepo()` without `primary`

- [ ] **Step 1: Update the client and factories**

Point the four project-git functions and the four schedule functions at the
repo-scoped paths, add `repos: { list: () => get<IProjectRepo[]>('/repos') }`,
and delete the seven fields from `makeProject()` plus `primary` from
`makeProjectRepo()`. In `mock-handlers.ts`, make `GET /projects/:id/repos`
return `[makeProjectRepo()]` instead of `[]` so components that now depend on
repos render something by default, and add a `GET /repos` handler.

- [ ] **Step 2: Typecheck the web package**

Run: `pnpm -F @atlas/web typecheck`
Expected: a list of failing components — that is Tasks 11-14.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(web): repo-scoped API client and test doubles"
```

---

### Task 11: Projects list page

**Files:**
- Modify: `packages/web/src/pages/Projects.tsx:172-260,374-510`
- Modify: `packages/web/src/pages/projects/ProjectCard.tsx:147,162-163`
- Modify: `packages/web/src/pages/projects/ProjectsTable.tsx:24,57,238`
- Modify: `packages/web/src/pages/projects/ProjectRowMenu.tsx:12,17,35-41`
- Modify: `packages/web/src/pages/projects/DeleteProjectModal.tsx:133`
- Test: `packages/web/src/pages/Projects.test.tsx`

**Interfaces:**
- Consumes: `api.repos.list()` from Task 10.
- Produces: a `Map<projectId, IProjectRepo[]>` built from ONE `GET /api/repos`
  call (no per-card fetch — `e2e/no-dup-fetches.spec.ts` audits this).

- [ ] **Step 1: Write the failing test**

```tsx
it('shows the repo count for a project with two repos', async () => {
    server.use(http.get('*/api/repos', () => HttpResponse.json([
        makeProjectRepo({ id: 'p1', project_id: 'p1', name: 'api' }),
        makeProjectRepo({ id: 'r2', project_id: 'p1', name: 'web' }),
    ])));
    renderWithProviders(<Projects />);
    expect(await screen.findByText('2 repos')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, watch it fail**

`pnpm -F @atlas/web exec vitest run src/pages/Projects.test.tsx`

- [ ] **Step 3: Implement**

Add `useAllRepos()` (TanStack Query over `api.repos.list`, key `['repos']`),
group by `project_id`, and pass each project's repos into the card and table
row. The card's path tooltip becomes the repo count plus the repo names; the
table's `Repo URL` column shows the first repo's URL with a `+N` suffix.
Delete `onReclone` / `onScheduleFetch` from `ProjectRowMenu` and drop the two
lazy modals from `Projects.tsx` — they now live on the Repos tab (Task 12).
`DeleteProjectModal` lists every repo path instead of `project.git_path`.

- [ ] **Step 4: Green + commit**

```bash
pnpm -F @atlas/web exec vitest run src/pages/Projects.test.tsx src/pages/projects
git commit -am "feat(web): the projects list counts repos instead of showing one path"
```

---

### Task 12: Project Detail — Repos tab owns every repo action

**Files:**
- Modify: `packages/web/src/pages/project/ProjectReposCard.tsx:144,178,203,223-300`
- Modify: `packages/web/src/pages/project/ProjectHeader.tsx:83-125`
- Modify: `packages/web/src/pages/project/SetupTab.tsx` (whole file)
- Modify: `packages/web/src/pages/ProjectDetail.tsx:173,239-313`
- Modify: `packages/web/src/pages/project/ProjectEnvSecretsModal.tsx:474`
- Move: `packages/web/src/pages/projects/{RecloneProjectModal,AutoFetchScheduleModal}.tsx`
  → take a `repo: IProjectRepo` prop, rendered from the Repos tab
- Test: `packages/web/src/pages/project/ProjectReposCard.test.tsx`,
  `SetupTab.test.tsx`, `ProjectDetail.test.tsx`

**Interfaces:**
- Consumes: Tasks 10-11.
- Produces: a per-row repo menu (Edit, Auto-fetch schedule, Reclone, Reveal,
  Remove); `SetupTab` edits the selected repo's scripts through
  `useUpdateProjectRepo`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('offers Remove on every repo, including the first', async () => {
    renderWithProviders(<ProjectReposCard projectId="p1" />);
    const rows = await screen.findAllByRole('button', { name: /^Remove / });
    expect(rows).toHaveLength(2);
});

it('has no Primary chip', async () => {
    renderWithProviders(<ProjectReposCard projectId="p1" />);
    await screen.findByText('api');
    expect(screen.queryByText('Primary')).not.toBeInTheDocument();
});

it('Setup tab saves the selected repo scripts', async () => { /* select "web", type, save, assert PATCH …/repos/r2 */ });
```

- [ ] **Step 2: Run, watch them fail**

- [ ] **Step 3: Implement**

- `ProjectReposCard`: delete the `repo.primary` chip and both `{!repo.primary && …}`
  gates; add the row menu with Reclone / Auto-fetch / Reveal wired to the
  repo-scoped endpoints; the remove confirm keeps the "folder stays on disk"
  copy and no longer refuses the last repo. Empty state: "No repos yet" plus
  the Add repo button. `EditRepoDialog` loses its setup-script fields.
- `ProjectHeader`: render the repos from `useProjectRepos` — one row links to
  its remote and shows its branch; more than one shows a count chip.
- `SetupTab`: `useProjectRepos` + a repo `Select` at the top +
  `useUpdateProjectRepo`; drop `useUpdateProject`.
- `ProjectDetail:173`: `aiScaffoldEnabled = repos.some((r) => r.clone_status === 'ready')`.
- `ProjectEnvSecretsModal:474`: `const noWorkspace = repos.length === 0;`.

- [ ] **Step 4: Green + commit**

```bash
pnpm -F @atlas/web exec vitest run src/pages/project src/pages/ProjectDetail.test.tsx
git commit -am "feat(web): the Repos tab owns reclone, auto-fetch, reveal and setup"
```

---

### Task 13: New Project, Add repo and the scaffold dialog

**Files:**
- Modify: `packages/web/src/pages/projects/NewProjectModal.tsx:288-294,1195,1210`
- Modify: `packages/web/src/pages/projects/GenerateAiScaffoldDialog.tsx:52`
- Test: `NewProjectModal.test.tsx`, `GenerateAiScaffoldDialog.test.tsx`

**Interfaces:**
- Consumes: `useCloneJob`'s `repo` branch (Task 10), Task 5's scaffold body.
- Produces: the success summary reads `job.repo`; the scaffold dialog names
  the repo it will analyze.

- [ ] **Step 1: Write the failing test**

```tsx
it('shows the cloned repo path and branch in the summary', async () => { /* emit clone_completed with {project, repo} */ });
```

- [ ] **Step 2: Run, fail, implement, green**

Read `job.repo.git_path` / `job.repo.default_branch`, call
`api.projects.head(job.project.id, job.repo.id)`, and give the scaffold dialog
a repo `Select` when the project has more than one ready repo.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(web): New Project summarises the repo it created"
```

---

### Task 14: Task repos and the terminal repo picker

**Files:**
- Modify: `packages/web/src/pages/TaskNew.tsx:93-143,413-431`
- Modify: `packages/web/src/components/TaskReposRow.tsx:20,32-34`
- Modify: `packages/web/src/components/RepoSelect.tsx:54`
- Modify: `packages/web/src/components/StartSessionDialog.tsx:19,57,126-131`
- Test: `TaskNew.test.tsx`, `TaskDetail.test.tsx`, `StartSessionDialog.test.tsx`

**Interfaces:**
- Consumes: Tasks 7, 8, 10.
- Produces: the repo select always renders; it defaults to the only repo;
  submitting with none selected is blocked; a session create sends `repo_id`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('preselects the only repo and always shows the picker', async () => {
    renderWithProviders(<TaskNew />);
    expect(await screen.findByLabelText('Repos')).toBeInTheDocument();
});

it('blocks submit when no repo is selected', async () => { /* deselect, expect the Create button disabled */ });
it('sends repo_id when starting a terminal session', async () => { /* … */ });
```

- [ ] **Step 2: Run, fail, implement, green**

Replace both `repos.filter((r) => r.primary)` defaults with
`repos.slice(0, 1)`, delete the `repos.length > 1` gates, always send
`repo_ids`, drop `RepoSelect`'s `primary` sub-label, and add the repo `Select`
to `StartSessionDialog` (hidden when there is exactly one repo, which is
preselected).

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(web): a Task and a terminal always name their repos"
```

---

### Task 15: E2E, docs and the full gate

**Files:**
- Modify: `e2e/fixtures/run-seed.ts:44-85` (insert a `project_repos` row)
- Modify: `e2e/flows/multi-repo.spec.ts:47-94`
- Create: `e2e/flows/repos-without-primary.spec.ts`
- Modify: `e2e/modals/{reclone-project-modal,auto-fetch-modal,delete-project-modal,generate-ai-scaffold-dialog}.spec.ts`,
  `e2e/pages/setup-tab.spec.ts`, `e2e/tabs/project-detail.spec.ts`,
  `e2e/no-dup-fetches.spec.ts`
- Create: `docs/adr/0018-repos-without-a-primary.md`
- Modify: `.agents/api-surface.md` (routes, SSE, migrations index),
  `.agents/data-model.md` (entities), `.agents/pages/03-project-detail.md`,
  `.agents/pages/06-task-new.md`, `.agents/pages/07-task-detail.md`, the
  projects-list and terminal page docs, `.agents/routes-map.md`

**Interfaces:**
- Consumes: every earlier task.
- Produces: a green `pnpm gate` and docs that match the code.

- [ ] **Step 1: Fix the seed**

`run-seed.ts` inserts the project without git columns plus a `project_repos`
row with `id = PROJECT_ID`, `position 0`, `git_path: CLONE_PATH`.

- [ ] **Step 2: Write the new e2e spec**

`e2e/flows/repos-without-primary.spec.ts` — "a project's repos are all equal":
open the Repos tab, add a second repo, assert no "Primary" chip, remove the
**first** repo, assert the project still works and the remaining repo is the
Task's default, then create a Task and assert its `repo_ids` holds the
remaining repo id.

- [ ] **Step 3: Update the existing specs**

`multi-repo.spec.ts`: insert both repos as rows (no project-row primary), drop
the `getByText('Primary')` assertion, keep `expect(task.repo_ids).toEqual([…])`
with the two real ids. Move the reclone / auto-fetch modal specs to the Repos
tab entry points. `setup-tab.spec.ts` asserts the repo selector and a
`PATCH …/repos/:repoId`.

- [ ] **Step 4: Write ADR 0018**

State the decision (no primary; a project is a container), that it supersedes
ADR 0017's primary-repo decision, the `id = project id` migration trick, and
the consequences from the spec.

- [ ] **Step 5: Update `.agents/`**

Follow the self-update table in AGENTS.md: routes and SSE and the migrations
index in `api-surface.md`, entities in `data-model.md`, and the UI element
lists for every page touched in Tasks 11-14.

- [ ] **Step 6: Run the full gate**

```bash
pnpm gate            # typecheck + knip + tests with coverage + build + bundle check
pnpm e2e             # Playwright
```
Expected: PASS. Do not claim completion until both have run green — paste the
summary lines into the final report.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: repos without a primary — e2e, ADR 0018 and .agents docs"
```

---

## Self-Review

- **Spec coverage:** data/migration → Task 1; shared types → Task 2; API
  surface → Tasks 5-9; runtime (`run-repos`, GH_TOKEN, lock, clone/reclone/
  auto-fetch, terminals, delete, env) → Tasks 4-9; UI → Tasks 11-14; testing
  and docs → Tasks 1-15 (each task carries its own tests) and Task 15.
- **The spec's "AI scaffold takes a repo id"** is covered in Task 5 Step 3
  (API) and Task 13 (UI).
- **Ordering invariant** (`list()[0]` = first repo) is stated in Global
  Constraints and enforced by Task 3's ordering plus Task 1's `position 0`.
- **Naming consistency:** `repoOr404` (Task 5) is reused in Task 6;
  `EnsureWorktreeInput.repo` (Task 4) is what Tasks 5 and 8 pass;
  `createFromClone` returns `{ project, repo }` in Tasks 3, 9 and 13.
