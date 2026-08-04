import { randomUUID } from 'crypto';
import { spawn as nodeSpawn } from 'child_process';
import { CLI_DIALECT, type IAgent } from '@atlas/shared';
import { broadcastSSE } from '../routes/events.js';
import { normalizeModelForCli, resolveSpawn } from './cli-model-naming.js';
import { ollamaEnv } from './ollama-env.js';

const DRY_RUN_TIMEOUT_MS = 30_000;

export interface DryRunStartResult {
    dryRunId: string;
    model: string;
    cli: string;
    promptLen: number;
}

// Tiny ping prompt: the smallest LLM round-trip that proves the CLI binary
// is reachable, credentials work, the model accepts requests, and stdout
// streams back. We deliberately do NOT inject the workspace constitution or
// any agent prompt here — that belongs to a real run, not a connection test.
// The Owner can append an extra line of context if they want to verify a
// follow-up question lands; otherwise this stays as one line of input.
function buildDryRunPrompt(extra: string | null): string {
    const lines = ['Reply with the single word OK and nothing else.'];
    if (extra && extra.trim()) {
        lines.push('', extra.trim());
    }
    return lines.join('\n');
}

function emitOutput(dryRunId: string, agentId: string, line: string, stream: 'stdout' | 'stderr'): void {
    if (!line.trim()) return;
    broadcastSSE({
        type: 'dry_run_output',
        dryRunId,
        agentId,
        output: line,
        stream,
    });
}

// Compose the final "[test] connection ok|failed · 2.3s" footer the UI
// surfaces as the pass/fail verdict. Exit code 0 means the CLI process
// returned cleanly. Non-zero is failure — the actual stderr / spawn error
// has already been streamed via emitOutput so the user can read why.
function formatVerdict(exitCode: number, latencyMs: number): string {
    const seconds = (latencyMs / 1000).toFixed(1);
    return exitCode === 0
        ? `[test] connection ok · ${seconds}s`
        : `[test] connection failed · exit=${exitCode} · ${seconds}s`;
}

function spawnDryRunCli(agent: IAgent, dryRunId: string, prompt: string): void {
    // Ollama runs the Claude binary; only the env overlay differs (see below).
    const dialect = CLI_DIALECT[agent.cli];
    const bin = dialect === 'claude' ? 'claude' : 'copilot';
    const probeCwd = process.cwd();

    // Flag shapes verified against the actual CLIs installed locally
    // (2026-05-31), not from speculation. Two diverging surface areas:
    //
    // Claude Code CLI (`claude --help`): `--print` is the non-interactive
    // flag, prompt arrives on stdin, `--output-format text` is the plain
    // single-string reply. `--tools` and `--disable-slash-commands` were
    // dropped from the CLI on 2026-05-27 (see routes/tool-catalog.ts:7).
    //
    // GitHub Copilot CLI (`copilot --help`): the standalone `copilot`
    // binary (installed via `npm i -g @github/copilot`). Non-interactive
    // mode REQUIRES `-p <text>` — without it, copilot launches a TUI and
    // ignores stdin. `--allow-all-tools` is mandatory for unattended runs;
    // otherwise the CLI prompts for tool permission and hangs in `--print`
    // mode. `--no-color` keeps the output panel readable. We deliberately
    // skip `gh copilot` — gh-copilot v2 is a thin wrapper around the same
    // binary (see `gh copilot --help`), so the direct invocation is
    // simpler and consistent with what `copilot --help` shows the user.
    const model = normalizeModelForCli(agent.model, agent.cli);
    const args = dialect === 'claude'
        ? [
              '--print',
              '--model', model,
              '--output-format', 'text',
          ]
        : [
              '-p', prompt,
              '--model', model,
              '--allow-all-tools',
              '--add-dir', probeCwd,
              '--no-color',
          ];

    const startedAt = Date.now();
    let child;
    try {
        const resolved = resolveSpawn(bin, args);
        child = nodeSpawn(resolved.command, resolved.args, {
            // This probe previously inherited process.env implicitly. It now
            // passes env explicitly so the Ollama overlay can land AFTER the
            // inherited vars — otherwise a stray ANTHROPIC_API_KEY would send
            // the "test connection" ping to Anthropic and report a false OK
            // for an Ollama agent whose server isn't even running.
            env: { ...process.env, ...ollamaEnv(agent.cli, model) },
            shell: resolved.useShell,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch (err) {
        broadcastSSE({
            type: 'dry_run_done',
            dryRunId,
            agentId: agent.id,
            exitCode: -1,
            output: `Failed to spawn ${bin}: ${(err as Error).message}`,
        });
        return;
    }

    let finished = false;

    const timeout = setTimeout(() => {
        if (finished) return;
        emitOutput(dryRunId, agent.id, `[test] timed out after ${DRY_RUN_TIMEOUT_MS / 1000}s — killing process`, 'stderr');
        try {
            child.kill();
        } catch {
            /* ignore */
        }
    }, DRY_RUN_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split(/\r?\n/)) {
            emitOutput(dryRunId, agent.id, line, 'stdout');
        }
    });

    child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split(/\r?\n/)) {
            emitOutput(dryRunId, agent.id, line, 'stderr');
        }
    });

    child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        const exitCode = code ?? -1;
        broadcastSSE({
            type: 'dry_run_done',
            dryRunId,
            agentId: agent.id,
            exitCode,
            output: formatVerdict(exitCode, Date.now() - startedAt),
        });
    });

    child.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        broadcastSSE({
            type: 'dry_run_done',
            dryRunId,
            agentId: agent.id,
            exitCode: -1,
            output: `${formatVerdict(-1, Date.now() - startedAt)} · ${err.message}`,
        });
    });

    // Claude reads the prompt from stdin (paired with `--print`).
    // Copilot already has the prompt in `-p <text>`; closing stdin
    // immediately tells it there's no further input to wait for.
    try {
        if (dialect === 'claude') {
            child.stdin.write(prompt);
        }
        child.stdin.end();
    } catch (err) {
        finished = true;
        clearTimeout(timeout);
        broadcastSSE({
            type: 'dry_run_done',
            dryRunId,
            agentId: agent.id,
            exitCode: -1,
            output: `${formatVerdict(-1, Date.now() - startedAt)} · failed to write stdin: ${(err as Error).message}`,
        });
    }
}

export async function startDryRun(
    agent: IAgent,
    extraPrompt: string | null
): Promise<DryRunStartResult> {
    const prompt = buildDryRunPrompt(extraPrompt);
    const dryRunId = randomUUID();
    const model = agent.model || 'sonnet';

    broadcastSSE({
        type: 'dry_run_started',
        dryRunId,
        agentId: agent.id,
        output: `[test] cli=${agent.cli} model=${model} · ping prompt (${prompt.length} chars)`,
    });

    setTimeout(() => spawnDryRunCli(agent, dryRunId, prompt), 50);

    return { dryRunId, model, cli: agent.cli, promptLen: prompt.length };
}
