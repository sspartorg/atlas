import { describe, expect, it, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { perfRoutes } from './perf.js';
import { recordTiming, reset } from '../services/perf-stats.js';

describe('GET /api/_perf/routes', () => {
    beforeEach(() => reset());

    it('returns [] when no timings recorded', async () => {
        const app = Fastify({ logger: false });
        await app.register(perfRoutes);
        const res = await app.inject({ method: 'GET', url: '/api/_perf/routes' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([]);
        await app.close();
    });

    it('surfaces recorded stats sorted slowest p95 first', async () => {
        recordTiming('GET', '/api/one', 200, 10);
        recordTiming('GET', '/api/one', 200, 20);
        recordTiming('GET', '/api/two', 200, 500);
        const app = Fastify({ logger: false });
        await app.register(perfRoutes);
        const res = await app.inject({ method: 'GET', url: '/api/_perf/routes' });
        expect(res.statusCode).toBe(200);
        const body = res.json() as Array<{ route: string; p95_ms: number }>;
        expect(body[0]?.route).toBe('/api/two');
        expect(body[1]?.route).toBe('/api/one');
    });
});
