import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { db } from '../db/kysely-client.js';
import { projectReposService } from './project-repos.js';
import { projectsService } from './projects.js';

// The project agent tests run in by default (ADR 0023 amendment).
//
// A test materialises a real Task, which spends a real issue key and appears in
// that project's lists. Running it in the Owner's own project by default puts
// test noise into real work, so tests default here instead: a project named
// "Tests" (prefix TST) with one local sample repo. Picking a real project is
// still one click away when the Owner wants the agent tested against real code.
//
// The sample repo is local-only — no remote, no credential — so nothing a test
// agent does can ever be pushed anywhere.

const execFileAsync = promisify(execFile);

const SAMPLE_REPO_NAME = 'atlas-test-sample';

/** Small enough to read in one go, real enough that a coder has something to extend. */
const SAMPLE_FILES: Record<string, string> = {
    'README.md': `# atlas-test-sample

A tiny sample project Atlas creates for agent tests. It has no remote, so
nothing done here is ever pushed. Safe to edit; safe to delete (Atlas recreates
it on the next test run).
`,
    'package.json': `${JSON.stringify(
        {
            name: 'atlas-test-sample',
            version: '1.0.0',
            private: true,
            type: 'module',
            scripts: { test: 'node --test' },
        },
        null,
        2,
    )}\n`,
    'src/strings.js': `/** Collapse runs of whitespace and trim both ends. */
export function squish(s) {
    return s.replace(/\\s+/g, ' ').trim();
}

/** Upper-case the first character. */
export function capitalize(s) {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
`,
    'test/strings.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitalize, squish } from '../src/strings.js';

test('squish collapses whitespace', () => {
    assert.equal(squish('  a   b  '), 'a b');
});

test('capitalize upper-cases the first character', () => {
    assert.equal(capitalize('hello'), 'Hello');
    assert.equal(capitalize(''), '');
});
`,
};

async function git(cwd: string, args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd });
}

/** Create the sample repo on disk unless it is already there. Returns its path. */
async function ensureSampleRepo(root: string): Promise<string> {
    const path = join(root, SAMPLE_REPO_NAME);
    if (existsSync(join(path, '.git'))) return path;
    mkdirSync(join(path, 'src'), { recursive: true });
    mkdirSync(join(path, 'test'), { recursive: true });
    for (const [file, body] of Object.entries(SAMPLE_FILES)) writeFileSync(join(path, file), body);
    await git(path, ['init', '-q', '-b', 'main']);
    await git(path, ['add', '-A']);
    // An explicit identity: a machine with no global git config would
    // otherwise fail the very first commit.
    await git(path, [
        '-c',
        'user.name=Atlas',
        '-c',
        'user.email=atlas@localhost',
        'commit',
        '-q',
        '-m',
        'Sample project for agent tests',
    ]);
    return path;
}

/** "TST", or the next free `T..` prefix when the Owner already uses TST. */
async function freePrefix(): Promise<string> {
    for (const candidate of ['TST', 'TSX', 'TSY', 'TSZ', 'TXT']) {
        if ((await projectsService.checkPrefix(candidate)).available) return candidate;
    }
    throw new Error('No free issue prefix for the agent test project (tried TST, TSX, TSY, TSZ, TXT)');
}

async function workspaceRoot(): Promise<string> {
    const row = await db.selectFrom('settings').select(['workspace_path']).executeTakeFirst();
    return (row?.workspace_path as string | null) || join(homedir(), '.atlas', 'workspace');
}

async function create(): Promise<string> {
    const existing = await db
        .selectFrom('projects')
        .select('id')
        .where('is_test_sandbox', '=', true)
        .executeTakeFirst();
    const projectId =
        existing?.id ??
        (
            await projectsService.create({
                name: 'Tests',
                issue_key_prefix: await freePrefix(),
                description: 'Where agent tests run by default. Items here are made by test runs.',
            })
        ).id;
    if (!existing) {
        await db.updateTable('projects').set({ is_test_sandbox: true }).where('id', '=', projectId).execute();
    }

    // A project the Owner stripped of its repo gets the sample back: a Task
    // needs at least one repo to be created at all.
    if ((await projectReposService.list(projectId)).length === 0) {
        const path = await ensureSampleRepo(await workspaceRoot());
        await projectReposService.insert({
            project_id: projectId,
            name: SAMPLE_REPO_NAME,
            git_url: '',
            git_path: path,
            credential_id: null,
            default_branch: 'main',
        });
    }
    return projectId;
}

let pending: Promise<string> | null = null;

/**
 * The sandbox project's id, creating it (and its sample repo) on first use.
 *
 * Serialised: "Run all" starts several fixtures at once, and two of them
 * racing here would create two projects.
 */
export function ensureTestProject(): Promise<string> {
    pending ??= create().finally(() => {
        pending = null;
    });
    return pending;
}
