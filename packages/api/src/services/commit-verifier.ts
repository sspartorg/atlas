import { execFile } from 'child_process';
import { promisify } from 'util';
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import { commentsService } from './comments.js';
import { parseCommitMessage } from './commit-discipline.js';
import { gitInvokeEnv } from './git-env.js';
import type {
    CommitVerificationResult,
    ICommitProblem,
    IssueType,
} from '@atlas/shared';

const execFileP = promisify(execFile);

// Theme 11 — commit verifier.
//
// Called by `agent-runner` after every issue-attached run (success or
// error). Wrapped in try/catch at the call site so a verifier failure
// must NOT compound a run failure — verification is best-effort
// observability, not load-bearing logic.

// 0x1E (RECORD SEPARATOR) + 0x00 (NULL) — neither appears in normal
// commit text, so we can split unambiguously without worrying about
// commits whose body contains newlines, dashes, or quotes. The
// format string passes the git escape literals (`%x00`, `%x1E`);
// git expands them in its output. We can't put raw NUL chars into
// the argv because Node's child_process rejects null bytes in args
// as a security measure.
const RECORD_SEP = String.fromCharCode(0x1e);
const FIELD_SEP = String.fromCharCode(0x00);
const GIT_FORMAT = '%H%x00%s%x00%b%x1E';

interface VerifyArgs {
    runId: string;
    agentId: string;
    itemId: string | null;
    /** Project cwd where the agent ran. The verifier shells out to
     *  `git` here; if it's not a git repo, the verifier records
     *  `result='clean'` (no work to verify). */
    cwd: string;
    /** ISO timestamp from `agent_runs.started_at`. Defines the
     *  `--since` window for the git log walk. */
    runStartedAtIso: string;
    /** Optional issue_type for the system-comment audit; required
     *  when itemId is non-null. */
    itemType: IssueType | null;
}

interface VerifyOutput {
    result: CommitVerificationResult;
    commitCount: number;
    problems: ICommitProblem[];
}

// `git log --since=<iso>` is unreliable when the ISO string carries
// milliseconds (`2026-05-24T08:13:17.123Z`) — git returns zero
// commits even when matches exist. Strip to second-level precision.
function stripMillis(iso: string): string {
    return iso.replace(/\.\d{3}(?=Z|[+-])/, '');
}

async function gitLogSince(
    cwd: string,
    sinceIso: string,
): Promise<Array<{ sha: string; subject: string; body: string }>> {
    try {
        const { stdout } = await execFileP(
            'git',
            ['log', `--since=${stripMillis(sinceIso)}`, `--pretty=format:${GIT_FORMAT}`],
            { cwd, env: gitInvokeEnv(null), maxBuffer: 4 * 1024 * 1024 },
        );
        if (!stdout) return [];
        const records = stdout
            .split(RECORD_SEP)
            .map((r) => r.trim())
            .filter((r) => r.length > 0);
        return records.map((r) => {
            const parts = r.split(FIELD_SEP);
            return {
                sha: parts[0] ?? '',
                subject: parts[1] ?? '',
                body: parts.slice(2).join(FIELD_SEP),
            };
        });
    } catch {
        return [];
    }
}

async function gitHasModifications(cwd: string): Promise<boolean> {
    try {
        const { stdout } = await execFileP('git', ['status', '--porcelain'], {
            cwd,
            env: gitInvokeEnv(null),
            maxBuffer: 1024 * 1024,
        });
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

async function isGitRepo(cwd: string): Promise<boolean> {
    try {
        await execFileP('git', ['rev-parse', '--is-inside-work-tree'], {
            cwd,
            env: gitInvokeEnv(null),
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Inspect the cwd for commits made during the run window + dirty
 * tree. Classify per the discipline rule, persist an audit row,
 * emit SSE, and append a system comment to the item when the
 * result is non-clean. Returns the classification so the caller
 * can log / route on it.
 *
 * `agent-runner` calls this in `completeRun` and `errorRun` for
 * every issue-attached run; freedom runs are skipped at the call
 * site.
 */
export async function verifyRunCommits(args: VerifyArgs): Promise<VerifyOutput> {
    const inRepo = await isGitRepo(args.cwd);
    if (!inRepo) {
        return await persistAndEmit(args, { result: 'clean', commitCount: 0, problems: [] });
    }

    const [commits, dirty] = await Promise.all([
        gitLogSince(args.cwd, args.runStartedAtIso),
        gitHasModifications(args.cwd),
    ]);

    const problems: ICommitProblem[] = [];
    for (const c of commits) {
        const raw = `${c.subject}\n\n${c.body}`.trim();
        const parsed = parseCommitMessage(raw);
        for (const p of parsed.problems) {
            problems.push({ commit_sha: c.sha.slice(0, 12), reason: p.reason });
        }
        if (args.itemId !== null && parsed.refs.length === 0) {
            problems.push({ commit_sha: c.sha.slice(0, 12), reason: 'refs-missing' });
        }
    }

    let result: CommitVerificationResult;
    if (commits.length === 0 && !dirty) result = 'clean';
    else if (commits.length === 0 && dirty) result = 'silent';
    else if (problems.length > 0) result = 'partial';
    else result = 'compliant';

    return await persistAndEmit(args, {
        result,
        commitCount: commits.length,
        problems,
    });
}

async function persistAndEmit(args: VerifyArgs, out: VerifyOutput): Promise<VerifyOutput> {
    // pg expects a JSON string for JSONB inserts; Kysely doesn't
    // auto-stringify JS arrays even when the column is typed as one.
    // Cast through `unknown` so the table's typed-array shape doesn't
    // complain — the driver writes the JSON text to the column.
    await db
        .insertInto('commit_verifications')
        .values({
            run_id: args.runId,
            item_id: args.itemId,
            agent_id: args.agentId,
            result: out.result,
            commit_count: out.commitCount,
            problems: JSON.stringify(out.problems) as unknown as ICommitProblem[],
        })
        .execute();

    broadcastSSE({
        type: 'commit_verification',
        agentId: args.agentId,
        runId: args.runId,
        commitVerificationResult: out.result,
    });

    if (
        args.itemId !== null &&
        args.itemType !== null &&
        (out.result === 'silent' || out.result === 'partial')
    ) {
        const problemSummary = out.problems
            .map((p) => (p.commit_sha ? `${p.commit_sha}: ${p.reason}` : p.reason))
            .slice(0, 6)
            .join('; ');
        try {
            await commentsService.create({
                author: 'agent',
                agent_id: args.agentId,
                issue_type: args.itemType,
                issue_id: args.itemId,
                body: `_(commit-discipline verifier: **${out.result}**${
                    problemSummary ? `. Problems: ${problemSummary}` : ''
                })_`,
            });
        } catch {
            /* best-effort */
        }
    }

    return out;
}
