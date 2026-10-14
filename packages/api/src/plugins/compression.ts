import type { FastifyInstance } from 'fastify';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

// Below this a compressed body plus headers isn't worth the CPU.
const MIN_BYTES = 1024;
const COMPRESSIBLE = /json|text\/(?!event-stream)|javascript|xml|svg/;

/**
 * Compress JSON/text responses for clients that accept it (ADR 0030).
 *
 * The API sent every body uncompressed: `/api/tasks` on a 2,100-task
 * workspace was 888 KB on the wire and 26 KB gzipped. Brotli at quality 4
 * costs about what gzip -6 does and compresses better; gzip is the fallback.
 * Streams (file downloads) and hijacked replies (the SSE route) never reach
 * this hook with a string/Buffer payload, so they pass through untouched.
 */
export function registerCompression(app: FastifyInstance): void {
    app.addHook('onSend', async (req, reply, payload) => {
        if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
        if (reply.getHeader('content-encoding')) return payload;
        if (!COMPRESSIBLE.test(String(reply.getHeader('content-type') ?? ''))) return payload;
        const size = Buffer.byteLength(payload);
        if (size < MIN_BYTES) return payload;

        const vary = reply.getHeader('vary');
        reply.header('vary', vary ? `${String(vary)}, Accept-Encoding` : 'Accept-Encoding');
        const accept = String(req.headers['accept-encoding'] ?? '');
        if (/\bbr\b/.test(accept)) {
            reply.header('content-encoding', 'br');
            reply.removeHeader('content-length');
            return brotli(payload, {
                params: {
                    [constants.BROTLI_PARAM_QUALITY]: 4,
                    [constants.BROTLI_PARAM_SIZE_HINT]: size,
                },
            });
        }
        if (/\bgzip\b/.test(accept)) {
            reply.header('content-encoding', 'gzip');
            reply.removeHeader('content-length');
            return gzipAsync(payload);
        }
        return payload;
    });
}
