import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLogPath, slugify, writeScriptStepLog } from './script-step-log.js';

// Each Script step leaves its full output where a fixer can read it, and an
// index that lists every run in order so a loop reads top to bottom.

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'atlas-script-log-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('slugify', () => {
    it('makes file-name-safe slugs', () => {
        expect(slugify('Build step!')).toBe('build-step');
        expect(slugify('  Tests / unit  ')).toBe('tests-unit');
        expect(slugify('!!!')).toBe('step');
    });
});

describe('checkLogPath', () => {
    it('names one log per step, and per repo when the Task has several', () => {
        expect(checkLogPath({ stepId: 'n1', stepLabel: 'Build' })).toBe('.atlas/checks/build.log');
        expect(checkLogPath({ stepId: 'n1', stepLabel: 'Build', repoName: 'web' })).toBe('.atlas/checks/build-web.log');
    });
});

describe('writeScriptStepLog', () => {
    it('writes the whole output to the step log and appends one line to the index', async () => {
        const rel = await writeScriptStepLog(root, {
            stepId: 'n1',
            stepLabel: 'Build',
            command: 'npm run build',
            verdict: 'fail',
            exitCode: 2,
            log: 'line one\nline two',
        });

        expect(rel).toBe('.atlas/checks/build.log');
        const body = await readFile(join(root, rel), 'utf8');
        expect(body).toContain('command: npm run build');
        expect(body).toContain('verdict: fail (exit 2)');
        expect(body.endsWith('line one\nline two')).toBe(true);

        const index = await readFile(join(root, '.atlas/checks/index.md'), 'utf8');
        expect(index).toContain('**Build**');
        expect(index).toContain('fail (exit 2)');
        expect(index).toContain('`.atlas/checks/build.log`');
    });

    it('replaces the step log on a re-run but keeps every line of the index', async () => {
        const entry = { stepId: 'n1', stepLabel: 'Tests', command: 'npm test', verdict: 'fail', log: 'red' };
        await writeScriptStepLog(root, entry);
        await writeScriptStepLog(root, { ...entry, verdict: 'pass', log: 'green' });

        const body = await readFile(join(root, '.atlas/checks/tests.log'), 'utf8');
        expect(body).toContain('green');
        expect(body).not.toContain('red');

        const index = (await readFile(join(root, '.atlas/checks/index.md'), 'utf8')).trim().split('\n');
        expect(index).toHaveLength(2);
        expect(index[0]).toContain('fail');
        expect(index[1]).toContain('pass');
    });

    it('keeps each repo of a multi-repo Task in its own log', async () => {
        await writeScriptStepLog(root, { stepId: 'n1', stepLabel: 'Build', repoName: 'api', command: 'make', verdict: 'pass', log: 'a' });
        await writeScriptStepLog(root, { stepId: 'n1', stepLabel: 'Build', repoName: 'web', command: 'npm run build', verdict: 'fail', log: 'w' });

        expect(await readFile(join(root, '.atlas/checks/build-api.log'), 'utf8')).toContain('\na');
        expect(await readFile(join(root, '.atlas/checks/build-web.log'), 'utf8')).toContain('\nw');
    });
});
