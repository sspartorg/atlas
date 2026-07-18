import { db } from '../db/kysely-client.js';
import type { IProjectSchedule } from '@atlas/shared';

function rowToSchedule(r: Record<string, unknown>): IProjectSchedule {
    return {
        project_id: r['project_id'] as string,
        enabled: (r['enabled'] as number) === 1,
        preset: r['preset'] as IProjectSchedule['preset'],
        cron_expression: r['cron_expression'] as string,
        time_of_day: r['time_of_day'] as string,
        weekday: (r['weekday'] as number | null) ?? null,
        skip_if_dirty: (r['skip_if_dirty'] as number) === 1,
        pause_while_agents_active: (r['pause_while_agents_active'] as number) === 1,
        conflict_policy: r['conflict_policy'] as IProjectSchedule['conflict_policy'],
        last_run_at: (r['last_run_at'] as string | null) ?? null,
        last_run_status: (r['last_run_status'] as IProjectSchedule['last_run_status']) ?? null,
        last_run_detail: (r['last_run_detail'] as string | null) ?? null,
        next_run_at: (r['next_run_at'] as string | null) ?? null,
        // auth_failure_count, created_at, updated_at are NOT NULL in the schema;
        // the `?? 0` / `?? ''` right arms are unreachable defensive fallbacks.
        /* v8 ignore start */
        auth_failure_count: (r['auth_failure_count'] as number) ?? 0,
        created_at: (r['created_at'] as string) ?? '',
        updated_at: (r['updated_at'] as string) ?? '',
        /* v8 ignore stop */
    };
}

function defaultSchedule(projectId: string): IProjectSchedule {
    return {
        project_id: projectId,
        enabled: false,
        preset: 'daily',
        cron_expression: '0 6 * * *',
        time_of_day: '06:00',
        weekday: null,
        skip_if_dirty: true,
        pause_while_agents_active: false,
        conflict_policy: 'skip',
        last_run_at: null,
        last_run_status: null,
        last_run_detail: null,
        next_run_at: null,
        auth_failure_count: 0,
        created_at: '',
        updated_at: '',
    };
}

export interface UpsertScheduleInput {
    project_id: string;
    enabled: boolean;
    preset: IProjectSchedule['preset'];
    cron_expression: string;
    time_of_day: string;
    weekday: number | null;
    skip_if_dirty: boolean;
    pause_while_agents_active: boolean;
    conflict_policy: IProjectSchedule['conflict_policy'];
    next_run_at: string | null;
}

export const schedulesService = {
    async getOrDefault(projectId: string): Promise<IProjectSchedule> {
        const row = await db
            .selectFrom('project_schedules')
            .selectAll()
            .where('project_id', '=', projectId)
            .executeTakeFirst();
        return row ? rowToSchedule(row as never) : defaultSchedule(projectId);
    },

    async upsert(input: UpsertScheduleInput): Promise<IProjectSchedule> {
        await db
            .insertInto('project_schedules')
            .values({
                project_id: input.project_id,
                enabled: input.enabled ? 1 : 0,
                preset: input.preset,
                cron_expression: input.cron_expression,
                time_of_day: input.time_of_day,
                weekday: input.weekday,
                skip_if_dirty: input.skip_if_dirty ? 1 : 0,
                pause_while_agents_active: input.pause_while_agents_active ? 1 : 0,
                conflict_policy: input.conflict_policy,
                next_run_at: input.next_run_at,
            })
            .onConflict((oc) =>
                oc.column('project_id').doUpdateSet((eb) => ({
                    enabled: eb.ref('excluded.enabled'),
                    preset: eb.ref('excluded.preset'),
                    cron_expression: eb.ref('excluded.cron_expression'),
                    time_of_day: eb.ref('excluded.time_of_day'),
                    weekday: eb.ref('excluded.weekday'),
                    skip_if_dirty: eb.ref('excluded.skip_if_dirty'),
                    pause_while_agents_active: eb.ref('excluded.pause_while_agents_active'),
                    conflict_policy: eb.ref('excluded.conflict_policy'),
                    next_run_at: eb.ref('excluded.next_run_at'),
                })),
            )
            .execute();
        return this.getOrDefault(input.project_id);
    },

    async delete(projectId: string): Promise<void> {
        await db.deleteFrom('project_schedules').where('project_id', '=', projectId).execute();
    },

    async listEnabled(): Promise<IProjectSchedule[]> {
        const rows = await db
            .selectFrom('project_schedules')
            .selectAll()
            .where('enabled', '=', 1)
            .execute();
        return rows.map((r) => rowToSchedule(r as never));
    },

    async recordRun(
        projectId: string,
        status: IProjectSchedule['last_run_status'],
        detail: string | null,
        nextRunAt: string | null,
    ): Promise<void> {
        await db
            .updateTable('project_schedules')
            .set({
                last_run_at: new Date().toISOString(),
                last_run_status: status,
                last_run_detail: detail,
                next_run_at: nextRunAt,
            })
            .where('project_id', '=', projectId)
            .execute();
    },

    async incrementAuthFailure(projectId: string): Promise<number> {
        await db
            .updateTable('project_schedules')
            .set((eb) => ({ auth_failure_count: eb('auth_failure_count', '+', 1) }))
            .where('project_id', '=', projectId)
            .execute();
        const row = await db
            .selectFrom('project_schedules')
            .select('auth_failure_count')
            .where('project_id', '=', projectId)
            .executeTakeFirst();
        return row?.auth_failure_count ?? 0;
    },

    async resetAuthFailure(projectId: string): Promise<void> {
        await db
            .updateTable('project_schedules')
            .set({ auth_failure_count: 0 })
            .where('project_id', '=', projectId)
            .execute();
    },

    async disable(projectId: string): Promise<void> {
        await db
            .updateTable('project_schedules')
            .set({ enabled: 0, next_run_at: null })
            .where('project_id', '=', projectId)
            .execute();
    },
};
