# Routes Map

One row per web route. Cross-link to `pages/*.md` for detail. Sources: `packages/web/src/App.tsx:98-272`, `packages/web/src/components/Sidenav.tsx:24-69`.

---

## Top-level routes

| Route | Page component | Key hooks | Main API endpoints | Modals / drawers | Coming-soon items |
|---|---|---|---|---|---|
| `/onboarding` | `Onboarding` | `useSettings`, `useNavigate` | `POST /settings/onboard` | FolderPicker (native dialog) | â€” |
| `/` | `Dashboard` | `useSettings`, `useProjects`, `useDashboard` | `GET /projects`, `GET /counts/dashboard`, `GET /agents` | `NewProjectModal` (from empty state) | â€” |
| `/projects` | `Projects` | `useProjects`, `useProjectsPaged`, `useAllRepos`, `useTasks`, `useAgents`, `useSettings`, `useEnabledSchedules` | `GET /projects`, `GET /projects/paged`, `GET /repos`, `GET /tasks`, `GET /agents` | `NewProjectModal`, `DeleteProjectModal` | Reclone / auto-fetch / reveal moved to Project Detail's Repos tab (ADR 0018) |
| `/projects/:id` | `ProjectDetail` (6 tabs: Overview, Tasks, Guard-rails, Repos, Setup, History) | `useProject`, `useIssues({projectId})`, `useProjectCounts`, `useAgents`, `useSettings`, `useProjectEnv`, `useSaveProjectEnv`, `useProjectRepos`, `useCloneProjectRepo`, `useConnectProjectRepo`, `useUpdateProjectRepo`, `useRemoveProjectRepo`, `useCloneJob`, `useCredentials` | `GET /projects/:id`, `GET /issues/tree?project_id=…`, `GET /counts/project/:id`, `GET /run?project_id=…`, `GET/PUT /projects/:id/env`, `GET/POST /projects/:id/repos`, `PATCH/DELETE /projects/:id/repos/:repoId` | `DeleteProjectModal`, `ProjectEnvSecretsModal`, `AddRepoDialog`, `EditRepoDialog`, remove-repo `ConfirmActionModal` | Rename, Edit repo URL, Change default branch, Notification routing, Archive — `stubMessage` toasts in `ProjectActionsMenu.tsx` |
| `/projects/:id/guard-rails` (alias: `/projects/:id/guardrails`) | `ProjectGuardrails` (redirects to `/projects/:id?tab=guardrails`) | `useProjectGuardrails`, `useCreateProjectGuardrail`, `useToggleProjectGuardrail` | `GET/POST/PATCH /projects/:projectId/guardrails`, `PATCH â€¦/toggle` | `AddRuleDialog` | â€” |
| `/tasks` | `Tasks` | `useTasks`, `useTaskStats`, `useTransitionTask`, `useProjects`, `useAgents`, `useSettings` | `GET /tasks`, `GET /tasks/stats`, `PATCH /tasks/:id/status` (Kanban) | — | — |
| `/tasks/new` | `TaskNew` | `useCreateTask`, `useTransitionTask`, `useProjects`, `useProjectRepos`, `useAgents`, `useSettings`, `useDraftGuard` | `GET /projects/:id/repos`, `POST /tasks`, `PATCH /tasks/:id/status` | — | — |
| `/tasks/:id` | `TaskDetail` | `useTaskFull`, `useTransitionTask`, `useAssignTask`, `useUpdateTask`, `useDeleteTask`, `useCreateSubTask`, `useItemAgentRuns`, `useProjectLabels`, `useProjectRepos` (rail Repos row); rail `ItemWorkflowPanel` (`useWorkflows`, `useItemWorkflowRuns`, `useSetItemWorkflow`, `useStartWorkflowRun`) | `GET /tasks/:id/full`, `PATCH /tasks/:id` (incl. `repo_ids`) + `/{status,assign}`, `DELETE /tasks/:id`, `POST /tasks/:id/sub-tasks`, `GET /projects/:id/repos`, `PUT /items/:id/workflow`, `GET /items/:id/workflow-runs`, `POST /workflows/:id/runs` | `LinkPickerDialog`, `ConfirmDeleteModal`, inline Add sub-task form | — |
| `/sub-tasks/:id` | `SubTaskDetail` | `useSubTaskFull`, `useDeleteSubTask`, `useItemAgentRuns`, `useProjectLabels` | `GET /sub-tasks/:id/full`, `PATCH /sub-tasks/:id` + `/{status,assign}`, `DELETE /sub-tasks/:id`, `POST /tasks/:taskId/sub-tasks` (Clone) | `LinkPickerDialog` (tested_by picker restricted to the same Task), `ConfirmDeleteModal` | — |
| `/queue` | `Queue` | `useWorkflowQueue`, `useProjects`, `useAgents`, `useUpdateWorkflow`, `useStartWorkflowRun`, `useSetItemWorkflow` | `GET /workflow-queue?project_id=`, `PATCH /workflows/:id`, `POST /workflows/:id/runs`, `PUT /items/:id/workflow` | — | — |
| `/search` | `Search` | `useSearch`, `useAgents`, `useProjects`, `useSettings`, `useProjectLabels` | `GET /search?q=&type=&project_id=&status=&updated=&labels=` (server-side Postgres FTS; `type` is `task` / `sub_task`) | — | "Create a Task / Sub-task" button only toasts (`Search.tsx:138`) |
| `/workflows` | `Workflows` | `useWorkflows`, `useProjects`, `useWorkflowTemplates`, `useCreateWorkflow`, `useCreateWorkflowFromTemplate`, `useImportWorkflow`, `useAgents` | `GET /workflows`, `GET /workflows/templates`, `POST /workflows`, `POST /workflows/from-template`, `POST /workflows/import` | `NewWorkflowDialog`, `ImportWorkflowDialog` | Doc: [`pages/33-workflows.md`](pages/33-workflows.md) |
| `/workflows/:id` | `WorkflowBuilder` (2 tabs: Builder, Runs) | `useWorkflow`, `useWorkflows`, `useUpdateWorkflow`, `useDeleteWorkflow`, `useStartWorkflowRun`, `useWorkflowRuns`, `useAgents`, `useProjects`, `useIssues`, `useDraftGuard` | `GET/PATCH/DELETE /workflows/:id`, `GET /workflows`, `GET/POST /workflows/:id/runs`, `GET /workflows/:id/export` (Export link), `POST /workflows/:id/publish` (Publish), `GET /issues/tree?project_id=` | `RunWorkflowDialog` (ready Tasks), delete `ConfirmActionModal` | Lazy `@xyflow/react` canvas. Doc: [`pages/34-workflow-detail.md`](pages/34-workflow-detail.md) |
| `/workflows/:id/runs/:runId` | `WorkflowRunDetail` | `useWorkflowRun`, `useStopWorkflowRun`, `useResumeWorkflowRun`, `useWorkflows`, `useAgents`, `useIssues` | `GET /workflow-runs/:id`, `POST /workflow-runs/:id/{stop,resume}` | — | Lists a Task run's sub-task runs; a sub-task run links back to its Task run. Doc: [`pages/35-workflow-run.md`](pages/35-workflow-run.md) |
| `/agents` | `Agents` | `useAgents`, `useUpdateAgent`, `useAgentFavorites`, `useQuery(['runs','agents-page'])` | `GET /agents`, `GET /run?limit=500`, `GET /cli/availability`, `POST /agents`, `PATCH /agents/:id`, `DELETE /agents/:id`, `POST /agents/:id/duplicate` | `DuplicateAgentModal`, Add-Agent dialog | â€” |
| `/agents/:id` | `AgentDetail` (6 tabs: Overview, Prompt, **Tests**, **Performance**, Runs, Memory — Handoffs was removed by ADR 0014, Test Run by the agent-qualification work) | `useAgent`, `useUpdateAgent`, `useAgentMemory`, `useSetAgentMemory`, `useRegenerateAgentMemory`, `useAgentTests`, `useAgentTestRuns`, `useAgentCostEstimate`, `useQuery(['runs', agentId])`, plus per-tab hooks | `GET /agents/:id`, `PATCH /agents/:id`, `GET/PUT /agents/:id/memory`, `POST /agents/:id/memory/regenerate`, `GET/POST /agents/:id/tests`, `GET /agents/:id/cost-estimate`, `GET /agents/:id/performance`, `GET /agent-tests/:testId/batches`, `POST /agent-tests/:testId/run`, `DELETE /agent-tests/:testId`, `GET /agents/:id/runs`, `GET /cli/availability`, `POST /run` (Run now dialog) | `DuplicateAgentModal`, `RunNowDialog`, `GlyphPickerModal` | "Reassign queue", "Diff view for v{n}" (Prompt tab), formatting toolbar in Prompt tab |
| `/agents/:id/runs/:runId` | `AgentRunDetail` | `useAgent`, `useAgentRun`, `useMutation(api.run.trigger)` | `GET /agents/:id`, `GET /run/:runId`, `POST /run` (Re-run with same inputs) | â€” | â€” |
| `/agents/marketplace` | `Marketplace` (2 tabs: Agents, Workflows) | `useQuery(['marketplace','list',q,category])`, `useTabParam`, `useWorkflowTemplates`, `usePublishedWorkflows`, `useMarketplaceCatalog`, `useNavigate`, `useToast` | `GET /api/marketplace/agents?q&category&limit` (via `api.marketplace.list`), `POST /api/marketplace/agents/:id/install` (bulk, via `runBulkInstall`), `GET /api/marketplace/agents/:id` + `GET /agents` (paired-agent hint for the selection), `GET /api/workflows/templates` + `GET /api/marketplace/workflows` (Workflows tab: Starter workflows, Published by you) | `BulkInstallBar` (sticky) | Doc: [`pages/27-marketplace.md`](pages/27-marketplace.md). Bulk install reports the failing ids + server reason and STAYS on the page with them selected; only a clean sweep navigates to `/agents`. |
| `/agents/marketplace/:id` | `MarketplaceAgentDetail` | `useQuery(['marketplace','agent',id])`, `useQuery(['marketplace','list'])`, `useQueryClient`, `useToast`, `useNavigate` | `GET /marketplace/:id` (via `api.marketplace.get`), `GET /marketplace?limit=100`, `POST /marketplace/:id/install`, `GET /marketplace/:id/export.zip`, `GET /cli/availability`, `GET /agents` | `AddFromMarketplaceModal` | Doc: [`pages/28-marketplace-detail.md`](pages/28-marketplace-detail.md) |
| `/agents/marketplace/workflows/:templateId` | `MarketplaceWorkflowDetail` | `useWorkflowTemplates`, `useAgents`, `useMarketplaceCatalog`; dialog `useProjects`, `useCreateWorkflowFromTemplate` | `GET /workflows/templates`, `GET /agents`, `GET /marketplace/agents?limit=100`, `GET /workflows/templates/:id/export` (link), `POST /workflows/from-template` | `NewWorkflowDialog` (template pre-selected) | Lazy read-only canvas preview (`WorkflowGraphPreview`). Doc: [`pages/28a-marketplace-workflow-detail.md`](pages/28a-marketplace-workflow-detail.md) |
| `/agents/marketplace/workflows/published/:publishedId` | `MarketplaceWorkflowDetail` | `usePublishedWorkflow`, `useUnpublishWorkflow`, `useAgents`, `useMarketplaceCatalog`; dialog `useProjects`, `useImportPublishedWorkflow` | `GET /marketplace/workflows/:id`, `GET /agents`, `GET /marketplace/agents?limit=100`, `GET /marketplace/workflows/:id/export` (link), `POST /marketplace/workflows/:id/use`, `DELETE /marketplace/workflows/:id` | `UsePublishedWorkflowDialog` (project picker), `ConfirmActionModal` (Unpublish) | A workflow you published from a builder. Same page as the starter route. Doc: [`pages/28a-marketplace-workflow-detail.md`](pages/28a-marketplace-workflow-detail.md) |
| `/agents/mcp-tools` | `McpTools` | `useQuery(['tool-catalog'])` | `GET /tool-catalog` (via `api.toolCatalog.get`) | â€” | Doc: [`pages/29-mcp-tools.md`](pages/29-mcp-tools.md) |
| `/analytics` | `Analytics` | `useQuery(['analytics'])` | `GET /analytics` (via `api.analytics.get`) | â€” | Doc: [`pages/30-analytics.md`](pages/30-analytics.md) |
| `/analytics/project/:projectId` | `AnalyticsProject` | `useQuery(['analytics-project', projectId])`, `useQuery(['analytics-project-tasks', …])` | `GET /analytics/project/:projectId`, `GET /analytics/project/:projectId/tasks?page&limit` (via `api.analytics.project` / `api.analytics.projectTasks`) | — | Doc: [`pages/31-analytics-project.md`](pages/31-analytics-project.md) |
| `/analytics/task/:taskId` | `AnalyticsTask` | `useQuery(['analytics-task', taskId])`, `useQuery(['analytics-task-children', …])` | `GET /analytics/task/:taskId`, `GET /analytics/task/:taskId/children?page&limit&type` (via `api.analytics.task` / `api.analytics.taskChildren`) | — | Doc: [`pages/32-analytics-task.md`](pages/32-analytics-task.md) |
| `/notifications` | `Notifications` (2 tabs: external notification, InApp) | `useNotifications`, `useMarkAllRead`, `useResendNotification`, `useCancelNotification`, `useAgents`, `useNow` | `GET /notifications`, `POST /notifications/:id/{resend,cancel}`, `POST /notifications/mark-all-read`, `POST /settings/external-notification/test` | â€” | â€” |
| `/guardrails` | `Guardrails` | `useGuardrails`, `useCreateGuardrail`, `useUpdateGuardrail`, `useDeleteGuardrail`, `useSaveGuardrails`, `useNow` | `GET/POST/PATCH/DELETE /guardrails`, `POST /guardrails/save` | `GuardrailModal` | Discard button only clears session dirty counter, doesn't roll back edits |
| `/settings` | `Settings` (7 tabs: Profile, Environment, **Shared Secrets**, Model Registry, Notifications, **Jira**, Help & About) | `useSettings`, `useJiraConfig`, `useUpdateJiraConfig`, `useTestJira`, `useSyncJira`, `useAllRepos`, `useWorkflows`, `useUpdateProfile`, `useEnv`, `useUpdateEnv`, `useEnvironmentSecrets`, `useSaveEnvironmentSecrets`, `useRestartServer`, `useCliModels`, `useCreateCliModel`, `useRemoveCliModel`, `useUpdateExternalNotification`, `useUpdateNotifications`, `useCredentials`, `useProjects` | `GET /settings`, `PATCH /settings/profile`, `PATCH /settings/constitution`, `GET/PATCH /settings/env`, `GET/PUT /environment-secrets`, `POST /server/restart`, `GET/POST/DELETE /cli-models`, `PATCH /settings/external-notification`, `POST /settings/external-notification/test`, `PATCH /settings/notifications`, `GET/PUT /integrations/jira`, `POST /integrations/jira/{test,sync}`, `GET /repos`, `GET /workflows`, `POST /settings/reset` | `ResetWorkspaceModal`, Restart Server confirm dialog | Chat-ID Detect button (`NotificationsTab.tsx:209-214`) shows "Detection not yet wired" toast |
| `/settings/credentials` | `Credentials` | `useCredentials`, `useMutation(deleteCredential)` | `GET/POST/PATCH/DELETE /credentials` | `CredentialModal` (3-view: kind picker â†’ form â†’ saved), Delete confirm dialog, `CredentialRowMenu` | SSH radio option disabled in the kind picker (`CredentialModal.tsx:415-432`); GitHub App is a working kind. *(corrected 2026-09-22 — "Check expiries", "Verify now" and the App password radio do not exist.)* |
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
| `GET /api/counts` | `useSidenavCounts()` â€” Sidenav badges Counts ALL agents since 2026-09-12 (was `status='active'`, which disagreed with both `/agents` and `/queue`). | `staleTime: Infinity`, `refetchOnMount: false`, SSE-invalidated |
| `GET /api/run?limit=500` | `useActiveRuns()` via `HeaderMascot` (Topbar) | `staleTime: 30_000`, `refetchOnMount: false` (post-2026-06-09 B2 fix), SSE-invalidated |

---

## Sidenav structure

Source: `packages/web/src/components/Sidenav.tsx:24-69`. Counts via `useSidenavCounts()` â†’ `GET /counts`.

```
WORKSPACE
  Dashboard           /              (no count)
  Scratch Pad         /scratch-pad
  Projects (N)        /projects
  Tasks (N)           /tasks
  Queue (N)           /queue
  Terminal            /terminal
  Standalone          /terminal/standalone
  Search              /search
  Analytics           /analytics

AGENTS
  Workflows          /workflows
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

**Unsaved-draft guard.** `DraftGuardProvider` (`packages/web/src/hooks/useDraftGuard.tsx`) wraps `AppShell`. Sidenav rows, BottomNav tabs, MoreSheet rows and the `g`+`<key>` shortcuts navigate through `useConfirmLeave()`. When a mounted form has called `useDraftGuard(true)` (TaskNew, Task Detail's Add sub-task form), they open a **Discard draft?** dialog instead of navigating.

### Mobile behavior

Below the MUI `md` breakpoint (`<900px`, via `useIsMobile()` in `packages/web/src/hooks/useIsMobile.ts`):

- The inline Sidenav is replaced with a temporary `Drawer` (left-anchored, 240px wide). The drawer opens via a hamburger `IconButton` in the mobile `AppBar` and closes on backdrop tap or when a nav link is clicked (via `onNavigate` prop on `Sidenav`).
- The desktop `Topbar` is replaced by `MobileAppBar` (`packages/web/src/components/shell/MobileAppBar.tsx`), which renders: `â‰¡` hamburger Â· page title (set per-page via `useSetPageTitle()` from `PageTitleContext`) Â· optional trailing icon slot. 56pt tall, respects `env(safe-area-inset-top)`.
- A persistent `BottomNav` (`packages/web/src/components/shell/BottomNav.tsx`) renders 4 destinations: **Home** (`/`), **Tasks** (`/tasks`, also active on `/sub-tasks/:id`), **Queue** (`/queue`), **More**. The More tab opens a bottom `Drawer` (`MoreSheet`) listing every secondary sidenav destination so phone users can reach the same routes the desktop sidenav offers: Scratch Pad, Projects, Search, Analytics, Terminal, Standalone, Workflows, Agents, Marketplace, MCP Tools, Notifications, Reminders, Guard-rails, Settings.
- The Shortcuts pill hides below `md` (no keyboard on touch devices).
- List pages (Projects, Tasks, Agents, Credentials) hide their top-right "+ New X" button on mobile and mount a `PageFab` instead, positioned above the bottom nav (`bottom: calc(80px + env(safe-area-inset-bottom))`).
- Tables (`WorkItemTable`, `TaskTable`) render as 2-line MUI list rows (`MobileWorkItemList` / `MobileTaskList`) below `md`.
- Filter-chip rows on Projects, Tasks, Agents scroll horizontally with no wrap on mobile.
- Dialog-based modals stay centered on every breakpoint and self-constrain via `PaperProps.sx` (`m: { xs: 2, sm: 4 }` + `maxHeight: 'calc(100% - 32px/64px)'`). `fullScreen={isMobile}` was removed across the modal surface (`ConfirmDeleteModal`, `Confirm*`, `RenameProjectModal`, `NewProjectModal`, `DeleteProjectModal`, `RecloneProjectModal`, `DuplicateAgentModal`, `AutoFetchScheduleModal`, `ProjectEnvSecretsModal`, `ResetWorkspaceModal`, `ShortcutsDialog`, the Handoffs inline delete confirm) because the edge-to-edge mobile sheet broke visual continuity with the parent UI and made small confirms look like separate pages.
- Sticky bottom action bars (Guardrails Save bar, TaskNew Draft/Submit footer) sit above the bottom nav via `bottom: calc(56px + env(safe-area-inset-bottom))`.
- Tabs on detail pages (Project / Agent / Settings / Notifications) use `variant="scrollable"` so they scroll horizontally on narrow viewports.

---

## Route guard

`packages/web/src/App.tsx:61-88`:

- If `!settings.onboarding_complete` AND `pathname !== '/onboarding'` â†’ redirect to `/onboarding`.
- If `settings.onboarding_complete` AND `pathname === '/onboarding'` â†’ redirect to `/`.

All other authenticated routes always render once onboarding is complete. There are no env-var feature flags hiding routes.
