import { describe, expect, it, beforeEach } from 'vitest';
import { recordTiming, readStats, reset, _registrySize } from './perf-stats.js';

describe('perf-stats registry', () => {
    beforeEach(() => reset());

    it('returns [] when nothing has been recorded', () => {
        expect(readStats()).toEqual([]);
    });

    it('records a single timing and reports p50=p95=p99=that value', () => {
        recordTiming('GET', '/api/x', 200, 50);
        const stats = readStats();
        expect(stats).toHaveLength(1);
        const [row] = stats;
        expect(row?.method).toBe('GET');
        expect(row?.route).toBe('/api/x');
        expect(row?.count).toBe(1);
        expect(row?.p50_ms).toBe(50);
        expect(row?.p95_ms).toBe(50);
        expect(row?.p99_ms).toBe(50);
        expect(row?.max_ms).toBe(50);
        expect(row?.last_status).toBe(200);
    });

    it('computes percentiles across a batch', () => {
        for (let i = 1; i <= 100; i++) recordTiming('GET', '/api/y', 200, i);
        const [row] = readStats();
        // p50 rank = ceil(50) = 50 → index 49 → value 50
        expect(row?.p50_ms).toBe(50);
        // p95 rank = ceil(95) = 95 → index 94 → value 95
        expect(row?.p95_ms).toBe(95);
        // p99 rank = ceil(99) = 99 → index 98 → value 99
        expect(row?.p99_ms).toBe(99);
        expect(row?.max_ms).toBe(100);
        expect(row?.count).toBe(100);
    });

    it('keys by method + route', () => {
        recordTiming('GET', '/api/z', 200, 10);
        recordTiming('POST', '/api/z', 201, 20);
        const stats = readStats();
        expect(stats).toHaveLength(2);
        const get = stats.find((s) => s.method === 'GET');
        const post = stats.find((s) => s.method === 'POST');
        expect(get?.p50_ms).toBe(10);
        expect(post?.p50_ms).toBe(20);
    });

    it('sorts slowest p95 first', () => {
        recordTiming('GET', '/api/fast', 200, 5);
        recordTiming('GET', '/api/slow', 200, 500);
        recordTiming('GET', '/api/medium', 200, 50);
        const stats = readStats();
        expect(stats.map((s) => s.route)).toEqual(['/api/slow', '/api/medium', '/api/fast']);
    });

    it('increments slow_count only when duration crosses threshold', () => {
        recordTiming('GET', '/api/a', 200, 100, 250); // fast
        recordTiming('GET', '/api/a', 200, 400, 250); // slow
        recordTiming('GET', '/api/a', 200, 600, 250); // slow
        const [row] = readStats();
        expect(row?.count).toBe(3);
        expect(row?.slow_count).toBe(2);
    });

    it("uses '<UNKNOWN>' when the route template is empty", () => {
        recordTiming('GET', '', 404, 5);
        const [row] = readStats();
        expect(row?.route).toBe('<UNKNOWN>');
    });

    it('drops the oldest key when the 2000-key cap is hit', () => {
        // Insert 2001 distinct routes; the earliest one should be evicted.
        for (let i = 0; i < 2001; i++) {
            recordTiming('GET', `/api/r${i}`, 200, 1);
        }
        expect(_registrySize()).toBe(2000);
        // /api/r0 was recorded first — it should be the one evicted.
        const stats = readStats();
        expect(stats.find((s) => s.route === '/api/r0')).toBeUndefined();
        expect(stats.find((s) => s.route === '/api/r2000')).toBeDefined();
    });

    it('honors the 500-sample rolling window (lifetime count keeps climbing)', () => {
        for (let i = 0; i < 600; i++) recordTiming('GET', '/api/w', 200, i);
        const [row] = readStats();
        expect(row?.count).toBe(600); // lifetime not truncated
        // With only the last 500 samples (values 100..599), p50 is at
        // sorted index 249 → value 349.
        expect(row?.p50_ms).toBe(349);
    });

    it('reset() clears the registry', () => {
        recordTiming('GET', '/api/x', 200, 10);
        expect(_registrySize()).toBe(1);
        reset();
        expect(_registrySize()).toBe(0);
        expect(readStats()).toEqual([]);
    });
});
