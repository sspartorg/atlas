import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialsService } from './credentials.js';
import type * as GithubAppTokens from './github-app-tokens.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('credentialsService', () => {
    const baseInput = {
        label: 'GH PAT',
        host: 'github' as const,
        kind: 'pat' as const,
        username: 'x-access-token',
        token: 'ghp_FAKEFAKEFAKEFAKEFAKE1234',
        scope: 'repo,workflow',
        expires_at: null,
    };

    it('create stores the credential with encrypted token + fingerprint', async () => {
        const c = await credentialsService.create(baseInput);
        expect(c.id).toBeTruthy();
        expect(c.label).toBe('GH PAT');
        expect(c.host).toBe('github');
        expect(c.kind).toBe('pat');
        expect(c.token_encrypted).not.toBe(baseInput.token);
        expect(c.token_encrypted.length).toBeGreaterThan(0);
        expect(c.token_fingerprint).toContain('ghp_');
        expect(c.token_fingerprint).toContain('1234');
    });

    it('getToken decrypts back to the original plaintext', async () => {
        const c = await credentialsService.create(baseInput);
        const tok = await credentialsService.getToken(c.id);
        expect(tok).toBe(baseInput.token);
    });

    it('getToken throws when the credential does not exist', async () => {
        await expect(credentialsService.getToken('nope')).rejects.toThrow(/not found/);
    });

    it('list returns rows DESC by created_at', async () => {
        await credentialsService.create({ ...baseInput, label: 'A' });
        await credentialsService.create({ ...baseInput, label: 'B' });
        const list = await credentialsService.list();
        expect(list).toHaveLength(2);
        expect(['A', 'B']).toContain(list[0]!.label);
    });

    it('get returns the row or undefined', async () => {
        const c = await credentialsService.create(baseInput);
        expect((await credentialsService.get(c.id))?.id).toBe(c.id);
        expect(await credentialsService.get('nope')).toBeUndefined();
    });

    it('update patches metadata without re-encrypting when token omitted', async () => {
        const c = await credentialsService.create(baseInput);
        const before = c.token_encrypted;
        const u = await credentialsService.update(c.id, { label: 'New Label', scope: 's' });
        expect(u.label).toBe('New Label');
        expect(u.scope).toBe('s');
        expect(u.token_encrypted).toBe(before);
    });

    it('update with a new token re-encrypts and updates fingerprint', async () => {
        const c = await credentialsService.create(baseInput);
        const before = c.token_encrypted;
        const u = await credentialsService.update(c.id, { token: 'github_pat_NEWNEWNEWxxxx9999' });
        expect(u.token_encrypted).not.toBe(before);
        expect(u.token_fingerprint).toContain('gpat_');
        expect(u.token_fingerprint).toContain('9999');
        expect(await credentialsService.getToken(c.id)).toBe('github_pat_NEWNEWNEWxxxx9999');
    });

    it('update throws when the credential does not exist', async () => {
        await expect(credentialsService.update('nope', { label: 'x' })).rejects.toThrow(/not found/);
    });

    it('delete removes the row', async () => {
        const c = await credentialsService.create(baseInput);
        await credentialsService.delete(c.id);
        expect(await credentialsService.get(c.id)).toBeUndefined();
    });

    it('markUsed stamps last_used_at', async () => {
        const c = await credentialsService.create(baseInput);
        expect(c.last_used_at).toBeNull();
        await credentialsService.markUsed(c.id);
        expect((await credentialsService.get(c.id))!.last_used_at).toBeTruthy();
    });

    it('fingerprint handles plain tokens (tok_ prefix) and the github_pat_ prefix', async () => {
        const c1 = await credentialsService.create({ ...baseInput, token: 'abc1234567xyz' });
        expect(c1.token_fingerprint).toContain('tok_');
        const c2 = await credentialsService.create({
            ...baseInput,
            token: 'github_pat_aaaaaaaaaa1234',
        });
        expect(c2.token_fingerprint).toContain('gpat_');
    });
});

// ─── github_app credential kind (migration 023) ──────────────────────────────
// Isolate the folder-reading + DB-insert path from the actual GitHub mint call.
// The mint side is covered by `github-app-tokens.test.ts`; here we care about
// (a) the row lands with encrypted PEM + null token, and (b) missing/ambiguous
// files surface as caller-friendly errors.

vi.mock('./github-app-tokens.js', async () => {
    const actual =
        await vi.importActual<typeof GithubAppTokens>('./github-app-tokens.js');
    return {
        ...actual,
        // The service's `create()` calls refreshCredential() to do a best-effort
        // first mint. In these tests we don't want a real GitHub round-trip.
        refreshCredential: vi.fn().mockResolvedValue(undefined),
    };
});

describe('credentialsService — github_app kind', () => {
    let botDir: string;

    beforeEach(() => {
        botDir = mkdtempSync(join(tmpdir(), 'atlas-bot-test-'));
    });

    afterAll(() => {
        // best-effort tidy — the OS temp dir sweeps eventually
    });

    function writeGoodFolder(opts: { slug?: string | null } = {}) {
        // Distinguish "no slug key in JSON" (opts.slug === null) from the
        // default happy path (opts.slug undefined → use 'test-bot'). A JS
        // default param treats an *explicit* `undefined` the same as
        // omitting the arg, so we can't use `undefined` as the
        // "no-slug" sentinel here.
        const cfg: Record<string, unknown> = { id: 12345678 };
        if (opts.slug !== null) cfg['slug'] = opts.slug ?? 'test-bot';
        writeFileSync(join(botDir, 'app-config.json'), JSON.stringify(cfg));
        writeFileSync(
            join(botDir, 'test-bot.private-key.pem'),
            '-----BEGIN RSA PRIVATE KEY-----\nfake-key-bytes\n-----END RSA PRIVATE KEY-----\n',
        );
    }

    it('creates a github_app row with encrypted PEM and null token_encrypted', async () => {
        writeGoodFolder();
        const cred = await credentialsService.create({
            label: 'atlas-app-bot',
            host: 'github',
            kind: 'github_app',
            bot_info_path: botDir,
            app_installation_owner: 'sspartorg',
            scope: '',
        });
        expect(cred.kind).toBe('github_app');
        expect(cred.app_id).toBe(12345678);
        expect(cred.app_installation_owner).toBe('sspartorg');
        expect(cred.has_app_private_key).toBe(true);
        expect(cred.token_encrypted).toBeNull();
        expect(cred.token_fingerprint).toBeNull();
        expect(cred.app_installation_id).toBeNull();
        expect(cred.app_slug).toBe('test-bot');
    });

    it('populates app_slug=null when app-config.json omits slug (backfilled later)', async () => {
        writeGoodFolder({ slug: null });
        const cred = await credentialsService.create({
            label: 'no-slug-bot',
            host: 'github',
            kind: 'github_app',
            bot_info_path: botDir,
            app_installation_owner: 'sspartorg',
            scope: '',
        });
        expect(cred.kind).toBe('github_app');
        expect(cred.app_slug).toBeNull();
    });

    it('rejects a folder without app-config.json', async () => {
        writeFileSync(
            join(botDir, 'x.pem'),
            '-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----\n',
        );
        await expect(
            credentialsService.create({
                label: 'x',
                host: 'github',
                kind: 'github_app',
                bot_info_path: botDir,
                app_installation_owner: 'sspartorg',
                scope: '',
            }),
        ).rejects.toThrow(/app-config\.json/);
    });

    it('rejects a folder without any .pem file', async () => {
        writeFileSync(join(botDir, 'app-config.json'), JSON.stringify({ id: 12345678 }));
        await expect(
            credentialsService.create({
                label: 'x',
                host: 'github',
                kind: 'github_app',
                bot_info_path: botDir,
                app_installation_owner: 'sspartorg',
                scope: '',
            }),
        ).rejects.toThrow(/no \*\.pem/);
    });

    it('rejects a folder with more than one .pem file', async () => {
        writeFileSync(join(botDir, 'app-config.json'), JSON.stringify({ id: 12345678 }));
        writeFileSync(
            join(botDir, 'a.pem'),
            '-----BEGIN RSA PRIVATE KEY-----\na\n-----END RSA PRIVATE KEY-----\n',
        );
        writeFileSync(
            join(botDir, 'b.pem'),
            '-----BEGIN RSA PRIVATE KEY-----\nb\n-----END RSA PRIVATE KEY-----\n',
        );
        await expect(
            credentialsService.create({
                label: 'x',
                host: 'github',
                kind: 'github_app',
                bot_info_path: botDir,
                app_installation_owner: 'sspartorg',
                scope: '',
            }),
        ).rejects.toThrow(/multiple \*\.pem/);
    });

    it('rejects a non-existent folder', async () => {
        rmSync(botDir, { recursive: true, force: true });
        await expect(
            credentialsService.create({
                label: 'x',
                host: 'github',
                kind: 'github_app',
                bot_info_path: botDir,
                app_installation_owner: 'sspartorg',
                scope: '',
            }),
        ).rejects.toThrow(/bot info folder not found/);
    });

    it('rejects a bot_info_path that points at a file, not a directory', async () => {
        const filePath = join(botDir, 'not-a-dir');
        writeFileSync(filePath, 'hi');
        await expect(
            credentialsService.create({
                label: 'x',
                host: 'github',
                kind: 'github_app',
                bot_info_path: filePath,
                app_installation_owner: 'sspartorg',
                scope: '',
            }),
        ).rejects.toThrow(/not a directory/);
    });

    it('rejects a bot_info_path that resolves to a filesystem root', async () => {
        // Post-audit guard: pointing at `/` or `C:\` would let the glob
        // loop scan the entire drive. `parsePath(root).base === ''` is
        // the platform-agnostic root check the service uses.
        const root = process.platform === 'win32' ? 'C:\\' : '/';
        await expect(
            credentialsService.create({
                label: 'x',
                host: 'github',
                kind: 'github_app',
                bot_info_path: root,
                app_installation_owner: 'sspartorg',
                scope: '',
            }),
        ).rejects.toThrow(/filesystem root/);
    });

    it('update() editing app_installation_owner clears installation_id AND stale token', async () => {
        // Post-audit fix: an owner change invalidates the previously-
        // minted installation token (which was scoped to the OLD owner's
        // installation). Without clearing token_encrypted + expires_at,
        // getToken keeps returning the stale token for up to ~55 min
        // and pushes silently authenticate against the OLD installation.
        writeGoodFolder();
        const cred = await credentialsService.create({
            label: 'atlas-app-bot',
            host: 'github',
            kind: 'github_app',
            bot_info_path: botDir,
            app_installation_owner: 'sspartorg',
            scope: '',
        });
        // Simulate a previously-minted token on the row.
        const { db } = await import('../db/kysely-client.js');
        await db
            .updateTable('credentials')
            .set({
                token_encrypted: 'ciphertext-for-old-installation',
                token_fingerprint: 'ghs_fp',
                expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
                app_installation_id: 12345,
            } as never)
            .where('id', '=', cred.id)
            .execute();
        const updated = await credentialsService.update(cred.id, {
            app_installation_owner: 'isw-CDM-Next',
        });
        expect(updated.app_installation_owner).toBe('isw-CDM-Next');
        expect(updated.app_installation_id).toBeNull();
        expect(updated.token_encrypted).toBeNull();
        expect(updated.token_fingerprint).toBeNull();
        expect(updated.expires_at).toBeNull();
    });

    it('update() accepts human_name/human_email on a PAT credential', async () => {
        // These become the commit AUTHOR for a PAT (buildGitAuth writes them
        // into the session's `[user]` block), so unlike github_app they are
        // not a co-authorship decoration and must be settable.
        const pat = await credentialsService.create({
            label: 'PAT',
            host: 'github',
            kind: 'pat',
            username: 'x-access-token',
            token: 'ghp_xxxxxxxxxxxxxxxxxxxx',
            scope: '',
            expires_at: null,
        });
        const updated = await credentialsService.update(pat.id, {
            human_name: 'Bob',
            human_email: 'bob@example.com',
        });
        expect(updated.human_name).toBe('Bob');
        expect(updated.human_email).toBe('bob@example.com');
    });

    it('create() persists human_name/human_email on a PAT credential', async () => {
        const pat = await credentialsService.create({
            label: 'PAT',
            host: 'github',
            kind: 'pat',
            username: 'x-access-token',
            token: 'ghp_xxxxxxxxxxxxxxxxxxxx',
            scope: '',
            expires_at: null,
            human_name: 'Bob',
            human_email: 'bob@example.com',
        });
        expect(pat.human_name).toBe('Bob');
        expect(pat.human_email).toBe('bob@example.com');
    });

    it('update() still rejects human_gh_login on a PAT credential', async () => {
        // gh_login only feeds `gh pr create --assignee`, which no PAT flow
        // reaches — accepting it would imply an assignment that never happens.
        const pat = await credentialsService.create({
            label: 'PAT',
            host: 'github',
            kind: 'pat',
            username: 'x-access-token',
            token: 'ghp_xxxxxxxxxxxxxxxxxxxx',
            scope: '',
            expires_at: null,
        });
        await expect(
            credentialsService.update(pat.id, { human_gh_login: 'bob' }),
        ).rejects.toThrow(/human_gh_login/);
    });

    it('update() rejects token on a github_app credential', async () => {
        writeGoodFolder();
        const app = await credentialsService.create({
            label: 'app',
            host: 'github',
            kind: 'github_app',
            bot_info_path: botDir,
            app_installation_owner: 'sspartorg',
            scope: '',
        });
        await expect(
            credentialsService.update(app.id, { token: 'ghp_should_be_rejected' }),
        ).rejects.toThrow(/token/);
    });

    it('update() rejects a non-x-access-token username on a github_app credential', async () => {
        writeGoodFolder();
        const app = await credentialsService.create({
            label: 'app',
            host: 'github',
            kind: 'github_app',
            bot_info_path: botDir,
            app_installation_owner: 'sspartorg',
            scope: '',
        });
        await expect(
            credentialsService.update(app.id, { username: 'sspartorg' }),
        ).rejects.toThrow(/username/);
        // Setting username back to the mandatory value is a no-op — allowed.
        const noop = await credentialsService.update(app.id, { username: 'x-access-token' });
        expect(noop.username).toBe('x-access-token');
    });

    it('update() clears expires_at when patch has explicit null', async () => {
        const pat = await credentialsService.create({
            label: 'PAT with expiry',
            host: 'github',
            kind: 'pat',
            username: 'x-access-token',
            token: 'ghp_xxxxxxxxxxxxxxxxxxxx',
            scope: '',
            expires_at: '2030-01-01T00:00:00.000Z',
        });
        // pg returns timestamptz as a Date object at runtime — normalise
        // via new Date().toISOString() before comparing against the
        // string we wrote.
        expect(new Date(pat.expires_at as unknown as string).toISOString()).toBe(
            '2030-01-01T00:00:00.000Z',
        );
        const cleared = await credentialsService.update(pat.id, { expires_at: null });
        expect(cleared.expires_at).toBeNull();
    });

    it('rowToCredential exposes app fields on list() responses', async () => {
        writeGoodFolder();
        await credentialsService.create({
            label: 'atlas-app-bot',
            host: 'github',
            kind: 'github_app',
            bot_info_path: botDir,
            app_installation_owner: 'sspartorg',
            scope: '',
        });
        // Include a PAT row so we exercise the projection on both kinds.
        await credentialsService.create({
            label: 'PAT',
            host: 'github',
            kind: 'pat',
            username: 'x-access-token',
            token: 'ghp_zzzzzzzzzzzzzzzzzzzz',
            scope: '',
            expires_at: null,
        });
        const rows = await credentialsService.list();
        const app = rows.find((r) => r.kind === 'github_app')!;
        const pat = rows.find((r) => r.kind === 'pat')!;
        expect(app.has_app_private_key).toBe(true);
        expect(pat.has_app_private_key).toBe(false);
        expect(pat.app_id).toBeNull();
    });
});
