import { dirname, join, resolve } from 'node:path';
import type { IProjectRepo } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { projectReposService } from './project-repos.js';
import { computeWorktreePath } from './worktree-orchestrator.js';

export interface RunRepo {
    repo: IProjectRepo;
    /** This run's checkout of the repo. */
    path: string;
}

export interface RunRepos {
    repos: RunRepo[];
    /**
     * Multi-repo Task: the folder holding one checkout per repo, named by repo
     * — it is the agents' cwd and `workflow_runs.worktree_path`. Null for a
     * single repo, whose checkout is the cwd, exactly as before ADR 0017.
     */
    workspace: string | null;
}

/**
 * ADR 0017 — the repos a run works on and where each is checked out. A
 * sub-task's run works on its Task's repos, in the Task's workspace.
 */
export async function runRepos(run: {
    project_id: string | null;
    item_id: string | null;
    branch: string | null;
    /** A single repo's checkout is wherever the run recorded it. */
    worktree_path?: string | null;
}): Promise<RunRepos> {
    if (!run.project_id || !run.branch) return { repos: [], workspace: null };
    let repoIds: string[] = [];
    if (run.item_id) {
        const item = await db
            .selectFrom('items')
            .select(['id', 'parent_id', 'repo_ids'])
            .where('id', '=', run.item_id)
            .executeTakeFirst();
        const task = item?.parent_id
            ? await db.selectFrom('items').select('repo_ids').where('id', '=', item.parent_id).executeTakeFirst()
            : item;
        repoIds = task?.repo_ids ?? [];
    }
    const repos = await projectReposService.forTask({ project_id: run.project_id, repo_ids: repoIds });
    const [only] = repos;
    if (repos.length === 1 && only) {
        const path = run.worktree_path ?? computeWorktreePath(only.git_path, only.id, run.branch);
        return { repos: [{ repo: only, path }], workspace: null };
    }
    const [primary] = await projectReposService.list(run.project_id);
    /* v8 ignore next -- list() always starts with the primary */
    if (!primary) return { repos: [], workspace: null };
    // `ws/` keeps a multi-repo workspace apart from any single-repo checkout
    // of the same branch left next to it.
    const workspace = join(
        dirname(resolve(primary.git_path)),
        'worktrees',
        run.project_id,
        'ws',
        run.branch.replace(/\//g, '__')
    );
    return { repos: repos.map((repo) => ({ repo, path: join(workspace, repo.name) })), workspace };
}

/**
 * Appended to a multi-repo run's `.atlas/current-task.md` — the file the
 * agent CLI reads — so agents know where each repo is and how to work them.
 */
export function repositoriesMarkdown(repos: RunRepo[], branch: string | null): string {
    const [first] = repos;
    return [
        '',
        '## Repositories',
        '',
        `This Task spans ${repos.length} repos, each checked out in its own folder here on branch \`${branch ?? ''}\`:`,
        '',
        '| Folder | Remote | Base branch |',
        '|---|---|---|',
        ...repos.map(
            (r, i) => `| \`./${r.repo.name}\`${i === 0 ? ' (first)' : ''} | ${r.repo.git_url || '-'} | \`${r.repo.default_branch}\` |`
        ),
        '',
        '- This folder is not a git repo. Change each file in the repo it belongs to, and commit inside that repo (`git -C ./<repo> ...`).',
        '- Run every checklist script from inside each repo you changed: `(cd ./<repo> && bash ./.atlas/scripts/bash/<script>.sh)`.',
        `- Put Task-wide files (specs, QA CSVs) in the first repo, \`./${first?.repo.name ?? ''}\`.`,
        '- When the workflow ends, Atlas pushes the branch and opens one pull request per repo you changed.',
        '',
    ].join('\n');
}
