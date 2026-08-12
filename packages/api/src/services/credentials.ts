import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve, parse as parsePath } from 'node:path';
import { db } from '../db/kysely-client.js';
import { encrypt, decrypt, fingerprint } from './crypto.js';
import { refreshCredential, LAZY_REFRESH_MS, GhApiError } from './github-app-tokens.js';
import type { ICredential } from '@atlas/shared';

/**
 * Thrown by credentialsService.create/update when the caller supplies
 * a field that doesn't apply to the row's kind, or when a bot-info
 * folder doesn't match the required shape. The routes layer catches
 * this and maps to HTTP 400 without string-matching error messages.
 */
export class CredentialValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CredentialValidationError';
    }
}

// Input shape for `create()`. Discriminated on `kind`. The API route
// (see `packages/api/src/routes/credentials.ts`) validates the wire
// payload via `CreateCredentialSchema` from `@atlas/shared`; this
// service accepts a slightly denormalised form so tests can construct
// input without dragging in Zod.
export type CredentialCreateInput =
    | {
          label: string;
          host: 'github';
          kind: 'pat';
          username: string;
          token: string;
          scope: string;
          expires_at: string | null;
          // Migration 026 columns, reused for PATs. Unlike the github_app
          // branch below (where they produce a Co-Authored-By trailer), on a
          // PAT they ARE the commit author — `buildGitAuth` writes them into
          // the session's `[user]` block. No `human_gh_login`: it only feeds
          // `gh pr create --assignee`, which no PAT flow reaches.
          human_name?: string | null | undefined;
          human_email?: string | null | undefined;
      }
    | {
          label: string;
          host: 'github';
          kind: 'github_app';
          bot_info_path: string;
          app_installation_owner: string;
          scope: string;
          // Migration 025 — optional human-attribution fields. When
          // provided on a github_app credential, commits get
          // `Co-Authored-By: <human_name> <human_email>` appended and
          // PRs get `--assignee <human_gh_login>` + `Requested-By:` prefix.
          human_name?: string | null | undefined;
          human_email?: string | null | undefined;
          human_gh_login?: string | null | undefined;
      };

// Fields caller can patch. Token is only meaningful for PAT rows;
// `app_installation_owner` is only meaningful for github_app rows.
//
// Every field is `?: T | undefined` (not `?: T`) so the shape lines up
// with Zod's `.optional()` output under `exactOptionalPropertyTypes`.
export interface CredentialUpdateInput {
    label?: string | undefined;
    username?: string | undefined;
    token?: string | undefined;
    scope?: string | undefined;
    expires_at?: string | null | undefined;
    app_installation_owner?: string | undefined;
    // Migration 025 — nullable to allow clearing; omitted keeps existing.
    human_name?: string | null | undefined;
    human_email?: string | null | undefined;
    human_gh_login?: string | null | undefined;
}

// Row -> ICredential. `has_app_private_key` is a boolean projection of
// the encrypted PEM presence; we never expose the ciphertext itself.
// Internal callers see token_encrypted for decrypt paths (getToken);
// the API layer runs the result through `stripSecretsForApi` before
// serialising to the wire so ciphertext never leaves the process.
function rowToCredential(row: Record<string, unknown>): ICredential {
    return {
        id: row['id'] as string,
        label: row['label'] as string,
        host: row['host'] as 'github',
        kind: row['kind'] as ICredential['kind'],
        username: row['username'] as string,
        token_encrypted: (row['token_encrypted'] as string | null) ?? null,
        token_fingerprint: (row['token_fingerprint'] as string | null) ?? null,
        scope: (row['scope'] as string) ?? '',
        last_used_at: (row['last_used_at'] as string | null) ?? null,
        expires_at: (row['expires_at'] as string | null) ?? null,
        app_id:
            row['app_id'] == null ? null : Number(row['app_id']),
        has_app_private_key: Boolean(row['app_private_key_encrypted']),
        app_installation_owner: (row['app_installation_owner'] as string | null) ?? null,
        app_installation_id:
            row['app_installation_id'] == null ? null : Number(row['app_installation_id']),
        app_slug: (row['app_slug'] as string | null) ?? null,
        human_name: (row['human_name'] as string | null) ?? null,
        human_email: (row['human_email'] as string | null) ?? null,
        human_gh_login: (row['human_gh_login'] as string | null) ?? null,
        created_at: row['created_at'] as string,
        updated_at: row['updated_at'] as string,
    };
}

// Drop encrypt-at-rest ciphertext + fingerprint before shipping a
// credential over HTTP. The API GET routes are read-open (any loopback
// caller); returning the encrypted-token blob would defeat the whole
// encrypt-at-rest boundary — anyone with a memory dump + the workspace
// key could recover every stored token. Applied by every route handler
// in `packages/api/src/routes/credentials.ts` before `reply.send`.
export function stripSecretsForApi(cred: ICredential): ICredential {
    return { ...cred, token_encrypted: null, token_fingerprint: null };
}

// Blank strings from the UI collapse to null so downstream truthiness
// checks (buildGitAuth, openPullRequest) can key off a single `!name` test.
function nullIfBlank(v: string | null | undefined): string | null {
    return v == null ? null : v.trim() || null;
}

/**
 * Read a `bot_info_path` folder (as produced by
 * `tools/atlas-bot/Create-App.ps1`) and extract everything we need to
 * store an App credential.
 *
 * The folder must contain:
 *   - `app-config.json` with a numeric `id` field.
 *   - Exactly one `*.pem` file (the App's RSA private key).
 *
 * Throws with a caller-friendly message on any structural issue so the
 * REST layer can surface a clean 400.
 */
function readBotInfoFolder(botInfoPath: string): { app_id: number; pem: string; app_slug: string | null } {
    // Resolve to an absolute, canonical path. `realpathSync` follows any
    // symlinks (or Windows junctions) so a `bot_info_path` that points
    // at a link into a system directory ends up compared against its
    // *real* target below — this defeats the "symlink tricks the reader
    // into stat'ing an approved folder while the read fires against an
    // arbitrary location" class of attack. Falls back to `resolve()`
    // when the path doesn't exist yet, so the "folder not found" error
    // below still fires with a caller-friendly message.
    const initialAbs = isAbsolute(botInfoPath) ? botInfoPath : resolve(botInfoPath);
    let absPath: string;
    try {
        absPath = realpathSync(initialAbs);
    } catch {
        throw new CredentialValidationError(`bot info folder not found: ${initialAbs}`);
    }
    // Refuse a filesystem root (e.g., `/`, `C:\`, `D:\`). `parsePath(x).base`
    // is empty exactly when x is a root. Reading a whole drive isn't the
    // Owner's intent — this catches typos like `bot_info_path: "C:\\"`
    // before they hit the glob loop.
    if (parsePath(absPath).base === '') {
        throw new CredentialValidationError(
            `bot info path is a filesystem root, refusing to scan: ${absPath}`,
        );
    }
    let stat;
    try {
        stat = statSync(absPath);
    } catch {
        throw new CredentialValidationError(`bot info folder not found: ${absPath}`);
    }
    if (!stat.isDirectory()) {
        throw new CredentialValidationError(`bot info path is not a directory: ${absPath}`);
    }

    const configPath = join(absPath, 'app-config.json');
    // Size-cap the read so a mis-selected 2 GB log file doesn't OOM the
    // API when JSON.parse runs against it. Legit app-config.json files
    // are ~200 bytes; 32 KB is generous headroom.
    let configStat;
    try {
        configStat = statSync(configPath);
    } catch {
        throw new CredentialValidationError(
            `could not read app-config.json in ${absPath}: not found`,
        );
    }
    const CONFIG_MAX_BYTES = 32 * 1024;
    if (configStat.size > CONFIG_MAX_BYTES) {
        throw new CredentialValidationError(
            `app-config.json in ${absPath} is unexpectedly large (${configStat.size} bytes > ${CONFIG_MAX_BYTES}); refusing to load`,
        );
    }
    let config: Record<string, unknown>;
    try {
        config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    } catch (e) {
        throw new CredentialValidationError(
            `could not read app-config.json in ${absPath}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    if (
        config['id'] == null ||
        typeof config['id'] !== 'number' ||
        !Number.isInteger(config['id']) ||
        (config['id'] as number) <= 0
    ) {
        throw new CredentialValidationError(
            `app-config.json in ${absPath} is missing a positive integer "id" field`,
        );
    }
    const appId = config['id'];
    // Slug is optional here — the App-manifest flow saves it, but old
    // exports may not. Backfilled from `GET /app` on the first refresh
    // if missing (see `github-app-tokens.refreshCredential`).
    const appSlug =
        typeof config['slug'] === 'string' && config['slug'].length > 0
            ? (config['slug'] as string)
            : null;

    const pemFiles = readdirSync(absPath).filter((f) => f.toLowerCase().endsWith('.pem'));
    if (pemFiles.length === 0) {
        throw new CredentialValidationError(`no *.pem file in ${absPath}`);
    }
    if (pemFiles.length > 1) {
        throw new CredentialValidationError(
            `multiple *.pem files in ${absPath} (${pemFiles.join(', ')}); expected exactly one`,
        );
    }
    const pem = readFileSync(join(absPath, pemFiles[0]!), 'utf-8');
    if (!pem.includes('BEGIN') || !pem.includes('PRIVATE KEY')) {
        throw new CredentialValidationError(
            `${pemFiles[0]} in ${absPath} does not look like a PEM private key`,
        );
    }
    return { app_id: appId, pem, app_slug: appSlug };
}

export const credentialsService = {
    async list(): Promise<ICredential[]> {
        const rows = await db
            .selectFrom('credentials')
            .selectAll()
            .orderBy('created_at', 'desc')
            .execute();
        return rows.map((r) => rowToCredential(r as unknown as Record<string, unknown>));
    },

    async get(id: string): Promise<ICredential | undefined> {
        const row = await db
            .selectFrom('credentials')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        return row ? rowToCredential(row as unknown as Record<string, unknown>) : undefined;
    },

    /**
     * Return a plaintext token for use in git / gh requests. For PAT rows
     * this is a straight decrypt of the stored ciphertext. For `github_app`
     * rows we lazily mint a fresh installation token whenever the stored
     * one is missing or within LAZY_REFRESH_MS of expiring; the background
     * scheduler tick handles the majority of refreshes ahead of time, but
     * the lazy path guarantees correctness even if the loop is silent.
     */
    async getToken(id: string): Promise<string> {
        const row = await db
            .selectFrom('credentials')
            .select(['kind', 'token_encrypted', 'expires_at'])
            .where('id', '=', id)
            .executeTakeFirst();
        if (!row) throw new Error(`Credential ${id} not found`);

        if (row.kind === 'github_app') {
            const nowPlusThreshold = Date.now() + LAZY_REFRESH_MS;
            // Coerce unparseable timestamps to 0 so a corrupt/foreign
            // expires_at TRIGGERS a refresh instead of silently disabling
            // it. `Date.parse('nonsense')` returns NaN; `NaN < threshold`
            // is always false, which prior to this guard let a stale
            // ghs_ token keep being served indefinitely.
            const parsed = row.expires_at ? Date.parse(row.expires_at) : 0;
            const expiresAtMs = Number.isFinite(parsed) ? parsed : 0;
            if (!row.token_encrypted || expiresAtMs < nowPlusThreshold) {
                await refreshCredential(id);
                const fresh = await db
                    .selectFrom('credentials')
                    .select('token_encrypted')
                    .where('id', '=', id)
                    .executeTakeFirst();
                if (!fresh?.token_encrypted) {
                    throw new Error(`Credential ${id} was refreshed but token_encrypted is still empty`);
                }
                return decrypt(fresh.token_encrypted);
            }
        }

        if (!row.token_encrypted) {
            throw new Error(`Credential ${id} has no stored token`);
        }
        return decrypt(row.token_encrypted);
    },

    async create(input: CredentialCreateInput): Promise<ICredential> {
        const id = randomUUID();
        if (input.kind === 'pat') {
            const token_encrypted = encrypt(input.token);
            const token_fingerprint = fingerprint(input.token);
            await db
                .insertInto('credentials')
                .values({
                    id,
                    label: input.label,
                    host: input.host,
                    kind: 'pat',
                    username: input.username,
                    token_encrypted,
                    token_fingerprint,
                    scope: input.scope,
                    expires_at: input.expires_at,
                    // On a PAT these are the commit AUTHOR, not a co-author —
                    // see the `pat` branch in `git-credentials.buildGitAuth`.
                    // `human_gh_login` stays github_app-only: it only feeds
                    // `gh pr create --assignee`, which no PAT flow reaches.
                    human_name: nullIfBlank(input.human_name),
                    human_email: nullIfBlank(input.human_email),
                } as never)
                .execute();
            // reason: the row was just inserted with this id; get() will
            // return it unless the DB dropped between statements.
            return (await this.get(id))!;
        }

        // kind === 'github_app'
        const { app_id, pem, app_slug } = readBotInfoFolder(input.bot_info_path);
        await db
            .insertInto('credentials')
            .values({
                id,
                label: input.label,
                host: input.host,
                kind: 'github_app',
                username: 'x-access-token',
                token_encrypted: null,
                token_fingerprint: null,
                scope: input.scope,
                expires_at: null,
                app_id,
                app_private_key_encrypted: encrypt(pem),
                app_installation_owner: input.app_installation_owner,
                app_installation_id: null,
                app_slug,
                human_name: nullIfBlank(input.human_name),
                human_email: nullIfBlank(input.human_email),
                human_gh_login: nullIfBlank(input.human_gh_login),
            } as never)
            .execute();
        // First-mint policy (2026-07-03 audit follow-up):
        //   * Transient failures (network, GitHub 5xx, 429 rate-limit) →
        //     keep the row; the lazy path in `getToken` retries when the
        //     Owner next does a git op. Log a warning so the operator
        //     sees it if they're tailing.
        //   * Permanent configuration failures (401 bad PEM, 403 App
        //     unauthorised, 404 installation owner not found / App not
        //     installed on that account) → roll back the insert and
        //     throw so the caller returns HTTP 400. A silently-accepted
        //     201 for a permanently-broken credential shows up as a
        //     valid entry in the UI and only surfaces at first git push,
        //     hours or days later.
        try {
            await refreshCredential(id);
        } catch (err) {
            const rawMsg = err instanceof Error ? err.message : String(err);
            const safeMsg = rawMsg.split(/:\s+/)[0] ?? rawMsg;
            const isPermanent =
                err instanceof GhApiError &&
                err.status >= 400 &&
                err.status < 500 &&
                err.status !== 429;
            if (isPermanent) {
                await db.deleteFrom('credentials').where('id', '=', id).execute();
                throw new CredentialValidationError(
                    `GitHub App token mint failed (${safeMsg}). Verify the bot info folder points at the correct App and the App is installed on '${input.app_installation_owner}'.`,
                );
            }
            // eslint-disable-next-line no-console
            console.warn(
                `[credentials] initial mint for ${id} failed transiently (will retry lazily): ${safeMsg}`,
            );
        }
        // reason: the insert above just committed a row with this id;
        // get() cannot legitimately return undefined here.
        return (await this.get(id))!;
    },

    async update(id: string, patch: CredentialUpdateInput): Promise<ICredential> {
        const existing = await this.get(id);
        if (!existing) throw new Error(`Credential ${id} not found`);

        // Kind-vs-field validation. Callers must not smuggle fields that
        // don't apply to the row's kind: github_app rows have no user-settable
        // token (the mint service owns it), and a PAT row has no App
        // installation. Silently dropping these was a footgun — the caller
        // assumed the write landed and got 200 OK back.
        //
        // `human_name` / `human_email` ARE valid on a PAT: they become the
        // commit author's `[user]` block. `human_gh_login` is not — it only
        // feeds `gh pr create --assignee`, which no PAT flow reaches, so
        // accepting it would imply an assignment that never happens.
        if (existing.kind === 'pat') {
            const badFields: string[] = [];
            if (patch.human_gh_login !== undefined) badFields.push('human_gh_login');
            if (patch.app_installation_owner !== undefined)
                badFields.push('app_installation_owner');
            if (badFields.length > 0) {
                throw new CredentialValidationError(
                    `Fields not valid for PAT credentials: ${badFields.join(', ')}`,
                );
            }
        }
        if (existing.kind === 'github_app') {
            const badFields: string[] = [];
            if (patch.token !== undefined) badFields.push('token');
            // username on a github_app row must remain 'x-access-token' —
            // it's the mandatory Basic-auth user for installation tokens
            // against api.github.com. Reject any attempt to change it.
            if (patch.username !== undefined && patch.username !== 'x-access-token')
                badFields.push('username');
            // expires_at is server-managed on github_app rows (mint
            // timestamp from GitHub). A client-writable expires_at is a
            // token-freshness tamper vector: PATCHing a far-future
            // timestamp makes getToken believe the stored (in fact expired)
            // ghs_ token is still valid, so every downstream git push /
            // gh call returns 401 with no signal on the row that the
            // installation-token cache is dead. Reject silently-passed
            // expires_at unless it matches what we already have (a no-op
            // PATCH would otherwise error the whole update).
            if (
                'expires_at' in patch &&
                patch.expires_at !== undefined &&
                patch.expires_at !== existing.expires_at
            ) {
                badFields.push('expires_at');
            }
            if (badFields.length > 0) {
                throw new CredentialValidationError(
                    `Fields not valid for github_app credentials: ${badFields.join(', ')}`,
                );
            }
        }

        // Build the patch. Use `'key' in patch` semantics for nullable
        // fields (expires_at, scope) so an explicit null clears them
        // instead of coalescing back to the existing value.
        const next: Record<string, string | null> = {
            label: patch.label ?? existing.label,
            username: patch.username ?? existing.username,
            scope: 'scope' in patch && patch.scope !== undefined ? patch.scope : existing.scope,
            expires_at:
                'expires_at' in patch ? patch.expires_at ?? null : existing.expires_at,
        };
        if (existing.kind === 'github_app' && patch.app_installation_owner !== undefined) {
            next['app_installation_owner'] = patch.app_installation_owner;
            // Owner change invalidates the cached installation id AND the
            // previously-minted token (which was scoped to the old owner's
            // installation). Without clearing token_encrypted + expires_at,
            // getToken keeps returning the stale token for up to
            // (1h - LAZY_REFRESH_MS = ~55 min) after the owner change,
            // during which pushes silently authenticate against the OLD
            // installation. See finding #2 in the 2026-07-03 audit.
            next['app_installation_id'] = null;
            next['token_encrypted'] = null;
            next['token_fingerprint'] = null;
            next['expires_at'] = null;
        }
        // name/email apply to both kinds (co-author on github_app, author on
        // pat); gh_login is github_app-only and already rejected above.
        if (patch.human_name !== undefined) {
            next['human_name'] = nullIfBlank(patch.human_name);
        }
        if (patch.human_email !== undefined) {
            next['human_email'] = nullIfBlank(patch.human_email);
        }
        if (existing.kind === 'github_app' && patch.human_gh_login !== undefined) {
            next['human_gh_login'] = nullIfBlank(patch.human_gh_login);
        }
        if (patch.token !== undefined && existing.kind === 'pat') {
            next['token_encrypted'] = encrypt(patch.token);
            next['token_fingerprint'] = fingerprint(patch.token);
        }
        await db.updateTable('credentials').set(next as never).where('id', '=', id).execute();
        // reason: update() only reached after the initial `this.get(id)`
        // succeeded; the row still exists after the update.
        return (await this.get(id))!;
    },

    async delete(id: string): Promise<void> {
        await db.deleteFrom('credentials').where('id', '=', id).execute();
    },

    async markUsed(id: string): Promise<void> {
        await db
            .updateTable('credentials')
            .set({ last_used_at: new Date().toISOString() })
            .where('id', '=', id)
            .execute();
    },
};
