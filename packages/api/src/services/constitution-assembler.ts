// Constitution assembler — merges Atlas + project articles + scripts
// and writes the result to `.atlas/` inside the worktree.
//
// Replaces the constitution-assembly side of the retired Phase-1 stack
// (atlas-regen.ts) without dragging back dispatch tokens, work-item.json,
// or per-agent slash-command bodies. The agent reads the resulting
// constitution.md as part of its prompt AND from disk.
//
// Article merge: project rows override Atlas rows on `id` collision
// (matches the historical atlas-regen behaviour). Project-only fields
// (`title` + `body_md`) render under a `## Project-Specific Rules`
// heading by `buildConstitutionMarkdown` in `prompt-builder.ts`.
//
// Script merge: project rows override Atlas rows on `id` collision.
// Each merged row becomes a pair of files:
//   `.atlas/scripts/bash/check-<id>.sh`
//   `.atlas/scripts/powershell/check-<id>.ps1`

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
    IGuardrailScript,
    IProjectGuardrail,
    IProjectGuardrailScript,
} from '@atlas/shared';
import { guardrailsService } from './guardrails.js';
import { projectGuardrailsService } from './projectGuardrails.js';
import { guardrailScriptsService } from './guardrailScripts.js';
import { projectGuardrailScriptsService } from './projectGuardrailScripts.js';
import { buildConstitutionMarkdown } from './prompt-builder.js';

export interface AssembleConstitutionInput {
    /** Absolute path to the worktree root. The .atlas/ tree is written here. */
    worktreePath: string;
    /** When non-null, project-level guardrails + scripts are merged in. */
    projectId: string | null;
}

export interface AssembleConstitutionOutput {
    /** The same markdown also returned for prompt injection. */
    constitutionMarkdown: string;
    /** Absolute path of the written constitution.md. */
    constitutionPath: string;
    /** Absolute paths of every script file written (bash + powershell). */
    scriptPaths: string[];
}

interface MergedScript {
    id: string;
    body_sh: string;
    body_ps1: string;
}

export async function assembleConstitution(
    input: AssembleConstitutionInput,
): Promise<AssembleConstitutionOutput> {
    const [atlasArticles, atlasScripts, projectArticles, projectScripts] =
        await Promise.all([
            guardrailsService.list(),
            guardrailScriptsService.list(),
            input.projectId
                ? projectGuardrailsService.list(input.projectId)
                : Promise.resolve<IProjectGuardrail[]>([]),
            input.projectId
                ? projectGuardrailScriptsService.list(input.projectId)
                : Promise.resolve<IProjectGuardrailScript[]>([]),
        ]);

    const constitutionMarkdown = buildConstitutionMarkdown(atlasArticles, projectArticles);

    const atlasDir = join(input.worktreePath, '.atlas');
    const bashDir = join(atlasDir, 'scripts', 'bash');
    const psDir = join(atlasDir, 'scripts', 'powershell');
    mkdirSync(atlasDir, { recursive: true });
    mkdirSync(bashDir, { recursive: true });
    mkdirSync(psDir, { recursive: true });

    const constitutionPath = join(atlasDir, 'constitution.md');
    writeFileSync(constitutionPath, constitutionMarkdown, 'utf8');

    const mergedScripts = mergeScriptsById(atlasScripts, projectScripts);
    const scriptPaths: string[] = [];
    for (const script of mergedScripts) {
        const shPath = join(bashDir, `check-${script.id}.sh`);
        const psPath = join(psDir, `check-${script.id}.ps1`);
        const sh = script.body_sh.endsWith('\n') ? script.body_sh : script.body_sh + '\n';
        const ps = script.body_ps1.endsWith('\n') ? script.body_ps1 : script.body_ps1 + '\n';
        writeFileSync(shPath, sh, { encoding: 'utf8', mode: 0o755 });
        writeFileSync(psPath, ps, 'utf8');
        scriptPaths.push(shPath, psPath);
    }

    return { constitutionMarkdown, constitutionPath, scriptPaths };
}

function mergeScriptsById(
    atlas: IGuardrailScript[],
    project: IProjectGuardrailScript[],
): MergedScript[] {
    const byId = new Map<string, MergedScript>();
    for (const s of atlas) {
        byId.set(s.id, { id: s.id, body_sh: s.body_sh, body_ps1: s.body_ps1 });
    }
    for (const s of project) {
        byId.set(s.id, { id: s.id, body_sh: s.body_sh, body_ps1: s.body_ps1 });
    }
    return Array.from(byId.values());
}
