#!/usr/bin/env node
// 2026-06-22 - Terminal v1 fake-claude binary for Playwright E2E.
//
// The Atlas cli-session-host spawns whatever `ATLAS_CLAUDE_BINARY`
// resolves to as a PTY child. The real claude is interactive +
// authenticated; this stand-in just lets the host code drive the full
// session lifecycle (Start -> Pause -> Resume -> Stop) without burning
// real API credits or needing the user's Anthropic auth.
//
// What it does:
//   - Prints a deterministic greeting so the xterm pane fills with
//     bytes the test can assert on.
//   - On `--session-id <uuid>`: writes a tiny JSONL transcript at
//     ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl with a couple of
//     turn records so `claude --resume <uuid>` has something to read.
//   - On `--resume <uuid>`: echoes "Resuming session ..." then
//     re-enters the same read-loop.
//   - Reads stdin in a loop; on EOF (PTY killed) or `/exit\n`, exits 0.
//
// Everything is best-effort. Errors are logged to stderr and the
// process exits 0 anyway -- a stand-in that bricks the test suite
// because of a Windows path edge case helps nobody.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
let sessionId = null;
let resumeId = null;
let model = 'fake-model';
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--session-id' && i + 1 < args.length) {
        sessionId = args[i + 1];
        i++;
    } else if (a === '--resume' && i + 1 < args.length) {
        resumeId = args[i + 1];
        i++;
    } else if (a === '--model' && i + 1 < args.length) {
        model = args[i + 1];
        i++;
    }
}

const cwd = process.cwd();
const greeting = resumeId
    ? `[fake-claude] resuming session ${resumeId} (model=${model})\r\n`
    : `[fake-claude] new session ${sessionId ?? '(no id)'} (model=${model})\r\n`;
process.stdout.write(greeting);

function encodeCwd(p) {
    return p.replace(/[:\\/]/g, '-').replace(/^-+/, '');
}

const claudeSid = sessionId ?? resumeId;
if (claudeSid) {
    try {
        const projectDir = join(homedir(), '.claude', 'projects', encodeCwd(cwd));
        mkdirSync(projectDir, { recursive: true });
        const jsonlPath = join(projectDir, `${claudeSid}.jsonl`);
        const transcript = [
            JSON.stringify({
                type: 'user',
                sessionId: claudeSid,
                cwd,
                message: { role: 'user', content: '[fake] kickoff' },
            }),
            JSON.stringify({
                type: 'assistant',
                sessionId: claudeSid,
                cwd,
                message: { role: 'assistant', content: '[fake] hello from fake claude' },
            }),
        ].join('\n') + '\n';
        writeFileSync(jsonlPath, transcript, { encoding: 'utf8', flag: resumeId ? 'a' : 'w' });
    } catch (err) {
        process.stderr.write(`[fake-claude] JSONL write failed: ${err.message}\r\n`);
    }
}

process.stdout.write('[fake-claude] ready -- type /exit to end\r\n');

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);
        if (line === '/exit') {
            process.stdout.write('[fake-claude] exiting\r\n');
            process.exit(0);
        }
        process.stdout.write(`[fake-claude] echo: ${line}\r\n`);
    }
});
process.stdin.on('end', () => {
    process.exit(0);
});

// Keep the process alive even if stdin paused (PTY mode).
setInterval(() => {}, 1_000).unref();
