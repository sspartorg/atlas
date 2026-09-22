# 0016. Jira Bridge

**Date:** 2026-09-19
**Status:** Accepted. Routing amended twice: by [ADR 0017](0017-multi-repo-projects.md) (multi-repo projects), where **sources** replaced the single JQL, the default project and the label rules; and again below, where sources moved to the project. See "Amendment: sources per repo" and "Amendment: sources per project".

## Context

Requirements are written in Jira, and the work happens in Atlas. The Owner wants:
- Jira issues to become Atlas Tasks with nothing lost.
- A label to pick the workflow that works each Task.
- Jira to hear about progress and the final PR without anyone copying text across.
- The Jira issue to close when the Task is done.

Atlas is self-hosted and is an extension to Jira, not a replacement. The existing `agent-jira-to-epic` catalog agent imports through an LLM and the Atlassian MCP, so every import costs tokens and its output varies from run to run.

## Decision

**Import is plain code driven by the scheduler, with no AI.** The API's one-minute tick (`services/agent-schedule-registry.ts`) calls `jiraSync.tick`:
- Every `poll_interval_minutes` it runs the Owner's JQL. Each new issue becomes a Task in the configured project.
- The Task description is composed deterministically: header fields, description, configured extra fields, sub-tasks, links, attachments and comments. That description is the agents' prompt.
- **Routing.** The first rule whose label the issue carries picks the Atlas project (else the default project) and, when the rule has one, queues the Task on its workflow. Without a workflow the Task stays a draft and the Owner gets a `needs_you` notification. One Jira board can feed several repos this way.
- The Jira issue key is the primary key of `jira_issues`, so an issue is imported once. A Task the Owner deletes is never re-imported.

**Progress goes back as orchestrator comments, never agent calls.**
- Every Task status change posts one Jira comment right away: queued, in progress, waiting on the owner, ready for review with the PR, done.
- New Task and sub-task comments ride along with that comment as a digest. If there is no milestone, the digest is posted on the next poll.
- Agents never touch Jira, so the bridge costs no model tokens.

**Any path to Done closes the Jira issue.** When a Task reaches Done, whether the Owner marked it or the existing PR-merge auto-close did, the bridge posts a final comment with the PR state. It then applies the first transition whose target is in the `done` status category.

**Jira comments added after import arrive as read-only context.**
- They are stored as "Workflow" comments (`commentsService.create({ system: true })`), so they are never attributed to a running agent and never resume a parked run. The Owner answers in Atlas.
- While a Task is still draft or ready, the description is refreshed in place instead.

**Echo loop.** `jira_issues` keeps three id lists:
- Jira comments already reflected in Atlas
- Jira comments the bridge posted, which are never imported and never shown in the description
- Atlas comments that came from Jira, which are never posted back

**Read v2, write v3.** Issues and comments are read over REST v2, which returns wiki-markup strings, so no ADF parsing is needed to build the prompt. Comments are posted over REST v3 as ADF (Atlassian Document Format): text nodes are literal, so Markdown from agent comments can't turn into wiki markup (the first live run showed `-v … -version` rendering as strikethrough under v2). Digest lines have their Markdown markers stripped.

**Trust boundary.** Anyone who can edit an issue matching the JQL writes text that becomes agent prompt text, and a mapped label queues it without Owner review. So:
- Imported Jira text is quoted line by line, under a note that it describes the work and is not an instruction. A Jira comment can't pose as an Owner turn in the prompt.
- Keep the JQL and the routing labels to issues your team controls. Leave a rule's workflow empty if you want to review each Task before it runs.
- The API token is bound to the site and email it was entered for: changing either drops it, and `/test` never sends the stored token to another site. The site must be https (plain http only on loopback).

## Consequences

- `packages/shared` gains `IJiraConfig`, `IJiraSyncResult`, `IJiraTestResult`, `UpdateJiraConfigSchema`, `TestJiraConnectionSchema`, and the `jira_issue` external-link kind. The Owner sanctioned these edits for this feature.
- The AGENTS.md "no tracker links" rule now allows the one Jira link the bridge writes.
- One Jira site. A second site would move `jira_config` from a singleton to rows. (The single JQL and default project gave way to per-repo sources; see the amendment below.)
- An import is capped at 500 issues per source per sync. Jira sub-tasks are listed in their parent's description, not imported.
- Credentials: an API token encrypted at rest (`v1:` + AES-GCM, as for settings secrets), write-only over the API.

## Amendment: sources per repo ([ADR 0017](0017-multi-repo-projects.md))

A project can hold several repos, and a Task can span several of them. One JQL routed by labels could not say which repo an issue is for, so the config became an ordered list of **sources**, `{repo_id, jql, workflow_id}`, one JQL per repo:
- Every sync runs each source's JQL. An issue matching several sources becomes **one** Task in the project of the first source it matched, with `repo_ids` = the matched repos of that project (source order).
- The first matched source in that project with a workflow queues the Task; otherwise it waits as a draft with a `needs_you` notification. Matches in other projects are named in the import notification, because a Task lives in one project.
- While a Task is draft or ready, a sync also updates its repos to the sources that match now. The description header gains a `Repos` line.
- The "ready for review" and "done" comments list every pull request of the Task with its state (one PR per repo).
- Migration 044 converts the old config without changing where issues go. Each label rule becomes `(<jql>) AND labels = "<label>"` for the rule's project, in rule order. The plain JQL for the default project then catches the rest. The first matching source picks the project, as the first matching rule did.

The trust-boundary advice still holds, now per source: keep each JQL to issues your team controls, and leave a source's workflow empty if you want to review each Task before it runs.


## Amendment: sources per project (migration 010)

The Owner's model is *"query + workflow is one combo. I can create 10 combos and 10
different workflows can be attached and synced."* Sources were already that combo, but
they lived in the wrong place: an ordered jsonb array on the **singleton** `jira_config`
row, edited globally in Settings → Jira, each entry naming one `repo_id` with the project
inferred from it.

**Credentials stay a singleton** — one self-hosted site, one email, one token — and so do
`enabled`, `poll_interval_minutes` and `extra_fields`, because there is one poller. Only
the sources move.

### Data

`jira_sources`: `id serial PRIMARY KEY`, `project_id` (→ `projects` `ON DELETE CASCADE`),
`jql`, `workflow_id` (→ `workflows` `ON DELETE SET NULL`), `repo_ids jsonb`, `created_at`.
`jira_config.sources` is dropped.

A table rather than per-project jsonb, for three reasons:

- **The global order survives.** Matching is order-dependent and an issue is one Task
  (`jira_issues` is keyed by `jira_key`). A serial gives a total order across every
  project for free; backfilling `ORDER BY` the old array's ordinality reproduces today's
  routing exactly.
- **The DB does the deletes.** The two FK behaviours retire the whole "this source points
  at something that no longer exists" class. `projectRepos.remove()` strips the repo from
  `jira_sources.repo_ids` alongside `items.repo_ids`.
- **Stable ids let the UI edit one source.** The old shape was read-modify-write over a
  shared array: two tabs stomped each other, and delete-then-re-add silently moved a
  source to the end of the global order — quietly changing which project won an ambiguous
  issue.

`repo_id` becomes `repo_ids[]`. That is a deletion: the union logic (`distinctRepos` and
the two "matched repos of that project" passes) existed only because a source could name
one repo.

### Routing

- **Lowest source `id` wins globally.** First-created-source-wins, and because new rows
  always sort last, adding a source to a second project cannot hijack routing an existing
  source already owns. `jira_issues` keeps `jira_key` as its PK, so one issue is still one
  Task and nothing in flight moves.
- *Rejected:* one Task per matching project. It forces the PK to `(jira_key, item_id)`,
  posts N milestone comments onto one shared Jira issue, and fires `transitionToDone` when
  the first of N Tasks finishes — real blast radius on someone else's board for an
  ambiguity the Owner fixes by narrowing a JQL.
- **Behaviour change:** the queueing workflow is now the matched source's **own**
  `workflow_id`, not "the first source in the winning project that has one". An issue
  caught by a deliberately workflow-less query used to be queued by a different query's
  workflow. It now waits as a draft with a `needs_you` notification, which is what "query
  + workflow is one combo" means.

### Surface

`GET/PUT /api/integrations/jira` shrinks to connection + import; `UpdateJiraConfigSchema`
is `.strict()`, so a stale caller sending `sources` gets a 400 — the same hard break the
retired `jql` / `project_id` / `label_workflows` fields took. Sources get
`GET/POST /api/projects/:projectId/jira-sources` and
`PATCH/DELETE /api/projects/:projectId/jira-sources/:id`, surfaced on a new **Jira** tab on
Project Detail (`ProjectJiraCard`). Settings keeps the connection, the poll interval and
Sync now.

`packages/shared` changes (Owner-sanctioned): `IJiraSource` reshaped, `IJiraConfig.sources`
removed, `sources` dropped from `UpdateJiraConfigSchema`, and `CreateJiraSourceSchema` /
`UpdateJiraSourceSchema` added.
