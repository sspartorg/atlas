# 19 — Security audit: evidence-based, targeted

**Status:** todo
**Depends on:** [task-13](task-13-cross-dependency-sweep.md)
**Scope:** api · infra

## Why

The Owner wants companies to be able to adopt Atlas. Ruling D-10 keeps this
targeted rather than formal: no STRIDE pass over ~200 routes, no SBOM, no
threat-model document. What it does instead is check the places where Atlas
already knows it is handling something dangerous, and prove the guards hold.

Atlas is single-owner and local-first — there is no auth surface, no session
tokens and no user table, so the usual authn/authz audit does not apply. The
real attack surface is: stored credentials, the secrets pipeline, the MCP
write gate, and text from Jira that becomes agent prompt text.

## What to do

### 1. Dependencies
`pnpm audit --audit-level=moderate`. Record every advisory with its path and
whether it is reachable from runtime code or only from a dev dependency. A
transitive dev-only advisory is not the same finding as a runtime one — say
which.

### 2. Secret-at-rest and secret-in-flight
- Every stored secret is AES-256-GCM under `~/.config/Atlas/workspace.key`
  (`services/crypto.ts`). Confirm the key file is mode 0600 and that a fresh
  install generated it rather than deriving a predictable value.
- **X1:** no list or get response returns plaintext. This is walked in
  [task-11](task-11-walk-wave-d-settings-admin.md); here, confirm it from the
  route side — grep every route that touches `credentials`,
  `environment_secrets`, `project_env_vars`, `jira_config` and
  `settings.external_notification_*` and verify the read model is
  metadata-only. `environment-secrets.ts` documents `list()` / `dbList()` as
  never-expose-on-a-route; confirm no route calls them.
- Every reveal endpoint logs `{tag:'secret_reveal'}`.

### 3. Tokens on disk and in process state
Three known-dangerous materialisations, each with a documented guard:
- **Git config temp dir** (`services/git-credentials.ts:104`) — contains a
  base64 `AUTHORIZATION: basic` header with a live token, mode 0600, handed to
  git via `GIT_CONFIG_GLOBAL` and never argv, so it does not appear in `ps`.
  Confirm it does not appear in `ps` during a run, and that `cleanupGitConfig`
  removes it in a `finally`. **A crash mid-run leaves it behind** — that is a
  real residual risk; measure how long a leftover token stays valid.
- **Setup-script temp file** (`project-setup-runner.ts`) — contains decrypted
  secrets inlined, mode 0600, `$TMPDIR` not the worktree, unlinked in a
  `finally`, swept at boot. Confirm all four properties.
- **Output redaction** — every secret value of length ≥ 4 replaced with `***`
  before `setup_output_text` is stored. Test the boundary: a 3-character secret
  is **not** redacted. Decide whether that is acceptable and record the ruling.

### 4. The MCP write gate
`packages/api/src/plugins/mcp-auth.ts` (`requireMcpToken`, `ATLAS_MCP_TOKEN`)
guards nearly every mutating route. **An empty token means fully open**, warned
loudly at boot. The MCP host binds `127.0.0.1:4500` by default.
- Confirm the boot warning fires when the token is empty.
- Confirm "nearly every" is actually every: enumerate mutating routes and find
  the ones not covered. Each uncovered route is a finding with its reason.
- Confirm the listener is loopback-only, and check what `ATLAS_LAN_ACCESS=true`
  changes — a LAN-exposed MCP endpoint with an empty token is a P0 shape.

### 5. The Jira trust boundary
ADR 0016 names this explicitly: anyone who can edit an issue matching the JQL
writes text that becomes agent prompt text, and a mapped label queues it
without Owner review. The guards are that imported text is quoted line by line
under a note saying it describes the work and is not an instruction, and that
the token is bound to the site and email it was entered for.
- Verify the quoting empirically — put something instruction-shaped in a Jira
  description and confirm it appears quoted, not executed.
- Verify `/test` never sends the stored token to a different site, and that
  changing site or email drops the token.
- Verify http is refused except on loopback.

### 6. Secretlint and the pre-commit hook
`.secretlintrc.json` plus the husky hook is the last line of defence before
history. Confirm the hook fires, and confirm nothing in this campaign's own
commits bypassed it — `git log` for any commit whose content suggests
`--no-verify`.

### 7. Repository hygiene
AGENTS.md hard rule 6 forbids committing audit artifacts. Confirm the campaign
itself complied: no screenshots, `.har`, `.ndjson`, `e2e-logs/`,
`test-results/` or `verification-*.png` in any commit on this branch.

## Done when

- [ ] `pnpm audit` output pasted, each advisory classified runtime vs dev-only
- [ ] `workspace.key` is 0600 and was freshly generated
- [ ] No route returns a plaintext secret — paste the route-side grep and its
      analysis
- [ ] `list()` / `dbList()` have no route callers
- [ ] Every reveal logs `{tag:'secret_reveal'}`
- [ ] No token appears in `ps` output during a live run — paste the check
- [ ] Both temp-file classes are 0600, outside the worktree, and cleaned in a
      `finally`; the crash-residual window is measured and recorded
- [ ] The ≥ 4-character redaction boundary is tested and ruled on
- [ ] Every mutating route is enumerated against `requireMcpToken`; uncovered
      ones are listed with reasons
- [ ] The empty-token boot warning fires; the MCP listener is loopback-only;
      `ATLAS_LAN_ACCESS=true` behaviour is recorded
- [ ] Instruction-shaped Jira text arrives quoted and is not executed
- [ ] The Jira token drops when site or email changes; http is refused off
      loopback
- [ ] Secretlint fires on a planted test secret, and no campaign commit
      bypassed it
- [ ] No audit artifact was committed on this branch — paste
      `git log --name-only` filtered against the forbidden patterns
- [ ] Findings are filed in [findings.md](findings.md) with severities; the
      claim "0 vulnerabilities" is made **only** if the register supports it,
      and is stated as "no findings above P3 in the audited surface", never as
      an unqualified absolute

## Evidence

*(filled during execution)*
