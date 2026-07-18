# Epic Detail

**Route:** `/epics/:id` • **Component:** `packages/web/src/pages/EpicDetail.tsx` • **Slug:** `epics`

## Purpose
Full epic view sharing the unified work-item shell with stories, sub-tasks, sub-bugs, and bugs. Renders editable title, description, and proposed plan; lists child stories and bugs; surfaces conversation; and exposes status / assignee changes via the right-rail Details card.

## States
- **Loading**: skeleton
- **Not found**: "Epic not found" + back button
- **Populated**: shared `IssueDetailShell` layout

## UI elements
**Shell (shared with story/bug/sub-task/sub-bug)**
- Breadcrumb: Projects → project name → **[Kind icon with tooltip]** + `EPC-NNN`. A `CopyLinkButton` follows the last crumb and copies `window.location.href`.
- `EditableTitle` — click to edit, Enter or check icon saves via `useUpdateEpic`.
- **`AddRelatedMenu`** (Jira-style `+` button) sits on its own row directly below the title row (which carries the title + 3-dots actions menu). Options: **Add story**, **Add bug** → opens `NewIssueModal` with the epic pre-filled as parent. **Add relates-to**, **Add blocked-by** → opens `LinkPickerDialog` to attach an existing item.
- **Blocked-by** + **Relates-to** sections (rendered by `RelatedItemsCard`) are hidden entirely when their underlying link list is empty. The `+` menu options carry the affordance in that state; the in-section "Add dependency" / "Link an item" buttons inside the tables remain for quick adds once the section is populated.
- The previous `KindChipDetail` text chip is gone — its job is now the breadcrumb icon, which reveals the type on hover.

**Body cards** (in order)
- `EditableMarkdownCard` for **Description** — click pencil to edit, Save calls `useUpdateEpic`.
- **Stories** card — lists child stories with `STR-NNN` short IDs, title, status chip; click → `/issues/stories/:id`. **Hidden entirely when empty** — the `+` menu under the title is the canonical add path, so a vacant "Stories" header is just noise.
- **Bugs** card — same structure as Stories, lists `useBugs({ epicId })`; click → `/issues/bugs/:id`. **Hidden entirely when empty**.
- `ConversationCard` — comments + compose box for human/agent back-and-forth. The pure interaction surface.

**Right rail**
- `DetailsRailCard` — Project (link), Status (clickable → `StatusPickerPopover`), Assignee (clickable → `AssigneePickerPopover`, locked when agent is running), Reporter, Priority (clickable picker), **Labels** (via `LabelsRailRow` + `useProjectLabels` — Task 2), Rounds (A04 — `X / Y` against the assignee's `max_rounds`; hidden when no assignee; clickable → `ResetRoundsPopover` so Owner can wipe the counter and give the agent a fresh budget), **Total cost (USD)** rolled up from `useItemAgentRuns`, Created, Last updated.
- `IssueDeleteAction` — 3-dots menu carries Delete (calls `useDeleteEpic`; confirms via `ConfirmDeleteModal`).
- `ActivityLogCard` — read-only feed of status changes, reassignments, and field edits. Lives in the rail beneath the details so audit context sits with the rest of the metadata; on mobile it stacks below Details, after Conversation.

## Why these affordances exist
- **Description as a stand-alone Editable card** — The Owner's intent lives in its own card with its own save endpoint. (The legacy "Proposed Plan" card was retired by A03's revised design — agent narrative now flows through the comments thread, with one auto-comment per agent persona at run end.)
- **AddRelatedMenu (`+` under title)** — Jira-style adder, one place to create any child issue type without scrolling to the matching section's button. Type-aware: epic offers story/bug, story offers sub-task/sub-bug.
- **Hide-when-empty on child tables** — Empty "Stories"/"Bugs" sections used to render a heading and a placeholder row. Now they're hidden until the first child appears, so a fresh epic shows only its title + description until decomposition lands.
- **Bugs card** — Bugs in scope of an epic but not under a specific story need somewhere to live; visible from the epic so they don't get lost when story decomposition starts.
- **Conversation in the main column / Activity log in the rail** — Comments are bi-directional (the Owner replies, agents post questions), so they live in the reading column. Status changes / reassignments / field edits are audit content — read-only, infrequently scanned — so they move next to the other metadata in the rail. On mobile both stack under Details after Conversation.
- **DetailsRailCard** — Metadata (status/assignee/reporter/priority) belongs in the rail so it stays eye-level while the Owner reads the body.

## Hooks used
- `useEpicFull(id)` — single composite hook returning epic + child stories + child bugs + project + activity in one payload (`EpicDetail.tsx:29`)
- `useEpics()` (for seq numbering)
- `useProjects`, `useAgents`, `useSettings`
- `useTransitionEpic`, `useAssignEpic`, `useUpdateEpic`, `useDeleteEpic`, `useResetRoundsEpic`
- `useItemAgentRuns(id)` — recent runs against this epic (for the Activity feed + cost rollup)
- `useProjectLabels(projectId)` — label-picker suggestions for `LabelsRailRow`

(`useSetProposedPlan` and the `PATCH /:id/plan` endpoint were retired by A03's revised design — agent narrative now flows through the comments thread.)

## API endpoints touched
- `GET /api/epics/:id/full` — single composite endpoint backing `useEpicFull`
- `PATCH /api/epics/:id` (title, description), `PATCH /api/epics/:id/status`, `PATCH /api/epics/:id/assign`
- `POST /api/epics/:id/reset-rounds`, `DELETE /api/epics/:id`

## Edge cases / quirks
- Owner override is built into the status popover's "Override" section, so manual transitions land via `transitionEpic({ override: true })`.
- Assignee row is locked (lock icon) when the assignee is mid-run on the epic.

## Connectivity
- **Pages**: [Epics](05-epics.md) — list / kanban that lands here; [Epic New](06-epic-new.md) — siblings created here become rows in the Stories card; [Story Detail](09-story-detail.md), [Bug Detail](11-bug-detail.md) — child cards deep-link here.
- **Routes**: `PATCH /api/epics/:id/plan` — separate from the generic PATCH because plan edits have their own author/timestamp meta; `GET /api/issues/:type/:id/activity` — single composite that merges comments + events so the activity card costs one round-trip.
- **MCP tools**: `get_epic { id }`, `get_epic_tree { id }` — the canonical "give me the full picture of this epic" call an AI client makes when the Owner says "look at EPC-NNN". `get_epic_tree` is preferred because it returns stories + bugs + their children in one payload.
- **Entities**: `epic`, `story`, `bug`, `comment`, `issue_event`, `agent` (assignee/reporter).

## Coming soon on this page
None.
