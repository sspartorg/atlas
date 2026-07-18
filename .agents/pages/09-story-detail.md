# Story Detail

**Route:** `/issues/stories/:id` â€¢ **Component:** `packages/web/src/pages/StoryDetail.tsx` â€¢ **Slug:** `issues`

## Purpose
Single-story view. Uses the unified `IssueDetailShell` shared with Epic / Sub-task / Sub-bug / Bug. Title, description, proposed plan, and acceptance criteria are all editable inline. Status and assignee live in the right-rail `DetailsRailCard`.

## States
- **Loading**: skeleton
- **Not found**: "Story not found" + back button
- **Populated**: shared shell layout

## UI elements
**Breadcrumb**: Projects â†’ project â†’ Issues â†’ `EPC-NNN` â†’ `STR-NNN`. Ends with a `CopyLinkButton`.

**Header (via shell)**
- `EditableTitle` â€” click to edit, Enter saves via `useUpdateStory`.
- **3-dots actions menu** (right side of title row, `IssueDeleteAction`): **Clone itemâ€¦** opens `NewIssueModal` pre-filled with the source story's title (`CLONE <title>`), description, and acceptance_criteria; the same parent epic; status reset to `draft`. After create, a `relates_to` link to the source is attached automatically. Below a divider: **Delete this storyâ€¦**.
- **`AddRelatedMenu`** (Jira-style `+` button) sits on its own row directly below the title row. Options: **Add sub-task**, **Add sub-bug** â†’ opens `NewIssueModal` with the story pre-filled as parent. **Add relates-to**, **Add blocked-by** â†’ opens `LinkPickerDialog` to attach an existing item.
- **Blocked-by** + **Relates-to** sections (rendered by `RelatedItemsCard`) are hidden entirely when the underlying link list is empty. The `+` menu options are the add path in that state; the in-section add buttons remain for quick adds once a section is populated.
- `KindChipDetail kind="story"`.

**Body cards** (in order)
- `EditableMarkdownCard` "Description" â€” Save â†’ `useUpdateStory`.
- `EditableMarkdownCard` "Acceptance criteria" â€” body renders as `<ul>` via `renderBody`; Save â†’ `useUpdateStory({ acceptance_criteria })`.
- **Sub-items** card â€” lists sub-tasks + sub-bugs (id, title, kind chip, status chip). Row click â†’ detail page. **Hidden entirely when empty** â€” the `+` menu under the title is the canonical add path.
- `ConversationCard` â€” comments + compose box.

**Right rail**
- `DetailsRailCard` â€” Project (link), Epic parent (link, click navigates to epic), Status (`StatusPickerPopover`), Assignee (`AssigneePickerPopover`), Rounds (A04 â€” `X / Y` against the assignee's `max_rounds`; hidden when no assignee; clickable â†’ `ResetRoundsPopover` so Owner can wipe the counter and give the agent a fresh budget), Created, Last updated.
- `ActivityLogCard` â€” read-only events feed (status changes, reassignments, field edits), under Details in the rail.

## Why these affordances exist
- **Editable Description / Acceptance criteria as separate cards** â€” Description is Owner-authored intent; AC is the Spec Writer's testable contract. Two lifecycles, two save endpoints. (The legacy "Proposed Plan" card was retired by A03's revised design â€” agent narrative now flows through the comments thread.)
- **Acceptance criteria as a list** â€” Sub-tasks and QA agents key off discrete criteria; rendering as `<ul>` enforces the bullet shape that downstream agents expect to parse.
- **AddRelatedMenu (`+` under title)** â€” Jira-style adder. Sub-task / sub-bug creation lives behind the menu instead of an inline link so the affordance doesn't disappear when the sub-items table is hidden (which happens on an empty story).
- **Hide-when-empty on Sub-items table** â€” A story with no sub-items shows only its description + AC; the table appears the moment the first child lands. Removes visual noise from freshly-spec'd stories.
- **Epic parent link in rail** â€” Sub-tasks tunnel up through story â†’ epic to find their project; one click up the rail is faster than back-navigating through Issues.
- **CopyLinkButton** â€” Stories get shared into PR descriptions and external notification; clipboard copy short-circuits manual URL construction.

## Modals / drawers
- `NewIssueModal` (sub-item creation).

## Hooks used
- `useStoryFull(id)` â€” single composite hook returning story + sub-tasks + sub-bugs + project + epic + activity (`StoryDetail.tsx:13`)
- `useEpics`, `useProjects`, `useAgents`, `useSettings`
- `useTransitionStory`, `useUpdateStory`, `useAssignStory`, `useDeleteStory`, `useResetRoundsStory`
- `useItemAgentRuns(id)` â€” recent agent runs against this story
- `useProjectLabels(projectId)` â€” labels picker

(Legacy `useSetProposedPlan` + `PATCH /:id/plan` are retired; agent narrative flows through the comments thread.)

## API endpoints touched
- `GET /api/stories/:id/full` â€” single composite endpoint
- `PATCH /api/stories/:id` (title, description, acceptance_criteria, labels)
- `PATCH /api/stories/:id/status`, `PATCH /api/stories/:id/assign`
- `POST /api/stories/:id/reset-rounds`, `DELETE /api/stories/:id`

## Edge cases / quirks
- Epic short ID is still derived by replacing `STR` with `EPC` in the seq id (matches the prior behaviour).
- Reporter row is hidden on Story (per shell config; reporter only renders when `reporter` prop is passed).

## Connectivity
- **Pages**: [Issues](08-issues.md) â€” primary entry; [Epic Detail](07-epic-detail.md) â€” rail link target (parent); [Sub-task Detail](10-sub-task-detail.md), [Sub-bug Detail](12-sub-bug-detail.md) â€” sub-items card row click.
- **MCP tools**: `get_story { id, include_children: true }` â€” the single call a Coder agent runs after picking up a sub-task, to fetch the parent story's spec + sibling sub-tasks without three separate round-trips.
- **Entities**: `story`, `sub_task`, `sub_bug`, `epic` (parent), `comment`, `issue_event`.

## Coming soon on this page
None.
