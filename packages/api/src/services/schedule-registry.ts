import { Cron } from 'croner';
import type { IProjectSchedule } from '@atlas/shared';
import { schedulesService } from './schedules.js';
import { runAutoFetch } from './auto-fetch-runner.js';

const jobs = new Map<string, Cron>();

export function registerOne(s: IProjectSchedule): void {
    unregisterOne(s.project_id);
    const job = new Cron(s.cron_expression, { catch: true, protect: true }, () => {
        void runAutoFetch(s.project_id);
    });
    jobs.set(s.project_id, job);
}

export function unregisterOne(projectId: string): void {
    const job = jobs.get(projectId);
    if (job) {
        job.stop();
        jobs.delete(projectId);
    }
}

export function nextRun(projectId: string): Date | null {
    const job = jobs.get(projectId);
    return job?.nextRun() ?? null;
}

export function registeredCount(): number {
    return jobs.size;
}

export async function bootSchedules(): Promise<void> {
    const enabled = await schedulesService.listEnabled();
    for (const s of enabled) {
        registerOne(s);
        const next = nextRun(s.project_id);
        if (next) {
            await schedulesService.recordRun(
                s.project_id,
                s.last_run_status,
                s.last_run_detail,
                next.toISOString(),
            );
        }
    }
}

export async function catchUpMissedFires(): Promise<void> {
    const now = Date.now();
    const enabled = await schedulesService.listEnabled();
    for (const s of enabled) {
        if (s.next_run_at && new Date(s.next_run_at).getTime() < now) {
            void runAutoFetch(s.project_id);
        }
    }
}

/** Test-only: clear all registrations. */
export function _resetForTests(): void {
    for (const job of jobs.values()) job.stop();
    jobs.clear();
}
