#!/usr/bin/env node
// 2026-06-25 - Terminal v1 fake-copilot binary for Playwright E2E.
//
// Mirrors fake-claude.js but emits `[fake-copilot]` markers so specs can
// distinguish which CLI was actually spawned. The Atlas cli-session-host
// resolves the copilot binary from ATLAS_COPILOT_BINARY (see
// services/cli-session-host.ts:resolveCliBinary). Without this fixture
// the e2e stack falls back to the bare string `copilot` and tries to
// invoke the real binary -- which isn't installed on CI runners.
//
// What it does (same shape as fake-claude.js):
//   - Prints a deterministic greeting so the xterm pane fills with bytes
//     the test can assert on.
//   - On `--session-id <uuid>`: writes a tiny JSONL transcript at
//     ~/.copilot/sessions/<encoded-cwd>/<uuid>.jsonl with a couple of
//     turn records so a future copilot --resume has something to read.
//   - On `--resume <uuid>`: echoes "Resuming session ..." then re-enters
//     the same read-loop.
//   - Reads stdin in a loop; on EOF (PTY killed) or `/exit\n`, exits 0.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
let sessionId = null;
let resumeId = null;
let model = 'fake-copilot-model';
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
    ? `[fake-copilot] resuming session ${resumeId} (model=${model})\r\n`
    : `[fake-copilot] new session ${sessionId ?? '(no id)'} (model=${model})\r\n`;
process.stdout.write(greeting);

function encodeCwd(p) {
    return p.replace(/[:\\/]/g, '-').replace(/^-+/, '');
}

const sid = sessionId ?? resumeId;
if (sid) {
    try {
        const projectDir = join(homedir(), '.copilot', 'sessions', encodeCwd(cwd));
        mkdirSync(projectDir, { recursive: true });
        const jsonlPath = join(projectDir, `${sid}.jsonl`);
        const transcript = [
            JSON.stringify({
                type: 'user',
                sessionId: sid,
                cwd,
                message: { role: 'user', content: '[fake] kickoff' },
            }),
            JSON.stringify({
                type: 'assistant',
                sessionId: sid,
                cwd,
                message: { role: 'assistant', content: '[fake] hello from fake copilot' },
            }),
        ].join('\n') + '\n';
        writeFileSync(jsonlPath, transcript, { encoding: 'utf8', flag: resumeId ? 'a' : 'w' });
    } catch (err) {
        process.stderr.write(`[fake-copilot] JSONL write failed: ${err.message}\r\n`);
    }
}

process.stdout.write('[fake-copilot] ready -- type /exit to end\r\n');

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);
        if (line === '/exit') {
            process.stdout.write('[fake-copilot] exiting\r\n');
            process.exit(0);
        }
        process.stdout.write(`[fake-copilot] echo: ${line}\r\n`);
    }
});
process.stdin.on('end', () => {
    process.exit(0);
});

setInterval(() => {}, 1_000).unref();
