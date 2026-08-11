// node-pty ships a prebuilt `spawn-helper` binary that every PTY spawn on
// macOS/Linux execs (see node-pty/lib/unixTerminal.js: `helperPath =
// native.dir + '/spawn-helper'`). pnpm's tarball extraction drops the
// execute bit, so posix_spawnp returns EACCES and node-pty reports the
// famously unhelpful "posix_spawnp failed." — every Terminal session and
// agent run fails with `{"kind":"internal_error"}` regardless of which CLI
// was picked.
//
// Restore the bit after each install. No-op on Windows, which uses
// conpty.node and has no spawn-helper.
import { chmodSync, readdirSync } from 'node:fs';

const base = 'node_modules/.pnpm';
let fixed = 0;
try {
    for (const pkg of readdirSync(base).filter((d) => d.startsWith('node-pty@'))) {
        const prebuilds = `${base}/${pkg}/node_modules/node-pty/prebuilds`;
        for (const platform of readdirSync(prebuilds)) {
            try {
                chmodSync(`${prebuilds}/${platform}/spawn-helper`, 0o755);
                fixed++;
            } catch {
                // win32-* prebuilds have no spawn-helper. Nothing to fix.
            }
        }
    }
} catch {
    // No node_modules/.pnpm yet, or no node-pty installed. Nothing to fix.
}
if (fixed > 0) console.log(`[fix-pty-helper] chmod +x on ${fixed} spawn-helper binaries`);
