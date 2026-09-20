# 11 — Walk wave D: settings, credentials, guard-rails, notifications, reminders

**Status:** todo
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
- [ ] **All six secret surfaces pass a write → hard-reload → reveal → compare
      round-trip** — paste the six comparisons
- [ ] No list or get response contains a plaintext secret — paste the six list
      responses with the relevant fields shown
- [ ] Each successful reveal produced a `{tag:'secret_reveal'}` log line
- [ ] The Reset Workspace modal's copy is compared against the actual truncate
      list, and any mismatch is filed. The reset was **not** executed
- [ ] The Jira tab renders sources per repo, not per project
- [ ] A throwaway PAT credential was used for the delete test; the
      `sspartorg (gh)` App credential is intact
- [ ] Console error count per page recorded; no finding fixed during this task

## Evidence

*(filled during execution)*

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
