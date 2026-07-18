import { execFile } from 'node:child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Theme 13 — E2E teardown. Reads the PID file dropped by
// global-setup.ts and SIGTERMs the api + web children. On Windows
// we shell out to `taskkill /T /F` so the whole process tree dies
// (`pnpm` → `node` → `vite` aren't all the same PID).

const REPO_ROOT = resolve(__dirname, '..');
const PID_FILE = join(REPO_ROOT, 'e2e-logs', 'pids.json');

interface PidFile {
    apiPid?: number;
    webPid?: number;
    platform?: NodeJS.Platform;
    skipped?: boolean;
}

async function killTree(pid: number, platform: NodeJS.Platform): Promise<void> {
    if (!pid) return;
    if (platform === 'win32') {
        try {
            await execFileP('taskkill', ['/PID', String(pid), '/T', '/F']);
        } catch {
            /* already dead */
        }
    } else {
        try {
            process.kill(pid, 'SIGTERM');
            await new Promise((r) => setTimeout(r, 1500));
            // Force-kill if still alive.
            try {
                process.kill(pid, 0);
                process.kill(pid, 'SIGKILL');
            } catch {
                /* already gone */
            }
        } catch {
            /* already dead */
        }
    }
}

export default async function globalTeardown(): Promise<void> {
    if (!existsSync(PID_FILE)) return;
    let pids: PidFile;
    try {
        pids = JSON.parse(readFileSync(PID_FILE, 'utf8'));
    } catch {
        return;
    }
    if (pids.skipped) return;
    const platform = pids.platform ?? process.platform;
    if (pids.apiPid) await killTree(pids.apiPid, platform);
    if (pids.webPid) await killTree(pids.webPid, platform);
}
