# Routes Map

One row per web route. Cross-link to `pages/*.md` for detail. Sources: `packages/web/src/App.tsx:98-272`, `packages/web/src/components/Sidenav.tsx:24-69`.

---

## Top-level routes

| Route | Page component | Key hooks | Main API endpoints | Modals / drawers | Coming-soon items |
|---|---|---|---|---|---|
| `/onboarding` | `Onboarding` | `useSettings`, `useNavigate` | `POST /settings/onboard` | FolderPicker (native dialog) | â€” |
| `/` | `Dashboard` | `useSettings`, `useProjects`, `useDashboard` | `GET /projects`, `GET /counts/dashboard`, `GET /agents` | `NewProjectModal` (from empty state) | â€” |
| `/projects` | `Projects` | `useProjects`, `useProjectsPaged`, `useEpics`, `useStories`, `useAgents`, `useSettings`, `useEnabledSchedules` | `GET /projects`, `GET /projects/paged`, `GET /epics`, `GET /stories`, `GET /agents`, `POST /projects/:id/reveal` | `NewProjectModal`, `DeleteProjectModal`, `RecloneProjectModal`, `AutoFetchScheduleModal` | â€” |
| `/projects/:id` | `ProjectDetail` (5 tabs) | `useProjects`, `useEpics(id)`, `useStories({projectId})`, `useBugs({projectId})`, `useAgents`, `useSettings`, `useSearchParams`, `useProjectEnv`, `useSaveProjectEnv` | `GET /projects`, `GET /epics?project_id=â€¦`, `GET /stories?project_id=â€¦`, `GET /bugs?project_id=â€¦`, `GET /projects/:id/env`, `PUT /projects/:id/env` | `DeleteProjectModal`, `ProjectEnvSecretsModal` | Rename, Edit repo URL, Change default branch, Notification routing, Archive â€” `stubMessage` toasts in `ProjectActionsMenu.tsx` |
| `/projects/:id/guard-rails` (alias: `/projects/:id/guardrails`) | `ProjectGuardrails` (redirects to `/projects/:id?tab=guardrails`) | `useProjectGuardrails`, `useCreateProjectGuardrail`, `useToggleProjectGuardrail` | `GET/POST/PATCH /projects/:projectId/guardrails`, `PATCH â€¦/toggle` | `AddRuleDialog` | â€” |
| `/epics` | `Epics` | `useEpics`, `useEpicStats`, `useProjects`, `useAgents`, `useSettings` | `GET /epics`, `GET /epics/stats`, `GET /projects`, `GET /agents` | â€” | â€” |
| `/epics/new` | `EpicNew` | `useCreateEpic`, `useTransitionEpic`, `useProjects`, `useAgents`, `useSettings` | `POST /epics`, `PATCH /epics/:id/status` | â€” | â€” |
| `/epics/:id` | `EpicDetail` | `useEpic`, `useEpics`, `useStories({epicId})`, `useBugs({epicId})`, `useProjects`, `useAgents`, `useSettings`, `useTransitionEpic`, `useAssignEpic`, `useUpdateEpic` | `GET /epics/:id`, `GET /stories?epic_id=â€¦`, `GET /bugs?epic_id=â€¦`, `PATCH /epics/:id` (title, description), `PATCH /epics/:id/{status,assign}` | â€” | â€” |
| `/issues` | `Issues` | `useIssues({projectId})`, `useProjects`, `useAgents` | (merges stories+bugs+sub-tasks+sub-bugs across calls) | `NewIssueModal` | Show-archived toggle (`Issues.tsx:92, 99-102`) â€” archived rows hidden by default |
| `/issues/stories/:id` | `StoryDetail` | `useStory`, `useSubTasks(id)`, `useSubBugs(id)`, `useEpics`, `useProjects`, `useAgents`, `useSettings`, `useTransitionStory`, `useUpdateStory`, `useAssignStory` | `GET /stories/:id`, `GET /stories/:id/sub-tasks`, `GET /stories/:id/sub-bugs`, `PATCH /stories/:id` (title/description/AC), `PATCH /stories/:id/{status,assign}` | `NewIssueModal` (Add sub-task or sub-bug) | â€” |
| `/issues/sub-tasks/:id` | `SubTaskDetail` | `useStories`, `useAgents`, `useEpics`, `useProjects`, `useSettings`; resolves task by scanning stories | `GET /stories/:id/sub-tasks` (scan), `PATCH /sub-tasks/:id` (title/description/AC), `PATCH /sub-tasks/:id/{status,assign}` | â€” | No direct GET /sub-tasks/:id endpoint â€” page scans story sub-task lists |
| `/issues/bugs/:id` | `BugDetail` | `useBug(id)`, `useEpics`, `useProjects`, `useAgents`, `useSettings`, `useUpdateBug`, `useTransitionBug`, `useAssignBug` | `GET /bugs/:id`, `PATCH /bugs/:id` (title/description/all bug fields), `PATCH /bugs/:id/{status,assign}` | â€” | â€” |
| `/issues/sub-bugs/:id` | `SubBugDetail` | `useStories`, `useAgents`, `useEpics`, `useProjects`, `useSettings`; resolves bug by scanning stories | `GET /stories/:id/sub-bugs` (scan), `PATCH /sub-bugs/:id` (title/description/all bug fields), `PATCH /sub-bugs/:id/{status,assign}` | â€” | No direct GET /sub-bugs/:id endpoint |
| `/queue` | `Queue` | `useStories`, `useBugs`, `useAgents`, `useEpics`, `useProjects`, `useQuery(['runs','queue-page'])`, `useUpdateAgent` | `GET /run?limit=500`, `PATCH /agents/:id` | `QueueAgentDrawer` | Mock log entries; expected-output strings hardcoded by agent id (`QueueAgentDrawer.tsx:41-52`) |
| `/search` | `Search` | `useEpics`, `useStories`, `useBugs`, `useAllSubTasks`, `useAllSubBugs`, `useAgents`, `useProjects`, `useSettings` | (built from already-loaded data; FTS path `GET /search?q=` available but unused by default) | â€” | "Create from search" toast (`SearchEmptyState.tsx:131`); bug/sub-task results fall back to `/issues` instead of detail page |
| `/agents` | `Agents` | `useAgents`, `useUpdateAgent`, `useAgentFavorites`, `useQuery(['runs','agents-page'])` | `GET /agents`, `GET /run?limit=500`, `POST /agents`, `PATCH /agents/:id`, `DELETE /agents/:id`, `POST /agents/:id/duplicate` | `DuplicateAgentModal`, Add-Agent dialog | â€” |
| `/agents/:id` | `AgentDetail` (6 tabs: Overview, Prompt, Handoffs, TestRun, Runs, Memory) | `useAgent`, `useUpdateAgent`, `useAgentMemory`, `useSetAgentMemory`, `useRegenerateAgentMemory`, `useQuery(['runs', agentId])`, plus per-tab hooks | `GET /agents/:id`, `PATCH /agents/:id`, `GET/POST /agents/:id/handoff-rules`, `GET/PUT /agents/:id/memory`, `POST /agents/:id/memory/regenerate`, `GET /run?agent_id=â€¦`, `POST /run` (Run now dialog) | `DuplicateAgentModal`, `RunNowDialog`, `GlyphPickerModal` | "Reassign queue", "Save as run" (TestRun tab), "Diff view for v{n}" (Prompt tab), formatting toolbar in Prompt tab |
| `/agents/:id/runs/:runId` | `AgentRunDetail` | `useAgent`, `useAgentRun`, `useMutation(api.run.trigger)` | `GET /agents/:id`, `GET /run/:runId`, `POST /run` (Re-run with same inputs) | â€” | â€” |
| `/agents/marketplace` | `Marketplace` | `useQuery(['marketplace','list',q,category])`, `useNavigate`, `useToast` | `GET /marketplace?q&category&limit` (via `api.marketplace.list`) | â€” | No page doc yet (`.agents/pages/*.md`) |
| `/agents/marketplace/:id` | `MarketplaceAgentDetail` | `useQuery(['marketplace','agent',id])`, `useQuery(['marketplace','list'])`, `useQueryClient`, `useToast`, `useNavigate` | `GET /marketplace/:id` (via `api.marketplace.get`), `GET /marketplace?limit=100`, `POST /marketplace/:id/install`, `GET /marketplace/:id/export.zip` | `AddFromMarketplaceModal` | No page doc yet (`.agents/pages/*.md`) |
| `/agents/mcp-tools` | `McpTools` | `useQuery(['tool-catalog'])` | `GET /tool-catalog` (via `api.toolCatalog.get`) | â€” | No page doc yet (`.agents/pages/*.md`) |
| `/analytics` | `Analytics` | `useQuery(['analytics'])` | `GET /analytics` (via `api.analytics.get`) | â€” | No page doc yet (`.agents/pages/*.md`) |
| `/analytics/project/:projectId` | `AnalyticsProject` | `useQuery(['analytics-project', projectId])`, `useQuery(['analytics-project-epics', â€¦])` | `GET /analytics/project/:projectId`, `GET /analytics/project/:projectId/epics?page&limit` (via `api.analytics.project` / `api.analytics.projectEpics`) | â€” | No page doc yet (`.agents/pages/*.md`) |
| `/analytics/epic/:epicId` | `AnalyticsEpic` | `useQuery(['analytics-epic', epicId])`, `useQuery(['analytics-epic-children', â€¦])` | `GET /analytics/epic/:epicId`, `GET /analytics/epic/:epicId/children?page&limit&type` (via `api.analytics.epic` / `api.analytics.epicChildren`) | â€” | No page doc yet (`.agents/pages/*.md`) |
| `/notifications` | `Notifications` (2 tabs: external notification, InApp) | `useNotifications`, `useMarkAllRead`, `useResendNotification`, `useCancelNotification`, `useAgents`, `useNow` | `GET /notifications`, `POST /notifications/:id/{resend,cancel}`, `POST /notifications/mark-all-read`, `POST /settings/external-notification/test` | â€” | â€” |
| `/guardrails` | `Guardrails` | `useGuardrails`, `useCreateGuardrail`, `useUpdateGuardrail`, `useDeleteGuardrail`, `useSaveGuardrails`, `useNow` | `GET/POST/PATCH/DELETE /guardrails`, `POST /guardrails/save` | `GuardrailModal` | Discard button only clears session dirty counter, doesn't roll back edits |
| `/settings` | `Settings` (5 tabs: Profile, Environment, **Shared Secrets**, Models, external notification) | `useSettings`, `useUpdateProfile`, `useEnv`, `useUpdateEnv`, `useEnvironmentSecrets`, `useSaveEnvironmentSecrets`, `useRestartServer`, `useCliModels`, `useCreateCliModel`, `useRemoveCliModel`, `useUpdateExternalNotification`, `useUpdateNotifications`, `useCredentials`, `useProjects` | `GET/PATCH /settings`, `GET/PATCH /settings/env`, `GET/PUT /environment-secrets`, `POST /server/restart`, `GET/POST/DELETE /cli-models`, `PATCH /settings/external-notification`, `POST /settings/external-notification/test`, `PATCH /settings/notifications`, `POST /settings/reset` | `ResetWorkspaceModal`, Restart Server confirm dialog | Chat-ID Detect button (`NotificationsTab.tsx:209-214`) shows "Detection not yet wired" toast |
| `/settings/credentials` | `Credentials` | `useCredentials`, `useMutation(deleteCredential)` | `GET/POST/PATCH/DELETE /credentials` | `CredentialModal` (3-view: kind picker â†’ form â†’ saved), Delete confirm dialog, `CredentialRowMenu` | "Check expiries" button disabled with tooltip "Coming soon" (`Credentials.tsx:203`); Verify-now menu item toasts "coming soon" (`Credentials.tsx:96-100`); SSH + App password radio options disabled in kind picker (`CredentialModal.tsx:280, 309`) |
| `/reminders` | `Reminders` | `useReminders`, `useCreateReminder`, `useCancelReminder`, `useToast` | `GET /reminders`, `POST /reminders`, `DELETE /reminders/:id` | `NewReminderModal`, cancel-confirm `Dialog` | â€” |
| `/scratch-pad` | `ScratchPad` | `useScratchPadList`, `useCreateScratchPad`, `useUpdateScratchPad`, `useDeleteScratchPad`, `useToast` | `GET /scratch-pad`, `POST /scratch-pad`, `PATCH /scratch-pad/:id`, `DELETE /scratch-pad/:id` | `ScratchPadEditor` (markdown editor modal) | â€” |
| `/terminal` | `Terminal` | `useCliSessions`, `useProjects`, `useCreateCliSession` (via dialog), `useToast` | `GET /cli/sessions`, `POST /cli/sessions` | `StartSessionDialog` | Multi-pane workspace entry (`/terminal/layout`); transcript history link on closed/errored cards (`/terminal/:id/history`) |
| `/terminal/standalone` | `TerminalStandalone` | `useCliSessions({standalone:true})`, `useCredentials`, `useCreateStandaloneCliSession` (via dialog), `useToast` | `GET /cli/sessions?standalone=true`, `POST /cli/sessions/standalone`, `GET /fs/{list,stat,join,home}` (via `FolderPicker`) | `StartStandaloneSessionDialog`, `ConfirmActionModal` (Stop, via `TerminalSessionControls`) | Declared BEFORE `/terminal/:id` in `App.tsx` or the param route swallows "standalone" as an id |
| `/terminal/layout` | `TerminalLayout` | `useCliSessions`, `useSearchParams`, `useToast`, `useNavigate` | `GET /cli/sessions`, `POST /cli/sessions` (via dialog), WS `/api/cli/sessions/:id/stream` (per pane) | `StartSessionDialog`, `StopSessionModal` (via `TerminalSessionControls`) | â€” |
| `/terminal/:id` | `TerminalSession` | `useCliSession(id)`, `usePauseCliSession`, `useResumeCliSession`, `useCliSessionDiff`, `useCliSessionFilePatch`, `useNavigate` (Pause/Resume/Stop now via `TerminalSessionControls`) | `GET /cli/sessions/:id`, `POST /cli/sessions/:id/{pause,resume,preflight-stop,stop}`, `GET /cli/sessions/:id/diff`, `GET /cli/sessions/:id/diff/file`, WS `/api/cli/sessions/:id/stream` | `StopSessionModal` (via `TerminalSessionControls`; diff panel lazy-loaded) | â€” |
| `/terminal/:id/history` | `TerminalHistory` | `useCliSession(id)`, `useCliSessionTranscript(id, status)` | `GET /cli/sessions/:id`, `GET /cli/sessions/:id/transcript` | â€” | â€” |

---

## Global app-shell GETs (every page)

These fire from `AppShell` / `Sidenav` / `Topbar` / `ReportBugLink` regardless of which page is mounted. They are intentionally NOT listed in the per-page "Main API endpoints" column because they're not page-specific. Captured here so the routes-map can be diffed against actual network captures without flagging them as drift.

| Endpoint | Origin | Caching |
|---|---|---|
| `GET /api/settings` | `useSettings()` â€” Topbar / Sidenav / RouteGuard / every page | `staleTime: Infinity`, `refetchOnMount: false`, `refetchOnWindowFocus: true` |
| `GET /api/settings/env` | `useEnv()` via `ReportBugLink` (sidenav footer) | `staleTime: Infinity`, `refetchOnMount: false` (post-2026-06-09 B2 fix) |
| `GET /api/counts` | `useSidenavCounts()` â€” Sidenav badges | `staleTime: Infinity`, `refetchOnMount: false`, SSE-invalidated |
| `GET /api/run?limit=500` | `useActiveRuns()` via `HeaderMascot` (Topbar) | `staleTime: 30_000`, `refetchOnMount: false` (post-2026-06-09 B2 fix), SSE-invalidated |

---

## Sidenav structure

Source: `packages/web/src/components/Sidenav.tsx:24-69`. Counts via `useSidenavCounts()` â†’ `GET /counts`.

```
WORKSPACE
  Dashboard           /              (no count)
  Scratch Pad         /scratch-pad
  Projects (N)        /projects
  Epics (N)           /epics
  Issues (N)          /issues
  Queue (N)           /queue
  Terminal            /terminal
  Standalone          /terminal/standalone
  Search              /search
  Analytics           /analytics

AGENTS
  Agents (N)         /agents
  Marketplace        /agents/marketplace
  MCP Tools          /agents/mcp-tools

ALERTS & ADMIN
  Notifications (N Â· unread dot)   /notifications
  Reminders           /reminders
  Guard-rails         /guardrails
  Settings            /settings
```

The Topbar (`packages/web/src/components/Topbar.tsx`) holds the Notifications status indicator and the shortcuts (`?`) icon that opens `ShortcutsDialog` (Cmd/Ctrl+?).

### Mobile behavior

Below the MUI `md` breakpoint (`<900px`, via `useIsMobile()` in `packages/web/src/hooks/useIsMobile.ts`):

- The inline Sidenav is replaced with a temporary `Drawer` (left-anchored, 240px wide). The drawer opens via a hamburger `IconButton` in the mobile `AppBar` and closes on backdrop tap or when a nav link is clicked (via `onNavigate` prop on `Sidenav`).
- The desktop `Topbar` is replaced by `MobileAppBar` (`packages/web/src/components/shell/MobileAppBar.tsx`), which renders: `â‰¡` hamburger Â· page title (set per-page via `useSetPageTitle()` from `PageTitleContext`) Â· optional trailing icon slot. 56pt tall, respects `env(safe-area-inset-top)`.
- A persistent `BottomNav` (`packages/web/src/components/shell/BottomNav.tsx`) renders 5 destinations: **Home** (`/`), **Epics** (`/epics`), **Issues** (`/issues`), **Queue** (`/queue`), **More**. The More tab opens a bottom `Drawer` (`MoreSheet`) listing every secondary sidenav destination so phone users can reach the same routes the desktop sidenav offers: Scratch Pad, Projects, Search, Analytics, Terminal, Standalone, Agents, Marketplace, MCP Tools, Notifications, Reminders, Guard-rails, Settings.
- The Shortcuts pill hides below `md` (no keyboard on touch devices).
- List pages (Projects, Epics, Issues, Agents, Credentials) hide their top-right "+ New X" button on mobile and mount a `PageFab` instead, positioned above the bottom nav (`bottom: calc(80px + env(safe-area-inset-bottom))`).
- Tables (`WorkItemTable`, `EpicTable`) and the inline Issues table render as 2-line MUI list rows (`MobileWorkItemList` / `MobileEpicList`) below `md`.
- Filter-chip rows on Projects, Epics, Issues, Agents scroll horizontally with no wrap on mobile.
- Dialog-based modals stay centered on every breakpoint and self-constrain via `PaperProps.sx` (`m: { xs: 2, sm: 4 }` + `maxHeight: 'calc(100% - 32px/64px)'`). `fullScreen={isMobile}` was removed across the modal surface (`ConfirmDeleteModal`, `Confirm*`, `RenameProjectModal`, `NewProjectModal`, `DeleteProjectModal`, `RecloneProjectModal`, `DuplicateAgentModal`, `AutoFetchScheduleModal`, `ProjectEnvSecretsModal`, `ResetWorkspaceModal`, `ShortcutsDialog`, the Handoffs inline delete confirm) because the edge-to-edge mobile sheet broke visual continuity with the parent UI and made small confirms look like separate pages.
- Sticky bottom action bars (Guardrails Save bar, EpicNew Draft/Submit footer) sit above the bottom nav via `bottom: calc(56px + env(safe-area-inset-bottom))`.
- Tabs on detail pages (Project / Agent / Settings / Notifications) use `variant="scrollable"` so they scroll horizontally on narrow viewports.

---

## Route guard

`packages/web/src/App.tsx:61-88`:

- If `!settings.onboarding_complete` AND `pathname !== '/onboarding'` â†’ redirect to `/onboarding`.
- If `settings.onboarding_complete` AND `pathname === '/onboarding'` â†’ redirect to `/`.

All other authenticated routes always render once onboarding is complete. There are no env-var feature flags hiding routes.
