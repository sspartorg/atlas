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
- **Check expiries** button — disabled with tooltip "Coming soon"
- **Add credential** → opens `CredentialModal` in add mode

**Security alert** — AES-256-GCM at rest copy + badge "local · aes-256-gcm". Read-only.

**`CredentialsTable`** — columns: Label (icon + name + `cred-XXXX` id), Host (hardcoded GitHub today), Kind chip ("PAT"), Scope chips, Fingerprint (truncated SHA-256), Status (Active / Expiring N d / Unused N d), Last used, Actions (Edit icon + `CredentialRowMenu`).

**`CredentialRowMenu`** items
- **Edit** → opens `CredentialModal` in edit mode
- **Verify now** → toast "Verify "{label}" — coming soon"; see coming-soon
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
- **Form view**: Host (locked to github), Label, Token, Repo scope; **Verify & save** (or **Save changes** in edit mode)
- **Saved view**: success + details box + **Add another** / **Done**

**Delete dialog** — "Delete credential?", red Delete button.

## Hooks used
- `useCredentials`
- `useMutation` (delete) — invalidates `['credentials']`
- `useToast`

## API endpoints touched
- `GET /api/credentials`
- `POST /api/credentials` (create — encrypts token before persisting)
- `PATCH /api/credentials/:id` (update — token blank keeps existing)
- `DELETE /api/credentials/:id`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- **Verify** and **Check expiries** are stubs (see coming-soon).
- "Expiring soon" is computed client-side as `expires_at <= now + 30d`. Status chip rules: Active (not expiring AND used recently or <30d old); Expiring (expiry in next 0-60d); Unused (no use for ≥30d).
- In edit mode, blank token keeps the existing token.
- Host is locked to GitHub today even though the schema permits other hosts.

## Connectivity
- **Pages**: [Projects](02-projects.md) — NewProjectModal picks a credential from this list; [Settings → Profile](19-settings.md) — credentials status card deep-links here.
- **Routes**: `POST /api/credentials` validates token against host before persisting, then encrypts at rest; `PATCH` accepts a blank token as a no-op so label/scope edits don't require re-entering the secret.
- **Entities**: `credential` — encrypted token, host, scope, fingerprint; referenced by `project.credential_id`.

## Coming soon on this page
- Verify now, Check expiries, SSH + App password credential kinds — see [coming-soon.md](../coming-soon.md).
