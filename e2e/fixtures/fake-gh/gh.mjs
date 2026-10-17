// A stand-in for the GitHub CLI on the e2e API's PATH (global-setup.ts), so a
// workflow's "open a PR" step never reaches api.github.com. `pr create` in a
// checkout of a fake GitHub repo (helpers/fake-github.ts) answers like gh does
// — the new PR's URL on the last line — and appends the call to
// <FAKE_GITHUB_DIR>/gh-calls.jsonl for specs to read. Everything else exits 1,
// as gh does offline (e.g. `pr view` for a PR link's title → no title).

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = join(tmpdir(), 'atlas-e2e-github');
if (args[0] === '--version') {
    process.stdout.write('gh version 0.0.0 (atlas e2e fake)\n');
    process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
    let origin = '';
    try {
        origin = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    } catch {
        /* not a checkout */
    }
    // get-url applies the insteadOf rule, so the origin may read as the file:// bare repo.
    const m = /\/(atlas-e2e\/[^/]+?)(?:\.git)?$/.exec(origin);
    if (m) {
        const flag = (f) => args[args.indexOf(f) + 1] ?? '';
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, 'gh-calls.jsonl'), JSON.stringify({ repo: m[1], head: flag('--head'), base: flag('--base'), title: flag('--title'), cwd: process.cwd() }) + '\n');
        process.stdout.write(`https://github.com/${m[1]}/pull/1\n`);
        process.exit(0);
    }
}
process.stderr.write(`fake gh (e2e): offline, ${args.slice(0, 2).join(' ')} not available\n`);
process.exit(1);
