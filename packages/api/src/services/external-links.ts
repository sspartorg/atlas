import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../db/kysely-client.js';
import { eventsLog } from './events-log.js';
import { credentialsService } from './credentials.js';
import { broadcastSSE } from '../routes/events.js';
import type { ExternalLinkKind, ExternalPrState, IItemExternalLink } from '@atlas/shared';

const execFileP = promisify(execFile);

// Parses a GitHub PR URL into its constituents. Returns null for any URL that
// doesn't match the GitHub pull-request shape — the REST route uses this to
// 400 a 'pull_request' link with a non-PR URL.
const GITHUB_PR_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export function parseGithubPrUrl(
    url: string,
): { owner: string; repo: string; number: string } | null {
    const m = GITHUB_PR_RE.exec(url.trim());
    if (!m) return null;
    return { owner: m[1]!, repo: m[2]!, number: m[3]! };
}

// Best-effort `gh pr view <url> --json title` to capture the PR title at link
// time. Returns null on any failure (gh not installed, no auth, network
// error, malformed JSON). The orchestrator already has `GH_TOKEN` injected
// via the same per-credential env path used by `openPullRequest`; callers
// can pass `extraEnv` to plumb that through.
export async function fetchGithubPrTitle(
    url: string,
    extraEnv: NodeJS.ProcessEnv = {},
): Promise<string | null> {
    if (!parseGithubPrUrl(url)) return null;
    try {
        // execFile (array-form args), NOT exec/execAsync (shell string) —
        // GITHUB_PR_RE allows `?a=$(cmd)` after the PR number, and a shell
        // string would evaluate that as command substitution on POSIX. The
        // array form passes `url` as a single argv[N] with no shell parsing.
        const { stdout } = await execFileP('gh', ['pr', 'view', url, '--json', 'title'], {
            env: { ...process.env, ...extraEnv },
            timeout: 10_000,
            windowsHide: true,
        });
        const parsed = JSON.parse(stdout) as { title?: unknown };
        return typeof parsed.title === 'string' ? parsed.title : null;
    } catch {
        return null;
    }
}

// Current state of a GitHub PR via the REST API (GET /repos/{o}/{r}/pulls/{n}).
// REST rather than `gh` like fetchGithubPrTitle: this runs on the read path
// against the project credential's token, so it must not depend on a local
// `gh` install or the developer's own `gh auth login`. Null on any failure.
export async function fetchGithubPrState(
    url: string,
    token: string,
): Promise<ExternalPrState | null> {
    const pr = parseGithubPrUrl(url);
    if (!pr) return null;
    try {
        const r = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pulls/${pr.number}`,
            {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'atlas/external-links',
                    Authorization: `Bearer ${token}`,
                },
                signal: AbortSignal.timeout(10_000),
            },
        );
        if (!r.ok) {
            // Drain so undici releases the socket.
            await r.text().catch(() => '');
            return null;
        }
        const body = (await r.json()) as { state?: unknown; merged_at?: unknown };
        if (body.merged_at) return 'merged';
        return body.state === 'closed' ? 'closed' : 'open';
    } catch {
        return null;
    }
}

const PR_STATE_TTL_MS = 5 * 60_000;
// Items with a background refresh already running — a detail page fans out
// several list() calls per render, which would otherwise each hit GitHub.
const refreshing = new Set<string>();

function isStalePr(row: ExternalLinkRow): boolean {
    if (row.link_kind !== 'pull_request') return false;
    if (!row.pr_state_checked_at) return true;
    return Date.now() - new Date(row.pr_state_checked_at).getTime() >= PR_STATE_TTL_MS;
}

// Re-reads each pull_request link's state from GitHub and persists it.
// `onlyStale` limits it to links unchecked for PR_STATE_TTL_MS. No project
// credential → nothing is fetched and pr_state stays null. checked_at is
// stamped even on a failed lookup so a broken link isn't retried per read.
// ADR 0017 — a Task's PRs can live in several repos of its project, each
// with its own credential. Keyed by `owner/repo`, lowercased.
// ADR 0018 — `fallback` is the first repo's credential, used for a PR whose
// remote is not one of the project's repos (the same rule the agents' GH_TOKEN
// follows).
async function repoCredentials(
    projectId: string
): Promise<{ byRepo: Map<string, string>; fallback: string | null }> {
    const repos = await db
        .selectFrom('project_repos')
        .select(['git_url', 'credential_id'])
        .where('project_id', '=', projectId)
        .orderBy('position', 'asc')
        .orderBy('created_at', 'asc')
        .execute();
    const byRepo = new Map<string, string>();
    for (const r of repos) {
        const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(r.git_url ?? '');
        if (m && r.credential_id) byRepo.set(`${m[1]}/${m[2]}`.toLowerCase(), r.credential_id);
    }
    return { byRepo, fallback: repos[0]?.credential_id ?? null };
}

async function syncPrStates(itemId: string, onlyStale: boolean): Promise<void> {
    const item = await db
        .selectFrom('items')
        .select(['items.type', 'items.project_id'])
        .where('items.id', '=', itemId)
        .executeTakeFirst();
    if (!item) return;
    const rows = await db
        .selectFrom('item_external_links')
        .selectAll()
        .where('item_id', '=', itemId)
        .where('link_kind', '=', 'pull_request')
        .execute();
    const due = onlyStale ? rows.filter(isStalePr) : rows;
    if (due.length === 0) return;
    const { byRepo, fallback } = await repoCredentials(item.project_id);
    const tokens = new Map<string, string | null>();
    const tokenFor = async (url: string): Promise<string | null> => {
        const pr = parseGithubPrUrl(url);
        const credentialId = (pr && byRepo.get(`${pr.owner}/${pr.repo}`.toLowerCase())) ?? fallback;
        if (!credentialId) return null;
        if (!tokens.has(credentialId)) {
            tokens.set(credentialId, await credentialsService.getToken(credentialId).catch(() => null));
        }
        return tokens.get(credentialId) ?? null;
    };
    let changed = false;
    let newlyMerged = false;
    for (const row of due) {
        const token = await tokenFor(row.url);
        if (!token) continue;
        const state = await fetchGithubPrState(row.url, token);
        await db
            .updateTable('item_external_links')
            .set({
                pr_state_checked_at: new Date().toISOString(),
                ...(state ? { pr_state: state } : {}),
            })
            .where('id', '=', row.id)
            .execute();
        if (state && state !== row.pr_state) changed = true;
        if (state === 'merged' && row.pr_state !== 'merged') newlyMerged = true;
    }
    // One PR per repo (ADR 0017): the Task closes once the last of them merges.
    if (newlyMerged && item.type === 'task') {
        const unmerged = await db
            .selectFrom('item_external_links')
            .select('id')
            .where('item_id', '=', itemId)
            .where('link_kind', '=', 'pull_request')
            .where((eb) => eb.or([eb('pr_state', 'is', null), eb('pr_state', '!=', 'merged')]))
            .executeTakeFirst();
        if (!unmerged) await closeMergedTask(itemId);
    }
    // counts_changed is what the item detail + list queries already refetch on.
    if (changed) broadcastSSE({ type: 'counts_changed', issueType: item.type, issueId: itemId });
}

/**
 * A Task's PR merged: the Owner accepted the branch, so the Task and the
 * sub-tasks it was reviewed with close. A sub-task still open (not reviewed)
 * keeps the Task open for the Owner to decide.
 */
async function closeMergedTask(taskId: string): Promise<void> {
    // Dynamic import: tasks.ts → items.ts is a heavy graph this module
    // otherwise doesn't need, and it keeps external-links free of cycles.
    const { tasksService } = await import('./tasks.js');
    const task = await tasksService.get(taskId);
    if (task?.status !== 'in_review') return;
    await tasksService.closeReviewedSubtasks(taskId, 'pr_merged');
    const open = await db
        .selectFrom('items')
        .select('id')
        .where('parent_id', '=', taskId)
        .where('status', '!=', 'done')
        .executeTakeFirst();
    if (!open) await tasksService.transition(taskId, 'done', false, null, 'pr_merged');
}

interface CreateInput {
    itemId: string;
    url: string;
    linkKind: ExternalLinkKind;
    title?: string | null;
    externalRef?: string | null;
    createdByRunId?: string | null;
    actorAgentId?: string | null;
}

async function recordExternalLinkEvent(
    eventType: 'link_created' | 'link_deleted',
    itemId: string,
    linkKind: ExternalLinkKind,
    url: string,
    actorAgentId: string | null = null,
): Promise<void> {
    await eventsLog.record({
        item_id: itemId,
        event_type: eventType,
        actor_agent_id: actorAgentId,
        field: 'external_link',
        to_value: url,
        detail: `${linkKind} → ${url}`,
    });
}

export const externalLinks = {
    /** All external links attached to an item, newest first. */
    async list(itemId: string): Promise<IItemExternalLink[]> {
        const rows = await db
            .selectFrom('item_external_links')
            .selectAll()
            .where('item_id', '=', itemId)
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc')
            .execute();
        if (rows.some(isStalePr) && !refreshing.has(itemId)) {
            refreshing.add(itemId);
            void syncPrStates(itemId, true)
                .catch(() => undefined)
                .finally(() => refreshing.delete(itemId));
        }
        return rows.map(rowToShared);
    },

    /**
     * Scheduler tick: re-checks (TTL-limited) the PRs of Tasks in review, so
     * a merged PR closes its Task even if nobody opens the Task page.
     */
    async syncReviewedTaskPrs(): Promise<void> {
        const rows = await db
            .selectFrom('item_external_links as l')
            .innerJoin('items as i', 'i.id', 'l.item_id')
            .select('l.item_id')
            .distinct()
            .where('l.link_kind', '=', 'pull_request')
            .where('i.type', '=', 'task')
            .where('i.status', '=', 'in_review')
            .where((eb) => eb.or([eb('l.pr_state', 'is', null), eb('l.pr_state', '=', 'open')]))
            .execute();
        for (const { item_id } of rows) {
            if (refreshing.has(item_id)) continue;
            refreshing.add(item_id);
            try {
                await syncPrStates(item_id, true);
            } finally {
                refreshing.delete(item_id);
            }
        }
    },

    /** Synchronously re-check every PR link on the item, then return the fresh list. */
    async refreshPrStates(itemId: string): Promise<IItemExternalLink[]> {
        await syncPrStates(itemId, false);
        return this.list(itemId);
    },

    /**
     * Insert or return the existing row keyed by (item_id, url). The
     * orchestrator hits the alreadyExists branch of `openPullRequest` on
     * every retry against the same branch, so this MUST be idempotent.
     */
    async create(input: CreateInput): Promise<IItemExternalLink> {
        const inserted = await db
            .insertInto('item_external_links')
            .values({
                item_id: input.itemId,
                link_kind: input.linkKind,
                url: input.url,
                title: input.title ?? null,
                external_ref: input.externalRef ?? null,
                created_by_run_id: input.createdByRunId ?? null,
            })
            .onConflict((oc) => oc.columns(['item_id', 'url']).doNothing())
            .returningAll()
            .executeTakeFirst();
        if (inserted) {
            await recordExternalLinkEvent(
                'link_created',
                input.itemId,
                input.linkKind,
                input.url,
                input.actorAgentId ?? null,
            );
            return rowToShared(inserted);
        }
        // Duplicate: load the existing row so the caller gets the canonical id.
        const existing = await db
            .selectFrom('item_external_links')
            .selectAll()
            .where('item_id', '=', input.itemId)
            .where('url', '=', input.url)
            .executeTakeFirst();
        // Defensive TOCTOU guard: `existing` is only undefined if another
        // transaction deletes the row between the failed (onConflict
        // doNothing) insert and this select — a genuine race that isn't
        // reproducible in a single-threaded unit test without mocking the
        // Kysely query builder.
        /* v8 ignore next 4 */
        if (!existing) {
            throw new Error(
                `external_links.create: insert collided but row not found (item=${input.itemId} url=${input.url})`,
            );
        }
        return rowToShared(existing);
    },

    async delete(linkId: number): Promise<void> {
        const row = await db
            .selectFrom('item_external_links')
            .select(['item_id', 'link_kind', 'url'])
            .where('id', '=', linkId)
            .executeTakeFirst();
        await db.deleteFrom('item_external_links').where('id', '=', linkId).execute();
        if (row) {
            // items.pr_url is a separate column the workflow engine writes; without
            // this the detail page keeps rendering a PR the Owner just unlinked.
            if (row.link_kind === 'pull_request') {
                await db
                    .updateTable('items')
                    .set({ pr_url: null })
                    .where('id', '=', row.item_id)
                    .where('pr_url', '=', row.url)
                    .execute();
            }
            await recordExternalLinkEvent(
                'link_deleted',
                row.item_id,
                row.link_kind as ExternalLinkKind,
                row.url,
            );
        }
    },
};

interface ExternalLinkRow {
    id: number;
    item_id: string;
    link_kind: string;
    url: string;
    title: string | null;
    external_ref: string | null;
    created_at: string | Date;
    created_by_run_id: string | null;
    pr_state: ExternalPrState | null;
    pr_state_checked_at: string | Date | null;
}

function rowToShared(row: ExternalLinkRow): IItemExternalLink {
    return {
        // bigserial round-trips as a string through node-postgres; coerce to
        // the shared `number` type so the wire shape matches IItemExternalLink.
        // The already-a-number arm is defensive typing for a
        // differently-configured driver and is unreachable against the real
        // Postgres connection used in tests.
        /* v8 ignore next */
        id: typeof row.id === 'string' ? Number(row.id) : row.id,
        item_id: row.item_id,
        link_kind: row.link_kind as ExternalLinkKind,
        url: row.url,
        title: row.title,
        external_ref: row.external_ref,
        // node-postgres/Kysely always deserializes `timestamptz` columns as
        // JS `Date` objects with this driver config — the string arm is
        // defensive typing for a differently-configured driver and is
        // unreachable against the real Postgres connection used in tests.
        /* v8 ignore next 3 */
        created_at:
            row.created_at instanceof Date
                ? row.created_at.toISOString()
                : (row.created_at as string),
        created_by_run_id: row.created_by_run_id,
        pr_state: row.pr_state,
    };
}
