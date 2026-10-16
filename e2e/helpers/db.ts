import { execFileSync } from 'node:child_process';

// Plain SQL on the e2e DB (atlas_e2e on the dev postgres container), for
// seeding rows no API produces on demand and for hand-computed expectations.

/** Rows of a query, tab-separated columns. */
export function sql(query: string): string[][] {
    const out = execFileSync('docker', ['exec', 'atlas-postgres', 'psql', '-U', 'atlas', '-d', 'atlas_e2e', '-v', 'ON_ERROR_STOP=1', '-tAF', '\t', '-c', query], {
        encoding: 'utf8',
    });
    return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t'));
}

export const one = (query: string): string => sql(query)[0]?.[0] ?? '';

/** A SQL string literal. */
const lit = (v: string | null): string => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

export interface NotificationRow {
    event_type: string;
    message: string;
    kind?: 'needs_you' | 'update' | 'system';
    item_id?: string | null;
    project_id?: string | null;
    agent_id?: string | null;
    external_status?: 'none' | 'pending' | 'sent' | 'failed';
    failure_reason?: string | null;
    push_status?: 'none' | 'pending' | 'sent' | 'failed';
    link_url?: string | null;
    deferred?: boolean;
    reminder_id?: number | null;
    in_app?: boolean;
    read?: boolean;
    /** Minutes ago. */
    ago?: number;
}

/** Insert notification rows directly (no SSE); returns their ids in order. */
export function insertNotifications(rows: NotificationRow[]): number[] {
    if (rows.length === 0) return [];
    const values = rows
        .map(
            (r) =>
                `(${lit(r.event_type)}, ${lit(r.message)}, ${lit(r.kind ?? 'update')}, ${lit(r.item_id ?? null)}, ${lit(r.project_id ?? null)}, ${lit(r.agent_id ?? null)}, ` +
                `${lit(r.external_status ?? 'none')}, ${r.external_status === 'sent' ? 1 : 0}, ${lit(r.failure_reason ?? null)}, ${lit(r.push_status ?? 'none')}, ${lit(r.link_url ?? null)}, ` +
                `${r.deferred ? 'now()' : 'NULL'}, ${r.reminder_id ?? 'NULL'}, ${r.in_app === false ? 'false' : 'true'}, ${r.read ? 'now()' : 'NULL'}, now() - interval '${r.ago ?? 1} minutes')`,
        )
        .join(',\n');
    return sql(
        `INSERT INTO notifications (event_type, message, kind, item_id, project_id, agent_id, external_status, sent_external, failure_reason, push_status, link_url, external_deferred_at, reminder_id, in_app, read_at, created_at) VALUES ${values} RETURNING id`,
    ).map((r) => Number(r[0]));
}
