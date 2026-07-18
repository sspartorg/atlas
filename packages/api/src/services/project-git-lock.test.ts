import { describe, expect, it } from 'vitest';
import { withProjectGitLock } from './project-git-lock.js';

// Workstream #3 — per-project mutex for git operations. Same project
// serializes; different projects run in parallel. In-process only.

describe('withProjectGitLock', () => {
    it('serializes concurrent calls on the same projectId', async () => {
        const events: string[] = [];
        const task = (label: string, delayMs: number) => async () => {
            events.push(`${label}:start`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            events.push(`${label}:end`);
            return label;
        };

        const [a, b, c] = await Promise.all([
            withProjectGitLock('proj-1', task('A', 30)),
            withProjectGitLock('proj-1', task('B', 10)),
            withProjectGitLock('proj-1', task('C', 5)),
        ]);

        expect([a, b, c]).toEqual(['A', 'B', 'C']);
        // Each task's start must directly follow the previous task's end.
        expect(events).toEqual([
            'A:start',
            'A:end',
            'B:start',
            'B:end',
            'C:start',
            'C:end',
        ]);
    });

    it('lets different projectIds run in parallel', async () => {
        const events: string[] = [];
        const task = (label: string, delayMs: number) => async () => {
            events.push(`${label}:start`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            events.push(`${label}:end`);
            return label;
        };

        const start = Date.now();
        await Promise.all([
            withProjectGitLock('proj-A', task('A', 30)),
            withProjectGitLock('proj-B', task('B', 30)),
        ]);
        const elapsed = Date.now() - start;

        // Parallel execution: both ~30 ms tasks finish well under 60 ms.
        expect(elapsed).toBeLessThan(55);
        // Both starts happen before either end (interleaved, not serialized).
        const aStart = events.indexOf('A:start');
        const bStart = events.indexOf('B:start');
        const aEnd = events.indexOf('A:end');
        const bEnd = events.indexOf('B:end');
        expect(Math.max(aStart, bStart)).toBeLessThan(Math.min(aEnd, bEnd));
    });

    it('queue survives a rejecting task — next call still runs', async () => {
        const events: string[] = [];

        const first = withProjectGitLock('proj-X', async () => {
            events.push('first:start');
            throw new Error('boom');
        });

        await expect(first).rejects.toThrow('boom');

        const second = await withProjectGitLock('proj-X', async () => {
            events.push('second:ran');
            return 42;
        });

        expect(second).toBe(42);
        expect(events).toEqual(['first:start', 'second:ran']);
    });

    it('returns the wrapped function value (preserves typing)', async () => {
        const result = await withProjectGitLock('proj-T', async () => ({
            opened: true,
            url: 'https://example.com/pr/1',
        }));

        expect(result).toEqual({ opened: true, url: 'https://example.com/pr/1' });
    });
});
