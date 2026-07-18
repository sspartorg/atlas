# @atlas/shared — AI Rules

## ⚠️ PROTECTED PACKAGE

**This package is the single source of truth for the entire Atlas system.**  
**Do NOT modify any file here without explicit owner instruction and a stated reason.**

If you believe a type, constant, or schema needs to change:
1. Stop.
2. Explain the change needed and why to the owner.
3. Wait for explicit approval.
4. Make the change only after approval.

---

## What This Package Contains

```
src/
├── types/       → TypeScript interfaces for all entities (IAgent, IProject, IEpic, IStory, ...)
├── constants/   → Status values, agent categories, issue types, agent accent colors
├── status-machine/ → getValidNextStatuses(), isValidTransition(), getStatusLabel()
└── schemas/     → Zod schemas for all create/update operations
```

## Rules

### Types (`src/types/index.ts`)
- Every entity in the DB has a corresponding TypeScript interface here
- Interfaces use snake_case field names matching SQLite column names
- Nullable DB columns are `string | null`, not `string | undefined`
- Never add `createdAt` — use `created_at` (snake_case throughout)

### Status Machine (`src/status-machine/index.ts`)
- Pure TypeScript functions — no side effects, no imports from api or web
- `getValidNextStatuses(issueType, currentStatus)` — returns ONLY valid next states
- `isValidTransition(issueType, from, to)` — returns boolean
- Status rules are canonical — both API and web import from here
- Tests in `src/status-machine/status-machine.test.ts` must pass after any change

### Schemas (`src/schemas/index.ts`)
- Zod schemas for API input validation
- Schema names: `Create<Entity>Schema`, `Update<Entity>Schema`, `Assign<Entity>Schema`
- Always derive schema field names from the TypeScript interface in `types/`

### Constants (`src/constants/index.ts`)
- `ISSUE_STATUSES`, `SUB_TASK_STATUSES` — ordered arrays
- `AGENT_CATEGORIES` — the 4 valid categories
- `AGENT_ACCENT_COLORS` — keyed by agent role name
- `STATUS_LABELS` — human-readable label for each status

## What Is NOT Allowed Here
- No imports from `@atlas/api` or `@atlas/web`
- No `fetch`, no database calls, no side effects
- No React, no Fastify, no MUI imports
- Runtime dependencies limited to `zod` only
