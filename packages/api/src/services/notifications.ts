import { sql, type ExpressionBuilder } from 'kysely';
import { db } from '../db/kysely-client.js';
import type { DB } from '../db/types.js';
import { broadcastSSE } from '../routes/events.js';
import { sendWebPushForNotification } from './web-push.js';
import { notificationLinkUrl } from '@atlas/shared';
import type {
    INotification,
    IssueType,
    NotificationKind,
    PushDeliveryStatus,
    NotificationDeliveryStatus,
} from '@atlas/shared';

interface CreateInput {
    event_type: string;
    message: string;
    kind?: NotificationKind;
    issue_type?: IssueType | null;
    issue_id?: string | null;
    project_id?: string | null;
    agent_id?: string | null;
    external_status?: NotificationDeliveryStatus;
    failure_reason?: string | null;
    /** Optional deep-link target — overrides the issue_type/issue_id-derived
     *  URL when set. Used by terminal idle notifications etc. */
    link_url?: string | null;
    /** Set by reminder fires — the fire log (`GET /api/reminders/:id/fires`). */
    reminder_id?: number | null;
    /** False = log-only (external-only reminder, MCP send): no feed row, no
     *  unread count, no web push. Defaults to true. */
    in_app?: boolean;
}

interface ListFilter {
    kind?: NotificationKind | undefined;
    external_status?: NotificationDeliveryStatus | undefined;
    limit?: number | undefined;
    // Keyset cursor: rows strictly older than this notification id's row.
    before?: number | undefined;
    in_app?: boolean | undefined;
}

export const SKIPPED_WHILE_HELD = 'Skipped: event turned off while held';
export const INTERRUPTED_TWICE = 'Send interrupted twice (the server stopped mid-send). Press Retry to send it.';
// A cancelled send stays in the Notification Log (`none` + this reason) with
// Send now, instead of vanishing. The web keys its "Cancelled" chip off the
// leading word.
export const CANCELLED_BY_OWNER = 'Cancelled by you';
export const SKIPPED_NO_CHANNEL = 'Skipped: no channel was connected when it was due';

interface ClaimedRow {
    id: number;
    message: string;
    created_at: string;
    external_event_key: string | null;
}

function toClaimed(r: { id: number; message: string; created_at: unknown; external_event_key: string | null }): ClaimedRow {
    return {
        id: Number(r.id),
        message: r.message,
        // timestamptz arrives as a Date from node-postgres whatever the column type says.
        created_at: new Date(r.created_at as string | Date).toISOString(),
        external_event_key: r.external_event_key,
    };
}

// One row of the notifications-with-item-type join. Avoids the previous N+1
// where every notification triggered a follow-up `SELECT type FROM items`.
function rowToNotification(row: Record<string, unknown>): INotification {
    // notifications.id is BIGINT in PG; node-postgres returns BIGINT as a
    // string to avoid JS Number precision loss. Our id sequence never gets
    // anywhere near 2^53, so coerce to number to match INotification.id.
    return {
        id: Number(row['id']),
        event_type: row['event_type'] as string,
        message: row['message'] as string,
        issue_type: (row['item_type'] as IssueType | null) ?? null,
        issue_id: (row['item_id'] as string | null) ?? null,
        project_id: (row['project_id'] as string | null) ?? null,
        sent_external: row['sent_external'] as number,
        kind: row['kind'] as NotificationKind,
        agent_id: (row['agent_id'] as string | null) ?? null,
        external_status: row['external_status'] as NotificationDeliveryStatus,
        failure_reason: (row['failure_reason'] as string | null) ?? null,
        // push_status is NOT NULL DEFAULT 'none' in the DB (migration 008) so
        // every row always carries a value; the `?? 'none'` fallback only
        // exists because the row shape is typed as Record<string, unknown>.
        /* v8 ignore next */
        push_status: (row['push_status'] as PushDeliveryStatus | undefined) ?? 'none',
        push_failure_reason: (row['push_failure_reason'] as string | null) ?? null,
        read_at: (row['read_at'] as string | null) ?? null,
        link_url: (row['link_url'] as string | null) ?? null,
        external_deferred_at: (row['external_deferred_at'] as string | null) ?? null,
        reminder_id: row['reminder_id'] == null ? null : Number(row['reminder_id']),
        in_app: row['in_app'] !== false,
        created_at: row['created_at'] as string,
    };
}

// A completion `needs_you` is a snapshot of "item is waiting on you"; once
// the item moves on it is stale and must drop out of the feed + badge. A
// newer one on the same item supersedes it too: otherwise an answered
// question resurfaced the moment the item reached in_review for its PR.
// Scoped to agent_completed and workflow_run — the two producers whose
// needs_you means "this item is parked on you / its PR is ready" (a workflow
// run's were never scoped, so they outlived the item). agent_error /
// terminal-idle prompts are not derived from item status and must survive
// whatever state the item is in.
/**
 * One plain line for a notification. Agents write their reasons in markdown;
 * the feed row, badge tooltip and external channel all showed it raw
 * ("## Brainstorm — …`todo count`…"). The comment thread keeps the markdown.
 */
export function plainNotice(text: string, max = 240): string {
    const line = text
        .replace(/`{1,3}/g, '')
        .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/#{1,6}\s+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const ITEM_STATE_EVENTS = ['agent_completed', 'workflow_run'];

function notStaleNeedsYou(
    eb: ExpressionBuilder<DB & { n: DB['notifications']; i: DB['items'] }, 'n' | 'i'>,
) {
    return eb.or([
        eb('n.kind', '!=', 'needs_you'),
        eb('n.event_type', 'not in', ITEM_STATE_EVENTS),
        eb('i.id', 'is', null),
        eb.and([
            eb('i.status', 'in', ['waiting_for_info', 'in_review']),
            eb.not(
                eb.exists(
                    eb
                        .selectFrom('notifications as newer')
                        .select('newer.id')
                        .whereRef('newer.item_id', '=', 'n.item_id')
                        .where('newer.kind', '=', 'needs_you')
                        .where('newer.event_type', 'in', ITEM_STATE_EVENTS)
                        .whereRef('newer.id', '>', 'n.id'),
                ),
            ),
        ]),
    ]);
}

function selectNotificationsWithItemType() {
    return db
        .selectFrom('notifications as n')
        .leftJoin('items as i', 'i.id', 'n.item_id')
        .select([
            'n.id as id',
            'n.event_type as event_type',
            'n.message as message',
            'n.item_id as item_id',
            'n.project_id as project_id',
            'n.sent_external as sent_external',
            'n.kind as kind',
            'n.agent_id as agent_id',
            'n.external_status as external_status',
            'n.failure_reason as failure_reason',
            'n.push_status as push_status',
            'n.push_failure_reason as push_failure_reason',
            'n.read_at as read_at',
            'n.link_url as link_url',
            'n.external_deferred_at as external_deferred_at',
            'n.reminder_id as reminder_id',
            'n.in_app as in_app',
            'n.created_at as created_at',
            'i.type as item_type',
        ]);
}

export const notificationsService = {
    async list(filter: ListFilter = {}): Promise<INotification[]> {
        let q = selectNotificationsWithItemType().where(notStaleNeedsYou);
        if (filter.kind) q = q.where('n.kind', '=', filter.kind);
        if (filter.external_status) q = q.where('n.external_status', '=', filter.external_status);
        if (filter.in_app !== undefined) q = q.where('n.in_app', '=', filter.in_app);
        if (filter.before !== undefined) {
            q = q.where(
                sql<boolean>`(n.created_at, n.id) < (SELECT c.created_at, c.id FROM notifications c WHERE c.id = ${filter.before})`,
            );
        }
        const rows = await q
            .orderBy('n.created_at', 'desc')
            .orderBy('n.id', 'desc')
            .limit(filter.limit ?? 50)
            .execute();
        return rows.map((r) => rowToNotification(r as Record<string, unknown>));
    },

    async get(id: number): Promise<INotification | null> {
        const row = await selectNotificationsWithItemType()
            .where('n.id', '=', id)
            .executeTakeFirst();
        return row ? rowToNotification(row as Record<string, unknown>) : null;
    },

    async create(data: CreateInput): Promise<INotification> {
        // Stamp the click target now, while the producer's context is known, so
        // the feed, push and log never have to guess it later.
        let issueType = data.issue_type ?? null;
        if (!data.link_url && data.issue_id && !issueType) {
            const item = await db.selectFrom('items').select('type').where('id', '=', data.issue_id).executeTakeFirst();
            issueType = (item?.type as IssueType | undefined) ?? null;
        }
        const linkUrl = notificationLinkUrl({
            link_url: data.link_url ?? null,
            issue_type: issueType,
            issue_id: data.issue_id ?? null,
            project_id: data.project_id ?? null,
            event_type: data.event_type,
        });
        const inserted = await db
            .insertInto('notifications')
            .values({
                event_type: data.event_type,
                message: data.message,
                item_id: data.issue_id ?? null,
                project_id: data.project_id ?? null,
                sent_external: 0,
                kind: data.kind ?? 'update',
                agent_id: data.agent_id ?? null,
                external_status: data.external_status ?? 'none',
                failure_reason: data.failure_reason ?? null,
                link_url: linkUrl,
                reminder_id: data.reminder_id ?? null,
                in_app: data.in_app ?? true,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        // Re-select via the join so the response carries item_type without
        // requiring a second per-row lookup in callers.
        const row = await selectNotificationsWithItemType()
            .where('n.id', '=', inserted.id as number)
            .executeTakeFirstOrThrow();
        const created = rowToNotification(row as Record<string, unknown>);
        broadcastSSE({
            type: 'notification_created',
            notificationId: created.id,
            notificationKind: created.kind,
        });
        // A log-only row changes no badge and has nothing to push to the browser.
        if (!created.in_app) return created;
        broadcastSSE({ type: 'counts_changed' });
        // Web push fan-out runs after the row + SSE broadcast so an outbound
        // delivery hiccup can never wedge the in-app feed. The push service
        // catches its own errors and updates `push_status` accordingly; the
        // wrapper here just guarantees a synchronous create() return.
        void sendWebPushForNotification(created.id).catch(() => {});
        return created;
    },

    async updateExternalStatus(
        id: number,
        status: NotificationDeliveryStatus,
        failureReason: string | null = null,
    ): Promise<void> {
        const sentFlag = status === 'sent' ? 1 : 0;
        // `pending` here means "in flight": stamp the claim the stuck-send
        // sweep reads. Any settled status clears it.
        const claim =
            status === 'pending'
                ? { external_claimed_at: new Date().toISOString() }
                : { external_claimed_at: null, external_reclaimed: false };
        await db
            .updateTable('notifications')
            .set({
                external_status: status,
                failure_reason: failureReason,
                sent_external: sentFlag,
                external_deferred_at: null,
                ...claim,
            })
            .where('id', '=', id)
            .execute();
        broadcastSSE({ type: 'notification_updated', notificationId: id });
    },

    /** Quiet hours: hold the outward send until `flushDeferredExternal`. The
     *  event key is kept so the flush can re-check its toggle. */
    async holdExternal(id: number, at: Date, eventKey: string | null = null): Promise<void> {
        await db
            .updateTable('notifications')
            .set({
                external_status: 'pending',
                failure_reason: null,
                sent_external: 0,
                external_deferred_at: at.toISOString(),
                external_event_key: eventKey,
                external_claimed_at: null,
                external_reclaimed: false,
            })
            .where('id', '=', id)
            .execute();
        broadcastSSE({ type: 'notification_updated', notificationId: id });
    },

    /**
     * Claim every held send (CAS: only rows still held and pending), oldest
     * first. The claim clears `external_deferred_at` and stamps
     * `external_claimed_at`, so a concurrent tick or a Cancel that lands first
     * wins, the row is never sent twice, and a process that dies before
     * reaching it leaves a claim the stuck-send sweep can see.
     */
    async claimDeferred(now: Date = new Date()): Promise<ClaimedRow[]> {
        const rows = await db
            .updateTable('notifications')
            .set({ external_deferred_at: null, external_claimed_at: now.toISOString() })
            .where('external_deferred_at', 'is not', null)
            .where('external_status', '=', 'pending')
            .returning(['id', 'message', 'created_at', 'external_event_key'])
            .execute();
        return rows
            .map(toClaimed)
            .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
    },

    /**
     * Sends stuck in flight (claimed before `cutoff`, still `pending`): the
     * process died mid-send. A row already re-claimed once is marked failed;
     * the rest are re-claimed (CAS on the old claim) and returned to retry.
     */
    async reclaimStuck(cutoff: Date, now: Date = new Date()): Promise<ClaimedRow[]> {
        const stuck = (eb: ExpressionBuilder<DB, 'notifications'>) =>
            eb.and([
                eb('external_status', '=', 'pending'),
                eb('external_deferred_at', 'is', null),
                eb('external_claimed_at', '<', cutoff.toISOString()),
            ]);
        const failed = await db
            .updateTable('notifications')
            .set({
                external_status: 'failed',
                failure_reason: INTERRUPTED_TWICE,
                sent_external: 0,
                external_claimed_at: null,
                external_reclaimed: false,
            })
            .where(stuck)
            .where('external_reclaimed', '=', true)
            .returning('id')
            .execute();
        for (const r of failed) broadcastSSE({ type: 'notification_updated', notificationId: Number(r.id) });
        const rows = await db
            .updateTable('notifications')
            .set({ external_claimed_at: now.toISOString(), external_reclaimed: true })
            .where(stuck)
            .where('external_reclaimed', '=', false)
            .returning(['id', 'message', 'created_at', 'external_event_key'])
            .execute();
        return rows.map(toClaimed).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
    },

    async updatePushStatus(
        id: number,
        status: PushDeliveryStatus,
        failureReason: string | null = null,
    ): Promise<void> {
        await db
            .updateTable('notifications')
            .set({
                push_status: status,
                push_failure_reason: failureReason,
            })
            .where('id', '=', id)
            .execute();
        broadcastSSE({ type: 'notification_updated', notificationId: id });
    },

    async markSent(id: number): Promise<void> {
        await this.updateExternalStatus(id, 'sent', null);
    },

    /** CAS on `pending`, so a flush that claimed the row first is never undone. */
    async cancel(id: number): Promise<boolean> {
        const r = await db
            .updateTable('notifications')
            .set({
                external_status: 'none',
                failure_reason: CANCELLED_BY_OWNER,
                sent_external: 0,
                external_deferred_at: null,
                external_claimed_at: null,
                external_reclaimed: false,
            })
            .where('id', '=', id)
            .where('external_status', '=', 'pending')
            .executeTakeFirst();
        /* v8 ignore next */
        if (Number(r.numUpdatedRows ?? 0) === 0) return false;
        broadcastSSE({ type: 'notification_updated', notificationId: id });
        return true;
    },

    async markAllRead(): Promise<number> {
        const r = await db
            .updateTable('notifications')
            .set({ read_at: new Date().toISOString() })
            .where('read_at', 'is', null)
            .where('in_app', '=', true)
            .executeTakeFirst();
        // Kysely's UpdateResult always carries numUpdatedRows (0n when no
        // rows matched, never undefined) — defensive fallback for the type.
        /* v8 ignore next */
        const changes = Number(r.numUpdatedRows ?? 0);
        if (changes > 0) {
            broadcastSSE({ type: 'notification_updated' });
            broadcastSSE({ type: 'counts_changed' });
        }
        return changes;
    },

    async markRead(id: number): Promise<boolean> {
        const r = await db
            .updateTable('notifications')
            .set({ read_at: new Date().toISOString() })
            .where('id', '=', id)
            .where('read_at', 'is', null)
            .executeTakeFirst();
        // Same defensive fallback as markAllRead above — numUpdatedRows is
        // always present on Kysely's UpdateResult.
        /* v8 ignore next */
        const ok = Number(r.numUpdatedRows ?? 0) > 0;
        if (ok) {
            broadcastSSE({ type: 'notification_updated', notificationId: id });
            broadcastSSE({ type: 'counts_changed' });
        }
        return ok;
    },

    async countUnread(): Promise<number> {
        const r = await db
            .selectFrom('notifications as n')
            .leftJoin('items as i', 'i.id', 'n.item_id')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('n.read_at', 'is', null)
            .where('n.in_app', '=', true)
            .where(notStaleNeedsYou)
            .executeTakeFirst();
        // countAll() + executeTakeFirst() always returns exactly one row.
        /* v8 ignore next */
        return Number(r?.n ?? 0);
    },
};
