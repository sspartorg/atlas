import { describe, expect, it, beforeEach, afterAll, afterEach } from 'vitest';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
    existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleTemplates } from './templates-assembler.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

let worktreePath: string;
const cleanupDirs: string[] = [];

function makeWorktree(): string {
    const p = mkdtempSync(join(tmpdir(), 'atlas-templates-test-'));
    cleanupDirs.push(p);
    return p;
}

async function insertTemplate(input: {
    id: string;
    filename: string;
    body_md: string;
    description?: string;
}): Promise<void> {
    await testDb
        .insertInto('agent_templates')
        .values({
            id: input.id,
            filename: input.filename,
            body_md: input.body_md,
            description: input.description ?? '',
        })
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    // `agent_templates` isn't on the TRUNCATE_TABLES list — its rows are
    // a small static catalog. Wipe explicitly so each test starts clean.
    await testDb.deleteFrom('agent_templates').execute();
    worktreePath = makeWorktree();
});

afterEach(() => {
    while (cleanupDirs.length > 0) {
        const p = cleanupDirs.pop()!;
        try {
            rmSync(p, { recursive: true, force: true });
        } catch {
            // ignore — tmpdir cleanup is best-effort
        }
    }
});

afterAll(async () => {
    await testDb.deleteFrom('agent_templates').execute();
    await closeTestDb();
});

describe('assembleTemplates', () => {
    it('writes every agent_templates row to .atlas/templates/<filename>', async () => {
        await insertTemplate({ id: 'spec', filename: 'spec.md', body_md: '# Spec\nhello' });
        await insertTemplate({ id: 'plan', filename: 'plan.md', body_md: '# Plan\nworld' });

        const result = await assembleTemplates({ worktreePath });

        const specPath = join(worktreePath, '.atlas', 'templates', 'spec.md');
        const planPath = join(worktreePath, '.atlas', 'templates', 'plan.md');
        expect(existsSync(specPath)).toBe(true);
        expect(existsSync(planPath)).toBe(true);
        expect(readFileSync(specPath, 'utf8')).toBe('# Spec\nhello');
        expect(readFileSync(planPath, 'utf8')).toBe('# Plan\nworld');
        expect(result.templatePaths).toEqual(expect.arrayContaining([specPath, planPath]));
    });

    it('writes non-markdown filenames as-is (e.g. qa-plan.csv)', async () => {
        await insertTemplate({
            id: 'qa-plan',
            filename: 'qa-plan.csv',
            body_md: 'col1,col2\nrow1a,row1b\n',
        });

        await assembleTemplates({ worktreePath });

        const csvPath = join(worktreePath, '.atlas', 'templates', 'qa-plan.csv');
        expect(readFileSync(csvPath, 'utf8')).toBe('col1,col2\nrow1a,row1b\n');
    });

    it('wipes stale files from .atlas/templates/ before writing the new set', async () => {
        // Pre-populate the templates dir with a stale file from a prior
        // run. The assembler must remove it before writing the current
        // row set.
        const templatesDir = join(worktreePath, '.atlas', 'templates');
        mkdirSync(templatesDir, { recursive: true });
        const stale = join(templatesDir, 'old-deleted-template.md');
        writeFileSync(stale, 'this should be wiped', 'utf8');
        expect(existsSync(stale)).toBe(true);

        await insertTemplate({ id: 'spec', filename: 'spec.md', body_md: '# Spec' });

        await assembleTemplates({ worktreePath });

        expect(existsSync(stale)).toBe(false);
        const files = readdirSync(templatesDir).sort();
        expect(files).toEqual(['spec.md']);
    });

    it('produces an empty .atlas/templates/ when agent_templates is empty', async () => {
        const result = await assembleTemplates({ worktreePath });

        const templatesDir = join(worktreePath, '.atlas', 'templates');
        expect(existsSync(templatesDir)).toBe(true);
        const files = readdirSync(templatesDir);
        expect(files).toEqual([]);
        expect(result.templatePaths).toEqual([]);
    });

    it('returns absolute paths matching the on-disk files', async () => {
        await insertTemplate({ id: 'story', filename: 'story.md', body_md: '# Story' });

        const result = await assembleTemplates({ worktreePath });

        expect(result.templatePaths).toHaveLength(1);
        const [path] = result.templatePaths;
        expect(path).toBe(join(worktreePath, '.atlas', 'templates', 'story.md'));
        expect(readFileSync(path!, 'utf8')).toBe('# Story');
    });

    it('wipes nested directories under .atlas/templates/ (rmSync recursive branch)', async () => {
        const templatesDir = join(worktreePath, '.atlas', 'templates');
        mkdirSync(templatesDir, { recursive: true });
        // Make a stale subdirectory containing a file — rmSync must remove it
        // recursively per the `recursive: true` option in the wipe path.
        const staleDir = join(templatesDir, 'old-subdir');
        mkdirSync(staleDir);
        writeFileSync(join(staleDir, 'file.md'), 'data', 'utf8');

        await insertTemplate({ id: 'plan', filename: 'plan.md', body_md: '# Plan' });
        await assembleTemplates({ worktreePath });

        expect(existsSync(staleDir)).toBe(false);
        expect(existsSync(join(templatesDir, 'plan.md'))).toBe(true);
    });
});
