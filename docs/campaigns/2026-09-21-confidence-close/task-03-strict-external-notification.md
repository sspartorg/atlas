# 03 — `.strict()` on `UpdateExternalNotificationSchema`

**Status:** todo
**Depends on:** task-01
**Scope:** shared

## Why

G-007. `PATCH /api/settings/external-notification` answers a body whose field
names are all unrecognised with **200 OK, having written nothing**. Zod strips
unknown keys by default and all four declared fields are `.optional()`, so
`{provider, token, chat_id}` — the un-prefixed names an agent would naturally
guess — parses to `{}`, the route applies an empty patch, and the caller is told
it succeeded.

The real UI sends the right names, which is why this is P3 and not higher. It
matters because the same API is driven by agents over MCP, where a wrong-shaped
body is likely and a 200 teaches the agent its write landed.

The predecessor marked F-019 `fixed` in task-15, but the schema is unchanged at
`packages/shared/src/schemas/index.ts:634`. What it actually did was document it
and hand the edit to the Owner, because `packages/shared` is protected. Ruling
E-4 is that waiver.

## What to do

1. Add `.strict()` to `UpdateExternalNotificationSchema`.
2. Match the error shape that already ships — `PATCH /api/projects/:id/repos/:repoId`
   answers `{"error":"Unrecognized key: \"credential_id\"","kind":"validation_error"}`.
   Two write routes disagreeing on this is the actual defect; do not invent a
   third shape.
3. One regression test asserting the 400 and the error body.

## Traps

- This is the **only** change permitted in `packages/shared` under E-4 besides
  task-02's fixture rename. No type change, no second field, no refactor.
- `shared` gates at **100% on all four metrics**. A new branch with no test
  fails `pnpm -w run gate` for the whole workspace.
- A body that is legitimately empty (`{}`) is a different case from one that is
  empty *after stripping*. Decide which one 400s and say so in the test name.

## Done when

- [ ] `.strict()` added, error shape matches the repos route exactly
- [ ] Regression test passes; reverting `.strict()` fails it
- [ ] `pnpm -F @atlas/shared test:coverage` still 100/100/100/100
- [ ] `.agents/api-surface.md` updated in the same commit
- [ ] G-007 flipped to `fixed` in `findings.md`, board row flipped

## Evidence

_Written after execution._
