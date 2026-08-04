import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export type Version = [number, number, number];

export function parseVersion(output: string): Version | null {
    const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function meetsMinVersion(actual: Version, min: Version): boolean {
    for (let i = 0; i < 3; i++) {
        const a = actual[i] as number;
        const m = min[i] as number;
        if (a > m) return true;
        if (a < m) return false;
    }
    return true;
}

interface Check {
    name: string;
    cmd: string;
    args: string[];
    min?: Version;
    optional?: boolean;
}

const checks: Check[] = [
    // Use 'node' by name so shell resolution handles PATH; process.execPath may
    // contain spaces (e.g. C:\Program Files\nodejs\node.exe) which breaks shell:true on Windows.
    { name: 'node', cmd: 'node', args: ['--version'], min: [20, 0, 0] },
    { name: 'pnpm', cmd: 'pnpm', args: ['--version'], min: [9, 0, 0] },
    { name: 'docker', cmd: 'docker', args: ['--version'] },
    { name: 'git', cmd: 'git', args: ['--version'] },
    // Agent CLIs — all optional; Atlas only needs the one(s) your agents are
    // configured to use. `ollama` backs the third `cli` option: it does not
    // replace `claude` (Ollama drives the same binary), so a working Ollama
    // setup needs BOTH rows below to pass.
    { name: 'claude', cmd: 'claude', args: ['--version'], optional: true },
    { name: 'copilot', cmd: 'copilot', args: ['--version'], optional: true },
    { name: 'ollama', cmd: 'ollama', args: ['--version'], optional: true },
    { name: 'gh', cmd: 'gh', args: ['--version'], optional: true },
];

async function runCheck(c: Check): Promise<{ ok: boolean; line: string }> {
    try {
        // shell: true is required on Windows because pnpm (and claude, gh) are
        // .cmd shims that cannot be resolved by execFile with shell: false.
        const { stdout } = await execFileP(c.cmd, c.args, { timeout: 5_000, shell: true });
        const out = (stdout.trim().split('\n')[0] ?? '').trim();
        const v = parseVersion(out);
        if (c.min && (!v || !meetsMinVersion(v, c.min))) {
            return {
                ok: false,
                line: `[FAIL] ${c.name}: needs >= ${c.min.join('.')}, found "${out}"`,
            };
        }
        return { ok: true, line: `[ OK ] ${c.name}: ${out}` };
    } catch {
        return {
            ok: !!c.optional,
            line: c.optional
                ? `[skip] ${c.name}: not found (optional)`
                : `[FAIL] ${c.name}: not installed or not on PATH`,
        };
    }
}

async function main(): Promise<void> {
    const results = await Promise.all(checks.map(runCheck));
    for (const r of results) console.log(r.line);
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.error(`\n${failed.length} prerequisite(s) missing.`);
        console.error('See README.md -> Prerequisites for install links.');
        process.exit(1);
    }
    console.log('\nAll prerequisites satisfied. Run `pnpm dev` to start.');
}

// Run when invoked directly (tsx src/scripts/check-prereqs.ts).
// On Windows, import.meta.url is file:///C:/... (three slashes before drive
// letter), so we use the URL constructor to canonicalise both sides before
// comparing rather than string-building the file:// prefix manually.
const _selfUrl = import.meta.url;
const _argvUrl = process.argv[1]
    ? new URL(`file:///${process.argv[1].replace(/\\/g, '/').replace(/^\/+/, '')}`).href
    : '';
if (_selfUrl === _argvUrl) {
    void main();
}
