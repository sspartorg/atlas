import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import { sendWebPushForNotification } from './web-push.js';
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
}

interface ListFilter {
    kind?: NotificationKind | undefined;
    external_status?: NotificationDeliveryStatus | undefined;
    limit?: number | undefined;
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
        created_at: row['created_at'] as string,
    };
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
            'n.created_at as created_at',
            'i.type as item_type',
        ]);
}

export const notificationsService = {
    async list(filter: ListFilter = {}): Promise<INotification[]> {
        let q = selectNotificationsWithItemType();
        if (filter.kind) q = q.where('n.kind', '=', filter.kind);
        if (filter.external_status) q = q.where('n.external_status', '=', filter.external_status);
        const rows = await q
            .orderBy('n.created_at', 'desc')
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
                link_url: data.link_url ?? null,
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
        await db
            .updateTable('notifications')
            .set({
                external_status: status,
                failure_reason: failureReason,
                sent_external: sentFlag,
            })
            .where('id', '=', id)
            .execute();
        broadcastSSE({ type: 'notification_updated', notificationId: id });
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

    async cancel(id: number): Promise<boolean> {
        const row = await this.get(id);
        if (!row || row.external_status !== 'pending') return false;
        await this.updateExternalStatus(id, 'none', null);
        return true;
    },

    async markAllRead(): Promise<number> {
        const r = await db
            .updateTable('notifications')
            .set({ read_at: new Date().toISOString() })
            .where('read_at', 'is', null)
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
            .selectFrom('notifications')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('read_at', 'is', null)
            .executeTakeFirst();
        // countAll() + executeTakeFirst() always returns exactly one row.
        /* v8 ignore next */
        return Number(r?.n ?? 0);
    },
};
