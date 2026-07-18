import { describe, expect, it, beforeEach, afterAll, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { assembleConstitution } from './constitution-assembler.js';
import { guardrailsService } from './guardrails.js';
import { guardrailScriptsService } from './guardrailScripts.js';
import { projectGuardrailsService } from './projectGuardrails.js';
import { projectGuardrailScriptsService } from './projectGuardrailScripts.js';
import { runSeed, GUARDRAIL_SCRIPT_SEEDS } from '../db/seed.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

let worktreePath: string;
const cleanupDirs: string[] = [];

function makeWorktree(): string {
    const p = mkdtempSync(join(tmpdir(), 'atlas-assemble-test-'));
    cleanupDirs.push(p);
    return p;
}

beforeEach(async () => {
    await truncateAll();
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
    await closeTestDb();
});

describe('assembleConstitution', () => {
    it('writes constitution.md to .atlas/ with only Atlas articles when projectId is null', async () => {
        await guardrailsService.create({
            category: 'file_system',
            rule_text: 'No deletes outside repo',
            detail: null,
            severity: 'block',
        });

        const result = await assembleConstitution({ worktreePath, projectId: null });

        expect(result.constitutionPath).toBe(join(worktreePath, '.atlas', 'constitution.md'));
        expect(existsSync(result.constitutionPath)).toBe(true);
        const body = readFileSync(result.constitutionPath, 'utf8');
        expect(body).toContain('# Atlas Constitution');
        expect(body).toContain('No deletes outside repo');
        expect(body).not.toContain('## Project-Specific Rules');
    });

    it('merges project articles under a `## Project-Specific Rules` section when projectId is set', async () => {
        const projectId = await insertProject('p-assemble-1');
        await guardrailsService.create({
            category: 'file_system',
            rule_text: 'No deletes outside repo',
            detail: null,
            severity: 'block',
        });
        await projectGuardrailsService.create(projectId, {
            title: 'spec.md must not contain npm install',
            body_md: 'Library installs belong in package.json, not the spec.',
        });

        const result = await assembleConstitution({ worktreePath, projectId });
        const body = readFileSync(result.constitutionPath, 'utf8');

        expect(body).toContain('## Project-Specific Rules');
        expect(body).toContain('spec.md must not contain npm install');
        expect(body).toContain('Library installs belong in package.json');
        // Atlas article still present
        expect(body).toContain('No deletes outside repo');
    });

    it('skips disabled project articles', async () => {
        const projectId = await insertProject('p-assemble-2');
        await projectGuardrailsService.create(projectId, {
            title: 'Enabled rule',
            body_md: '',
            enabled: 1,
        });
        await projectGuardrailsService.create(projectId, {
            title: 'Disabled rule',
            body_md: '',
            enabled: 0,
        });

        const result = await assembleConstitution({ worktreePath, projectId });
        const body = readFileSync(result.constitutionPath, 'utf8');

        expect(body).toContain('Enabled rule');
        expect(body).not.toContain('Disabled rule');
    });

    it('writes atlas scripts as bash + powershell pairs under .atlas/scripts/', async () => {
        const script = await guardrailScriptsService.create({
            id: 'no-npm-install',
            name: 'no-npm-install',
            description: 'Block npm install in spec.md',
            body_sh: '#!/bin/bash\necho "checking"\nexit 0',
            body_ps1: 'Write-Host "checking"; exit 0',
        });

        const result = await assembleConstitution({ worktreePath, projectId: null });

        const shPath = join(worktreePath, '.atlas', 'scripts', 'bash', `check-${script.id}.sh`);
        const psPath = join(
            worktreePath,
            '.atlas',
            'scripts',
            'powershell',
            `check-${script.id}.ps1`,
        );
        expect(existsSync(shPath)).toBe(true);
        expect(existsSync(psPath)).toBe(true);
        expect(readFileSync(shPath, 'utf8')).toContain('#!/bin/bash');
        expect(readFileSync(psPath, 'utf8')).toContain('Write-Host');
        expect(result.scriptPaths).toEqual(expect.arrayContaining([shPath, psPath]));
    });

    it('writes project scripts alongside atlas scripts', async () => {
        const projectId = await insertProject('p-assemble-3');
        const atlasScript = await guardrailScriptsService.create({
            id: 'atlas-only',
            name: 'atlas-only',
            description: '',
            body_sh: 'echo atlas',
            body_ps1: 'Write-Host atlas',
        });
        const projectScript = await projectGuardrailScriptsService.create(projectId, {
            id: 'project-only',
            name: 'project-only',
            description: '',
            body_sh: 'echo project',
            body_ps1: 'Write-Host project',
        });

        await assembleConstitution({ worktreePath, projectId });

        const bashDir = join(worktreePath, '.atlas', 'scripts', 'bash');
        const files = readdirSync(bashDir).sort();
        expect(files).toEqual(
            [`check-${atlasScript.id}.sh`, `check-${projectScript.id}.sh`].sort(),
        );
    });

    it('project script body overrides atlas script body when ids collide', async () => {
        const projectId = await insertProject('p-assemble-4');
        // Force an id collision by manually constructing a project script with
        // the same id as a atlas one. Both layers share `id` as the natural
        // join key; project entries override atlas entries with the same id.
        const atlasScript = await guardrailScriptsService.create({
            id: 'shared',
            name: 'shared',
            description: '',
            body_sh: 'echo atlas-body',
            body_ps1: 'Write-Host atlas-body',
        });
        // Direct insert with the same id as atlasScript.id to simulate the
        // override path (which the merge code resolves project-wins by id).
        const { testDb } = await import('../../tests/_pg-db.js');
        await testDb
            .insertInto('project_guardrail_scripts')
            .values({
                id: atlasScript.id,
                project_id: projectId,
                name: 'shared',
                description: '',
                body_sh: 'echo project-body',
                body_ps1: 'Write-Host project-body',
                sort_order: 0,
            })
            .execute();

        await assembleConstitution({ worktreePath, projectId });

        const shPath = join(worktreePath, '.atlas', 'scripts', 'bash', `check-${atlasScript.id}.sh`);
        expect(readFileSync(shPath, 'utf8')).toContain('project-body');
        expect(readFileSync(shPath, 'utf8')).not.toContain('atlas-body');
    });

    it('returns the same markdown that lands on disk', async () => {
        await guardrailsService.create({
            category: 'file_system',
            rule_text: 'sentinel rule',
            detail: null,
            severity: 'block',
        });

        const result = await assembleConstitution({ worktreePath, projectId: null });
        const onDisk = readFileSync(result.constitutionPath, 'utf8');
        expect(result.constitutionMarkdown).toBe(onDisk);
    });
});

// Phase 3 smoke — after `runSeed` populates the 6 per-agent validators
// in `guardrail_scripts`, `assembleConstitution` must write each one to
// both `.atlas/scripts/bash/check-<id>.sh` (mode 0o755) and
// `.atlas/scripts/powershell/check-<id>.ps1`.
describe('assembleConstitution — Phase 3 per-agent validators on disk', () => {
    it('writes all 6 seeded validator scripts into the worktree', async () => {
        await runSeed();
        await assembleConstitution({ worktreePath, projectId: null });

        const bashDir = join(worktreePath, '.atlas', 'scripts', 'bash');
        const psDir = join(worktreePath, '.atlas', 'scripts', 'powershell');
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            const sh = join(bashDir, `check-${seed.id}.sh`);
            const ps = join(psDir, `check-${seed.id}.ps1`);
            expect(existsSync(sh), `${sh} should exist`).toBe(true);
            expect(existsSync(ps), `${ps} should exist`).toBe(true);
            // Body round-trip — what we seeded is what landed on disk
            // (plus trailing newline if the body didn't end in one).
            expect(readFileSync(sh, 'utf8').startsWith(seed.body_sh.split('\n')[0]!)).toBe(true);
            expect(readFileSync(ps, 'utf8').startsWith(seed.body_ps1.split('\n')[0]!)).toBe(true);
        }
    });

    it('sets the bash script mode to 0o755 (executable)', async () => {
        await runSeed();
        await assembleConstitution({ worktreePath, projectId: null });

        // POSIX mode bits aren't honoured by NTFS — Windows reports
        // 0o666 on every file. Skip the mode assertion off-Linux/macOS
        // but keep the existence check above as a portable smoke.
        if (platform() === 'win32') return;
        const shPath = join(worktreePath, '.atlas', 'scripts', 'bash', 'check-prereqs.sh');
        const mode = statSync(shPath).mode & 0o777;
        expect(mode).toBe(0o755);
    });
});

// CA-EXTRA — branch coverage gaps for the `endsWith('\n')` true arm in
// the script-writing loop (lines 86-87 of constitution-assembler.ts).
// All existing tests seed scripts WITHOUT a trailing newline, so the
// `script.body_sh + '\n'` false arm fires. Seeding a script that already
// ends in '\n' exercises the true arm (body passes through unchanged).
describe('assembleConstitution — trailing-newline pass-through (CA-EXTRA)', () => {
    it('passes through body_sh/body_ps1 unchanged when they already end with \\n', async () => {
        await guardrailScriptsService.create({
            id: 'has-trailing-newline',
            name: 'has-trailing-newline',
            description: 'Script body that already ends in newline',
            body_sh: '#!/bin/bash\necho "atlas"\n',
            body_ps1: 'Write-Host "atlas"\n',
        });

        await assembleConstitution({ worktreePath, projectId: null });

        const shPath = join(worktreePath, '.atlas', 'scripts', 'bash', 'check-has-trailing-newline.sh');
        const content = readFileSync(shPath, 'utf8');
        // Body already ends in \n — must NOT get a doubled newline.
        expect(content.endsWith('\n\n')).toBe(false);
        expect(content.endsWith('\n')).toBe(true);
        expect(content).toContain('echo "atlas"');
    });
});
