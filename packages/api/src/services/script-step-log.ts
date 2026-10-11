import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// A Script step's output, kept where the next agent can read it.
//
// Every run of a Script step writes its full (redacted) output to
// `<root>/.atlas/checks/<step>[-<repo>].log`, replacing the previous run's
// file, and appends one line to `.atlas/checks/index.md` so the history of a
// loop reads top to bottom. A fixer or reviewer is pointed at the index and
// opens only the log it needs, instead of the whole output being pasted into its
// prompt on every turn.
//
// `root` is the run's workspace when the Task spans several repos, otherwise
// the one repo checkout. Both are per-run and Atlas-owned (`.atlas/` is kept out
// of commits by the worktree orchestrator).

export interface ScriptStepLogEntry {
    /** Stable id of the step in the graph. Used in the file name. */
    stepId: string;
    /** The Owner's label for the step, shown in the index. */
    stepLabel: string;
    /** Repo name when the Task has several repos; omitted for one. */
    repoName?: string | undefined;
    command: string;
    verdict: string;
    exitCode?: number | undefined;
    /** Whole redacted output, already capped by the runner. */
    log: string;
}

const CHECKS_DIR = join('.atlas', 'checks');

/** `Build step!` → `build-step`. Keeps file names readable and path-safe. */
export function slugify(text: string): string {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return slug || 'step';
}

/** Relative (to `root`) path of a step's log, as the index and comments cite it. */
export function checkLogPath(entry: Pick<ScriptStepLogEntry, 'stepId' | 'stepLabel' | 'repoName'>): string {
    const base = slugify(entry.stepLabel || entry.stepId);
    const repo = entry.repoName ? `-${slugify(entry.repoName)}` : '';
    return join(CHECKS_DIR, `${base}${repo}.log`).split('\\').join('/');
}

export async function writeScriptStepLog(root: string, entry: ScriptStepLogEntry): Promise<string> {
    const dir = join(root, CHECKS_DIR);
    await mkdir(dir, { recursive: true });
    const rel = checkLogPath(entry);
    const header =
        `# ${entry.stepLabel}${entry.repoName ? ` (${entry.repoName})` : ''}\n` +
        `command: ${entry.command}\n` +
        `verdict: ${entry.verdict}${entry.exitCode !== undefined ? ` (exit ${entry.exitCode})` : ''}\n` +
        `written: ${new Date().toISOString()}\n\n`;
    await writeFile(join(root, rel), header + entry.log, 'utf8');

    const line =
        `- ${new Date().toISOString()} · **${entry.stepLabel}**` +
        `${entry.repoName ? ` · ${entry.repoName}` : ''} · ${entry.verdict}` +
        `${entry.exitCode !== undefined ? ` (exit ${entry.exitCode})` : ''} · \`${rel}\`\n`;
    await appendFile(join(root, CHECKS_DIR, 'index.md'), line, 'utf8');
    return rel;
}
