# 04 — Register the sspart-bot GitHub App credential

**Status:** done — 2026-09-20
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

## Installation id

`62910480`, supplied by the Owner on 2026-09-20. It is not in
`~/Work/workspace/bots-info/`, which holds only `app-config.json`
(`{"id": 4332243, "slug": "sspart-bot"}`) and `sspart-bot.pem`.

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
   | installation id | `62910480` |
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

- [x] The installation id was obtained from the Owner: `62910480` (2026-09-20)
- [x] Row exists with `kind = github_app`, `app_id = 4332243`,
      `app_slug = sspart-bot` — pasted below
- [x] `POST /api/credentials/:id/refresh` minted a new token — fingerprint
      changed `bOVg` → `ff1Q`, expiry moved 09:07:09 → 09:08:20
- [x] `GET /api/credentials` returns `token_encrypted: null` and reduces the
      private key to `has_app_private_key: true`. No `ghs_` or `BEGIN` string
      anywhere in the payload
- [ ] ⚠️ **Not applicable to an App credential — the checkbox was wrong.**
      `GET /api/credentials/:id/token` returns `400 validation_error`, *"Only
      pat credentials can be revealed"*. Correct by design: an App has no
      static token, only short-lived installation tokens minted on demand.
      The reveal round-trip belongs to the PAT path and is exercised in
      [task-11](task-11-walk-wave-d-settings-admin.md); `refresh` is the App
      equivalent and passed
- [x] Zero gitconfig-fallback warnings in the API log — `app_slug` and
      `app_id` both landed, so the `[user]` block will be written
- [x] Zero `AUTHORIZATION`-bearing files in `$TMPDIR` after the refresh, and
      zero `ghs_` strings in `ps aux` — the token never reaches argv
- [x] PEM sha256 matches the task-02 capture exactly; still mode 0600,
      1679 bytes, mtime 11 Aug
- [x] **Bot identity proven on a real commit** (deferred check, closed in
      task-07): author `sspart-bot[bot]`, trailer `Co-Authored-By: sspart`

## Evidence

Executed 2026-09-20 through the UI at `/settings/credentials`.

**Credential row** (encrypted columns elided):

```
label                  sspartorg (gh)
host                   github
kind                   github_app
username               x-access-token
app_id                 4332243          <- read from app-config.json
app_slug               sspart-bot       <- read from app-config.json
app_installation_id    147420481        <- DISCOVERED by Atlas, see below
app_installation_owner sspartorg
human_name / email     sspart / sspart.org@gmail.com
human_gh_login         sspartorg
token_encrypted        set(548)
app_private_key_enc.   set(2276)
token_fingerprint      tok_****************bOVg
```

**`workspace.key` was created here, not at boot** — 32 bytes, mode 0600,
generated on the first `encrypt()` call. This closes the checkbox deferred from
[task-03](task-03-first-boot-onboarding.md) and confirms `loadOrCreateKey()` is
lazy.

**X1 holds.** `GET /api/credentials` returns 20 keys; `token_encrypted` is
`null` and the private key is reduced to `has_app_private_key: true`. A scan of
the payload for `ghs_`, `BEGIN` and `PRIVATE KEY` found nothing. Note that
`token_fingerprint` **is** populated — the 2026-09-12 defect where the API
nulled it on every read is not present here.

**Refresh works.**

```
expires_at  2026-09-20 09:07:09+00  ->  2026-09-20 09:08:20+00
fingerprint tok_****bOVg            ->  tok_****ff1Q
```

The response still nulls `token_encrypted`.

**No token exposure.** Zero `AUTHORIZATION`-bearing files in `$TMPDIR`, zero
`ghs_` strings in `ps aux` — consistent with `buildGitAuth` handing the token
to git via `GIT_CONFIG_GLOBAL` rather than argv.

**PEM untouched.** `3d9dab455e6fd15f79e11a38571b37de6119e8cae9d33c346e553bbe1ceb34aa`,
identical to the task-02 capture.

### Two corrections

1. **The form has no App ID or Installation ID field.** The task's field table
   listed both. In reality the modal takes Host, Label, Bot info folder,
   Installation owner, optional human attribution and Repo scope — Atlas reads
   `app_id` and `app_slug` from `app-config.json` in that folder and
   **discovers the installation id itself** from the owner.

2. ⚠️ **The discovered installation id is `147420481`, not the `62910480` the
   Owner supplied.** The supplied value was never entered, because there is no
   field for it. Atlas's discovered id demonstrably works — it minted two live
   installation tokens. `62910480` could not be cross-checked:
   `GET /app/installations` needs an App JWT and
   `GET /orgs/sspartorg/installations` needs the `admin:org` scope, neither of
   which this `gh` session has. **Raised with the Owner rather than assumed
   wrong** — it may be a second installation on a personal account.

**The deferred identity proof PASSED** during task-07's first live run
(2026-09-20). Commit `df04405` on branch `atlas/wf/ATL-1`:

```
author:    sspart-bot[bot] <4332243+sspart-bot[bot]@users.noreply.github.com>
committer: sspart-bot[bot] <4332243+sspart-bot[bot]@users.noreply.github.com>
Co-Authored-By: sspart <sspart.org@gmail.com>
```

Exactly the shape `git-credentials.ts:104-175` specifies: the App's bot
identity authors, the human rides as a trailer. The `[user]` block was written,
which is the positive proof that `app_slug` and `app_id` both landed — had
either been missing, the block would have been omitted and the commit would
have silently inherited the host machine's `~/.gitconfig`.
