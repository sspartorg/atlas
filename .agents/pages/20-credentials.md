# Credentials

**Route:** `/settings/credentials` • **Component:** `packages/web/src/pages/Credentials.tsx` • **Slug:** `proj-creds`

## Purpose
Manage encrypted git credentials. Today only Personal Access Tokens (PAT) are functional; SSH and App Password are placeholders.

## States
- **Loading**: full-height spinner
- **Empty**: `CredentialsEmptyState`
- **Populated**: `CredentialsTable` + security alert

## UI elements
**Breadcrumb** — Settings → Credentials.

**Header**
- Title "Git credentials" + summary line "{N} credentials · {M} hosts · {P} expiring soon"
- ~~**Check expiries** button~~ — **does not exist.** `Credentials.tsx:182-194` has only **Add credential**. *(corrected 2026-09-20 — campaign task-21.)*
- **Add credential** → opens `CredentialModal` in add mode

**Security alert** — AES-256-GCM at rest copy + badge "local · aes-256-gcm". Read-only.

**`CredentialsTable`** — columns: Label (icon + name + `cred-XXXX` id), Host (hardcoded GitHub today), Kind chip (`PAT` / `GitHub App`, from `credential.kind` — was a hardcoded `PAT` literal until 2026-09-12, so every `github_app` row was mislabeled), Scope chips, Fingerprint, Status (Active / Expiring N d / Unused N d — `github_app` rows never show Expiring), Last used, Actions (Edit icon + `CredentialRowMenu`).

**Fingerprint is not a hash.** `crypto.ts::fingerprint()` returns a host prefix (`ghp_` / `gpat_` / `tok_`) + 16 mask dots + the token's last 4 characters. Until 2026-09-12 `stripSecretsForApi` nulled it on every read, so this column, the saved-view detail row and the row menu's **Copy fingerprint** action were all permanently blank. Only `token_encrypted` is stripped now.

**`CredentialRowMenu`** items
- **Edit** → opens `CredentialModal` in edit mode
- ~~**Verify now**~~ — **does not exist.** `CredentialRowMenu.tsx:14-23` has exactly two items: Edit and Delete. *(corrected 2026-09-20 — campaign task-21.)*
- **Copy fingerprint** → clipboard write of `token_fingerprint` + toast
- **Delete credential…** → confirmation → `DELETE /api/credentials/:id`

## Why these affordances exist
- **Verify & save (form view)** — Tokens are easy to typo and silently wrong; verifying against the host before persisting prevents storing junk that later breaks a clone.
- **Edit (token blank keeps existing)** — Rotating a label or scope shouldn't require re-typing the token; matches the standard credential-manager pattern.
- **Copy fingerprint** — Multiple credentials per host need disambiguation; the SHA-256 fingerprint is the human-checkable identifier that doesn't leak the secret.
- **Delete confirmation** — Deletion breaks any project depending on the credential; the confirm modal makes the blast radius explicit.
- **3-view modal (Kind / Form / Saved)** — Kind selection sets schema; mixing kind + form fields up-front would create a wide form with mostly-irrelevant inputs.

## Modals / drawers
**`CredentialModal`** — 3-view flow
- **Kind view** (add only): PAT (default) / SSH key (disabled) / App password (disabled)
- **Form view**: Host (locked to github), Label, Token, **Commit identity** (PAT only — Your name / Your email), Repo scope; **Verify & save** (or **Save changes** in edit mode)
- **Token eye icon** — in edit mode on a `pat` row it fetches the plaintext from `GET /api/credentials/:id/token` and shows it read-only until clicked again; the field stays read-only while a revealed value is on screen so a stray keystroke can't turn a reveal into a silent rotation. Typing drops the revealed value and reverts to "replace the token" semantics. In add mode (or once the Owner has typed) it is a plain show/hide. Before 2026-09-12 it only flipped the input `type` over a field that is never hydrated — the token is not in any GET response — so "show" showed an empty box.
- **Saved view**: success + details box + **Add another** / **Done**

**Commit identity (PAT)** — writes `human_name` / `human_email`. Set both and `buildGitAuth` emits a `[user]` block in the session's temp git config, so `git commit` inside any terminal on this credential is authored as you. Leave either blank and commits fall back to the host machine's `~/.gitconfig` — which was the only behaviour before standalone terminals shipped, and is the reason a session could push under one identity while committing under another. Note the field means something different on a github_app credential, where the same two columns produce a `Co-Authored-By` trailer behind the bot author.

**Delete dialog** — "Delete credential?", red Delete button.

## Hooks used
- `useCredentials`
- `useMutation` (delete) — invalidates `['credentials']`
- `useToast`

## API endpoints touched
- `GET /api/credentials/:id/token` (on-demand PAT reveal — `requireMcpToken`, audited, `pat` only)
- `GET /api/credentials`
- `POST /api/credentials` (create — encrypts token before persisting)
- `PATCH /api/credentials/:id` (update — token blank keeps existing)
- `DELETE /api/credentials/:id`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- **Verify** and **Check expiries** are stubs (see coming-soon).
- "Expiring soon" and the Expiring chip share `daysUntilExpiry()` in `CredentialsTable.tsx`: expiry within 0-30 days (`EXPIRY_WARN_DAYS`). `github_app` credentials are skipped — their `expires_at` is the ~1h installation token the API re-mints on its own. Status chip rules: Active (not expiring AND used recently or <30d old); Expiring (0-30d); Unused (no use for ≥30d).
- In edit mode, blank token keeps the existing token. Revealing does NOT populate the submit payload — `revealedToken` is transient display state, `token` stays empty, so saving after a reveal preserves the stored value.
- Host is locked to GitHub today even though the schema permits other hosts.

## Connectivity
- **Pages**: [Projects](02-projects.md) — NewProjectModal picks a credential from this list; [Settings → Profile](19-settings.md) — credentials status card deep-links here; [Terminal — Standalone](26-terminal-standalone.md) — its create dialog picks a credential per session, and the commit identity above is what makes that pick affect authorship and not just the push token.
- **Routes**: `POST /api/credentials` validates token against host before persisting, then encrypts at rest; `PATCH` accepts a blank token as a no-op so label/scope edits don't require re-entering the secret.
- **Entities**: `credential` — encrypted token, host, scope, fingerprint; referenced by `project.credential_id`.

## Coming soon on this page
- Verify now, Check expiries, SSH + App password credential kinds — see [coming-soon.md](../coming-soon.md).
