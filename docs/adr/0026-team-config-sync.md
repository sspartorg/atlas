# 0026. Team Config Sync Through a Git Repo

**Date:** 2026-10-07
**Status:** Accepted

## Context

Every Atlas install is configured by hand: projects, repos, guardrails, guardrail scripts, Jira queries, workflows (which own schedules, ADR 0014) and agents. A teammate joining a project, or the Owner moving to a new laptop, rebuilt all of it step by step, and the copies drifted. The only portable pieces were single-workflow and single-agent zip bundles and a per-project `.env` secrets export.

Secrets cannot travel with the rest. Every encrypted value is keyed to one machine (`services/crypto.ts`, HKDF over the OS machine id), and committing plaintext to a repo is not acceptable. Credentials, Jira tokens and `.env` values are also personal: each person uses their own.

Atlas is single-Owner with no auth (AGENTS.md). Sharing configuration must not change that.

## Decision

An install can connect to one git repo, the **team config repo**, as a **publisher** or a **subscriber** (`team_config` singleton, migration 004; `services/team-config.ts`).

- The publisher exports the projects it marks `team_managed` — with their repos (no local path, no credential), guardrails, scripts, Jira sources, workflows and the agents those workflows use (no memory) — as JSON and Markdown files, commits, and pushes. The one-minute tick re-exports and pushes when the files differ.
- A subscriber fetches on its interval and imports: ids travel with the rows, every row it writes is marked `team_managed`, and the next pull overwrites local edits to those rows. Rows it did not write are never touched. Missing repos are cloned into the workspace with the subscriber's own credential.
- Secrets are never written to the repo. They keep using the existing per-project export / import.
- Nothing that holds the Owner's work is deleted by a sync: a project dropped from the repo is detached and becomes local.

Each install still has one Owner. The repo is shared; the installs are not.

## Consequences

- A new machine joins by setting a repo URL, a credential and the subscriber role, then adding its own secrets.
- Subscribers must not edit team-managed items; the UI warns on them. Per-field local overrides are not supported. A workflow's active switch is the one local exception, so a teammate can pause a schedule.
- Writing to the repo needs push rights on the configured branch: an admin bypass on a protected `main`, or a dedicated sync branch.
- "Assigned to me" in a shared JQL query must be written `currentUser()`; Jira resolves it against each person's own token.
- One repo per install. Several team repos, webhook-driven pulls and merging edits from several publishers are left out until needed.
