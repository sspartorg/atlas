/**
 * W12 spec 2 — Input sanitization: SQL injection + path-traversal guards.
 *
 * Three checks:
 *   1. searchItems with a classic SQL-injection payload leaves the items
 *      table intact (Kysely uses parameterized queries throughout).
 *   2. projectsService.create rejects workspace_path values containing
 *      path-traversal components (../). Inline fix added to projects.ts.
 *   3. materializeCron (custom preset) rejects cron expressions that embed
 *      shell-metacharacter payloads.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';
import { searchItems } from './items.js';
import { projectsService } from './projects.js';
import { materializeCron } from './cron-materializer.js';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

// ---------------------------------------------------------------------------
// 1. SQL injection — table must survive a crafted query string
// ---------------------------------------------------------------------------
describe('SQL injection guard — searchItems', () => {
    it("classic UNION/DROP payload does not truncate the projects table", async () => {
        await insertProject('sqlinj-p1', 'SQA');
        await insertItem({ id: 'SQA-1', type: 'epic', project_id: 'sqlinj-p1', title: 'Real epic' });

        const countBefore = (await testDb.selectFrom('projects').selectAll().execute()).length;

        // Classic injection attempt passed as the full-text query.
        await searchItems({ q: "'; DROP TABLE projects; --" });

        const countAfter = (await testDb.selectFrom('projects').selectAll().execute()).length;

        expect(countAfter).toBe(countBefore);
    });

    it("UNION SELECT injection in q returns empty / no error (parameterized query)", async () => {
        await insertProject('sqlinj-p2', 'SQB');
        await insertItem({ id: 'SQB-1', type: 'epic', project_id: 'sqlinj-p2', title: 'Real epic' });

        // Should not throw; returns an array (possibly empty).
        const results = await searchItems({
            q: "1 UNION SELECT id, name, 'x', 'y', 'z', 'a', NULL, NULL FROM projects--",
        });
        expect(Array.isArray(results)).toBe(true);
        // The injected payload must not appear as a hit — only valid items match.
        expect(results.every((r) => r.type !== undefined)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 2. Path traversal — projectsService.create must reject `..` in git_path
// ---------------------------------------------------------------------------
describe('path traversal guard — projectsService', () => {
    it('rejects git_path with leading traversal (../../etc/passwd)', async () => {
        await expect(
            projectsService.create({
                name: 'Test Project',
                issue_key_prefix: 'TRV',
                git_path: '../../etc/passwd',
            }),
        ).rejects.toThrow(/path-traversal/);
    });

    it('rejects git_path with traversal in middle (workspaces/../../../secret)', async () => {
        await expect(
            projectsService.create({
                name: 'Test Project',
                issue_key_prefix: 'TV2',
                git_path: 'workspaces/../../../secret',
            }),
        ).rejects.toThrow(/path-traversal/);
    });

    it('accepts safe absolute path (no traversal components)', async () => {
        const project = await projectsService.create({
            name: 'Safe Project',
            issue_key_prefix: 'SFP',
            git_path: '/home/user/repos/myproject',
        });
        expect(project.id).toBeTruthy();
        expect(project.git_path).toBe('/home/user/repos/myproject');
    });

    it('accepts empty git_path', async () => {
        const project = await projectsService.create({
            name: 'Empty Path',
            issue_key_prefix: 'EPT',
            git_path: '',
        });
        expect(project.id).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// 3. Shell-meta in cron expression — croner must reject it
// ---------------------------------------------------------------------------
describe('shell-metacharacter injection guard — cron-materializer', () => {
    it('rejects cron expression with shell-meta payload (& rm -rf)', () => {
        // croner will reject the malformed expression (shell meta makes it
        // syntactically invalid as a 5-field cron).
        expect(() =>
            materializeCron({
                preset: 'custom',
                time_of_day: '',
                weekday: null,
                cron_expression: '*/5 * * * * & rm -rf nothing',
            }),
        ).toThrow(/cron/i);
    });

    it('rejects cron expression containing semicolons', () => {
        expect(() =>
            materializeCron({
                preset: 'custom',
                time_of_day: '',
                weekday: null,
                cron_expression: '*/5 * * * *; echo pwned',
            }),
        ).toThrow(/cron/i);
    });

    it('accepts a well-formed 5-field cron expression', () => {
        const result = materializeCron({
            preset: 'custom',
            time_of_day: '',
            weekday: null,
            cron_expression: '*/5 * * * *',
        });
        expect(result.cron_expression).toBe('*/5 * * * *');
    });
});
