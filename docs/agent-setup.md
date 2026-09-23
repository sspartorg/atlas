# Agent Setup — GitHub bot & first agent run

This runbook captures the exact, working procedure to connect Atlas to GitHub via a **bot (GitHub App)**
and get an AI agent to open a **real pull request**. Verified end-to-end.

## Prerequisites (on the machine running the Atlas API)

- **`gh`** (GitHub CLI) and **`claude`** (Claude Code CLI) installed and on `PATH`.
- Atlas onboarded (a workspace folder is set under Settings → Environment).
- Live agent runs enabled: **`ATLAS_AI_ENABLED=true`** in `.env` (the default is simulated mode, which
  emits canned output instead of spawning a real CLI).

## 1. Create the bot (a GitHub App) — one time

Create a GitHub App under your account/org with:

- **Repository permissions:** Contents = **Read & write**, Pull requests = **Read & write** (Metadata =
  Read is automatic). No webhook needed.
- **Generate a private key** (downloads a `.pem`).
- **Install** the App on the repositories it should manage (e.g. *All repositories*).

You end up with an **App ID**, an app **slug** (e.g. `sspart-bot`), and the **`.pem`** private key.

> Fastest path: GitHub's *App-Manifest flow* — a small local page that POSTs a pre-filled manifest to
> `https://github.com/settings/apps/new`; you click **Create GitHub App** once and GitHub returns the App
> ID + private key automatically. The manual UI (Settings → Developer settings → GitHub Apps → New GitHub
> App) works too.

## 2. Build the bot-info folder

Atlas reads the App from a local folder (keep it private — it holds the key):

```
<bot-info-folder>/
  app-config.json      # {"id": <appId>, "slug": "<slug>"}
  <name>.pem           # the App private key (exactly one .pem in the folder)
```

## 3. Register the credential in Atlas

Settings → **Credentials** (`/settings/credentials`) → **Add credential** → **GitHub App**:

- **Label** — e.g. `sspart-bot`
- **Bot-info folder** — the folder from step 2
- **Installation owner** — the GitHub user/org the App is installed on (e.g. `sspartorg`)
- *(optional)* your name / email / GitHub login for commit co-authoring

Atlas mints an installation token on save — a successful save means the whole auth chain works.

## 4. Add a project, then a repo

Since **ADR 0017 / 0018** a project is not a clone — it is a container that holds one or more repos, and
none of them is "primary".

1. **New Project** — name, description and an **issue-key prefix** of **exactly 3 uppercase letters**
   (e.g. `DMO`; `IssueKeyPrefixSchema`). This is a plain create; it clones nothing.
2. **Project → Repos → Add repo** — either **clone** (`repo_url` + credential → Atlas clones into
   `<workspace>/<project-slug>-<repo-name>`) or **connect** (point at a folder that is already a clone of
   that remote). The old project-level `POST /api/projects/clone` and `/connect` are **gone**.

A Task names one or more of the project's repos (`items.repo_ids`); a run works them side by side and
opens one PR per repo it changed.

## 5. Run an agent → PR

Trigger work. The quickest path to a real PR:

- **AI-Readiness scaffold** (Project → *generate AI scaffold*): a single agent reads the whole repo and
  commits an AI-ready scaffold (`AGENTS.md`, `CLAUDE.md`, `.agents/*`, `.github/copilot-instructions.md`,
  `.gitignore`); the orchestrator then pushes the branch and opens the PR.
- Or create a **Task**, assign it a **workflow**, and let the workflow run it. The starter `delivery`
  template is PO Writer → PO Reviewer → Architect → Architect Reviewer → Sub-tasks (build) → Sub-tasks
  (test) → End. Epics, stories and bugs no longer exist (**ADR 0015**): there are Tasks and their
  Sub-tasks, and one Task = one branch = one PR per repo it changed.

## What actually happens (verified)

- Clone/push authenticate with a short-lived **installation token** Atlas mints from the App key
  (JWT → installation access token, auto-refreshed before expiry).
- Commits are attributed to the bot: **`<slug>[bot]`**.
- The PR is opened by the orchestrator via **`gh pr create`** (the bot token is injected as `GH_TOKEN`),
  not by the AI's shell.
- Agents never route (**ADR 0014**). Each one ends with an `atlas-outcome` block and the workflow graph
  decides the next step; loops are bounded by the workflow's **Max loops**, not by anything on the agent.
  Anything ambiguous or over-budget **parks the run** and sets the item to `waiting_for_info` instead of
  looping. Replying to the parked item resumes it.

---

*Verified end-to-end: the AI-Readiness agent ran on live Claude and opened a real PR (10 files) authored
by `sspart-bot[bot]`, on a throwaway demo repo.*

*Runbook refreshed 2026-09-23 for ADR 0014 (workflows route, not agents), ADR 0015 (Tasks / Sub-tasks,
no epics) and ADR 0017 / 0018 (a project holds repos; no primary repo).*
