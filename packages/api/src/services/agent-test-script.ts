import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Owner's own check for an agent test (ADR 0023 amendment).
//
// Regex rules cover "never says X" and "never runs Y"; a script covers the
// rest — "every answer mentions a menu item", "no file outside src/ has a
// TODO". It gets the run's evidence as plain files and answers with its exit
// code, which is the same contract the guard-rail scripts already use.
//
// Same trust as a project's setup script: the Owner wrote it and it runs on
// the Owner's machine. It sees only the evidence folder, never the repo.
//
// ponytail: bash only. Add a `body_ps1` twin, as guard-rail scripts have, if a
// Windows host ever runs agent tests.

const TIMEOUT_MS = 60_000;
/** What a failure message quotes from the script's output. */
const OUTPUT_CAP = 1_000;

export interface ScriptEvidence {
    reply: string | null;
    commands: string[] | null;
    tool_calls: Array<{ name: string; input: Record<string, unknown> }> | null;
    files_changed: string[] | null;
    diff: string | null;
    outcome: { kind: string | null; summary: string; reason: string | null };
}

export type ScriptResult = { kind: 'passed' } | { kind: 'failed'; output: string } | { kind: 'errored'; reason: string };

export async function runTestScript(bodySh: string, evidence: ScriptEvidence): Promise<ScriptResult> {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-test-check-'));
    try {
        writeFileSync(join(dir, 'reply.txt'), evidence.reply ?? '');
        writeFileSync(join(dir, 'commands.txt'), (evidence.commands ?? []).join('\n'));
        writeFileSync(join(dir, 'tool_calls.json'), JSON.stringify(evidence.tool_calls ?? [], null, 2));
        writeFileSync(join(dir, 'files_changed.txt'), (evidence.files_changed ?? []).join('\n'));
        writeFileSync(join(dir, 'diff.patch'), evidence.diff ?? '');
        writeFileSync(join(dir, 'outcome.json'), JSON.stringify(evidence.outcome, null, 2));
        writeFileSync(join(dir, 'check.sh'), bodySh);

        return await new Promise<ScriptResult>((resolve) => {
            let out = '';
            const child = spawn('bash', ['check.sh'], { cwd: dir, windowsHide: true });
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                resolve({ kind: 'errored', reason: `the script ran past ${TIMEOUT_MS / 1000}s` });
            }, TIMEOUT_MS);
            const take = (chunk: Buffer) => {
                if (out.length < OUTPUT_CAP) out += chunk.toString('utf8');
            };
            child.stdout.on('data', take);
            child.stderr.on('data', take);
            child.on('error', (err) => {
                clearTimeout(timer);
                resolve({ kind: 'errored', reason: `could not run bash (${err.message})` });
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                const output = out.trim().slice(0, OUTPUT_CAP);
                resolve(code === 0 ? { kind: 'passed' } : { kind: 'failed', output: output || `exited ${code}` });
            });
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
