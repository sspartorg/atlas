# Atlas

> AI Agent Orchestration Platform

A single-owner workbench for running, reviewing, and steering AI coding agents
across software-development projects. Atlas is the UI + API + MCP server that
ties together the projects you're working on, the agents that act on them, and
the conversation history that keeps everyone aligned.

This README gets a teammate from a fresh clone to a running app in 10–15
minutes on Windows, macOS, or Linux.

---

## One-command install (Windows)

Skip the manual prerequisites section if you're on Windows 11 and want a
single command to set everything up — tools, env files, MCP token, database,
MCP client registration, and verification:

```powershell
# Open an ELEVATED PowerShell at the repo root, then:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
```

`scripts/bootstrap.ps1` installs (or upgrades) Git, Node.js LTS, pnpm, Docker
Desktop, GitHub CLI, GitHub Copilot CLI extension, and Claude Code CLI via
`winget`; enables WSL2 + Windows long paths; copies `.env` / `.env.prod` from
their examples; generates a random `ATLAS_MCP_TOKEN`; runs `pnpm install`;
brings Postgres up and applies migrations; registers `atlas` as an MCP server
with Claude Code CLI and GitHub Copilot CLI; and finishes by running
`pnpm doctor`. It is idempotent — re-running on a configured machine walks
every prompt with **Keep** as the default, so a single Enter trip-through is
safe.

Flags:

- `-SkipOptionalCLIs` — skip Claude / gh / Copilot installs (CI scenario).
- `-NonInteractive` — take the default for every prompt (CI / unattended).

Both `.env` and `.env.prod` are always created — the dev and prod local stacks
are designed to coexist, so leaving one out breaks the other.

After it finishes, run `pnpm dev` and open <http://localhost:4000>.

If the script just enabled WSL2 for you, reboot Windows once before `pnpm dev`
so Docker Desktop's engine can come up cleanly. For real AI agent runs, also
sign in to the CLIs the script can't drive interactively:

```powershell
claude login         # Anthropic sign-in
gh auth login        # GitHub sign-in (also unlocks `gh copilot`)
```

---

## Prerequisites

Install these once, then never again:

- **Node** 20 or newer
- **pnpm** 9 or newer (`npm i -g pnpm` if you don't have it)
- **Docker** — Docker Desktop on Windows/macOS, Docker Engine + Compose v2 on Linux
- **Postgres 16** — runs in Docker via `pnpm db:up`. SQLite is no longer supported.
- **Git** on your `PATH`

Optional (only matters once you start spawning real agent runs):

- **Claude Code CLI** (`claude`) — for live agent runs with `ATLAS_AI_ENABLED=true`
- **GitHub CLI** (`gh`) — only needed if you use GitHub PAT credentials and want the CLI's helpers

---

## Setup check (optional)

Once Node and pnpm are installed, run:

```bash
pnpm install
pnpm doctor
```

`pnpm doctor` verifies that node ≥ 20, pnpm ≥ 9, docker, and git are on
your `PATH`, and reports the versions it found. Optional checks for
`claude` and `gh` will show `[skip]` if they aren't installed. Use this if
you're not sure your machine has everything before running `pnpm dev`.

---

## Quickstart

```bash
git clone <your-fork-or-this-repo>
cd atlas
cp .env.example .env
pnpm install
pnpm doctor    # verifies Node, pnpm, Docker, and Postgres connectivity — run this first if anything later fails
pnpm dev
```

The web UI opens at `http://localhost:4000`. The API runs at `http://localhost:4001`.
On first run you'll see the onboarding wizard — enter a display name and pick a
local folder to use as your workspace (any path you want).

Atlas uses dedicated non-default ports across every tier so dev, prod, and E2E
can coexist with each other and with any other app on the machine:

| Tier | Web | API | MCP | Postgres (host) | Postgres DB |
|---|---|---|---|---|---|
| Dev  | 4000 | 4001 | 4500 | 5500 | `atlas` |
| Prod | 5000 | 5001 | 4500 | 5510 | `atlas_prod` |
| E2E  | 6000 | 6001 | —    | 5500 (dev container, separate DB) | `atlas_e2e` |

---

## Dev vs prod local stacks

Atlas ships two parallel local stacks so you can run a stable instance for
your day-to-day work AND hack on the code without one breaking the other.
They live in the same repo, share `node_modules`, and never collide:

| Surface | Dev (`pnpm dev`) | Prod (`pnpm prod`) |
|---|---|---|
| Web port | `4000` | `5000` |
| API port | `4001` | `5001` |
| Postgres host port | `5500` | `5510` |
| Postgres container | `atlas-postgres` | `atlas-postgres-prod` |
| Postgres data volume | `atlas-pg` | `atlas-pg-prod` |
| Postgres database | `atlas` | `atlas_prod` |
| Env file | `.env` | `.env.prod` |
| HMR / watch | ✅ vite HMR + tsx watch | ❌ vite preview + plain tsx |

`pnpm prod` runs `pnpm build` first, then serves the static build via `vite
preview` and starts the API in non-watch mode. Editing `.ts` / `.tsx` files
does NOT affect the running prod instance — to pick up new code, re-run
`pnpm prod`. Meanwhile `pnpm dev` in another terminal keeps its HMR /
auto-restart behaviour.

The two stacks are switched by a single env var, `ATLAS_ENV`. When unset
it defaults to dev. The root `pnpm prod` script wraps every step with
`cross-env ATLAS_ENV=prod`, so the API's `load-env.ts` and web's
`vite.config.ts` both read from `.env.prod`. To set up prod for the first
time:

```bash
cp .env.prod.example .env.prod   # then edit creds / tokens as needed
pnpm prod                        # first boot starts atlas-postgres-prod
                                 # and runs migrations against atlas_prod
```

Useful prod-side scripts (all driven by `cross-env ATLAS_ENV=prod`):

```
pnpm prod                  # full chain: build + db up + migrate + start
pnpm db:up:prod            # start the prod Postgres container only
pnpm db:down:prod          # stop the prod container (keep data)
pnpm db:down:prod:purge    # stop + WIPE the prod volume (rare, explicit)
pnpm db:migrate:prod       # apply pending migrations to prod
pnpm db:status:prod        # show prod migration state
```

By design there is no `pnpm db:reset:prod` — wiping the prod DB shouldn't
be a one-liner.

---

## What `pnpm dev` actually does

`pnpm dev` chains four steps in order:

1. **`pnpm db:up`** — brings up the `atlas-postgres` container via
   `docker compose up -d postgres`. The compose file at the repo root pins
   pgvector/pgvector:pg16, host port 5500 → container port 5432, with
   `atlas`/`atlas`/`atlas` defaults (matching `DATABASE_URL` in
   `.env.example`).
2. **`pnpm db:wait`** — polls until Postgres accepts a connection (≤60 s).
3. **`pnpm db:migrate`** — applies Knex migrations from
   `packages/api/src/db/migrations/`.
4. **`pnpm --parallel -r dev`** — starts the API (Fastify on `:4001`) and
   the web UI (Vite on `:4000`) in parallel.

All four steps are pure Node — no PowerShell, no shell-specific syntax. The
same `pnpm dev` works identically on Windows, macOS, and Linux.

---

## First-run onboarding

When `settings.onboarding_complete = 0` in the DB, the app redirects every
route to `/onboarding`. The wizard has two steps:

1. **Display name + accent color.** Used in the topbar and on your own avatar.
2. **Workspace folder.** A local directory the app will treat as the parent
   for every cloned project. Pick anything you have write access to —
   examples per OS:
   - Windows: `C:\Users\You\Projects`
   - macOS: `/Users/you/Projects`
   - Linux: `/home/you/projects`

After save, the dashboard becomes the home page. Subsequent boots skip the
wizard.

---

## Multi-device access (LAN)

By default, Atlas only trusts browser requests from `localhost:4000` and
`127.0.0.1:4000` (dev) — `localhost:5000` / `127.0.0.1:5000` on prod. Open the
UI from a second device on the same Wi-Fi and you can READ data (the page
renders, SSE arrives) but every WRITE silently fails — the API blocks the
cross-origin POST/PATCH.

To enable LAN access, set this in `.env`:

```bash
ATLAS_LAN_ACCESS=true
```

Then restart the API. On boot you'll see something like:

```
[security] ATLAS_LAN_ACCESS=true — trusting LAN origins for CORS + MCP-token gate: http://192.168.1.50:4000, http://10.0.0.5:4000
```

Both ends of the trust contract are updated: the CORS allowlist accepts the
LAN origin, and the MCP-token gate treats it as a trusted browser origin (so
the React app doesn't need to start sending tokens).

Leave `ATLAS_LAN_ACCESS` unset (or `false`) to keep Atlas locked to
localhost — the safer default if you don't want your dev API reachable from
any other device on the network.

---

## Connecting Atlas to your AI CLI (MCP)

The Atlas API hosts an MCP listener in-process at
`http://127.0.0.1:4500/mcp`. Your AI clients (Claude Code, Claude Desktop,
GitHub Copilot CLI) connect to that single URL. No repo paths, no tokens, no
copy-paste between dev and prod, no `<REPO>` placeholders to update when you
move the clone.

**One URL, two stacks.** Whichever local stack (`pnpm dev` or `pnpm prod`)
starts first owns port 4500 and serves MCP. The other instance catches
`EADDRINUSE`, logs `[mcp] port 4500 in use — running API-only`, and serves
its own `/api/*` traffic without MCP. To hand MCP over, stop the owning
instance and start the other — the client config never changes.

The listener binds loopback only. `ATLAS_LAN_ACCESS` does not expose MCP to
the LAN under any setting. The `ATLAS_MCP_TOKEN` from `.env` / `.env.prod`
is still required, but it's used internally by the MCP shim when it calls
back into the API — it's never something the client sends. Clients connect
anonymously to loopback.

**Prerequisite:** the API must be running (`pnpm dev` or `pnpm prod`). If you
hit `ATLAS_HOST_MCP=false` in your env, the listener is disabled on that
stack — useful for headless / CI runs, but then no client can connect.

### Claude Code CLI (`claude mcp`)

From any directory:

```powershell
claude mcp add-json atlas --scope user '{\"url\":\"http://127.0.0.1:4500/mcp\"}'
```

Verify with `claude mcp list` — you want `atlas ✓ Connected`. The `--scope
user` flag makes the registration follow you across projects.

To update or remove, `claude mcp remove atlas -s user` then re-run `add-json`.

### Claude Desktop

Edit your Claude Desktop config file:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Merge this entry into the top-level `mcpServers` object (create the object
if the file is empty), then fully restart the desktop app:

```json
{
  "mcpServers": {
    "atlas": {
      "url": "http://127.0.0.1:4500/mcp"
    }
  }
}
```

### GitHub Copilot CLI (`copilot mcp`)

Copilot CLI keeps its MCP registrations in `~/.copilot/mcp-config.json`
(override the parent directory by setting `$COPILOT_HOME`). Merge this entry
into the top-level `mcpServers` object, then restart any open `copilot`
sessions:

```json
{
  "mcpServers": {
    "atlas": {
      "type": "http",
      "url": "http://127.0.0.1:4500/mcp",
      "tools": ["*"]
    }
  }
}
```

`tools: ["*"]` exposes every tool the Atlas MCP server registers. Replace
the wildcard with an explicit list if you want to scope down (e.g. block
`createAgent` on a particular workstation).

Verify with `copilot mcp list` — you want `atlas ✓ Connected`.

If your Copilot CLI version doesn't recognise `"type": "http"`, drop in the
`mcp-remote` stdio shim that bridges to the HTTP endpoint — same single URL,
same zero-credential client config:

```json
{
  "mcpServers": {
    "atlas": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:4500/mcp"],
      "tools": ["*"]
    }
  }
}
```

### Legacy stdio transport

The MCP package still ships a stdio entry point at `packages/mcp/src/index.ts`
for CI and sandboxed environments where the API process can't host the
listener. See [`.agents/mcp.md`](.agents/mcp.md) for that path — it requires
a built `dist/`, a `ATLAS_API_BASE` env var, and manual reconfiguration when
you switch between dev (4001) and prod (5001). The HTTP host above is the
supported flow for every other case.

---

## Setting up external notifications

Atlas delivers outbound alerts (reminder fires, agent completions,
quiet-hours-respecting notifications) through a provider-agnostic transport.
It supports **Telegram** and **Microsoft Teams**. All setup happens under
**Settings → Notifications** in the UI — no file edits required.

### Telegram (fast, personal)

1. Chat with [@BotFather](https://t.me/BotFather) on Telegram and send
   `/newbot`. Follow the prompts to name your bot; save the returned **bot
   token**.
2. Message your new bot from the chat you want notifications to land in.
3. Open `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` in a
   browser and copy the `"chat":{"id":...}` value — that's your **chat ID**.
4. In Atlas: **Settings → Notifications → Provider: Telegram** → paste
   token + chat ID → **Send Test Message**.

### Microsoft Teams (via Power Automate)

Atlas's Teams transport posts a v1.4 Adaptive Card as the entire HTTP body
(`packages/api/src/services/transports/teams.ts#buildAdaptiveCard`). Your
Power Automate flow needs to deserialise that body and feed it to
`PostCardToConversation`. Minimal working recipe on
[make.powerautomate.com](https://make.powerautomate.com) → **Create →
Instant cloud flow**:

1. **Trigger:** *When an HTTP request is received* — leave the request body
   schema blank (Power Automate accepts any JSON).
2. **Action 1:** *Initialize variable* — Name `Body`, Type `String`, Value
   `@{string(triggerBody())}`.
   > ⚠ **Critical:** stringify the WHOLE incoming object, NOT a sub-field.
   > Older guides mapping `triggerBody()?['text']` break under Atlas's
   > Adaptive Card payload.
3. **Action 2:** *Post card in a chat or channel* (`PostCardToConversation`)
   — Post as `Flow bot`, Post in `Group chat` or `Channel`, Recipient = the
   chat/channel ID, Adaptive Card = `@{variables('Body')}`.
4. Save the flow. Copy the HTTP POST URL Power Automate generates.
5. In Atlas: **Settings → Notifications → Provider: Microsoft Teams** →
   paste the webhook URL → **Send Test Message**.

The card Atlas sends is:

```json
{
  "type": "AdaptiveCard",
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "version": "1.4",
  "body": [
    { "type": "TextBlock", "text": "Your notification text here", "wrap": true }
  ]
}
```

`wrap: true` is required so multi-line messages render with line breaks
preserved. Paste into [adaptivecards.io/designer](https://adaptivecards.io/designer/)
to preview / tweak.

### Fine-tuning

- **Per-event opt-ins** — same Notifications tab. Toggle each event class
  (agent completion, reminder fire, run error, item transition) independently.
- **Quiet hours** — deliveries queue during the configured window and
  release at the next allowed slot. Applies to both external transport and
  in-app.
- **Tokens encrypted at rest** — bot token and webhook URL are encrypted via
  `settingsService.updateExternalNotificationToken` before storage.

### Troubleshooting

- **Flow run fails with `AdaptiveSerializationException: Property 'type'
  must be 'AdaptiveCard'`** — the `Body` variable is mapped to a sub-field
  instead of `string(triggerBody())`. Fix step 2 of the recipe.
- **Test message reports delivered but nothing arrives in Telegram** — chat
  ID is wrong. Re-send a message from the target chat, re-hit `/getUpdates`,
  and confirm the ID.
- **Test message returns 4xx / connection pill is red** — reveal the token
  / webhook URL and confirm no whitespace was pasted (leading space is the
  most common cause).

The Confluence page [Setting up the external notification
workflow](https://github.com/sspartorg/atlas/tree/main/docs)
carries the same content with screenshots.

---

## Repo layout

```
packages/shared/   — types, status machine, Zod schemas (zero runtime deps)
packages/api/      — Fastify API + Kysely + Postgres
packages/web/      — React UI + MUI + TanStack Query
packages/mcp/      — Model Context Protocol server
.agents/           — terse functional docs read by AI coding agents
```

Contribution conventions for this repo (hard rules, package patterns, the
`.agents/` self-update protocol): see [`AGENTS.md`](./AGENTS.md).

Per-package patterns: `packages/shared/AGENTS.md`, `packages/api/AGENTS.md`,
`packages/web/AGENTS.md`, `packages/mcp/AGENTS.md`.

---

## Updating to a new version

When new commits land on `main`:

1. `git pull`
2. `pnpm install` — in case dependencies changed.
3. `pnpm db:migrate` — in case the schema changed. **Required if you use `pnpm start`**; auto-runs at boot if you only use `pnpm dev`.
4. Restart the API (`pnpm dev` or `pnpm start`).

If the migration step fails, the API now refuses to start — it prints `[boot] migration failed, refusing to start:` with the underlying error and exits with code 1. Read the error and either fix your `.env` / Postgres state, or use the in-app **Report a bug** link (sidenav footer + `Settings → Help & About`). New installs ship with `ATLAS_FEEDBACK_URL` pointing at the upstream issue tracker (`https://github.com/sspartorg/atlas/issues`); override to a `mailto:` URL or leave blank to hide the link.

---

## Troubleshooting

**`docker compose up failed`** — confirm Docker is running. On Windows/macOS
that's Docker Desktop in the system tray. On Linux it's `systemctl status
docker`.

**`postgres did not become ready within 60s`** — usually means the container
crashed mid-boot. `docker logs atlas-postgres` shows the cause; the most
common is host port 5500 already in use. Stop whatever else is bound there
(`netstat -ano | findstr :5500` on Windows, `lsof -iTCP:5500 -sTCP:LISTEN` on
Mac/Linux) or change the host port in `docker-compose.yml`.

**Can't write from a second device on the LAN** — set
`ATLAS_LAN_ACCESS=true` in `.env` and restart the API. See "Multi-device
access" above.

**`PowerShell` no longer used.** Every API script (db, clone, auto-fetch)
runs in Node and spawns `git` / `docker` directly. Atlas's runtime has no
PowerShell dependency on any OS.

**Credentials decrypt to garbage after deleting `workspace.key` on macOS.**
macOS doesn't expose a stable machine ID Atlas can re-derive
`workspace.key` from, so the file is generated with random bytes on first
boot. If you delete `~/.config/Atlas/workspace.key` (or move to a new
mac), the new key won't decrypt your old stored credentials — re-enter
Credentials in the UI. On Windows and Linux the key is re-derived from
`MachineGuid` / `/etc/machine-id`, so it survives file deletion on the
same machine.

---

## License

Atlas is open source under the [Apache License 2.0](LICENSE).

Copyright © 2026 Sspart Enterprise Private Limited.

You are free to use, modify, and distribute Atlas — including in commercial and
closed-source products — as long as you retain the copyright and attribution
notices from the [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE) files. The `NOTICE`
file contains the attribution that must accompany any redistribution.
