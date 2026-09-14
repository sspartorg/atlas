import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENT_CLIS, type ICliAvailability } from '@atlas/shared';
import { resolveCliBinary } from './cli-session-host.js';

const execFileP = promisify(execFile);
const CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 3_000;

let cache: { at: number; value: Promise<ICliAvailability[]> } | null = null;

async function probe(binary: string): Promise<{ available: boolean; version: string | null }> {
    try {
        // Array-form args, no shell on POSIX. Windows needs one: the CLIs
        // install as `.cmd` shims, which execFile cannot launch without
        // cmd.exe (same constraint as scripts/check-prereqs.ts).
        const { stdout } = await execFileP(binary, ['--version'], {
            timeout: PROBE_TIMEOUT_MS,
            shell: process.platform === 'win32',
            windowsHide: true,
        });
        return { available: true, version: stdout.split('\n')[0]?.trim() || null };
    } catch {
        return { available: false, version: null };
    }
}

/**
 * Whether each agent CLI's binary runs on this host. Resolved through the
 * same `resolveCliBinary` the PTY host spawns with, so `ollama` probes the
 * Claude binary and the ATLAS_*_BINARY overrides apply. The in-flight
 * promise is cached so concurrent callers share one round of spawns.
 */
export function getCliAvailability(): Promise<ICliAvailability[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
    const value = Promise.all(
        AGENT_CLIS.map(async (cli) => {
            const binary = resolveCliBinary(cli);
            return { cli, binary, ...(await probe(binary)) };
        }),
    );
    cache = { at: Date.now(), value };
    return value;
}

export function __resetCliAvailabilityCacheForTest(): void {
    cache = null;
}
