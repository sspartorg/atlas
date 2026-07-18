import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { scratchPadService, inferTitle } from './scratch-pad.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';

// T5 — Service-level coverage for the inferred-title backstop. Routes
// already have CRUD coverage in `routes/scratchPad.test.ts`; this file
// proves the server-side title fill kicks in even when the client (or an
// MCP caller) skips it.

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('inferTitle', () => {
    it('returns the original title when non-blank', () => {
        expect(inferTitle('Meeting notes', 'body irrelevant')).toBe('Meeting notes');
    });

    it('preserves leading whitespace when the title still has visible content', () => {
        // We only treat fully-blank titles as "needs inferring" — a title
        // with content shouldn't get rewritten.
        expect(inferTitle('  Real title', 'body')).toBe('  Real title');
    });

    it('falls back to the first 3 words of the body when title is blank', () => {
        expect(inferTitle('', 'Plan the migration tomorrow afternoon')).toBe(
            'Plan the migration',
        );
    });

    it('treats whitespace-only title the same as blank', () => {
        expect(inferTitle('   ', 'A small thought about scope')).toBe('A small thought');
    });

    it('uses fewer than 3 words when the body is short', () => {
        expect(inferTitle('', 'Hello')).toBe('Hello');
        expect(inferTitle('', 'Hello world')).toBe('Hello world');
    });

    it('collapses runs of whitespace inside the body when picking words', () => {
        expect(inferTitle('', '  one   two   three   four  ')).toBe('one two three');
    });

    it('returns "Untitled" when both title and body are blank', () => {
        expect(inferTitle('', '')).toBe('Untitled');
        expect(inferTitle('  ', '   ')).toBe('Untitled');
    });
});

describe('scratchPadService update — title backstop', () => {
    it('applies inferTitle when the PATCH ships an empty title alongside a body', async () => {
        const created = await scratchPadService.create({});
        const updated = await scratchPadService.update(created.id, {
            title: '',
            body_md: 'Refactor the autosave debounce path',
        });
        expect(updated?.title).toBe('Refactor the autosave');
        expect(updated?.body_md).toBe('Refactor the autosave debounce path');
    });

    it('applies inferTitle using the EXISTING body when only the empty title is patched', async () => {
        const created = await scratchPadService.create({
            title: '',
            body_md: 'A thought worth keeping forever',
        });
        const updated = await scratchPadService.update(created.id, { title: '' });
        expect(updated?.title).toBe('A thought worth');
        expect(updated?.body_md).toBe('A thought worth keeping forever');
    });

    it('persists "Untitled" when both title and body are empty', async () => {
        const created = await scratchPadService.create({});
        const updated = await scratchPadService.update(created.id, {
            title: '',
            body_md: '',
        });
        expect(updated?.title).toBe('Untitled');
    });

    it('leaves a non-blank title untouched', async () => {
        const created = await scratchPadService.create({});
        const updated = await scratchPadService.update(created.id, {
            title: 'Explicit title',
            body_md: 'long body that should be ignored for naming',
        });
        expect(updated?.title).toBe('Explicit title');
    });

    it('returns undefined when the row does not exist (even with blank title)', async () => {
        const updated = await scratchPadService.update('does-not-exist', { title: '' });
        expect(updated).toBeUndefined();
    });

    it('does not touch the title when the patch omits it entirely', async () => {
        const created = await scratchPadService.create({ title: 'Keep me', body_md: 'x' });
        const updated = await scratchPadService.update(created.id, { body_md: 'y' });
        expect(updated?.title).toBe('Keep me');
        expect(updated?.body_md).toBe('y');
    });

    it('returns undefined when updating body_md only on a non-existent row', async () => {
        // Only patch.body_md is set — the `effectiveTitle !== undefined`
        // guard skips the pre-lookup, so this exercises the DB-update-
        // returned-null path directly.
        const updated = await scratchPadService.update('nope', { body_md: 'x' });
        expect(updated).toBeUndefined();
    });
});

describe('scratchPadService CRUD', () => {
    it('create respects a caller-supplied id (skips UUID minting)', async () => {
        const created = await scratchPadService.create({
            id: 'client-minted-id-42',
            title: 'Hi',
            body_md: 'ho',
        });
        expect(created.id).toBe('client-minted-id-42');
        expect(created.title).toBe('Hi');
        expect(created.body_md).toBe('ho');
    });

    it('create mints a UUID when id is omitted', async () => {
        const created = await scratchPadService.create({});
        // UUID v4 shape
        expect(created.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        // Defaults: empty strings, not null
        expect(created.title).toBe('');
        expect(created.body_md).toBe('');
    });

    it('get returns the row when present and undefined when missing', async () => {
        const created = await scratchPadService.create({ title: 'hi' });
        const got = await scratchPadService.get(created.id);
        expect(got?.id).toBe(created.id);
        expect(got?.title).toBe('hi');

        expect(await scratchPadService.get('does-not-exist')).toBeUndefined();
    });

    it('list returns rows ordered by updated_at desc', async () => {
        const first = await scratchPadService.create({ title: 'first' });
        // Small delay so updated_at ordering is deterministic.
        await new Promise((r) => setTimeout(r, 5));
        const second = await scratchPadService.create({ title: 'second' });

        const rows = await scratchPadService.list();
        expect(rows.length).toBeGreaterThanOrEqual(2);
        const idx1 = rows.findIndex((r) => r.id === first.id);
        const idx2 = rows.findIndex((r) => r.id === second.id);
        expect(idx2).toBeLessThan(idx1);
    });

    it('delete returns true when a row is removed', async () => {
        const created = await scratchPadService.create({ title: 'goodbye' });
        expect(await scratchPadService.delete(created.id)).toBe(true);
        // Row is gone.
        expect(await scratchPadService.get(created.id)).toBeUndefined();
    });

    it('delete returns false when no row matches', async () => {
        expect(await scratchPadService.delete('does-not-exist')).toBe(false);
    });
});
