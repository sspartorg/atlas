import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageArgs } from './atlas-artifacts.js';

// Real git, real files: the test proves what a commit would contain, which is
// the thing that leaked.
let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'atlas-artifacts-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    writeFileSync(join(repo, 'README.md'), 'base\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('stageArgs', () => {
    it('stages product changes and leaves spec and QA artifacts out of the commit', () => {
        writeFileSync(join(repo, 'app.js'), 'code\n');
        mkdirSync(join(repo, 'specs', 'one'), { recursive: true });
        writeFileSync(join(repo, 'specs', 'one', 'spec.md'), '# spec\n');
        mkdirSync(join(repo, 'tests', 'qa'), { recursive: true });
        writeFileSync(join(repo, 'tests', 'qa', 'APL-9.csv'), 'case\n');

        git(...stageArgs());
        const staged = git('diff', '--cached', '--name-only').trim().split('\n');
        expect(staged).toEqual(['app.js']);
    });

    it('keeps an artifact out even when it was already tracked and then edited', () => {
        mkdirSync(join(repo, 'specs'), { recursive: true });
        writeFileSync(join(repo, 'specs', 'spec.md'), 'v1\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'track spec');
        writeFileSync(join(repo, 'specs', 'spec.md'), 'v2\n');
        writeFileSync(join(repo, 'app.js'), 'code\n');

        git(...stageArgs());
        expect(git('diff', '--cached', '--name-only').trim().split('\n')).toEqual(['app.js']);
        expect(readFileSync(join(repo, 'specs', 'spec.md'), 'utf8')).toBe('v2\n');
    });
});
