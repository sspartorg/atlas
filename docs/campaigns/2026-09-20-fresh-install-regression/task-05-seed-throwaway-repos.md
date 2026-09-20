# 05 — Seed two throwaway repos under sspartorg

**Status:** todo
**Depends on:** [task-04](task-04-bot-credential.md)
**Scope:** infra

## Why

The campaign needs two repos that the sspart-bot App can read and write, and
that contain **real** Node projects — a setup script running `npm ci` against
an empty repo proves nothing, and the large sample Task in
[task-07](task-07-sample-tasks-small-medium-large.md) needs a shared contract
to span.

Throwaway, because the campaign will push branches, open PRs, and re-clone
them repeatedly.

## What to do

1. **Check `gh` is authenticated and has org create rights:**
   `gh auth status`, then `gh api /orgs/sspartorg -q .login`. If the account
   cannot create repos in the org, stop and ask the Owner — creating them
   under a personal account changes the App installation scope.

2. **Create the two repos, private:**
   ```
   gh repo create sspartorg/atlas-demo-api --private --add-readme
   gh repo create sspartorg/atlas-demo-web --private --add-readme
   ```

3. **Seed `atlas-demo-api`** — a minimal Express service with vitest, so
   `npm ci` and `npm test` both do real work:
   - `package.json` with `express`, `vitest`, scripts `dev`, `test`, `build`
   - `src/server.ts` exporting an app with one route
   - `src/server.test.ts` with one passing assertion
   - `tsconfig.json`
   - `.gitignore` covering `node_modules`, `dist`, `.env`

4. **Seed `atlas-demo-web`** — a Vite + React app with vitest:
   - `package.json` with `vite`, `react`, `vitest`, same script names
   - `src/main.tsx`, `src/App.tsx`
   - `src/App.test.tsx` with one passing assertion
   - `.gitignore` as above

5. **Give both a shared contract to span.** Add the same
   `src/contract.ts` to each, exporting a single `Item` type. The large sample
   Task's job is to extend it in both repos at once — that is what forces the
   multi-repo workspace.

6. **Verify both build and test cleanly from a fresh clone**, because that is
   exactly what the setup script will do inside a worktree:
   ```
   git clone … /tmp/verify-api && cd /tmp/verify-api && npm ci && npm test
   ```
   Repeat for the web repo. Delete the verification clones afterwards —
   Atlas's own clone must be the first one in the workspace.

7. **Confirm the App installation covers both.** The sspart-bot App must be
   installed on the org with access to these two repos, or every clone in
   [task-06](task-06-project-two-repos-setup-secrets.md) fails with an auth
   error that looks like a bug. Check
   `gh api /orgs/sspartorg/installations` or the App's installation settings.

8. **Record the default branch name** each repo got — `main` or `master`
   changes what goes into the project's repo rows and what `ensureWorktree`
   rebases onto.

## Done when

- [ ] Both repos exist and are private — paste `gh repo list sspartorg --limit 20`
- [ ] Each has a real `package.json` with `dev`, `test` and `build` scripts
- [ ] `npm ci && npm test` passes from a fresh clone of each — paste both tails
- [ ] Both carry an identical `src/contract.ts`
- [ ] The sspart-bot App installation lists both repos — paste the check
- [ ] The default branch name of each is recorded below
- [ ] The two verification clones under `/tmp` are deleted
- [ ] Nothing was created inside `~/Work/workspace` by this task — Atlas clones
      them itself in task-06

## Evidence

*(filled during execution)*

`atlas-demo-api` default branch: ____
`atlas-demo-web` default branch: ____
