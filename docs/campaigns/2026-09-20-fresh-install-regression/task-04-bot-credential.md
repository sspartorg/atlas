# 04 — Register the sspart-bot GitHub App credential

**Status:** todo — needs the App installation id
**Depends on:** [task-03](task-03-first-boot-onboarding.md)
**Scope:** infra

## Why

Every clone, push and PR in this campaign runs as the bot. Atlas stores
credentials as global rows attached per repo (`project_repos.credential_id`)
and per session (`cli_sessions.credential_id`), both `ON DELETE SET NULL`.
There is no user table and no per-user scoping — the credential row *is* the
identity.

Getting the App fields wrong fails quietly rather than loudly, which is why
this task checks the commit trailer rather than trusting the save.

## Blocked on

The **App installation id** is not in `~/Work/workspace/bots-info/`, which
holds only `app-config.json` (`{"id": 4332243, "slug": "sspart-bot"}`) and
`sspart-bot.pem`. Ask the Owner, or read it from
`GET /app/installations` with a JWT signed by the PEM. Do not guess.

## What to do

1. **Confirm the PEM is still there and was not wiped.**
   `ls -l ~/Work/workspace/bots-info/sspart-bot.pem` — mode 0600, 1679 bytes.
   The reset inventory lists this directory under KEEP for exactly this reason.

2. **Create the credential through the UI**, at `/settings/credentials` →
   Add credential → kind **GitHub App** (`pages/credentials/CredentialModal.tsx`):

   | Field | Value |
   |---|---|
   | label | `sspartorg (gh)` |
   | host | `github` |
   | kind | `github_app` |
   | app id | `4332243` |
   | bot info folder | `~/Work/workspace/bots-info` (Atlas reads the PEM from it) |
   | app slug | `sspart-bot` |
   | installation owner | `sspartorg` |
   | installation id | *(from the blocker above)* |
   | human name | `sspart` |
   | human email | `sspart.org@gmail.com` |
   | human GitHub login | `sspartorg` |
   | username | `x-access-token` (the default) |

3. **Understand why `app_slug` and `app_id` are not optional.**
   `services/git-credentials.ts:104-175` builds a per-run git config and
   writes a `[user]` block only when both are present. Without them the block
   is omitted entirely and **commits silently fall back to the host machine's
   `~/.gitconfig`** — the code logs a loud warning for exactly this case, but
   the commit still lands, attributed to the wrong person. Check the API log
   for that warning after saving; its absence is part of the proof.

4. **Verify the token mints.** Hit Refresh on the credential row
   (`POST /api/credentials/:id/refresh`) and confirm an installation token is
   minted. `services/github-app-tokens.ts` also pre-warms tokens within 15 min
   of expiry on the minute tick.

5. **Verify the reveal round-trip** (check class 1, invariant X1). The token is
   AES-256-GCM encrypted under the freshly generated `workspace.key`. It must
   come back through `GET /api/credentials/:id/token` and **not** through the
   list or get response. Confirm `GET /api/credentials` returns only
   `token_fingerprint`, never the token.

6. **Prove the identity end to end.** This is the real test, and it cannot be
   done until a repo exists — so defer the assertion to
   [task-06](task-06-project-two-repos-setup-secrets.md) and record here what
   to look for. The expected git config is:
   ```ini
   [http]
   	extraheader = AUTHORIZATION: basic <base64("x-access-token:<ghs_token>")>
   [credential]
   	helper =
   [user]
   	name  = sspart-bot[bot]
   	email = 4332243+sspart-bot[bot]@users.noreply.github.com
   [core]
   	hooksPath = <tmpdir>
   ```
   plus a `prepare-commit-msg` hook appending
   `Co-Authored-By: sspart <sspart.org@gmail.com>`. The bot authors; the human
   is a trailer. (For a PAT with `human_*` set the human becomes the *author*
   instead — a PAT has no bot identity. That path is not used here.)

7. **Confirm the temp config is cleaned up.** `buildGitAuth` materialises a
   0600 temp dir handed to git via `GIT_CONFIG_GLOBAL` — never argv, so the
   token does not appear in `ps`. `cleanupGitConfig` runs in a `finally`. After
   any operation, `$TMPDIR` must hold no leftover config with an
   `AUTHORIZATION` line.

## Done when

- [ ] The installation id was obtained from the Owner or from
      `GET /app/installations`, and is recorded below
- [ ] The credential row exists with `kind = github_app`, `app_id = 4332243`,
      `app_slug = sspart-bot` — paste the row with the encrypted columns elided
- [ ] `POST /api/credentials/:id/refresh` mints an installation token
- [ ] `GET /api/credentials` returns **no** token or private key — paste the
      response
- [ ] `GET /api/credentials/:id/token` reveals it, and the reveal is logged
      with `{tag:'secret_reveal'}`
- [ ] The API log carries **no** "falling back to host gitconfig" warning
- [ ] No `AUTHORIZATION`-bearing file is left in `$TMPDIR` after the refresh
- [ ] The PEM at `~/Work/workspace/bots-info/sspart-bot.pem` is unmodified —
      compare its checksum against a pre-task capture

## Evidence

*(filled during execution)*

App installation id: ____
