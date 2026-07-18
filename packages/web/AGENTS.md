# @atlas/web — AI Rules

## Responsibility

React 19 + Vite SPA on port 4000 (dev) / 5000 (prod). Owns:
- All UI components (MUI-based)
- 19 page routes (React Router v7)
- Data fetching (TanStack Query + typed fetch client)
- SSE subscription (EventSource)
- Atlas design system implementation (theme + tokens)

---

## File Structure Rules

```
src/
├── main.tsx            → Entry. ThemeProvider + CssBaseline + App.
├── App.tsx             → BrowserRouter + Routes. No logic here.
├── theme/
│   ├── theme.ts        → MUI createTheme (the ONLY place the theme is defined)
│   ├── tokens.ts       → Design tokens (ATLAS_PALETTE, SPACING, ELEVATION, MOTION, TYPOGRAPHY)
│   └── index.ts        → Barrel
├── components/         → Shared components used across pages (Sidenav, Topbar, StatusChip, etc.)
├── pages/              → One file (or folder) per route. Page-level only.
├── hooks/              → Custom hooks. All data fetching lives here.
│   ├── useAgents.ts   → wraps TanStack Query for GET /api/agents
│   └── useSSE.ts       → EventSource wrapper for /api/events
└── api/
    └── api.ts          → Typed fetch wrapper. ALL API calls go through here.
```

## MUI Usage Rules

### ✅ Always use sx prop with theme tokens
```tsx
// Good
<Box sx={{ p: 4, background: 'background.paper', borderRadius: 2 }} />
<Box sx={{ color: 'primary.main', borderColor: 'divider' }} />

// For Atlas-specific values not in MUI palette:
import { ATLAS_PALETTE, MOTION } from '@/theme/tokens';
<Box sx={{ background: ATLAS_PALETTE.navyLight, transition: `all ${MOTION.hover}ms ease` }} />
```

### ❌ Never hardcode values
```tsx
// Wrong — these will break if theme changes
<Box sx={{ background: '#1A2A3A', color: '#007AC9', padding: '16px' }} />
<div style={{ display: 'flex', gap: '8px' }} />
```

### Component rules
- Use MUI components only: `Box`, `Typography`, `Stack`, `Card`, `Chip`, `Button`, etc.
- No raw `<div>`, `<span>`, `<p>` — use `<Box component="div">` only when MUI has no equivalent
- One exception: `<Box component="span" className="material-symbols-rounded">` for Material icons

## Data Fetching Pattern

```tsx
// hooks/useAgents.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IAgent } from '@atlas/shared';

export function useAgents() {
  return useQuery<IAgent[]>({
    queryKey: ['agents'],
    queryFn: () => api.agents.list(),
  });
}

// In component:
function AgentsList() {
  const { data: agents, isLoading } = useAgents();
  // ...
}
```

- All API calls go through `api/api.ts` — never `fetch('/api/...')` directly in components
- Loading states use MUI `<Skeleton>` with shimmer animation
- Error states use MUI `<Alert severity="error">`

## Status Display Rules

```tsx
import { getValidNextStatuses, getStatusLabel } from '@atlas/shared';

// Show ONLY valid next statuses — HIDE invalid ones (don't disable/grey them out)
const validNext = getValidNextStatuses(issueType, currentStatus);
{validNext.map(status => (
  <MenuItem key={status} onClick={() => transition(status)}>
    {getStatusLabel(status)}
  </MenuItem>
))}
```

## Page Header Action Area

Top-right of every page follows this 4-tier hierarchy:

- **Primary** — green `ATLAS_PALETTE.green` filled `<Button>` for "+ create new X" (Projects, Issues, Epics, Agents, Credentials).
- **Operational** — outlined `<Button>` for utilities (Pause, Mark All Read, Notification Settings).
- **Mode** — `<ViewModeToggle>` / `<ViewToggle>` or `Filters/Query` toggle.
- **Overflow** — `<IconButton>` with kebab icon (rightmost).

Conformance notes:
- Pages with no create-at-this-level may show only the kebab (e.g., Project detail).
- Pages that are pure dashboards/monitors may show only operational buttons (e.g., Queue, Notifications).
- Issue-detail pages have no header actions — editing happens inline on the title.

## Page Subtitle Pattern

Under the H1, choose one of 3 buckets:

- **Hero** — only Dashboard. Large mixed-color phrase, ~48px.
- **Counter strip** — only Queue. Mono dots of live stats (`running 0× · queued 2× · …`).
- **Metadata** — everywhere else. Small slate60 text, may include inline mono spans for IDs/counts.

Do not invent a new subtitle shape (no status pills, no bold-keyword paragraphs as a separate variant).

## Typography Rules

- Page title: `<Typography variant="h2">`
- Section header: `<Typography variant="h4">`
- Body text: `<Typography variant="body1">` (default)
- Metadata/captions: `<Typography variant="caption">`
- IDs and paths: `sx={{ fontFamily: '"JetBrains Mono", monospace' }}`
- Section labels (uppercase): `<Typography variant="overline">`

## Component Naming

- Page components: `Dashboard.tsx`, `AgentsLibrary.tsx` (PascalCase)
- Shared components: `AgentCard.tsx`, `StatusChip.tsx`, `IssueRow.tsx`
- Hooks: `useAgents.ts`, `useSSE.ts`, `useEpics.ts`
- All use named exports (no default exports)

## What NOT to Do

- No direct DB access (web never imports from @atlas/api)
- No fetch('/api/...') outside api/api.ts
- No hardcoded colors, spacing, or motion values
- No Tailwind, no CSS modules, no styled-components
- No `console.log` (use browser dev tools; remove before committing)
- No `any` type without a comment explaining why
