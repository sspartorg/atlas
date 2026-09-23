import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    MAX_LISTED_FILES,
    renderChangedFiles,
    resolveBaseRef,
    writeChangedFiles,
} from './changed-files.js';

const exec = promisify(execFile);

describe('renderChangedFiles', () => {
    it('lists committed paths with a readable verb per status code', () => {
        const out = renderChangedFiles({
            base: 'origin/main',
            committed: 'A\tsrc/new.ts\nM\tsrc/old.ts\nD\tsrc/gone.ts',
            stat: ' src/new.ts | 10 +\n 3 files changed, 10 insertions(+), 2 deletions(-)',
            dirty: '',
        });
        expect(out).toContain('`src/new.ts` — added');
        expect(out).toContain('`src/old.ts` — modified');
        expect(out).toContain('`src/gone.ts` — deleted');
        expect(out).toContain('Committed on this branch (3)');
        expect(out).toContain('**3 files changed, 10 insertions(+), 2 deletions(-)**');
    });

    it('reports the destination path of a rename, not the source', () => {
        // `--name-status` renders a rename as `R096<TAB>old<TAB>new`. The old
        // path no longer exists, so pointing an agent at it wastes a read.
        const out = renderChangedFiles({
            base: 'origin/main',
            committed: 'R096\tsrc/old-name.ts\tsrc/new-name.ts',
            stat: '',
            dirty: '',
        });
        expect(out).toContain('`src/new-name.ts` — renamed');
        expect(out).not.toContain('old-name.ts');
    });

    it('keeps an unknown status code verbatim rather than inventing a verb', () => {
        const out = renderChangedFiles({ base: 'origin/main', committed: 'X\tsrc/odd.ts', stat: '', dirty: '' });
        expect(out).toContain('`src/odd.ts` — X');
    });

    it('says so plainly when the branch has committed nothing', () => {
        const out = renderChangedFiles({ base: 'origin/main', committed: '', stat: '', dirty: '' });
        expect(out).toContain('_Nothing yet._');
    });

    it('caps the list and points at the command for the rest', () => {
        const many = Array.from({ length: MAX_LISTED_FILES + 25 }, (_, i) => `M\tsrc/f${i}.ts`).join('\n');
        const out = renderChangedFiles({ base: 'origin/main', committed: many, stat: '', dirty: '' });
        expect(out).toContain(`Committed on this branch (${MAX_LISTED_FILES + 25})`);
        expect(out).toContain('and 25 more');
        expect(out).toContain('git diff --name-status origin/main...HEAD');
        expect(out).not.toContain(`src/f${MAX_LISTED_FILES + 10}.ts`);
    });

    it('surfaces uncommitted work separately from committed work', () => {
        const out = renderChangedFiles({
            base: 'origin/main',
            committed: 'M\tsrc/done.ts',
            stat: '',
            dirty: ' M src/wip.ts\n?? src/untracked.ts',
        });
        expect(out).toContain('Uncommitted in the working tree (2)');
        expect(out).toContain('M src/wip.ts');
        expect(out).toContain('?? src/untracked.ts');
    });

    it('caps the uncommitted list too', () => {
        const many = Array.from({ length: MAX_LISTED_FILES + 5 }, (_, i) => ` M src/w${i}.ts`).join('\n');
        const out = renderChangedFiles({ base: 'origin/main', committed: '', stat: '', dirty: many });
        expect(out).toContain('and 5 more');
    });

    it('omits the stat summary when git produced no changed-file line', () => {
        const out = renderChangedFiles({ base: 'origin/main', committed: 'M\ta.ts', stat: 'nonsense', dirty: '' });
        expect(out).not.toContain('**nonsense**');
    });

    it('names the base ref so the agent knows what the diff is against', () => {
        const out = renderChangedFiles({ base: 'origin/develop', committed: '', stat: '', dirty: '' });
        expect(out).toContain('`origin/develop`');
    });
});

describe('writeChangedFiles (real git)', () => {
    let root: string;
    let upstream: string;
    let clone: string;

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'atlas-changed-files-'));
        upstream = join(root, 'upstream.git');
        clone = join(root, 'clone');

        const g = (cwd: string, args: string[]) => exec('git', args, { cwd });
        mkdirSync(upstream, { recursive: true });
        await exec('git', ['init', '--bare', '--initial-branch=main', upstream]);
        await exec('git', ['clone', upstream, clone]);
        await g(clone, ['config', 'user.email', 'test@example.com']);
        await g(clone, ['config', 'user.name', 'Test']);
        writeFileSync(join(clone, 'base.txt'), 'base\n');
        await g(clone, ['add', '-A']);
        await g(clone, ['commit', '-m', 'base']);
        await g(clone, ['push', 'origin', 'main']);

        await g(clone, ['checkout', '-b', 'feature']);
        writeFileSync(join(clone, 'added.txt'), 'new\n');
        writeFileSync(join(clone, 'base.txt'), 'changed\n');
        await g(clone, ['add', '-A']);
        await g(clone, ['commit', '-m', 'feature work']);
        // Leave one file uncommitted so both sections are exercised.
        writeFileSync(join(clone, 'wip.txt'), 'wip\n');
    }, 60_000);

    afterAll(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('resolves the base ref from the clone', async () => {
        const base = await resolveBaseRef(clone);
        expect(base).toMatch(/^origin\/(main|master)$/);
    });

    it('writes the diff summary into .atlas/', async () => {
        const path = await writeChangedFiles(clone);
        expect(path).toBe(join(clone, '.atlas', 'changed-files.md'));
        const body = readFileSync(path!, 'utf8');
        expect(body).toContain('`added.txt` — added');
        expect(body).toContain('`base.txt` — modified');
        expect(body).toContain('wip.txt');
        expect(body).toContain('files changed');
    });

    it('returns null for a repo with no remote rather than guessing a base', async () => {
        const solo = join(root, 'solo');
        mkdirSync(solo, { recursive: true });
        await exec('git', ['init', '--initial-branch=main', solo]);
        await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: solo });
        await exec('git', ['config', 'user.name', 'Test'], { cwd: solo });
        writeFileSync(join(solo, 'a.txt'), 'a\n');
        await exec('git', ['add', '-A'], { cwd: solo });
        await exec('git', ['commit', '-m', 'only'], { cwd: solo });

        expect(await resolveBaseRef(solo)).toBeNull();
        expect(await writeChangedFiles(solo)).toBeNull();
    });

    it('never throws when the path is not a repository at all', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const notARepo = join(root, 'empty');
        mkdirSync(notARepo, { recursive: true });
        // resolveBaseRef swallows its own git failures and reports "no base",
        // so this returns null without ever reaching the catch — the point is
        // that staging a run in a non-repo directory cannot fail the run.
        await expect(writeChangedFiles(notARepo)).resolves.toBeNull();
        warn.mockRestore();
    });
});
