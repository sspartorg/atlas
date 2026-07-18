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

Settings → **Shared Secrets → Add → GitHub App**:

- **Label** — e.g. `sspart-bot`
- **Bot-info folder** — the folder from step 2
- **Installation owner** — the GitHub user/org the App is installed on (e.g. `sspartorg`)
- *(optional)* your name / email / GitHub login for commit co-authoring

Atlas mints an installation token on save — a successful save means the whole auth chain works.

## 4. Add a project

**New Project** → paste the repo URL (`https://github.com/<owner>/<repo>`) → pick the credential → Atlas
clones it into your workspace folder.

- The **issue-key prefix** must be **exactly 3 uppercase letters** (e.g. `DMO`).

## 5. Run an agent → PR

Trigger work. The quickest path to a real PR:

- **AI-Readiness scaffold** (Project → *generate AI scaffold*): a single agent reads the whole repo and
  commits an AI-ready scaffold (`AGENTS.md`, `CLAUDE.md`, `.agents/*`, `.github/copilot-instructions.md`,
  `.gitignore`); the orchestrator then pushes the branch and opens the PR.
- Or create an **Epic** and run the **PO Writer → Architect → Coder → Reviewer** chain for actual feature
  code.

## What actually happens (verified)

- Clone/push authenticate with a short-lived **installation token** Atlas mints from the App key
  (JWT → installation access token, auto-refreshed before expiry).
- Commits are attributed to the bot: **`<slug>[bot]`**.
- The PR is opened by the orchestrator via **`gh pr create`** (the bot token is injected as `GH_TOKEN`),
  not by the AI's shell.
- Every run is bounded by each agent's **Max rounds**; anything ambiguous or over-budget **escalates to
  the Owner** with status `waiting_for_info` instead of looping.

---

*Verified end-to-end: the AI-Readiness agent ran on live Claude and opened a real PR (10 files) authored
by `sspart-bot[bot]`, on a throwaway demo repo.*
