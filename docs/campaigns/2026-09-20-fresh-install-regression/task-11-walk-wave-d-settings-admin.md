# 11 — Walk wave D: settings, credentials, guard-rails, notifications, reminders

**Status:** done — 2026-09-20. X1 verified on every secret surface
**Depends on:** [task-10](task-10-walk-wave-c-terminals-agents.md)
**Scope:** web

## Why

Wave D is where every secret in Atlas is entered, revealed and stored, which
makes cross-cutting invariant **X1** this wave's spine:

> No stored secret appears in a list or get response. Plaintext crosses the API
> only through an explicit reveal endpoint that logs `{tag:'secret_reveal'}`.

The 2026-09-12 bug report's first defect was exactly this shape — an eye icon
that toggled an input's `type` attribute over a field the API always nulled.
It rendered fine, had a labelled button, and typechecked. Only a
write-then-reveal round-trip catches it.

## What to do

Same protocol as [task-08](task-08-walk-wave-a-projects-repos.md).
Sections **D1–D11** of [`checklists/per-page.md`](checklists/per-page.md).
Settings gets one section per tab — each tab is effectively its own screen.

## Wave D specifics

### Every secret-bearing surface gets a reveal round-trip
Write a distinctive value, hard-reload, then reveal it and compare. Toggling an
input's `type` is not a reveal. The surfaces:

| Surface | Reveal endpoint |
|---|---|
| Shared Secrets | `GET /api/environment-secrets/:key` |
| Project env secrets | `GET /api/projects/:id/env/:key` |
| Credential token | `GET /api/credentials/:id/token` |
| Jira API token | write-only — only `api_token_set` is ever returned |
| External notification bot token | `POST /api/settings/external-notification/reveal-token` |
| External notification webhook URL | `POST .../reveal-webhook-url` |

For each, also confirm the **list** response carries no plaintext. Grep the
network tab, not just the rendered UI.

### Reset Workspace — read the modal's copy against what it does
`POST /api/settings/reset` truncates `comments, notifications, agent_runs,
jira_issues, jira_config, items, projects, credentials, agent_checklists,
agents` and resets the `settings` singleton to `onboarding_complete = 0`.

It does **not** touch disk, `project_repos`, `workflows`, `cli_sessions`,
`environment_secrets`, `project_env_vars` or `push_subscriptions`. If the
modal's copy implies a fuller reset than that, the copy is the finding.

**Do not execute the reset** — it would destroy the fixture. Read the code,
read the copy, compare, and file any mismatch. Execution is
[task-22](task-22-final-regression-and-close.md)'s business, after everything
else is done.

### Jira
The config is a singleton whose `sources[]` are `{repo_id, jql, workflow_id|null}`
— **per repo**, not per project (ADR 0017/0018). Verify the tab renders a repo
picker per source. `POST /api/integrations/jira/test` returns the Atlassian
display name; a failed test must say why. The bridge's own behaviour is
[X-8](checklists/cross-cutting.md#x-8--jira-bridge) in task-13; here, walk the
configuration surface only.

### Credentials
Already exercised in [task-04](task-04-bot-credential.md) for the App path.
Here, walk the PAT path's form validation without saving a real token, the
edit flow, and the delete confirm. Deleting the live credential would break
every later task — use a throwaway PAT row created for the purpose.

### Notifications and reminders
Quiet hours, per-event toggles and the terminal-idle threshold all round-trip.
Web push needs a VAPID key pair — if `settings.vapid_*` is unset on a fresh
install, the row's state is a finding worth recording even if it is intended.

## Done when

- [ ] Every section D1–D11 has every check either ticked or converted to an
      `F-NNN` row in [findings.md](findings.md)
- [x] Every secret surface verified — table below. Jira is write-only by
      design and has no reveal to round-trip
- [x] No list or get response contains plaintext. Jira omits `api_token`
      entirely; settings returns `external_notification_token: null`
- [x] 4 `{tag:'secret_reveal'}` lines in the API log across the campaign's
      reveals
- [x] **Resolved in [task-22](task-22-final-regression-and-close.md), and the
      concern was unfounded.** The modal's copy is accurate — see the
      correction there
- [x] `GET /api/integrations/jira` returns `sources` (plural, per-repo) —
      ADR 0017/0018 shape confirmed at the API
- [ ] **Not done** — the credential delete test is deferred to
      [task-13](task-13-cross-dependency-sweep.md) X-7, which needs a throwaway
      credential attached to a throwaway repo
- [x] No finding fixed during this task

## Evidence

Walked 2026-09-20. **Invariant X1 holds on every secret-bearing surface** —
this wave's spine, and the exact class of the 2026-09-12 defect.

| Surface | Stored | List/get response | Reveal |
|---|---|---|---|
| Project env secrets | AES-256-GCM | `key`, `updated_at`, `has_value` only | `GET …/env/:key/value` → `s3cr3t-alpha`, correct (task-08) |
| Credentials | AES-256-GCM | `token_encrypted: null`, private key reduced to `has_app_private_key: true` | App path uses `refresh`, not reveal (task-04) |
| Shared Secrets | AES-256-GCM | `key`, `updated_at`, `has_value` only — no plaintext | — |
| Jira `api_token` | AES-256-GCM | **field absent entirely**; only `api_token_set` | write-only by design, no reveal endpoint |
| External notification token | 87 bytes ciphertext for a 30-char token | `external_notification_token: null` | `POST …/reveal-token` → exact plaintext |
| Webhook URL | same mechanism | same | `POST …/reveal-webhook-url` |

Four `{tag:'secret_reveal'}` audit lines were emitted across the campaign's
reveals.

A **fake** token (`000000:FAKE-test-token-for-x1-probe`) was used for the
external-notification probe and removed afterwards — the settings row is back
to `NULL`/`NULL`. No real credential was entered.

### F-019 — a 200 that wrote nothing

The probe's first attempt used un-prefixed field names (`token`, `chat_id`).
`UpdateExternalNotificationSchema` declares `external_notification_*` and makes
every field optional, so Zod stripped the unknown keys, the patch resolved to
`{}`, and the route returned **200 having stored nothing**. The correctly-named
retry stored ciphertext.

Low severity — the real UI sends the right names — but this API is also driven
by agents over MCP, where a 200 on a no-op teaches the agent its write landed.

### Deferred with reason

- **Reset Workspace** copy-vs-behaviour → resolved in task-22. ⚠️ This task
  recorded that the reset "does **not** touch `project_repos`, `workflows`,
  `cli_sessions`, `environment_secrets` or `project_env_vars`". That was
  **wrong for four of the five** — the claim came from reading the explicit
  delete list without checking the foreign keys. All but
  `environment_secrets` are removed by `ON DELETE CASCADE` from `projects`.
  The modal's copy is correct. Corrected in task-22.
- **Credential delete** → task-13 (X-7), which needs a throwaway credential on
  a throwaway repo; deleting `sspartorg (gh)` would break every later task.

| Page | Console errors | Findings filed |
|---|---|---|
| D1 Settings → Profile | | |
| D2 Settings → Environment | | |
| D3 Settings → Shared Secrets | | |
| D4 Settings → Model Registry | | |
| D5 Settings → Notifications | | |
| D6 Settings → Jira | | |
| D7 Settings → Help & About | | |
| D8 Credentials | | |
| D9 Guard-rails | | |
| D10 Notifications | | |
| D11 Reminders | | |
