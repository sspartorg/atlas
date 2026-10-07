// Seed for scripts/guide-stack.sh — the user-guide screenshots.
//
// Only what the API cannot create for us goes here: the catalog sync, the
// Owner profile, and a project whose repos are LOCAL clones of local bare
// origins. The API only accepts github.com URLs for a repo, and the guide runs
// real agents without pushing anywhere, so the repo rows are written directly
// exactly as e2e/fixtures/run-seed.ts does. Everything else (agents,
// workflows, Tasks, runs) is made by e2e/guide/populate-guide.ts through the
// API, the way the Owner would.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runSeed } from '../../packages/api/src/db/seed.js';
import { db } from '../../packages/api/src/db/kysely-client.js';

const DATA = process.env['GUIDE_DATA'] ?? '/tmp/atlas-guide';
const WORKSPACE = join(DATA, 'workspace');
const ORIGINS = join(DATA, 'origins');
const PROJECT_ID = 'acme-notes';

await runSeed();

await db
    .updateTable('settings')
    .set({ onboarding_complete: 1, owner_name: 'Alex Rivera', workspace_path: WORKSPACE })
    .where('id', '=', 1)
    .execute();

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });

function makeRepo(name: string, files: Record<string, string>): string {
    const bare = join(ORIGINS, `${name}.git`);
    const clone = join(WORKSPACE, PROJECT_ID, name);
    mkdirSync(ORIGINS, { recursive: true });
    mkdirSync(dirname(clone), { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
    execFileSync('git', ['clone', bare, clone], { stdio: 'pipe' });
    git(clone, 'config', 'user.email', 'alex@acme.example');
    git(clone, 'config', 'user.name', 'Alex Rivera');
    git(clone, 'config', 'commit.gpgsign', 'false');
    for (const [path, body] of Object.entries(files)) {
        mkdirSync(dirname(join(clone, path)), { recursive: true });
        writeFileSync(join(clone, path), body, 'utf8');
    }
    git(clone, 'add', '-A');
    git(clone, 'commit', '-m', 'Initial commit');
    git(clone, 'push', '-u', 'origin', 'main');
    return clone;
}

const notesApi = makeRepo('notes-api', {
    'package.json': JSON.stringify(
        {
            name: 'notes-api',
            version: '0.1.0',
            type: 'module',
            private: true,
            scripts: { test: 'node --test' },
        },
        null,
        2,
    ) + '\n',
    'README.md':
        '# notes-api\n\nA tiny in-memory notes store used by the Acme Notes app.\n\n```bash\nnpm test\n```\n',
    'src/notes.js': `const notes = [];
let nextId = 1;

export function addNote(title, body = '', tags = []) {
    if (!title || !title.trim()) throw new Error('title is required');
    const note = { id: nextId++, title: title.trim(), body, tags, createdAt: new Date().toISOString() };
    notes.push(note);
    return note;
}

export function listNotes() {
    return [...notes];
}

export function getNote(id) {
    return notes.find((n) => n.id === id) ?? null;
}

export function deleteNote(id) {
    const i = notes.findIndex((n) => n.id === id);
    if (i === -1) return false;
    notes.splice(i, 1);
    return true;
}

export function resetNotes() {
    notes.length = 0;
    nextId = 1;
}
`,
    'test/notes.test.js': `import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addNote, listNotes, getNote, deleteNote, resetNotes } from '../src/notes.js';

beforeEach(() => resetNotes());

test('addNote stores a trimmed title', () => {
    const n = addNote('  Groceries  ');
    assert.equal(n.title, 'Groceries');
    assert.equal(listNotes().length, 1);
});

test('addNote rejects an empty title', () => {
    assert.throws(() => addNote('   '));
});

test('getNote and deleteNote', () => {
    const n = addNote('Ideas');
    assert.deepEqual(getNote(n.id), n);
    assert.equal(deleteNote(n.id), true);
    assert.equal(getNote(n.id), null);
});
`,
    '.gitignore': 'node_modules/\n',
});

const notesWeb = makeRepo('notes-web', {
    'package.json': JSON.stringify(
        {
            name: 'notes-web',
            version: '0.1.0',
            type: 'module',
            private: true,
            scripts: { test: 'node --test' },
        },
        null,
        2,
    ) + '\n',
    'README.md': '# notes-web\n\nStatic front end for Acme Notes.\n',
    'index.html': `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Acme Notes</title></head>
<body>
  <h1>Acme Notes</h1>
  <ul id="notes"></ul>
  <script type="module" src="./src/render.js"></script>
</body>
</html>
`,
    'src/render.js': `export function renderNote(note) {
    return \`<li data-id="\${note.id}">\${note.title}</li>\`;
}
`,
    'test/render.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNote } from '../src/render.js';

test('renderNote renders a list item', () => {
    assert.equal(renderNote({ id: 1, title: 'Hi' }), '<li data-id="1">Hi</li>');
});
`,
    '.gitignore': 'node_modules/\n',
});

await db
    .insertInto('projects')
    .values({
        id: PROJECT_ID,
        name: 'Acme Notes',
        issue_key_prefix: 'ACM',
        description: 'A small notes app: a JSON API and a static web front end.',
    })
    .execute();
await db.insertInto('project_issue_counters').values({ project_id: PROJECT_ID, last_seq: 0 }).execute();
await db
    .insertInto('project_repos')
    .values([
        {
            id: 'acme-notes-api',
            project_id: PROJECT_ID,
            name: 'notes-api',
            git_path: notesApi,
            git_url: '',
            default_branch: 'main',
            clone_status: 'ready',
            position: 0,
        },
        {
            id: 'acme-notes-web',
            project_id: PROJECT_ID,
            name: 'notes-web',
            git_path: notesWeb,
            git_url: '',
            default_branch: 'main',
            clone_status: 'ready',
            position: 1,
        },
    ])
    .execute();

await db.destroy();
console.log(`guide seed: project ${PROJECT_ID} with notes-api + notes-web under ${WORKSPACE}`);
