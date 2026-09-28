import { spawn as nodeSpawn } from 'node:child_process';
import { tmpdir } from 'node:os';

import type { IRunTraceSummary } from '@atlas/shared';

import { resolveSpawn } from './cli-model-naming.js';
// `parseClaudeCostFromOutput` directly, NOT `agent-runner.ts`'s dispatcher:
// the runner imports the evaluator which imports this, so reaching back into
// it would close a cycle. The judge always spawns `claude`, so the dispatcher
// would only have picked this branch anyway.
import { parseClaudeCostFromOutput } from './claude-cost-parser.js';
import { parseRunOutcome } from './run-outcome-parser.js';
import type { JudgeVerdict } from '../db/types.js';

// Custom LLM-as-a-Judge for an agent test (ADR 0023).
//
// Every other expectation is a string or a number compared against something
// the run produced. Some things are not: "did it explain WHY it rejected the
// work, or just that it did?" watsonx Orchestrate ships this for the same
// reason — a claims agent and an onboarding agent are judged on different
// things, and only the person who wrote the agent knows what those are.
//
// It is the only non-deterministic piece in the whole evaluation path, so
// everything here is arranged to keep it from becoming the thing that flakes:
//
//  1. **Deterministic input.** It sees the outcome summary, the reason, the
//     trace JSON, the agent's final reply and the shell commands it ran — the
//     last two so a scope criterion ("does not answer off-topic questions") is
//     graded on what it said, not on its own summary. Never the repo, never the
//     diff. Same bytes in, same question out.
//  2. **Binary questions, not a paragraph.** `judge_criteria` is a list, each
//     entry one question, capped at 200 characters by the route schema. A
//     vague paragraph is the single largest source of judge variance.
//  3. **A fixed, cheap model.** `haiku`, hardcoded. The judge is not the agent;
//     changing an agent's model must not change its grade.
//  4. **Judged once, cached.** The verdict is written at evaluation and never
//     recomputed, so re-reading a run cannot change what it scored.
//  5. **Off by default.** No criteria, no spawn, no cost, no variance.
//  6. **Measured, not assumed.** With more than one sample the batch reports
//     judge agreement separately, so a judge that disagrees with itself over
//     identical evidence says so instead of the agent taking the blame.

/** The judge is not the agent. Its grade must not move when the agent's model does. */
const JUDGE_MODEL = 'haiku';
const JUDGE_TIMEOUT_MS = 120_000;

export interface JudgeResult {
    verdict: JudgeVerdict;
    reason: string;
    cost_usd: number | null;
}

export interface JudgeEvidence {
    summary: string;
    reason: string | null;
    trace: IRunTraceSummary | null;
    /** What the agent actually answered — so a criterion about it is graded on it, not on the summary. */
    reply?: string | null | undefined;
    /** The shell commands it ran. */
    commands?: string[] | null | undefined;
}

/** Enough of a reply to judge; the prompt is not the place for a whole transcript. */
const REPLY_IN_PROMPT = 8_000;
const COMMANDS_IN_PROMPT = 50;

function buildPrompt(criteria: string[], evidence: JudgeEvidence): string {
    return [
        'You are grading one run of a software agent against criteria its author wrote.',
        'You are NOT grading the code, the repo, or whether you would have done it differently.',
        'Judge ONLY the evidence below, against ONLY the criteria below.',
        '',
        '## Criteria — every one must hold',
        ...criteria.map((c, i) => `${i + 1}. ${c}`),
        '',
        '## What the agent reported',
        evidence.summary || '(it reported no summary)',
        '',
        '## Why it said so',
        evidence.reason ?? '(it gave no reason)',
        '',
        '## What it actually did',
        evidence.trace ? JSON.stringify(evidence.trace) : '(no transcript was recorded for this run)',
        '',
        '## Its final reply',
        evidence.reply ? evidence.reply.slice(0, REPLY_IN_PROMPT) : '(no final reply was recorded)',
        '',
        '## Shell commands it ran',
        evidence.commands == null
            ? '(this CLI does not report them)'
            : evidence.commands.length === 0
              ? '(none)'
              : evidence.commands.slice(0, COMMANDS_IN_PROMPT).map((c) => `- ${c.slice(0, 300)}`).join('\n'),
        '',
        '## How to answer',
        'End your reply with exactly this block and nothing after it:',
        '',
        '```atlas-outcome',
        'outcome: done | rejected',
        'summary: |',
        '  One sentence. If any criterion did not hold, name which and why.',
        '```',
        '',
        'Use `done` when every criterion holds. Use `rejected` when any does not.',
    ].join('\n');
}

function spawnJudge(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // `--output-format stream-json` so the existing cost parser applies —
        // no new cost code for a second kind of spawn.
        const args = [
            '--print',
            '--model',
            JUDGE_MODEL,
            '--output-format',
            'stream-json',
            '--verbose',
        ];
        let child;
        try {
            const resolved = resolveSpawn('claude', args);
            child = nodeSpawn(resolved.command, resolved.args, {
                cwd: tmpdir(),
                shell: resolved.useShell,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (err) {
            reject(new Error(`could not spawn the judge: ${(err as Error).message}`));
            return;
        }

        let stdout = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('the judge timed out'));
        }, JUDGE_TIMEOUT_MS);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0 && stdout.trim()) resolve(stdout);
            else reject(new Error(`the judge exited ${code ?? 'without a code'}`));
        });

        child.stdin.write(prompt);
        child.stdin.end();
    });
}

/**
 * Grade one run against its test's natural-language criteria.
 *
 * Returns `null` when judging did not happen at all — no criteria, or AI
 * disabled. The caller treats a failure to judge as `errored`, never as a
 * pass and never as the agent's fault: blaming an agent for a missing
 * `claude` binary is the mistake `agent-tests-evaluate.ts` already refuses to
 * make about the dispatch itself.
 */
export async function judgeAgentTestRun(
    criteria: string[] | undefined,
    evidence: JudgeEvidence,
): Promise<JudgeResult | null> {
    if (!criteria || criteria.length === 0) return null;
    if (process.env['ATLAS_AI_ENABLED'] !== 'true') return null;

    let raw: string;
    try {
        raw = await spawnJudge(buildPrompt(criteria, evidence));
    } catch (err) {
        return { verdict: 'abstained', reason: (err as Error).message, cost_usd: null };
    }

    const cost = parseClaudeCostFromOutput(raw);
    const cost_usd = cost?.total_cost_usd ?? null;

    // Reuse the block the whole product already speaks. A bespoke JSON
    // contract would be a second parser to write, cover and keep honest.
    const outcome = parseRunOutcome(raw);
    if (!outcome) {
        return { verdict: 'abstained', reason: 'the judge did not answer in the expected form', cost_usd };
    }
    // A block with no summary is still a verdict; the reason is just empty.
    const reason = outcome.summary ?? '';
    if (outcome.kind === 'done') return { verdict: 'pass', reason, cost_usd };
    if (outcome.kind === 'rejected') return { verdict: 'fail', reason, cost_usd };
    // `asked_question` means it would not commit either way, which is an
    // abstention rather than a finding about the agent.
    return { verdict: 'abstained', reason, cost_usd };
}
