import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stages Atlas's own gate probes into `<worktree>/.atlas/probes/`.
//
// `gate-perf` and `gate-visual` used to delegate entirely to a script the
// project declared, and skip when there wasn't one — so the 100ms/200ms budgets
// and the cross-viewport checking were enforced only on projects that had
// already built that tooling themselves, which is precisely the set that needed
// it least. These are the harness for everyone else.
//
// Real `.mjs` files rather than more `guardrail_scripts` bodies: they are
// several hundred lines each, they are the kind of code that wants a debugger,
// and a shell script embedded in a TypeScript template literal is the worst
// place in this repo to put anything non-trivial. The guardrail scripts stay as
// the thin, project-aware layer that decides WHETHER to invoke them.

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Source dir. Resolved relative to this file so it works from src and dist. */
const PROBES_DIR = join(__dirname, '..', 'marketplace', 'probes');

export function assembleProbes(worktreePath: string): string[] {
    if (!existsSync(PROBES_DIR)) return [];
    const target = join(worktreePath, '.atlas', 'probes');
    mkdirSync(target, { recursive: true });
    const written: string[] = [];
    for (const name of readdirSync(PROBES_DIR)) {
        if (!name.endsWith('.mjs')) continue;
        const dest = join(target, name);
        copyFileSync(join(PROBES_DIR, name), dest);
        written.push(dest);
    }
    return written;
}
