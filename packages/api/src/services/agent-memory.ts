import { createHash } from 'crypto';
import { spawn as nodeSpawn } from 'child_process';
import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import { commentsService } from './comments.js';
import { resolveSpawn } from './cli-model-naming.js';
import { ollamaEnv } from './ollama-env.js';
import { isClaudeDialect } from '@atlas/shared';
import type {
    IAgent,
    IAgentMemory,
    IAgentRun,
    IComment,
    MemoryBoundaryFlag,
    MemoryRegenerationTrigger,
} from '@atlas/shared';

// Theme 08 — explicit, agent-readable rule for what belongs in memory.
// Embedded into (1) the regenerate prompt so the AI follows it during
// `regenerate()`, and (2) the `updateAgentMemory` MCP tool description
// so an agent calling the tool mid-run sees it. Tests assert against
// this string so a careless rewrite is caught.
export const MEMORY_BOUNDARY_RULE = [
    '## Memory boundary — what belongs here, what does not',
    '',
    'Memory is for behavioral generalizations of how YOU (the agent) should approach future similar work — process, style, anti-patterns, escalation triggers.',
    '',
    'Memory is NOT for product or project facts.',
    '',
    'Test: "would this fact be just as true if a different item or different project hit this code path?"',
    '- If YES → it belongs in memory.',
    '- If it is tied to project X / item Y / a specific user → it does NOT belong in memory.',
    '',
    'Project-specific facts go in item descriptions / comments / `spec_md`. Workspace-wide constraints go in guardrails.',
].join('\n');

function slug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// A06 — soft filter for memory bodies that violate the boundary rule.
//
// Patterns target the high-cardinality identifiers that always indicate
// "this is product-specific, not behavioral": item IDs, agent IDs, run
// UUIDs, project IDs. Result is informational — the memory still persists
// (Owner's choice) — and the Memory tab renders an amber chip on the
// audit row so the Owner can spot drift.
//
// Each regex is created fresh on every call so the `g` flag's lastIndex
// state never leaks across invocations.
export function detectBoundaryViolations(body: string): MemoryBoundaryFlag[] {
    const flags: MemoryBoundaryFlag[] = [];
    if (/\b(epic|story|sub-task|sub-bug|bug|task)_[a-z0-9]{4,}\b/i.test(body)) {
        flags.push('item_id');
    }
    if (/\bagent-[a-z0-9][a-z0-9-]{2,}\b/i.test(body)) {
        flags.push('agent_id');
    }
    if (/\bproj(?:ect)?_[a-z0-9]{4,}\b/i.test(body)) {
        flags.push('project_id');
    }
    if (
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(body)
    ) {
        flags.push('run_id');
    }
    return flags;
}

function hashBody(body: string): string {
    return createHash('sha256').update(body).digest('hex');
}

// Diff metrics for memory_regenerations.{chars_added,chars_removed}.
// chars_added = new − overlap; chars_removed = old − overlap. We
// approximate overlap by the longest common prefix to avoid pulling in
// a real diff library — this is metric-only signal for the UI
// sparkline, not a structural diff.
function diffMetrics(oldBody: string, newBody: string): { added: number; removed: number } {
    let i = 0;
    const min = Math.min(oldBody.length, newBody.length);
    while (i < min && oldBody.charCodeAt(i) === newBody.charCodeAt(i)) i++;
    const overlap = i;
    return {
        added: Math.max(0, newBody.length - overlap),
        removed: Math.max(0, oldBody.length - overlap),
    };
}

async function ensureRow(agentId: string): Promise<IAgentMemory> {
    const existing = await db
        .selectFrom('agent_memory')
        .selectAll()
        .where('agent_id', '=', agentId)
        .executeTakeFirst();
    if (existing) return existing as unknown as IAgentMemory;
    await db
        .insertInto('agent_memory')
        .values({ agent_id: agentId, body_md: '', version: 1, source: 'ai-generated' })
        .onConflict((oc) => oc.column('agent_id').doNothing())
        .execute();
    const row = await db
        .selectFrom('agent_memory')
        .selectAll()
        .where('agent_id', '=', agentId)
        .executeTakeFirstOrThrow();
    return row as unknown as IAgentMemory;
}

function simulatedBody(agent: IAgent, recent: IAgentRun[]): string {
    const completed = recent.filter((r) => r.status === 'completed').length;
    const failed = recent.filter((r) => r.status === 'error').length;
    return [
        `# Procedural Memory — ${agent.name}`,
        '',
        `_Self-corrections from past runs. The agent rewrites this file after each run; manual edits are kept._`,
        '',
        '## Course corrections',
        '',
        `1. Reviewed ${recent.length} recent run(s) (${completed} completed, ${failed} errored).`,
        '2. Tighten acceptance-criteria checks before drafting; reject stories where AC is empty.',
        '3. When the Epic title is vague, surface follow-up questions to the Owner rather than guessing.',
        '4. Escalate retention-policy questions to the Owner; never guess legal/compliance defaults.',
        '',
        '## Style fixes',
        '',
        `- Prefer concrete actors (CSR, Finance Ops, Billing Admin) over the generic "user".`,
        '- Prefer "refund-partial" over "refund partial" or "partial refund" in titles.',
        '- Keep acceptance criteria to 2 bullets max per story.',
        '',
        `_(Simulated body — set ATLAS_AI_ENABLED=true for real CLI regeneration.)_`,
        '',
    ].join('\n');
}

// reason: only reachable via realCliBody(), which itself requires
// ATLAS_AI_ENABLED=true and a live `claude` CLI spawn — both already
// v8-ignored below. Extend the ignore up to here so this pure string
// builder doesn't show as uncovered branches for a path tests can't hit.
/* v8 ignore start */
function buildMemoryPrompt(agent: IAgent, recent: IAgentRun[]): string {
    const completed = recent.filter((r) => r.status === 'completed').length;
    const failed = recent.filter((r) => r.status === 'error').length;

    const runLines = recent.slice(0, 10).map((r, i) => {
        const out = (r.output_text ?? '').slice(0, 600).replace(/\s+/g, ' ').trim();
        const head = `${i + 1}. [${r.status}] run ${r.id.slice(0, 8)} on ${r.issue_type} ${r.issue_id}`;
        return out ? `${head}\n   output: ${out}` : head;
    }).join('\n');

    const role = agent.prompt_md.trim() || '(no role prompt configured)';
    const fileName = `${slug(agent.name)}.memory.md`;

    return [
        `# Your Role`,
        ``,
        role,
        ``,
        `---`,
        ``,
        MEMORY_BOUNDARY_RULE,
        ``,
        `---`,
        ``,
        `# Task: Rewrite your procedural memory`,
        ``,
        `You are agent **${agent.name}**. The file \`${fileName}\` is read before every run`,
        `so you can learn from past mistakes. Rewrite it now based on the runs below.`,
        `Surface concrete course-corrections, recurring failure modes, and style fixes —`,
        `things the next run should do differently. Apply the memory boundary rule above:`,
        `do not invent lessons that the runs do not support, and do not save product- or`,
        `project-specific facts.`,
        ``,
        `## Recent runs (${recent.length} total, ${completed} completed, ${failed} errored)`,
        ``,
        runLines || '_(no runs yet — say so plainly in the output)_',
        ``,
        `## Output format`,
        ``,
        `Output ONLY the new \`memory.md\` contents. No preamble, no closing remarks, no code fences.`,
        `Use this structure:`,
        ``,
        `# Procedural Memory — ${agent.name}`,
        ``,
        `_Self-corrections from past runs._`,
        ``,
        `## Course corrections`,
        ``,
        `1. ...`,
        ``,
        `## Style fixes`,
        ``,
        `- ...`,
        ``,
    ].join('\n');
}

/* v8 ignore start */
function spawnClaudeForMemory(agent: IAgent, prompt: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // `--tools` was dropped from Claude Code CLI on 2026-05-27 (see
        // routes/tool-catalog.ts:7). Memory regeneration just wants a single
        // text reply, so plain `--print --output-format text` is enough.
        //
        // Memory regeneration always spawns `claude`, whatever the agent's own
        // CLI is — a Copilot agent's memory is still written by Claude, hence
        // the `sonnet` fallback. Ollama agents are the exception: their CLI IS
        // this binary, so they keep their own model AND need the env overlay.
        // Without it we'd send an Ollama model id to Anthropic and 404.
        // Note the fallback differs per CLI: 'sonnet' is meaningless to an
        // Ollama server, so a null-model Ollama agent falls back to its own
        // default instead of a Claude model name.
        const model = isClaudeDialect(agent.cli)
            ? agent.model || (agent.cli === 'ollama' ? 'qwen3.5' : 'sonnet')
            : 'sonnet';
        const args = [
            '--print',
            '--model', model,
            '--output-format', 'text',
        ];

        let child;
        try {
            const resolved = resolveSpawn('claude', args);
            child = nodeSpawn(resolved.command, resolved.args, {
                cwd,
                env: { ...process.env, ...ollamaEnv(agent.cli, model) },
                shell: resolved.useShell,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (err) {
            reject(new Error(`Failed to spawn claude: ${(err as Error).message}`));
            return;
        }

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
            if (code === 0) {
                const body = stdout.trim();
                if (!body) {
                    reject(new Error('claude returned empty output'));
                } else {
                    resolve(body);
                }
            } else {
                const tail = (stderr || stdout).trim().slice(-400);
                reject(new Error(`claude exited with code ${code ?? 'unknown'}${tail ? `: ${tail}` : ''}`));
            }
        });

        try {
            child.stdin?.write(prompt);
            child.stdin?.end();
        } catch (err) {
            reject(new Error(`failed to write prompt to stdin: ${(err as Error).message}`));
        }
    });
}
/* v8 ignore stop */

/* v8 ignore start */
async function realCliBody(agent: IAgent, recent: IAgentRun[]): Promise<string> {
    const settingsRow = await db
        .selectFrom('settings')
        .select(['workspace_path'])
        .where('id', '=', 1)
        .executeTakeFirst();
    const cwd = (settingsRow?.workspace_path as string | null) || process.cwd();

    const prompt = buildMemoryPrompt(agent, recent);
    return spawnClaudeForMemory(agent, prompt, cwd);
}
/* v8 ignore stop */

// Inserts an audit row + broadcasts SSE. Shared by regenerate / appendLesson.
async function recordRegenAudit(opts: {
    agentId: string;
    runId: string | null;
    trigger: MemoryRegenerationTrigger;
    prevVersion: number;
    newVersion: number;
    prevBody: string;
    newBody: string;
}): Promise<void> {
    const { added, removed } = diffMetrics(opts.prevBody, opts.newBody);
    // A06 — soft boundary-rule filter. We tag the audit row with any
    // detected violations in the NEW body; memory still persists either
    // way (Owner's choice). The Memory tab renders an amber chip when
    // this array is non-empty. JSONB-bound: serialize JS array to JSON
    // text — pg/node doesn't auto-stringify even when Kysely's column
    // type carries the JS shape (cf. commit-verifier.problems).
    const boundaryFlags = detectBoundaryViolations(opts.newBody);
    await db
        .insertInto('memory_regenerations')
        .values({
            agent_id: opts.agentId,
            run_id: opts.runId,
            trigger: opts.trigger,
            prev_version: opts.prevVersion,
            new_version: opts.newVersion,
            prev_body_hash: hashBody(opts.prevBody),
            new_body_hash: hashBody(opts.newBody),
            chars_added: added,
            chars_removed: removed,
            boundary_flags: JSON.stringify(boundaryFlags) as unknown as MemoryBoundaryFlag[],
        })
        .execute();
    broadcastSSE({
        type: 'memory_regenerated',
        agentId: opts.agentId,
        ...(opts.runId ? { runId: opts.runId } : {}),
        memoryRegenerationTrigger: opts.trigger,
        memoryVersion: opts.newVersion,
    });
}

// Append a lesson under `## Course corrections`. If the section is
// missing, append the whole section to the body. The bullet uses `- `
// so it appends regardless of whether the existing section uses
// numbered or bulleted lists.
function applyAppendLesson(existingBody: string, lessonMd: string): string {
    const trimmed = lessonMd.trim();
    if (!trimmed) return existingBody;
    const bullet = trimmed.startsWith('-') ? trimmed : `- ${trimmed}`;
    const sectionRe = /^##\s+Course corrections\s*$/im;
    const match = existingBody.match(sectionRe);
    if (!match) {
        const sep = existingBody.endsWith('\n') ? '' : '\n';
        return `${existingBody}${sep}\n## Course corrections\n\n${bullet}\n`;
    }
    // Insert at end of section (right before next `## ` heading or
    // end-of-file). Find the position of the next `## ` after the
    // matched section heading.
    const startIdx = match.index ?? 0;
    const afterHeading = startIdx + match[0].length;
    const tail = existingBody.slice(afterHeading);
    const nextHeadingRel = tail.search(/^##\s+/m);
    const sectionEndAbs = nextHeadingRel === -1
        ? existingBody.length
        : afterHeading + nextHeadingRel;
    const sectionBody = existingBody.slice(afterHeading, sectionEndAbs);
    // Ensure exactly one blank line separates new bullet from prior
    // content. Don't disturb trailing blank lines before the next heading.
    const sectionBodyTrimmedEnd = sectionBody.replace(/[\s]+$/m, '');
    const newSection = `${sectionBodyTrimmedEnd}\n${bullet}\n`;
    const trailingBlanks = sectionBody.slice(sectionBodyTrimmedEnd.length);
    return (
        existingBody.slice(0, afterHeading) +
        newSection +
        trailingBlanks +
        existingBody.slice(sectionEndAbs)
    );
}

function hasLessonMarker(body: string): boolean {
    return /\[(lesson|memory)\s*:/i.test(body);
}

async function findOwnerLessonOnItem(itemId: string): Promise<IComment | undefined> {
    // We need the issue_type for commentsService.list; query items
    // directly to keep this scoped.
    const item = await db
        .selectFrom('items')
        .select('type')
        .where('id', '=', itemId)
        .executeTakeFirst();
    if (!item) return undefined;
    const comments = await commentsService.list(item.type, itemId);
    // Walk from newest backward; the marker only matters when fresh.
    for (let i = comments.length - 1; i >= 0; i--) {
        const c = comments[i]!;
        if (c.author === 'owner' && hasLessonMarker(c.body)) return c;
    }
    return undefined;
}

export interface RegenerateOpts {
    runId?: string;
    trigger?: MemoryRegenerationTrigger;
}

export const agentMemoryService = {
    async get(agentId: string): Promise<IAgentMemory> {
        return ensureRow(agentId);
    },

    async put(agentId: string, bodyMd: string): Promise<IAgentMemory> {
        await ensureRow(agentId);
        await db
            .updateTable('agent_memory')
            .set((eb) => ({
                body_md: bodyMd,
                version: eb('version', '+', 1),
                source: 'manual-edit' as const,
            }))
            .where('agent_id', '=', agentId)
            .execute();
        return ensureRow(agentId);
    },

    /**
     * Regenerate the agent's memory from its recent run history.
     * Theme 08: writes a `memory_regenerations` audit row, holds a
     * session-scoped advisory lock per-agent so concurrent regens
     * don't race, resets the `runs_since_regen` counter on success,
     * and broadcasts `memory_regenerated` over SSE.
     */
    async regenerate(agentId: string, opts: RegenerateOpts = {}): Promise<IAgentMemory> {
        const trigger = opts.trigger ?? 'manual';
        const agentRow = await db
            .selectFrom('agents')
            .selectAll()
            .where('id', '=', agentId)
            .executeTakeFirst();
        if (!agentRow) throw new Error('Agent not found');
        const agent = agentRow as unknown as IAgent;

        // Advisory lock keyed on the agent id. If another regen is in
        // flight, no-op and return the current memory row — losing
        // this race is fine: the in-flight regen is doing the work.
        const lockKey = `agent-memory:${agentId}`;
        const lockResult = await db
            .executeQuery(
                sql<{ acquired: boolean }>`SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS acquired`.compile(
                    db,
                ),
            );
        const acquired = lockResult.rows[0]?.acquired ?? false;
        if (!acquired) {
            return ensureRow(agentId);
        }

        try {
            const runRows = await db
                .selectFrom('agent_runs')
                .selectAll()
                .where('agent_id', '=', agentId)
                .orderBy('created_at', 'desc')
                .limit(20)
                .execute();
            const recent = runRows as unknown as IAgentRun[];
            const lastRunId = recent[0]?.id ?? null;

            const before = await ensureRow(agentId);
            const aiEnabled = process.env['ATLAS_AI_ENABLED'] === 'true';
            const body = aiEnabled ? await realCliBody(agent, recent) : simulatedBody(agent, recent);

            await db
                .updateTable('agent_memory')
                .set((eb) => ({
                    body_md: body,
                    version: eb('version', '+', 1),
                    source: 'ai-generated' as const,
                    last_run_id: lastRunId,
                    runs_since_regen: 0,
                }))
                .where('agent_id', '=', agentId)
                .execute();
            const after = await ensureRow(agentId);

            await recordRegenAudit({
                agentId,
                runId: opts.runId ?? null,
                trigger,
                prevVersion: before.version,
                newVersion: after.version,
                prevBody: before.body_md,
                newBody: after.body_md,
            });

            return after;
        } finally {
            await db.executeQuery(
                sql`SELECT pg_advisory_unlock(hashtext(${lockKey}))`.compile(db),
            );
        }
    },

    /**
     * Surgical append under `## Course corrections`. Used by the MCP
     * `updateAgentMemory` tool in `mode: 'append'`. Bumps version,
     * does NOT reset the cadence counter (the agent writing one
     * lesson shouldn't suppress the cadence regenerator's own pass).
     * Trigger='mcp_update' lets the Memory tab badge this row as
     * agent-driven.
     */
    async appendLesson(agentId: string, lessonMd: string, runId?: string): Promise<IAgentMemory> {
        const before = await ensureRow(agentId);
        const newBody = applyAppendLesson(before.body_md, lessonMd);
        await db
            .updateTable('agent_memory')
            .set((eb) => ({
                body_md: newBody,
                version: eb('version', '+', 1),
                // The agent wrote this — track as ai-generated so the
                // Memory tab "Owner intervention" badge doesn't fire on
                // every MCP call.
                source: 'ai-generated' as const,
            }))
            .where('agent_id', '=', agentId)
            .execute();
        const after = await ensureRow(agentId);

        await recordRegenAudit({
            agentId,
            runId: runId ?? null,
            trigger: 'mcp_update',
            prevVersion: before.version,
            newVersion: after.version,
            prevBody: before.body_md,
            newBody: after.body_md,
        });

        return after;
    },

    /**
     * Called by `agent-runner.completeRun` / `errorRun` after every
     * issue-attached run completion. Increments `runs_since_regen`
     * (error: +2, success: +1), checks for a high-signal Owner
     * comment marker on the run's item, and fires `regenerate(...)`
     * when either the cadence threshold or the high-signal marker
     * applies. Returns the trigger that fired (or null if no regen).
     */
    async maybeRegenerateAfterRun(
        agentId: string,
        runId: string,
        runStatus: 'completed' | 'error',
    ): Promise<MemoryRegenerationTrigger | null> {
        const agentRow = await db
            .selectFrom('agents')
            .select(['memory_cadence'])
            .where('id', '=', agentId)
            .executeTakeFirst();
        if (!agentRow) return null;
        const cadence = agentRow.memory_cadence ?? 1;

        await ensureRow(agentId);

        // Increment counter atomically. Errors carry more signal so
        // count double.
        const bump = runStatus === 'error' ? 2 : 1;
        const counter = await db
            .updateTable('agent_memory')
            .set((eb) => ({
                runs_since_regen: eb('runs_since_regen', '+', bump),
            }))
            .where('agent_id', '=', agentId)
            .returning('runs_since_regen')
            .executeTakeFirst();

        const nextCount = counter?.runs_since_regen ?? bump;

        // High-signal marker on the run's item — fires regardless of
        // cadence.
        const run = await db
            .selectFrom('agent_runs')
            .select(['item_id'])
            .where('id', '=', runId)
            .executeTakeFirst();
        if (run?.item_id) {
            const ownerLesson = await findOwnerLessonOnItem(run.item_id);
            if (ownerLesson) {
                await this.regenerate(agentId, { runId, trigger: 'high_signal' });
                return 'high_signal';
            }
        }

        if (nextCount >= cadence) {
            await this.regenerate(agentId, { runId, trigger: 'cadence' });
            return 'cadence';
        }

        return null;
    },

    /**
     * Last N memory_regenerations rows for the Agent Detail tab's
     * sparkline + diff metadata. Newest first.
     */
    async history(agentId: string, limit = 10) {
        const rows = await db
            .selectFrom('memory_regenerations')
            .selectAll()
            .where('agent_id', '=', agentId)
            .orderBy('created_at', 'desc')
            .limit(limit)
            .execute();
        return rows.map((r) => ({
            id: Number(r.id),
            agent_id: r.agent_id,
            run_id: r.run_id,
            trigger: r.trigger as MemoryRegenerationTrigger,
            prev_version: r.prev_version,
            new_version: r.new_version,
            prev_body_hash: r.prev_body_hash,
            new_body_hash: r.new_body_hash,
            chars_added: r.chars_added,
            chars_removed: r.chars_removed,
            boundary_flags: (r.boundary_flags ?? []) as MemoryBoundaryFlag[],
            created_at: r.created_at,
        }));
    },

    fileName(agent: IAgent): string {
        return `${slug(agent.name)}.memory.md`;
    },
};
