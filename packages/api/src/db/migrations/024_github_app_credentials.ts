import type { Knex } from 'knex';

// Extend the credentials table to support GitHub App installation identities.
//
// Today `credentials` only holds Personal Access Tokens: `kind = 'pat'` and
// `token_encrypted` is required. Add a second kind, `github_app`, that stores
// an App's numeric id + the encrypted PEM. The minted installation token
// (short-lived) reuses `token_encrypted` / `expires_at`; the credentials
// service refreshes it lazily on `getToken()` and pre-warms it from the
// existing agent-scheduler tick. That means every callsite that already
// consumes a credential id (worktree push, PR create, reclone, auto-fetch,
// git-status) works transparently for either kind.
//
// Both existing columns `token_encrypted` and `token_fingerprint` become
// nullable so we can insert a `github_app` row before the first token has
// been minted. PAT rows continue to require them via a partial CHECK.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_kind_check;
        ALTER TABLE public.credentials
            ADD CONSTRAINT credentials_kind_check
            CHECK (kind = ANY (ARRAY['pat'::text, 'github_app'::text]));

        ALTER TABLE public.credentials ALTER COLUMN token_encrypted DROP NOT NULL;
        ALTER TABLE public.credentials ALTER COLUMN token_fingerprint DROP NOT NULL;

        ALTER TABLE public.credentials
            ADD COLUMN IF NOT EXISTS app_id bigint,
            ADD COLUMN IF NOT EXISTS app_private_key_encrypted text,
            ADD COLUMN IF NOT EXISTS app_installation_owner text,
            ADD COLUMN IF NOT EXISTS app_installation_id bigint;

        -- PAT rows must have a real token; github_app rows must have App fields.
        ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_kind_fields_check;
        ALTER TABLE public.credentials
            ADD CONSTRAINT credentials_kind_fields_check CHECK (
                (kind = 'pat' AND token_encrypted IS NOT NULL AND token_fingerprint IS NOT NULL)
                OR
                (kind = 'github_app' AND app_id IS NOT NULL
                    AND app_private_key_encrypted IS NOT NULL
                    AND app_installation_owner IS NOT NULL)
            );
    `);
}

export async function down(knex: Knex): Promise<void> {
    // Any github_app rows must be gone before we can restore the PAT-only
    // NOT NULLs. Delete them explicitly rather than surprising the operator
    // with a check-constraint violation halfway through.
    await knex.schema.raw(`
        DELETE FROM public.credentials WHERE kind = 'github_app';

        ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_kind_fields_check;

        ALTER TABLE public.credentials
            DROP COLUMN IF EXISTS app_installation_id,
            DROP COLUMN IF EXISTS app_installation_owner,
            DROP COLUMN IF EXISTS app_private_key_encrypted,
            DROP COLUMN IF EXISTS app_id;

        ALTER TABLE public.credentials ALTER COLUMN token_fingerprint SET NOT NULL;
        ALTER TABLE public.credentials ALTER COLUMN token_encrypted SET NOT NULL;

        ALTER TABLE public.credentials DROP CONSTRAINT IF EXISTS credentials_kind_check;
        ALTER TABLE public.credentials
            ADD CONSTRAINT credentials_kind_check CHECK (kind = 'pat'::text);
    `);
}
