# 0016. Jira Bridge

**Date:** 2026-09-19
**Status:** Accepted. Routing amended by ADR 0017 (multi-repo projects): **sources** replaced the single JQL, the default project and the label rules. See "Amendment: sources per repo" below.

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

## Amendment: sources per repo (ADR 0017)

A project can hold several repos, and a Task can span several of them. One JQL routed by labels could not say which repo an issue is for, so the config became an ordered list of **sources**, `{repo_id, jql, workflow_id}`, one JQL per repo:
- Every sync runs each source's JQL. An issue matching several sources becomes **one** Task in the project of the first source it matched, with `repo_ids` = the matched repos of that project (source order).
- The first matched source in that project with a workflow queues the Task; otherwise it waits as a draft with a `needs_you` notification. Matches in other projects are named in the import notification, because a Task lives in one project.
- While a Task is draft or ready, a sync also updates its repos to the sources that match now. The description header gains a `Repos` line.
- The "ready for review" and "done" comments list every pull request of the Task with its state (one PR per repo).
- Migration 044 converts the old config without changing where issues go. Each label rule becomes `(<jql>) AND labels = "<label>"` for the rule's project, in rule order. The plain JQL for the default project then catches the rest. The first matching source picks the project, as the first matching rule did.

The trust-boundary advice still holds, now per source: keep each JQL to issues your team controls, and leave a source's workflow empty if you want to review each Task before it runs.
