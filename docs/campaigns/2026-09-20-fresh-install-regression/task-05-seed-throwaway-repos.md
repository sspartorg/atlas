# 05 — Verify the two sandbox repos

**Status:** done — 2026-09-20
**Depends on:** [task-04](task-04-bot-credential.md)
**Scope:** infra

> ⚠️ **Rewritten 2026-09-20. This task originally created two new repos.**
> Ruling D-2 was amended by the Owner once `sspartorg` was listed and found to
> already hold a matching pair. No repos were created. The original steps
> (create `atlas-demo-api` / `atlas-demo-web` via `gh`, seed them with
> Express+vitest and Vite+vitest) are superseded, not merely skipped.

## Why

The campaign needs two repos the sspart-bot App can read and write, containing
**real** Node projects — a setup script running against an empty repo proves
nothing, and the large sample Task in
[task-07](task-07-sample-tasks-small-medium-large.md) needs two repos to span.

`sspartorg` already has exactly that pair. Using it beats creating new repos on
three counts: no new permanent artifacts in the Owner's org, no risk that the
App installation is scoped to selected repositories and excludes the new ones
(which would need an Owner admin action to fix), and one less task.

## The pair

| Repo | Default branch | Size | Contents |
|---|---|---|---|
| `sspartorg/atlas-sdlc-sandbox` | `main` | 35 KB | `package.json`, `src`, `test`, `tests`, `specs`, `docs` |
| `sspartorg/atlas-sdlc-sandbox-web` | `main` | 6 KB | `package.json`, `src`, `test` |

Both pushed 2026-09-19. Both have `"test": "node --test"`; the web repo also
has `"start": "node src/server.js"`. Neither declares dependencies, so
`npm ci` is a no-op and a setup script must do something else observable —
see the note in [task-06](task-06-project-two-repos-setup-secrets.md).

## Done when

- [x] Both repos exist and are private — confirmed via `gh repo list sspartorg`
- [x] Each has a real `package.json` with a working `test` script
- [x] `npm test` passes from a fresh shallow clone of each — 43 tests and 10
      tests respectively, both zero failures
- [x] The sspart-bot App installation covers them — proven in task-04 by
      minting two live installation tokens against owner `sspartorg`, and by
      the previous Atlas install having cloned `atlas-sdlc-sandbox`
- [x] Default branch of each recorded below
- [x] The verification clones under `/tmp` are deleted
- [x] Nothing was created inside `~/Work/workspace` by this task — Atlas clones
      them itself in task-06
- [x] **No repos were created in the Owner's org**

## Evidence

Executed 2026-09-20.

```
=== atlas-sdlc-sandbox: npm test ===    === atlas-sdlc-sandbox-web: npm test ===
1..43                                   1..10
# tests 43   # pass 43   # fail 0       # tests 10   # pass 10   # fail 0
# duration_ms 313.789125                # duration_ms 81.938959
```

`atlas-sdlc-sandbox` default branch: **main**
`atlas-sdlc-sandbox-web` default branch: **main**

Both verification clones removed from `/tmp` afterwards, so Atlas's own clone
in task-06 is the first one in the workspace.

### Why the shared contract was dropped

The original task added an identical `src/contract.ts` to both repos so the
large sample Task would have a genuine cross-repo change to make. The Owner
chose the plain "use the existing pair" option over the variant that added one.
[Task-07](task-07-sample-tasks-small-medium-large.md)'s large task therefore
has to find its own cross-repo change — it must still touch **both** repos to
exercise the `ws/` workspace and the two-PR path (ruling D-8), so its
description is reworked against what these two repos actually contain rather
than against a contract file that was never added.
