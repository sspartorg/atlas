import { Cron } from 'croner';
import type { IProjectSchedule } from '@atlas/shared';
import { schedulesService } from './schedules.js';
import { runAutoFetch } from './auto-fetch-runner.js';

// ADR 0018 — one timer per repo, keyed by repo id.
const jobs = new Map<string, Cron>();

export function registerOne(s: IProjectSchedule): void {
    unregisterOne(s.repo_id);
    const job = new Cron(s.cron_expression, { catch: true, protect: true }, () => {
        void runAutoFetch(s.repo_id);
    });
    jobs.set(s.repo_id, job);
}

export function unregisterOne(repoId: string): void {
    const job = jobs.get(repoId);
    if (job) {
        job.stop();
        jobs.delete(repoId);
    }
}

export function nextRun(repoId: string): Date | null {
    const job = jobs.get(repoId);
    return job?.nextRun() ?? null;
}

export function registeredCount(): number {
    return jobs.size;
}

export async function bootSchedules(): Promise<void> {
    const enabled = await schedulesService.listEnabled();
    for (const s of enabled) {
        registerOne(s);
        const next = nextRun(s.repo_id);
        if (next) {
            await schedulesService.recordRun(
                s.repo_id,
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
            void runAutoFetch(s.repo_id);
        }
    }
}

/** Test-only: clear all registrations. */
export function _resetForTests(): void {
    for (const job of jobs.values()) job.stop();
    jobs.clear();
}
