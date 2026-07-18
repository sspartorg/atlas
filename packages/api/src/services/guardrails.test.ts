import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { sql } from 'kysely';
import { guardrailsService } from './guardrails.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

// guardrails are seeded by knex migration; truncateAll wipes them. Re-seed
// a small set before each test that needs the canonical multi-category view.
async function seedFiveCategories(): Promise<void> {
    const cats = [
        'file_system',
        'secrets_credentials',
        'git_branches',
        'side_effects_network',
        'escalation_scope',
    ] as const;
    for (let i = 0; i < cats.length; i++) {
        await guardrailsService.create({
            category: cats[i]!,
            rule_text: `seed-${cats[i]}`,
            detail: null,
            severity: 'block',
        });
    }
}

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('guardrailsService', () => {
    it('list() returns rows for all 5 categories once seeded', async () => {
        await seedFiveCategories();
        const list = await guardrailsService.list();
        const categories = new Set(list.map((r) => r.category));
        expect(categories.has('file_system')).toBe(true);
        expect(categories.has('secrets_credentials')).toBe(true);
        expect(categories.has('git_branches')).toBe(true);
        expect(categories.has('side_effects_network')).toBe(true);
        expect(categories.has('escalation_scope')).toBe(true);
    });

    describe('create', () => {
        it('inserts a rule and bumps sort_order within its category', async () => {
            const a = await guardrailsService.create({
                category: 'file_system',
                rule_text: 'first',
                detail: null,
                severity: 'block',
            });
            const b = await guardrailsService.create({
                category: 'file_system',
                rule_text: 'second',
                detail: null,
                severity: 'block',
            });
            expect(a.sort_order).toBe(1);
            expect(b.sort_order).toBe(2);
        });

        it('allows all 3 severities and 5 categories', async () => {
            const severities = ['block', 'ask_owner', 'warn'] as const;
            const categories = [
                'file_system',
                'secrets_credentials',
                'git_branches',
                'side_effects_network',
                'escalation_scope',
            ] as const;
            for (const cat of categories) {
                for (const sev of severities) {
                    const r = await guardrailsService.create({
                        category: cat,
                        rule_text: `r ${cat} ${sev}`,
                        detail: null,
                        severity: sev,
                    });
                    expect(r.category).toBe(cat);
                    expect(r.severity).toBe(sev);
                }
            }
        });

        it('rejects an invalid category', async () => {
            await expect(
                guardrailsService.create({
                    category: 'nope' as unknown as 'file_system',
                    rule_text: 'x',
                    detail: null,
                    severity: 'warn',
                }),
            ).rejects.toThrow();
        });

        it('rejects an invalid severity', async () => {
            await expect(
                guardrailsService.create({
                    category: 'file_system',
                    rule_text: 'x',
                    detail: null,
                    severity: 'maybe' as unknown as 'warn',
                }),
            ).rejects.toThrow();
        });
    });

    describe('update', () => {
        it('patches the named fields and returns the row', async () => {
            const r = await guardrailsService.create({
                category: 'file_system',
                rule_text: 'old',
                detail: 'd',
                severity: 'warn',
            });
            const updated = await guardrailsService.update(r.id, {
                category: 'git_branches',
                rule_text: 'new',
                detail: null,
                severity: 'block',
            });
            expect(updated!.category).toBe('git_branches');
            expect(updated!.rule_text).toBe('new');
            expect(updated!.detail).toBeNull();
            expect(updated!.severity).toBe('block');
        });

        it('no-op when nothing defined just returns the row', async () => {
            const r = await guardrailsService.create({
                category: 'file_system',
                rule_text: 't',
                detail: null,
                severity: 'warn',
            });
            const same = await guardrailsService.update(r.id, {});
            expect(same!.id).toBe(r.id);
        });

        it('returns null-ish for missing id when no patch', async () => {
            const result = await guardrailsService.update('does-not-exist', {});
            expect(result).toBeUndefined();
        });

        it('handles partial single-field patches', async () => {
            const r = await guardrailsService.create({
                category: 'file_system',
                rule_text: 'orig',
                detail: 'd',
                severity: 'warn',
            });
            const u1 = await guardrailsService.update(r.id, { rule_text: 'only this' });
            expect(u1!.rule_text).toBe('only this');
            expect(u1!.severity).toBe('warn');
            const u2 = await guardrailsService.update(r.id, { detail: null });
            expect(u2!.detail).toBeNull();
        });
    });

    describe('remove', () => {
        it('deletes the rule', async () => {
            const r = await guardrailsService.create({
                category: 'file_system',
                rule_text: 'del me',
                detail: null,
                severity: 'warn',
            });
            await guardrailsService.remove(r.id);
            const found = (await guardrailsService.list()).find((x) => x.id === r.id);
            expect(found).toBeUndefined();
        });
    });

    describe('markSaved', () => {
        it('stamps settings.guardrails_published_at and returns the ISO string', async () => {
            const iso = await guardrailsService.markSaved();
            expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            const row = (await sql<{ guardrails_published_at: Date | string | null }>`SELECT guardrails_published_at FROM settings WHERE id = 1`.execute(
                testDb,
            )).rows[0]!;
            const stamped =
                row.guardrails_published_at instanceof Date
                    ? row.guardrails_published_at.toISOString()
                    : row.guardrails_published_at;
            expect(stamped).toBe(iso);
        });
    });
});
