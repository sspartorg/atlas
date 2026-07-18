// Theme 13 — tiny wrapper that invokes the api seed module. Spawned
// by `e2e/global-setup.ts` with DATABASE_URL pointing at atlas_e2e
// so the seed runs against the e2e DB (not the dev DB). Also flips
// `settings.onboarding_complete=1` so the route guard doesn't
// redirect every spec to /onboarding.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSeed } from '../../packages/api/src/db/seed.js';
import { db } from '../../packages/api/src/db/kysely-client.js';
import {
    marketplaceService,
    MarketplaceSlugTakenError,
} from '../../packages/api/src/services/marketplace.js';

await runSeed();

// W5 — install PO Writer from the marketplace so the /agents page is
// non-empty and the agents.spec.ts assertions ("shows the seeded PO Writer
// agent card", "clicking an agent card navigates to its detail page") have
// something to find. runSeed() only syncs the marketplace catalog; agents
// are installed via the legitimate marketplace install path (never by
// writing directly to the agents table).
//
// Idempotent: MarketplaceSlugTakenError means the agent is already
// installed (e.g. a re-run against a DB that survived a previous seed).
try {
    await marketplaceService.install('agent-po-writer');
} catch (err) {
    if (!(err instanceof MarketplaceSlugTakenError)) throw err;
}
await db
    .updateTable('settings')
    .set({ onboarding_complete: 1, workspace_path: '/tmp/atlas-e2e' })
    .where('id', '=', 1)
    .execute();

// 2026-06-22 — Terminal v1 fixture. The Playwright spec at
// `e2e/pages/terminal.spec.ts` drives a real cli-session lifecycle
// (Start → Pause → Resume → Stop) which requires:
//
//   * a `projects` row with a usable `git_path`
//   * that git_path to be a clone of a remote that accepts push (so
//     Stop's push-and-cleanup step doesn't strand the worktree)
//
// We provision both on disk under tmpdir/atlas-e2e-fixtures: a
// bare repo plays origin, a working clone is what `projects.git_path`
// points at. Wipe-and-recreate every seed so reruns are hermetic.
// The Atlas worktrees the Terminal route creates land alongside as
// `<E2E_FIX_DIR>/worktrees/<projectId>/…` and get wiped with the dir.
const E2E_FIX_DIR = join(tmpdir(), 'atlas-e2e-fixtures');
const BARE_REPO = join(E2E_FIX_DIR, 'remote.git');
const CLONE_PATH = join(E2E_FIX_DIR, 'project');
const PROJECT_ID = 'e2e-terminal-project';

if (existsSync(E2E_FIX_DIR)) {
    rmSync(E2E_FIX_DIR, { recursive: true, force: true });
}
mkdirSync(E2E_FIX_DIR, { recursive: true });

const gitOpts = { stdio: 'pipe' as const };
execFileSync('git', ['init', '--bare', '-b', 'main', BARE_REPO], gitOpts);
execFileSync('git', ['clone', BARE_REPO, CLONE_PATH], gitOpts);
execFileSync('git', ['-C', CLONE_PATH, 'config', 'user.email', 'e2e@atlas.local'], gitOpts);
execFileSync('git', ['-C', CLONE_PATH, 'config', 'user.name', 'Atlas E2E Bot'], gitOpts);
execFileSync('git', ['-C', CLONE_PATH, 'config', 'commit.gpgsign', 'false'], gitOpts);
writeFileSync(join(CLONE_PATH, 'README.md'), '# Atlas e2e fixture project\n', 'utf8');
execFileSync('git', ['-C', CLONE_PATH, 'add', 'README.md'], gitOpts);
execFileSync('git', ['-C', CLONE_PATH, 'commit', '-m', 'init'], gitOpts);
execFileSync('git', ['-C', CLONE_PATH, 'push', '-u', 'origin', 'main'], gitOpts);

await db
    .insertInto('projects')
    .values({
        id: PROJECT_ID,
        name: 'E2E Terminal',
        issue_key_prefix: 'ETM',
        git_path: CLONE_PATH,
        default_branch: 'main',
        clone_status: 'ready',
        description: 'Hermetic fixture project for the Terminal Playwright spec.',
    })
    .execute();
await db
    .insertInto('project_issue_counters')
    .values({ project_id: PROJECT_ID, last_seq: 0 })
    .execute();

// Terminal v2 — seed one epic so the linked-session spec has an item
// to pick from the Start Session dialog's Item Autocomplete.
await db
    .insertInto('items')
    .values({
        id: 'ETM-1',
        type: 'epic',
        project_id: PROJECT_ID,
        title: 'E2E linked epic',
        description: 'Used by the Terminal v2 item-linkage Playwright spec.',
        status: 'in_progress',
        priority: 'normal',
    })
    .execute();
await db
    .updateTable('project_issue_counters')
    .set({ last_seq: 1 })
    .where('project_id', '=', PROJECT_ID)
    .execute();

await db.destroy();
