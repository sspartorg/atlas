import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../db/kysely-client.js';
import { eventsLog } from './events-log.js';
import type { ExternalLinkKind, IItemExternalLink } from '@atlas/shared';

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

interface CreateInput {
    itemId: string;
    url: string;
    linkKind: ExternalLinkKind;
    title?: string | null;
    externalRef?: string | null;
    createdByRunId?: string | null;
}

async function recordExternalLinkEvent(
    eventType: 'link_created' | 'link_deleted',
    itemId: string,
    linkKind: ExternalLinkKind,
    url: string,
): Promise<void> {
    await eventsLog.record({
        item_id: itemId,
        event_type: eventType,
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
        return rows.map(rowToShared);
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
    };
}
