import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import type { IScratchPad } from '@atlas/shared';

// P12 — Scratch Pad service. CRUD against the `scratch_pad` table; no SSE
// broadcast (the page autosaves its own UI without cross-tab sync — fine for
// a single-owner local app). id is client-minted on create when present;
// otherwise we mint a UUID server-side so MCP / scripted callers don't have
// to bring their own id generator.
//
// T5 — When an update / create lands with a blank title, the server applies
// `inferTitle()` as a belt-and-braces backstop so the grid never renders an
// untitled tile even if the client forgets to fill one in. The web modal
// applies the same logic before sending the PATCH; this server-side guard
// catches MCP callers and any future client that skips it.

interface CreateInput {
    id?: string | undefined;
    title?: string | undefined;
    body_md?: string | undefined;
}

interface UpdateInput {
    title?: string | undefined;
    body_md?: string | undefined;
}

/**
 * Compute the title to persist when the caller supplies a blank one.
 * Returns the original title untouched if non-blank; otherwise the first
 * three whitespace-separated words of the body, or `"Untitled"` when the
 * body is also blank. Exported for symmetry with the web-side helper +
 * direct testing.
 */
export function inferTitle(title: string, body: string): string {
    if (title.trim()) return title;
    const words = body.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    return words || 'Untitled';
}

function rowToScratchPad(row: Record<string, unknown>): IScratchPad {
    return {
        id: row['id'] as string,
        title: (row['title'] as string) ?? '',
        body_md: (row['body_md'] as string) ?? '',
        created_at: row['created_at'] as string,
        updated_at: row['updated_at'] as string,
    };
}

export const scratchPadService = {
    async list(): Promise<IScratchPad[]> {
        const rows = await db
            .selectFrom('scratch_pad')
            .selectAll()
            .orderBy('updated_at', 'desc')
            .execute();
        return rows.map((r) => rowToScratchPad(r as never));
    },

    async get(id: string): Promise<IScratchPad | undefined> {
        const row = await db
            .selectFrom('scratch_pad')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        return row ? rowToScratchPad(row as never) : undefined;
    },

    async create(input: CreateInput): Promise<IScratchPad> {
        const id = input.id ?? randomUUID();
        const title = input.title ?? '';
        const body_md = input.body_md ?? '';
        const row = await db
            .insertInto('scratch_pad')
            .values({
                id,
                title,
                body_md,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return rowToScratchPad(row as never);
    },

    async update(id: string, patch: UpdateInput): Promise<IScratchPad | undefined> {
        // Resolve the effective post-update body so the title backstop
        // can pull words from the new body when the caller only patches
        // body_md (or vice versa). We only read the existing row when
        // the title patch is empty — every other path is one round-trip.
        let effectiveTitle = patch.title;
        if (effectiveTitle !== undefined && effectiveTitle.trim() === '') {
            const incomingBody = patch.body_md;
            let bodyForInfer = incomingBody ?? '';
            if (incomingBody === undefined) {
                const existing = await db
                    .selectFrom('scratch_pad')
                    .select(['body_md'])
                    .where('id', '=', id)
                    .executeTakeFirst();
                if (!existing) return undefined;
                bodyForInfer = (existing.body_md as string) ?? '';
            }
            effectiveTitle = inferTitle(effectiveTitle, bodyForInfer);
        }

        const update: Record<string, unknown> = { updated_at: sql<string>`now()` };
        if (effectiveTitle !== undefined) update['title'] = effectiveTitle;
        if (patch.body_md !== undefined) update['body_md'] = patch.body_md;
        const row = await db
            .updateTable('scratch_pad')
            .set(update)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();
        return row ? rowToScratchPad(row as never) : undefined;
    },

    async delete(id: string): Promise<boolean> {
        const result = await db
            .deleteFrom('scratch_pad')
            .where('id', '=', id)
            .executeTakeFirst();
        return Number(result.numDeletedRows) > 0;
    },
};
