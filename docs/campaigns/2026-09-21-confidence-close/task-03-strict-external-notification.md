# 03 — `.strict()` on `UpdateExternalNotificationSchema`

**Status:** done — 2026-09-21
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

- [x] `.strict()` added, error shape matches the repos route exactly
- [x] Regression test passes; reverting `.strict()` fails it
- [x] `pnpm -F @atlas/shared test:coverage` still 100/100/100/100
- [x] `.agents/api-surface.md` updated in the same commit
- [x] G-007 flipped to `fixed` in `findings.md`, board row flipped

## Evidence

**Done. `shared` holds 100/100/100/100 (291 stmts, 121 branches, 34 funcs,
255 lines); `settings.test.ts` 40 passed; `schemas.test.ts` 132 passed.**

### The finding was half-wrong, and the half it got right mattered

G-007 said the route "still answers 200". **It does not, and has not since the
predecessor's task-15.** F-019 *was* fixed — at the route, not the schema, and
the code said so out loud at `routes/settings.ts:88`:

> `.strict()` on the schema would be the cleaner fix, but it lives in
> packages/shared (AGENTS.md hard rule 1), so the route rejects the empty
> patch instead.

So the predecessor hit the wall hard rule 1 puts there, chose the legal fix,
and documented the illegal one it wanted. That is the rule working, not a
lapse — and this board's G-007 row overstated it by reading the schema without
reading the route. Corrected in `findings.md`.

What ruling E-4 actually bought is therefore **not** a 200→400 fix. It is a
better 400:

| body | before | after |
|---|---|---|
| `{provider, token, chat_id}` | 400 `"No recognised fields in the request body…"` | 400 `"Unrecognized keys: \"provider\", \"token\", \"chat_id\""` |

The caller is now told *which* key is wrong instead of only that nothing
matched — which is the difference between an agent fixing its payload and an
agent guessing again. It also makes this route agree with
`PATCH /api/projects/:id/repos/:repoId`, and two write routes disagreeing about
whether an unrecognised body is an error was the part of F-019 worth closing.

### The inherited test caught the change, which is the point

`settings.test.ts`'s F-019 case asserted `/no recognised fields/i` — the
route-level wording. `.strict()` moved the rejection a layer earlier and the
message changed, so **that test failed immediately**. It was updated to assert
the key is named, rather than deleted, and the block is now headed
`F-019 / G-007` with both histories in the comment.

The route's empty-patch guard is **kept and still load-bearing**: `{}` is valid
against a schema whose every field is optional, so strictness cannot catch it.
A test in each package now pins that division — one in `shared` asserting `{}`
parses, one in `api` asserting the route still 400s it. Move the empty check
into the schema and both tell you.
