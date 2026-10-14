import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { registerCompression } from './compression.js';

const big = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Task ${i}` })) };

async function app() {
    const a = Fastify();
    registerCompression(a);
    a.get('/big', async () => big);
    a.get('/small', async () => ({ ok: true }));
    a.get('/stream', async (_req, reply) =>
        reply.type('application/octet-stream').send(Readable.from([Buffer.alloc(4096, 1)]))
    );
    a.get('/sse', async (_req, reply) =>
        reply.type('text/event-stream').send('data: x\n\n'.repeat(500))
    );
    a.get('/vary', async (_req, reply) => reply.header('vary', 'Origin').send(big));
    await a.ready();
    return a;
}

describe('response compression', () => {
    it('sends brotli to clients that accept it, and it decodes to the same JSON', async () => {
        const a = await app();
        const res = await a.inject({ url: '/big', headers: { 'accept-encoding': 'gzip, br' } });
        expect(res.headers['content-encoding']).toBe('br');
        expect(res.headers['vary']).toBe('Accept-Encoding');
        expect(JSON.parse(brotliDecompressSync(res.rawPayload).toString())).toEqual(big);
        expect(res.rawPayload.length).toBeLessThan(JSON.stringify(big).length / 3);
    });

    it('falls back to gzip, and to nothing for clients that accept neither', async () => {
        const a = await app();
        const gz = await a.inject({ url: '/big', headers: { 'accept-encoding': 'gzip' } });
        expect(gz.headers['content-encoding']).toBe('gzip');
        expect(JSON.parse(gunzipSync(gz.rawPayload).toString())).toEqual(big);
        const plain = await a.inject({ url: '/big' });
        expect(plain.headers['content-encoding']).toBeUndefined();
        expect(plain.json()).toEqual(big);
    });

    it('leaves small bodies, streams and event streams alone', async () => {
        const a = await app();
        const h = { 'accept-encoding': 'br' };
        expect(
            (await a.inject({ url: '/small', headers: h })).headers['content-encoding']
        ).toBeUndefined();
        expect(
            (await a.inject({ url: '/stream', headers: h })).headers['content-encoding']
        ).toBeUndefined();
        expect(
            (await a.inject({ url: '/sse', headers: h })).headers['content-encoding']
        ).toBeUndefined();
    });

    it('adds to an existing Vary header instead of replacing it', async () => {
        const a = await app();
        const res = await a.inject({ url: '/vary', headers: { 'accept-encoding': 'br' } });
        expect(res.headers['vary']).toBe('Origin, Accept-Encoding');
    });
});
